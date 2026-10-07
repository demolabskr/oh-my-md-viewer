'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme, clipboard, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');

const APP_NAME = 'OMMV';
const REPO_URL = 'https://github.com/demolabskr/oh-my-md-viewer';
const MD_RE = /\.(md|markdown|mdown|mkd|mkdn|mdwn)$/i;
const MAX_BYTES = 30 * 1024 * 1024;

const DEFAULT_PREFS = { theme: 'system', toc: true, width: 'medium', zoom: 0, bounds: null, maximized: false, recent: [] };
const THEMES = ['system', 'light', 'dark'];
const WIDTHS = ['narrow', 'medium', 'wide', 'full'];

app.setAppUserModelId('com.github.demolabskr.ommv');

/**
 * 네트워크(UNC)로 향하는 file: 주소인가?
 * 악성 문서가 ![](//서버/a.png), file://서버/…, url(file://…) 등으로 SMB 접속을 유발하면
 * Windows 가 로그인 해시(NTLM)를 서버로 보낼 수 있으므로 모든 요청 단계에서 차단한다.
 */
function isRemoteFileUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return true; }
  if (u.protocol !== 'file:') return false;
  if (u.host && u.host.toLowerCase() !== 'localhost') return true;
  let p = u.pathname;
  try { p = decodeURIComponent(p); } catch { /* 그대로 */ }
  return /^[\\/]{2}/.test(p); // file:////서버/공유/…
}

/* ───────────────────────── 환경설정 저장소 ───────────────────────── */
let prefs = { ...DEFAULT_PREFS };
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const customCssFile = () => path.join(app.getPath('userData'), 'custom.css');

function loadPrefs() {
  try {
    const j = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    prefs = { ...DEFAULT_PREFS, ...j };
  } catch { /* 첫 실행 */ }
  if (!THEMES.includes(prefs.theme)) prefs.theme = 'system';
  if (!WIDTHS.includes(prefs.width)) prefs.width = 'medium';
  if (!Array.isArray(prefs.recent)) prefs.recent = [];
  if (typeof prefs.zoom !== 'number') prefs.zoom = 0;
}
function savePrefsNow() {
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2));
  } catch { /* best effort */ }
}
let saveTimer;
function savePrefs() { clearTimeout(saveTimer); saveTimer = setTimeout(savePrefsNow, 300); }
const publicPrefs = () => ({ theme: prefs.theme, toc: prefs.toc, width: prefs.width, zoom: prefs.zoom });

/* ───────────────────────── 파일 읽기 ───────────────────────── */
/** 파일 바이트 → { text, enc }  (enc: utf-8 | utf-8-bom | utf-16le | utf-16be | euc-kr) */
function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(buf.subarray(3)), enc: 'utf-8-bom' };
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), enc: 'utf-16le' };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), enc: 'utf-16be' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'utf-8' }; } catch { /* UTF-8 아님 */ }
  try { return { text: new TextDecoder('euc-kr').decode(buf), enc: 'euc-kr' }; } catch { return { text: new TextDecoder('utf-8').decode(buf), enc: 'utf-8' }; }
}

/** 텍스트 → 파일 바이트 (읽을 때의 인코딩을 그대로 유지) */
function encodeText(text, enc) {
  if (enc === 'utf-8-bom') return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  if (enc === 'utf-16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  if (enc === 'utf-16be') return Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]);
  return Buffer.from(text, 'utf8');
}

function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}

function readDocFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('파일이 아니에요.');
  if (stat.size > MAX_BYTES) throw new Error('파일이 너무 커요 (30MB 초과).');
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8000).includes(0) && !(buf[0] === 0xff && buf[1] === 0xfe) && !(buf[0] === 0xfe && buf[1] === 0xff)) {
    throw new Error('텍스트 파일이 아닌 것 같아요.');
  }
  const { text, enc } = decodeText(buf);
  return { text, enc, eol: detectEol(text), sig: `${stat.mtimeMs}:${stat.size}` };
}

/** 임시 파일에 쓴 뒤 이름을 바꿔 교체 (저장 도중 문제가 생겨도 원본이 깨지지 않게). 실패하면 직접 덮어쓴다 */
function writeFileSafely(file, buf) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.ommv-${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    fs.writeFileSync(file, buf);
  }
}

function readCustomCss() {
  try {
    const f = customCssFile();
    if (fs.existsSync(f) && fs.statSync(f).size < 300 * 1024) return fs.readFileSync(f, 'utf8');
  } catch { /* ignore */ }
  return '';
}

/* ───────────────────────── 창 관리 ───────────────────────── */
/** webContents.id → { win, file, history, idx, sig, unwatch } */
const states = new Map();
const stateOf = (wc) => states.get(wc.id);
const focusedState = () => {
  const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  return w ? states.get(w.webContents.id) : null;
};

function initialBounds() {
  const b = prefs.bounds;
  const opts = { width: (b && b.width) || 1100, height: (b && b.height) || 800 };
  if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) {
    const n = states.size * 28;
    const x = b.x + n, y = b.y + n;
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return x >= a.x - 50 && y >= a.y - 10 && x < a.x + a.width - 120 && y < a.y + a.height - 120;
    });
    if (visible) { opts.x = x; opts.y = y; }
  }
  return opts;
}

function createWindow(file) {
  const isFirst = states.size === 0;
  const win = new BrowserWindow({
    ...initialBounds(),
    minWidth: 420,
    minHeight: 320,
    show: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1117' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const wc = win.webContents;
  const st = { win, file: file || null, history: file ? [file] : [], idx: file ? 0 : -1, sig: null, unwatch: null, enc: 'utf-8', eol: '\n', dirty: false, mode: 'render', closeAfterSave: false };
  states.set(wc.id, st);
  if (file) { addRecent(file); watch(st); }

  if (isFirst && prefs.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  wc.on('did-finish-load', () => wc.setZoomLevel(prefs.zoom));

  // 외부 탐색·새 창 차단 (링크는 전부 IPC 로 직접 처리)
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));

  wc.on('context-menu', (_e, params) => {
    const items = [];
    if (params.selectionText) items.push({ role: 'copy', label: '복사' });
    if (/^(https?:|mailto:)/i.test(params.linkURL || '')) {
      items.push({ label: '링크 주소 복사', click: () => clipboard.writeText(params.linkURL) });
    }
    if (params.mediaType === 'image' && /^https?:/i.test(params.srcURL || '')) {
      items.push({ label: '이미지 주소 복사', click: () => clipboard.writeText(params.srcURL) });
    }
    items.push({ role: 'selectAll', label: '전체 선택' });
    if (st.file) items.push({ type: 'separator' }, { label: '탐색기에서 보기', click: () => shell.showItemInFolder(st.file) });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  win.on('close', (e) => {
    if (st.dirty) {
      e.preventDefault();
      const r = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['저장', '저장 안 함', '취소'],
        defaultId: 0,
        cancelId: 2,
        message: '저장하지 않은 변경 사항이 있어요',
        detail: path.basename(st.file || ''),
      });
      if (r === 0) { st.closeAfterSave = true; wc.send('cmd', 'save'); }
      else if (r === 1) { st.dirty = false; win.close(); }
      return;
    }
    prefs.maximized = win.isMaximized();
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) prefs.bounds = win.getBounds();
    savePrefs();
  });
  win.on('closed', () => { st.unwatch && st.unwatch(); states.delete(wc.id); });

  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  return st;
}

function openInNewWindowOrFocus(file) {
  for (const st of states.values()) {
    if (st.file && path.resolve(st.file).toLowerCase() === path.resolve(file).toLowerCase()) {
      if (st.win.isMinimized()) st.win.restore();
      st.win.focus();
      return st;
    }
  }
  return createWindow(file);
}

/* ───────────────────────── 문서 로드·히스토리 ───────────────────────── */
function buildPayload(st, extra = {}) {
  const { text, sig, enc, eol } = readDocFile(st.file);
  st.sig = sig;
  st.enc = enc;
  st.eol = eol;
  const dir = path.dirname(st.file);
  return {
    path: st.file,
    name: path.basename(st.file),
    dir,
    dirUrl: pathToFileURL(dir).href.replace(/\/?$/, '/'),
    text,
    canBack: st.idx > 0,
    canForward: st.idx < st.history.length - 1,
    customCss: readCustomCss(),
    ...extra,
  };
}

function sendDoc(st, extra) {
  if (st.win.isDestroyed()) return;
  try {
    st.win.webContents.send('doc:load', buildPayload(st, extra));
    st.win.setTitle(`${path.basename(st.file)} — ${APP_NAME}`);
  } catch (e) {
    st.win.webContents.send('doc:load', { error: `파일을 읽을 수 없어요: ${e.message}` });
  }
}

/** 미저장 변경이 있으면 버릴지 묻는다. true 면 진행 */
function confirmDiscard(st, what) {
  if (!st.dirty) return true;
  const r = dialog.showMessageBoxSync(st.win, {
    type: 'warning',
    buttons: [`저장하지 않고 ${what}`, '취소'],
    defaultId: 1,
    cancelId: 1,
    message: '저장하지 않은 변경 사항이 있어요',
    detail: '취소한 뒤 Ctrl+S 로 저장하고 다시 시도하세요.',
  });
  if (r !== 0) return false;
  st.dirty = false;
  return true;
}

function navigateTo(st, file, opts = {}) {
  file = path.resolve(file);
  if (!MD_RE.test(file)) {
    dialog.showMessageBox(st.win, { type: 'info', message: 'Markdown(.md) 파일만 열 수 있어요', detail: file });
    return false;
  }
  try { readDocFile(file); } catch (e) {
    dialog.showMessageBox(st.win, { type: 'error', message: '파일을 열 수 없어요', detail: `${file}\n${e.message}` });
    return false;
  }
  if (!opts.skipGuard && !confirmDiscard(st, '이동')) return false;
  if (st.history[st.idx] !== file) {
    st.history = st.history.slice(0, st.idx + 1);
    st.history.push(file);
    st.idx = st.history.length - 1;
  }
  st.file = file;
  addRecent(file);
  watch(st);
  sendDoc(st, { hash: opts.hash || null, restore: false, keepMode: !!opts.keepMode });
  return true;
}

function navHistory(st, dir) {
  const next = st.idx + (dir === 'back' ? -1 : 1);
  if (next < 0 || next >= st.history.length) return;
  if (!confirmDiscard(st, '이동')) return;
  st.idx = next;
  st.file = st.history[next];
  watch(st);
  sendDoc(st, { restore: true });
}

function reload(st, { force = false, retry = true } = {}) {
  if (!st.file || st.win.isDestroyed()) return;
  try {
    const stat = fs.statSync(st.file);
    if (!force && st.sig === `${stat.mtimeMs}:${stat.size}`) return;
    if (force && !confirmDiscard(st, '다시 불러오기')) return;
    sendDoc(st, { restore: true, force });
  } catch {
    if (retry) setTimeout(() => reload(st, { force, retry: false }), 300);
  }
}

/** 파일 변경 감시 (에디터의 '임시파일 → 이름 변경' 저장 방식도 처리하려고 폴더를 감시) */
function watch(st) {
  if (st.unwatch) { st.unwatch(); st.unwatch = null; }
  if (!st.file) return;
  const file = st.file;
  const base = path.basename(file).toLowerCase();
  let timer;
  const trigger = () => { clearTimeout(timer); timer = setTimeout(() => reload(st), 150); };
  try {
    const w = fs.watch(path.dirname(file), { persistent: false }, (_ev, name) => {
      if (!name || String(name).toLowerCase() === base) trigger();
    });
    w.on('error', () => {});
    st.unwatch = () => { clearTimeout(timer); w.close(); };
  } catch {
    fs.watchFile(file, { interval: 1000, persistent: false }, (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs) trigger(); });
    st.unwatch = () => { clearTimeout(timer); fs.unwatchFile(file); };
  }
}

function addRecent(file) {
  prefs.recent = [file, ...prefs.recent.filter((f) => f.toLowerCase() !== file.toLowerCase())].slice(0, 10);
  try { app.addRecentDocument(file); } catch { /* ignore */ }
  savePrefs();
  for (const st of states.values()) if (!st.win.isDestroyed()) st.win.webContents.send('recent', prefs.recent);
  if (app.isReady()) buildMenu();
}

/* ───────────────────────── 링크 처리 ───────────────────────── */
function handleLink(st, href) {
  if (typeof href !== 'string' || !href || href.length > 4096) return;
  if (/^(https?:|mailto:|tel:)/i.test(href)) { shell.openExternal(href); return; }

  let hash = '';
  let p = href;
  const hi = p.indexOf('#');
  if (hi >= 0) { hash = p.slice(hi + 1); p = p.slice(0, hi); }
  const qi = p.indexOf('?');
  if (qi >= 0) p = p.slice(0, qi);

  if (!p) { st.win.webContents.send('doc:scroll', hash); return; }

  const isDrive = /^[a-zA-Z]:[\\/]/.test(p);
  if (!isDrive && /^[a-z][a-z0-9+.-]+:/i.test(p) && !/^file:/i.test(p)) return; // javascript:, data: 등은 무시

  let target;
  try {
    if (/^file:/i.test(p)) target = fileURLToPath(p);
    else {
      let d = p;
      try { d = decodeURIComponent(p); } catch { /* 그대로 */ }
      target = path.isAbsolute(d) || isDrive ? d : path.resolve(path.dirname(st.file), d);
    }
  } catch { return; }

  if (/^[\\/]{2}/.test(target)) return;   // 네트워크(UNC) 경로는 접근하지 않는다
  if (!MD_RE.test(target)) return;          // Markdown 파일만 연다 (그 외 파일·폴더 링크는 무시)
  if (!fs.existsSync(target)) {
    dialog.showMessageBox(st.win, { type: 'warning', message: '링크한 파일이 없어요', detail: target });
    return;
  }
  if (path.resolve(target).toLowerCase() === path.resolve(st.file).toLowerCase()) st.win.webContents.send('doc:scroll', hash);
  else navigateTo(st, target, { hash });
}

/* ───────────────────────── 저장 ───────────────────────── */
/** 저장 결과가 실패/취소면 '저장 후 닫기' 예약도 해제한다 */
function doSave(st, ...args) {
  const r = doSaveInner(st, ...args);
  if (!r.ok) st.closeAfterSave = false;
  return r;
}

/** @returns {{ok:boolean, canceled?:boolean, error?:string, note?:string}} */
function doSaveInner(st, text, target = st.file, { checkConflict = true } = {}) {
  try {
    if (typeof text !== 'string' || !target) return { ok: false, error: '저장할 파일이 없어요' };
    if (!MD_RE.test(target)) return { ok: false, error: 'Markdown(.md) 파일로만 저장할 수 있어요' };

    // 열어둔 뒤 디스크에서 파일이 바뀌었으면 확인
    if (checkConflict && target === st.file && st.sig) {
      let cur = null;
      try { const s = fs.statSync(target); cur = `${s.mtimeMs}:${s.size}`; } catch { /* 지워진 경우: 새로 만든다 */ }
      if (cur && cur !== st.sig) {
        const r = dialog.showMessageBoxSync(st.win, {
          type: 'warning', buttons: ['덮어쓰기', '취소'], defaultId: 1, cancelId: 1,
          message: '디스크의 파일이 열어둔 뒤에 바뀌었어요', detail: '덮어쓰면 바뀐 내용이 사라져요.',
        });
        if (r !== 0) return { ok: false, canceled: true };
      }
    }

    let enc = st.enc || 'utf-8';
    let note = '';
    if (enc === 'euc-kr') {
      const r = dialog.showMessageBoxSync(st.win, {
        type: 'question', buttons: ['UTF-8로 저장', '취소'], defaultId: 0, cancelId: 1,
        message: '이 파일은 EUC-KR(CP949) 인코딩이에요', detail: '저장하면 UTF-8로 바뀌어요. 한글은 그대로 보존돼요.',
      });
      if (r !== 0) return { ok: false, canceled: true };
      enc = 'utf-8';
      note = 'UTF-8로 저장됨';
    }
    const out = text.replace(/\r\n|\r|\n/g, st.eol || '\n');
    writeFileSafely(target, encodeText(out, enc));

    const s = fs.statSync(target);
    if (target === st.file) { st.sig = `${s.mtimeMs}:${s.size}`; st.enc = enc; }
    st.dirty = false;
    if (st.closeAfterSave) { st.closeAfterSave = false; setImmediate(() => { if (!st.win.isDestroyed()) st.win.close(); }); }
    return { ok: true, note };
  } catch (e) {
    st.closeAfterSave = false;
    return { ok: false, error: `저장하지 못했어요: ${e.message}` };
  }
}

async function doSaveAs(st, text) {
  const r = await dialog.showSaveDialog(st.win, {
    title: '다른 이름으로 저장',
    defaultPath: st.file || undefined,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  let target = r.filePath;
  if (!MD_RE.test(target)) target += '.md';
  const res = doSave(st, text, target, { checkConflict: false });
  if (!res.ok) return res;
  st.dirty = false;
  navigateTo(st, target, { keepMode: true, skipGuard: true });
  return res;
}

/* ───────────────────────── IPC ───────────────────────── */
function broadcastPrefs() {
  for (const st of states.values()) if (!st.win.isDestroyed()) st.win.webContents.send('prefs', publicPrefs());
  buildMenu();
}

function setPrefs(patch) {
  if (patch && typeof patch === 'object') {
    if (THEMES.includes(patch.theme)) { prefs.theme = patch.theme; nativeTheme.themeSource = prefs.theme; }
    if (typeof patch.toc === 'boolean') prefs.toc = patch.toc;
    if (WIDTHS.includes(patch.width)) prefs.width = patch.width;
  }
  savePrefs();
  broadcastPrefs();
}

function setZoom(level) {
  prefs.zoom = Math.max(-3, Math.min(5, Math.round(level * 2) / 2));
  for (const st of states.values()) if (!st.win.isDestroyed()) st.win.webContents.setZoomLevel(prefs.zoom);
  savePrefs();
}

ipcMain.handle('app:ready', (e) => {
  const st = stateOf(e.sender);
  if (!st) return null;
  let doc = null;
  if (st.file) {
    try { doc = buildPayload(st, { restore: false }); st.win.setTitle(`${path.basename(st.file)} — ${APP_NAME}`); }
    catch (err) { doc = { error: `파일을 읽을 수 없어요: ${err.message}` }; }
  }
  if (doc && doc.error) doc = null;
  return { prefs: publicPrefs(), recent: prefs.recent, doc };
});

ipcMain.handle('file:dialog', async (e) => {
  const st = stateOf(e.sender);
  if (!st) return;
  const r = await dialog.showOpenDialog(st.win, {
    title: 'Markdown 파일 열기',
    properties: ['openFile'],
    defaultPath: st.file ? path.dirname(st.file) : undefined,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn'] }],
  });
  if (!r.canceled && r.filePaths[0]) navigateTo(st, r.filePaths[0]);
});

ipcMain.handle('file:open', (e, p) => {
  const st = stateOf(e.sender);
  if (st && typeof p === 'string') navigateTo(st, p);
});
ipcMain.handle('link:open', (e, href) => { const st = stateOf(e.sender); if (st && st.file) handleLink(st, href); });
ipcMain.handle('nav', (e, dir) => { const st = stateOf(e.sender); if (st && (dir === 'back' || dir === 'forward')) navHistory(st, dir); });
ipcMain.handle('file:save', (e, text) => { const st = stateOf(e.sender); return st ? doSave(st, text) : { ok: false }; });
ipcMain.handle('file:saveAs', (e, text) => { const st = stateOf(e.sender); return st ? doSaveAs(st, text) : { ok: false }; });
ipcMain.handle('doc:dirty', (e, v) => { const st = stateOf(e.sender); if (st) st.dirty = !!v; });
ipcMain.handle('mode:report', (e, mode) => { const st = stateOf(e.sender); if (st && ['render', 'edit'].includes(mode)) st.mode = mode; });
ipcMain.handle('reveal', (e) => { const st = stateOf(e.sender); if (st && st.file) shell.showItemInFolder(st.file); });
ipcMain.handle('prefs:set', (_e, patch) => setPrefs(patch));
ipcMain.handle('zoom', (_e, dir) => setZoom(prefs.zoom + (dir > 0 ? 0.5 : -0.5)));
ipcMain.handle('clipboard:write', (_e, t) => { clipboard.writeText(String(t).slice(0, 5 * 1024 * 1024)); });

/* ───────────────────────── 인쇄 / PDF ───────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withLightTheme(fn) {
  const wasDark = nativeTheme.shouldUseDarkColors;
  if (wasDark) { nativeTheme.themeSource = 'light'; await sleep(700); } // Mermaid 가 라이트 테마로 다시 그려질 시간
  try { await fn(); } finally { nativeTheme.themeSource = prefs.theme; }
}

async function ensureRenderMode(st) {
  if (st.mode === 'render') return;
  st.win.webContents.send('cmd', 'mode-render');
  await sleep(600);
}

async function printCurrent() {
  const st = focusedState();
  if (!st || !st.file) return;
  await ensureRenderMode(st);
  await withLightTheme(() => new Promise((resolve) => st.win.webContents.print({ printBackground: true }, () => resolve())));
}

async function exportPdf() {
  const st = focusedState();
  if (!st || !st.file) return;
  await ensureRenderMode(st);
  const def = path.join(path.dirname(st.file), path.basename(st.file).replace(/\.[^.]+$/, '') + '.pdf');
  const r = await dialog.showSaveDialog(st.win, { title: 'PDF로 내보내기', defaultPath: def, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return;
  await withLightTheme(async () => {
    const buf = await st.win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    fs.writeFileSync(r.filePath, buf);
  });
  shell.showItemInFolder(r.filePath);
}

/* ───────────────────────── 메뉴 ───────────────────────── */
function openCustomCss() {
  const f = customCssFile();
  if (!fs.existsSync(f)) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, [
      '/* OMMV 사용자 CSS — 저장 후 F5 (다시 불러오기) 로 적용 */',
      '/* 예) 본문 글꼴/크기 바꾸기',
      '#article.markdown-body { font-family: "Pretendard", "Malgun Gothic", sans-serif; font-size: 17px; }',
      '*/',
      '',
    ].join('\n'));
  }
  shell.openPath(f);
}

function buildMenu() {
  const radio = (list, labels, cur, key) => list.map((v) => ({ label: labels[v], type: 'radio', checked: cur === v, click: () => setPrefs({ [key]: v }) }));
  const recent = prefs.recent.filter((f) => { try { return fs.existsSync(f); } catch { return false; } });
  const template = [
    {
      label: '파일(&F)',
      submenu: [
        { label: '열기…', accelerator: 'CmdOrCtrl+O', click: async () => { const st = focusedState() || createWindow(); const r = await dialog.showOpenDialog(st.win, { properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn'] }] }); if (!r.canceled && r.filePaths[0]) navigateTo(st, r.filePaths[0]); } },
        { label: '저장', accelerator: 'CmdOrCtrl+S', click: () => { const st = focusedState(); st && st.win.webContents.send('cmd', 'save'); } },
        { label: '다른 이름으로 저장…', accelerator: 'CmdOrCtrl+Shift+S', click: () => { const st = focusedState(); st && st.file && st.win.webContents.send('cmd', 'save-as'); } },
        { type: 'separator' },
        { label: '새 창', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: '최근 파일', enabled: recent.length > 0, submenu: recent.map((f) => ({ label: f, click: () => { const st = focusedState(); st ? navigateTo(st, f) : createWindow(f); } })) },
        { type: 'separator' },
        { label: '다시 불러오기', accelerator: 'F5', click: () => { const st = focusedState(); st && reload(st, { force: true }); } },
        { label: '다시 불러오기', accelerator: 'CmdOrCtrl+R', visible: false, click: () => { const st = focusedState(); st && reload(st, { force: true }); } },
        { label: '탐색기에서 보기', click: () => { const st = focusedState(); st && st.file && shell.showItemInFolder(st.file); } },
        { type: 'separator' },
        { label: 'PDF로 내보내기…', click: exportPdf },
        { label: '인쇄…', accelerator: 'CmdOrCtrl+P', click: printCurrent },
        { type: 'separator' },
        { label: '창 닫기', accelerator: 'CmdOrCtrl+W', role: 'close' },
        { label: '종료', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: '편집(&E)',
      submenu: [
        { label: '복사', role: 'copy' },
        { label: '전체 선택', role: 'selectAll' },
        { type: 'separator' },
        { label: '찾기…', accelerator: 'CmdOrCtrl+F', click: () => { const st = focusedState(); st && st.win.webContents.send('cmd', 'find'); } },
      ],
    },
    {
      label: '보기(&V)',
      submenu: [
        { label: '보기 모드', accelerator: 'Shift+Alt+V', click: () => { const st = focusedState(); st && st.win.webContents.send('cmd', 'mode-render'); } },
        { label: '편집 모드', accelerator: 'Shift+Alt+E', click: () => { const st = focusedState(); st && st.win.webContents.send('cmd', 'toggle-edit'); } },
        { type: 'separator' },
        { label: '목차 표시', accelerator: 'CmdOrCtrl+B', type: 'checkbox', checked: prefs.toc, click: () => setPrefs({ toc: !prefs.toc }) },
        { label: '테마', submenu: radio(THEMES, { system: '시스템 설정', light: '라이트', dark: '다크' }, prefs.theme, 'theme') },
        { label: '본문 너비', submenu: radio(WIDTHS, { narrow: '좁게', medium: '보통', wide: '넓게', full: '전체' }, prefs.width, 'width') },
        { type: 'separator' },
        { label: '확대', accelerator: 'CmdOrCtrl+=', click: () => setZoom(prefs.zoom + 0.5) },
        { label: '확대', accelerator: 'CmdOrCtrl+Plus', visible: false, click: () => setZoom(prefs.zoom + 0.5) },
        { label: '축소', accelerator: 'CmdOrCtrl+-', click: () => setZoom(prefs.zoom - 0.5) },
        { label: '원래 크기', accelerator: 'CmdOrCtrl+0', click: () => setZoom(0) },
        { type: 'separator' },
        { label: '전체 화면', role: 'togglefullscreen' },
        { label: '개발자 도구', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: '이동(&G)',
      submenu: [
        { label: '뒤로', accelerator: 'Alt+Left', click: () => { const st = focusedState(); st && navHistory(st, 'back'); } },
        { label: '앞으로', accelerator: 'Alt+Right', click: () => { const st = focusedState(); st && navHistory(st, 'forward'); } },
      ],
    },
    {
      label: '도움말(&H)',
      submenu: [
        { label: '기본 앱으로 설정… (Windows 설정 열기)', click: () => shell.openExternal('ms-settings:defaultapps') },
        { label: '사용자 CSS 편집…', click: openCustomCss },
        { label: 'GitHub 저장소 열기', click: () => shell.openExternal(REPO_URL) },
        { type: 'separator' },
        { label: `${APP_NAME} 정보`, click: () => dialog.showMessageBox({ type: 'info', title: APP_NAME, message: `${APP_NAME} ${app.getVersion()}`, detail: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}\n\ndemolabskr · MIT License\n${REPO_URL}` }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ───────────────────────── 실행 인자 / 단일 인스턴스 ───────────────────────── */
function filesFromArgv(argv, cwd) {
  const out = [];
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-')) continue;
    const p = path.resolve(cwd || process.cwd(), a);
    try { if (MD_RE.test(p) && fs.statSync(p).isFile()) out.push(p); } catch { /* 파일 아님 */ }
  }
  return out;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, cwd) => {
    const files = filesFromArgv(argv, cwd);
    if (!files.length) {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) { if (w.isMinimized()) w.restore(); w.focus(); } else createWindow();
      return;
    }
    files.forEach(openInNewWindowOrFocus);
  });

  app.whenReady().then(() => {
    loadPrefs();
    nativeTheme.themeSource = prefs.theme;
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.webRequest.onBeforeRequest((details, cb) => cb({ cancel: isRemoteFileUrl(details.url) }));
    buildMenu();
    const files = filesFromArgv(process.argv);
    if (files.length) files.forEach(openInNewWindowOrFocus); else createWindow();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { clearTimeout(saveTimer); savePrefsNow(); });
}
