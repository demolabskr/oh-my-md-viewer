import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import { full as emoji } from 'markdown-it-emoji';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import mark from 'markdown-it-mark';
import deflist from 'markdown-it-deflist';
import katexPlugin from '@vscode/markdown-it-katex';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';

const api = window.api;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ───────────────────────── 아이콘 ───────────────────────── */
const ICONS = {
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  forward: '<path d="M9 18l6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  width: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  'theme-light': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  'theme-dark': '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  'theme-system': '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
};
function setIcon(el, name) { el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`; }
document.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));

/* ───────────────────────── Markdown 엔진 ───────────────────────── */
function highlight(code, lang) {
  lang = (lang || '').trim().split(/\s+/)[0].toLowerCase();
  if (lang === 'mermaid') return `<pre class="mermaid">${esc(code)}</pre>`;
  let html = null;
  if (lang && hljs.getLanguage(lang)) {
    try { html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { /* plain */ }
  }
  if (html == null) html = esc(code);
  return `<pre><code class="hljs${lang ? ` language-${esc(lang)}` : ''}" data-lang="${esc(lang)}">${html}</code></pre>`;
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: false, highlight });
md.use(footnote).use(taskLists).use(emoji).use(sub).use(sup).use(mark).use(deflist);
md.use(katexPlugin.default || katexPlugin, { throwOnError: false });
// 블록마다 원본 줄 번호를 data-line 으로 달아 보기 ↔ 편집 전환 시 위치를 맞춘다
md.core.ruler.push('data_line', (st) => {
  const off = (st.env && st.env.lineOffset) || 0;
  for (const t of st.tokens) {
    if (t.map && t.block && t.type !== 'inline' && (t.nesting === 1 || t.nesting === 0)) t.attrSet('data-line', String(t.map[0] + off));
  }
});

// 네트워크(UNC)·외부 CSS 리소스 참조 차단 (main.js 의 요청 차단과 이중 방어)
const REMOTE_FILE_REF = /(^|[\s,])(?:[\\/]{2}|file:\/\/(?!\/)|file:\/{4,})/i;
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  const name = data.attrName;
  const val = String(data.attrValue || '');
  if (name === 'style' && /url\s*\(|@import|image-set\s*\(|expression\s*\(/i.test(val)) data.keepAttr = false;
  if (['src', 'srcset', 'poster', 'xlink:href', 'background', 'data'].includes(name) && REMOTE_FILE_REF.test(val)) data.keepAttr = false;
});

const PURIFY = { FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed'], ADD_ATTR: ['open'] };

function splitFrontMatter(text) {
  const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  if (!m) return { front: null, body: text, lineOffset: 0 };
  return { front: m[1], body: text.slice(m[0].length), lineOffset: (m[0].match(/\n/g) || []).length };
}

/* ───────────────────────── 상태 ───────────────────────── */
const state = {
  doc: null,
  prefs: { theme: 'system', toc: true, width: 'medium' },
  recent: [],
  headings: [],
  spy: -1,
  scrollPos: new Map(),
  renderToken: 0,
  mermaidLoading: null,
  mode: 'render', // 'render' | 'edit'
  editor: null,
  editorLoading: null,
  savedText: '',
  renderedText: null,
  dirty: false,
  saving: false,
  switching: false,
  pendingDoc: null,
};
const WIDTHS = ['narrow', 'medium', 'wide', 'full'];
const WIDTH_LABEL = { narrow: '좁게', medium: '보통', wide: '넓게', full: '전체' };

const article = $('#article');
const darkMQ = matchMedia('(prefers-color-scheme: dark)');

/* ───────────────────────── 렌더링 ───────────────────────── */
function slugify(s) {
  return s.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
}

function isAbsoluteUrl(u) { return /^[a-z][a-z0-9+.-]+:/i.test(u) || u.startsWith('//'); }

function resolveAsset(src, baseUrl) {
  if (!src || src.startsWith('#')) return src;
  if (/^[a-zA-Z]:[\\/]/.test(src)) return encodeURI('file:///' + src.replace(/\\/g, '/'));
  if (isAbsoluteUrl(src)) return src;
  try { return new URL(src, baseUrl).href; } catch { return src; }
}

function frontMatterEl(src) {
  const d = document.createElement('details');
  d.className = 'front-matter';
  const s = document.createElement('summary');
  s.textContent = 'Front matter';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = src;
  pre.append(code);
  d.append(s, pre);
  return d;
}

function postProcess(root, doc) {
  // 제목 id (GitHub 방식 슬러그, 한글 지원, 중복은 -1, -2 …)
  const seen = new Map();
  root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    if (h.id) return;
    const base = slugify(h.textContent) || 'section';
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    h.id = n ? `${base}-${n}` : base;
  });

  // 상대 경로 이미지·미디어 → 문서 폴더 기준 file:// URL
  root.querySelectorAll('img[src], video[src], audio[src], source[src]').forEach((el) => {
    el.setAttribute('src', resolveAsset(el.getAttribute('src'), doc.dirUrl));
  });
  root.querySelectorAll('video[poster]').forEach((el) => el.setAttribute('poster', resolveAsset(el.getAttribute('poster'), doc.dirUrl)));
  root.querySelectorAll('img').forEach((img) => { img.loading = 'lazy'; });

  // 표 가로 스크롤 래퍼
  root.querySelectorAll(':scope > table, :scope table').forEach((t) => {
    if (t.parentElement.classList.contains('table-wrap')) return;
    const w = document.createElement('div');
    w.className = 'table-wrap';
    t.replaceWith(w);
    w.append(t);
  });

  // GitHub 알림 > [!NOTE]
  const ALERTS = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' };
  root.querySelectorAll('blockquote').forEach((bq) => {
    const p = bq.firstElementChild;
    if (!p || p.tagName !== 'P') return;
    const first = p.firstChild;
    if (!first || first.nodeType !== Node.TEXT_NODE) return;
    const m = first.textContent.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\r?\n?/i);
    if (!m) return;
    const type = m[1].toUpperCase();
    first.textContent = first.textContent.slice(m[0].length);
    bq.classList.add('alert', `alert-${type.toLowerCase()}`);
    const title = document.createElement('p');
    title.className = 'alert-title';
    title.textContent = ALERTS[type];
    bq.prepend(title);
    if (!p.textContent.trim() && !p.querySelector('img,code')) p.remove();
  });

  // 코드 블록 헤더 + 복사 버튼
  root.querySelectorAll('pre > code.hljs').forEach((code) => {
    const pre = code.parentElement;
    const wrap = document.createElement('div');
    wrap.className = 'code-block';
    const head = document.createElement('div');
    head.className = 'code-head';
    const lang = document.createElement('span');
    lang.textContent = code.dataset.lang || 'text';
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = '복사';
    btn.addEventListener('click', async () => {
      await api.copyText(code.textContent);
      btn.textContent = '복사됨 ✓';
      setTimeout(() => { btn.textContent = '복사'; }, 1200);
    });
    head.append(lang, btn);
    pre.replaceWith(wrap);
    wrap.append(head, pre);
  });
}

function buildToc() {
  const hs = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  state.headings = hs;
  state.spy = -1;
  const list = $('#toc-list');
  list.replaceChildren();
  document.body.classList.toggle('no-toc', hs.length === 0);
  if (!hs.length) return;
  const min = Math.min(...hs.map((h) => +h.tagName[1]));
  hs.forEach((h, i) => {
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent.replace(/^#\s*/, '');
    a.title = a.textContent;
    a.className = 'toc-l' + Math.min(+h.tagName[1] - min, 4);
    a.dataset.idx = i;
    list.append(a);
  });
  updateSpy();
}

function updateSpy() {
  const hs = state.headings;
  if (!hs.length || document.body.classList.contains('is-empty')) return;
  const limit = 44 + 28;
  let cur = 0;
  for (let i = 0; i < hs.length; i++) {
    if (hs[i].getBoundingClientRect().top <= limit) cur = i; else break;
  }
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) cur = hs.length - 1;
  if (cur === state.spy) return;
  state.spy = cur;
  const toc = $('#toc');
  toc.querySelectorAll('a.active').forEach((a) => a.classList.remove('active'));
  const a = toc.querySelector(`a[data-idx="${cur}"]`);
  if (!a) return;
  a.classList.add('active');
  const top = a.offsetTop - toc.clientHeight / 2;
  if (a.offsetTop < toc.scrollTop + 40 || a.offsetTop > toc.scrollTop + toc.clientHeight - 60) toc.scrollTo({ top: Math.max(0, top) });
}

/* Mermaid (필요할 때만 로드) */
function loadMermaid() {
  if (window.__mermaid) return Promise.resolve(window.__mermaid);
  if (!state.mermaidLoading) {
    state.mermaidLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'mermaid.bundle.js';
      s.onload = () => resolve(window.__mermaid);
      s.onerror = () => { state.mermaidLoading = null; reject(new Error('mermaid 로드 실패')); };
      document.head.append(s);
    });
  }
  return state.mermaidLoading;
}

async function renderMermaid(token) {
  const nodes = [...article.querySelectorAll('pre.mermaid')];
  if (!nodes.length) return;
  let mermaid;
  try { mermaid = await loadMermaid(); } catch (e) { return; }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: darkMQ.matches ? 'dark' : 'default',
    suppressErrorRendering: true,
    fontFamily: '"Segoe UI","Malgun Gothic",sans-serif',
  });
  let i = 0;
  for (const el of nodes) {
    if (token !== state.renderToken) return;
    if (el.dataset.src === undefined) el.dataset.src = el.textContent;
    const id = `mmd-${token}-${i++}`;
    try {
      const { svg } = await mermaid.render(id, el.dataset.src);
      if (token !== state.renderToken) return;
      el.innerHTML = svg;
    } catch (err) {
      document.getElementById('d' + id)?.remove();
      document.getElementById(id)?.remove();
      const box = document.createElement('div');
      box.className = 'mermaid-error';
      box.textContent = 'Mermaid 오류: ' + String((err && err.message) || err).split('\n')[0] + '\n\n' + el.dataset.src;
      el.replaceChildren(box);
    }
  }
}

/** Markdown 텍스트를 미리보기 영역에 그린다. 반환값: Mermaid 렌더 토큰 */
function renderArticle(text, doc) {
  const token = ++state.renderToken;
  const { front, body, lineOffset } = splitFrontMatter(text);
  article.innerHTML = DOMPurify.sanitize(md.render(body, { lineOffset }), PURIFY);
  if (front !== null) article.prepend(frontMatterEl(front));
  postProcess(article, doc);
  state.renderedText = text;
  buildToc();
  return token;
}

function showDoc(doc) {
  const sameDoc = state.doc && state.doc.path === doc.path;

  // 편집 중(미저장)인데 같은 파일이 디스크에서 바뀐 경우: 내용을 덮어쓰지 않고 알리기만 한다
  if (sameDoc && state.dirty && !doc.force) {
    state.pendingDoc = doc;
    showNotice('디스크의 파일이 바뀌었어요. 편집 중인 내용은 그대로 두었어요.');
    return;
  }
  hideNotice();
  state.pendingDoc = null;

  if (state.doc && !sameDoc) state.scrollPos.set(state.doc.path, scrollY);
  const targetY = sameDoc ? scrollY : (doc.restore ? state.scrollPos.get(doc.path) || 0 : 0);

  // 다른 문서를 열면 보기 모드로 돌아간다 (다른 이름으로 저장은 모드 유지)
  if (!sameDoc && !doc.keepMode && state.mode !== 'render') {
    state.mode = 'render';
    applyModeClasses();
    $('#editor').hidden = true;
  }

  state.doc = doc;

  // 사용자 CSS
  let style = $('#custom-css');
  if (!style) { style = document.createElement('style'); style.id = 'custom-css'; document.head.append(style); }
  style.textContent = doc.customCss || '';

  const token = renderArticle(doc.text, doc);

  article.hidden = false;
  $('#empty').hidden = true;
  document.body.classList.remove('is-empty');
  const title = $('#doc-title');
  title.textContent = doc.name;
  title.title = `${doc.path}\n(클릭: 탐색기에서 보기)`;
  $('#btn-back').disabled = !doc.canBack;
  $('#btn-fwd').disabled = !doc.canForward;

  // 에디터 내용 동기화 (저장된 상태로 초기화)
  state.savedText = doc.text;
  if (state.dirty) { state.dirty = false; $('#btn-save').classList.remove('dirty'); api.setDirty(false); }
  document.title = `${doc.name} — OMMV`;
  if (state.editor) {
    const line = sameDoc && state.mode !== 'render' ? state.editor.topLine() : 1;
    state.editor.setValue(doc.text);
    if (line > 1) requestAnimationFrame(() => state.editor.scrollToLine(line));
  }

  const place = () => {
    if (state.mode !== 'render') return;
    if (doc.hash) scrollToId(doc.hash, false);
    else window.scrollTo(0, targetY);
    updateSpy();
  };
  place();
  renderMermaid(token).then(() => { if (token === state.renderToken) place(); });
  if (!findbar.hidden && findInput.value) runFind();
}

/* ───────────────────────── 모드 전환 · 에디터 · 저장 ───────────────────────── */
function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve(window[globalName]);
    el.onerror = () => reject(new Error(src + ' 로드 실패'));
    document.head.append(el);
  });
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 4000 : 1800);
}
function showNotice(text) { $('#notice-text').textContent = text; $('#notice').hidden = false; }
function hideNotice() { $('#notice').hidden = true; }
$('#notice-ignore').addEventListener('click', hideNotice);
$('#notice-reload').addEventListener('click', () => {
  const d = state.pendingDoc;
  hideNotice();
  if (d) showDoc({ ...d, force: true });
});

function applyModeClasses() {
  const b = document.body;
  b.classList.remove('mode-render', 'mode-edit');
  b.classList.add('mode-' + state.mode);
  for (const m of ['render', 'edit']) $('#btn-mode-' + m).classList.toggle('active', state.mode === m);
  $('#btn-save').hidden = state.mode !== 'edit';
  api.reportMode(state.mode);
}

function setDirty(d) {
  if (d === state.dirty) return;
  state.dirty = d;
  $('#btn-save').classList.toggle('dirty', d);
  if (state.doc) document.title = `${d ? '● ' : ''}${state.doc.name} — OMMV`;
  api.setDirty(d);
}
function onEditorChange() { setDirty(state.editor.getValue() !== state.savedText); }

async function ensureEditor() {
  if (state.editor) return state.editor;
  if (!state.editorLoading) {
    state.editorLoading = (async () => {
      const lib = await loadScript('editor.bundle.js', '__editor');
      state.editor = lib.create({
        parent: $('#editor'),
        doc: state.doc.text,
        readOnly: true,
        dark: darkMQ.matches,
        onChange: onEditorChange,
        onSave: () => save(),
      });
      return state.editor;
    })().finally(() => { state.editorLoading = null; });
  }
  return state.editorLoading;
}

function visibleRenderedLine() {
  const top = 44 + 4;
  for (const el of article.querySelectorAll('[data-line]')) {
    if (el.getBoundingClientRect().bottom > top) return +el.dataset.line + 1;
  }
  return 1;
}
function scrollRenderedToLine(line) {
  let best = null;
  for (const el of article.querySelectorAll('[data-line]')) {
    if (+el.dataset.line + 1 <= line) best = el; else break;
  }
  if (best && line > 1) best.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
  updateSpy();
}

async function setMode(next) {
  if (!state.doc || next === state.mode || state.switching) return;
  state.switching = true;
  try {
    const prev = state.mode;
    if (next === 'render') {
      const ed = state.editor;
      const line = ed ? ed.topLine() : 1;
      const text = ed ? ed.getValue() : state.doc.text;
      ed && ed.closeSearch();
      state.mode = 'render';
      applyModeClasses();
      $('#editor').hidden = true;
      if (text !== state.renderedText) renderMermaid(renderArticle(text, state.doc));
      requestAnimationFrame(() => scrollRenderedToLine(line));
    } else {
      const line = prev === 'render' ? visibleRenderedLine() : null;
      $('#editor').hidden = false;
      let ed;
      try { ed = await ensureEditor(); } catch (e) { $('#editor').hidden = true; toast('에디터를 불러오지 못했어요', true); return; }
      closeFind();
      state.mode = next;
      applyModeClasses();
      ed.setReadOnly(false);
      ed.measure();
      if (line != null) requestAnimationFrame(() => requestAnimationFrame(() => ed.scrollToLine(line)));
      if (next === 'edit') ed.focus();
    }
  } finally { state.switching = false; }
}
const toggleMode = (m) => setMode(state.mode === m ? 'render' : m);

async function save() {
  if (!state.editor || !state.doc || state.saving) return;
  if (!state.dirty) { toast('변경 사항이 없어요'); return; }
  state.saving = true;
  try {
    const text = state.editor.getValue();
    const r = await api.save(text);
    if (r && r.ok) {
      state.savedText = text;
      state.doc.text = text;
      setDirty(state.editor.getValue() !== text);
      toast('저장했어요' + (r.note ? ` · ${r.note}` : ''));
    } else if (r && !r.canceled) {
      toast(r.error || '저장하지 못했어요', true);
    }
  } finally { state.saving = false; }
}
async function saveAs() {
  if (!state.doc || state.saving) return;
  const text = state.editor ? state.editor.getValue() : state.doc.text;
  state.saving = true;
  try {
    const r = await api.saveAs(text);
    if (r && !r.ok && !r.canceled) toast(r.error || '저장하지 못했어요', true);
  } finally { state.saving = false; }
}

$('#btn-mode-render').addEventListener('click', () => setMode('render'));
$('#btn-mode-edit').addEventListener('click', () => setMode('edit'));
$('#btn-save').addEventListener('click', save);

function showError(msg) {
  article.hidden = false;
  article.textContent = msg;
}

function showEmpty() {
  state.doc = null;
  state.headings = [];
  article.hidden = true;
  article.replaceChildren();
  $('#empty').hidden = false;
  document.body.classList.add('is-empty');
  document.title = 'OMMV';
  $('#doc-title').textContent = 'OMMV';
  $('#doc-title').title = '';
  $('#btn-back').disabled = true;
  $('#btn-fwd').disabled = true;
  renderRecent();
}

function renderRecent() {
  const wrap = $('#recent-wrap');
  const ul = $('#recent-list');
  ul.replaceChildren();
  wrap.hidden = !state.recent.length;
  for (const p of state.recent) {
    const li = document.createElement('li');
    const norm = p.replace(/\\/g, '/');
    const i = norm.lastIndexOf('/');
    li.innerHTML = `<div class="r-name">${esc(norm.slice(i + 1))}</div><div class="r-dir">${esc(p.slice(0, Math.max(0, p.length - (norm.length - i))))}</div>`;
    li.addEventListener('click', () => api.openPath(p));
    ul.append(li);
  }
}

/* ───────────────────────── 스크롤·링크 ───────────────────────── */
function scrollToId(id, smooth = true) {
  let key = id;
  try { key = decodeURIComponent(id); } catch { /* keep */ }
  const el = document.getElementById(key) || document.getElementById(id) || document.getElementsByName(key)[0];
  if (el) el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}

article.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (href.startsWith('#')) scrollToId(href.slice(1));
  else api.openLink(href);
});

$('#toc-list').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-idx]');
  if (!a) return;
  e.preventDefault();
  state.headings[+a.dataset.idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

let ticking = false;
addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; updateSpy(); });
}, { passive: true });

addEventListener('wheel', (e) => {
  if (e.ctrlKey) { e.preventDefault(); api.zoom(e.deltaY < 0 ? 1 : -1); }
}, { passive: false });

/* ───────────────────────── 툴바·환경설정 ───────────────────────── */
function applyPrefs(p) {
  state.prefs = { ...state.prefs, ...p };
  document.documentElement.dataset.width = state.prefs.width;
  document.body.classList.toggle('toc-visible', !!state.prefs.toc);
  $('#btn-toc').classList.toggle('active', !!state.prefs.toc);
  updateThemeButton();
  $('#btn-width').title = `본문 너비: ${WIDTH_LABEL[state.prefs.width]} (클릭하면 변경)`;
}
const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];

$('#btn-toc').addEventListener('click', () => api.setPrefs({ toc: !state.prefs.toc }));
// 테마 버튼: 지금 보이는 모드의 반대로 한 번에 전환하고, 아이콘은 '전환될 모드'를 보여준다.
// (시스템 설정으로 되돌리기는 메뉴 보기 → 테마)
function updateThemeButton() {
  const dark = darkMQ.matches;
  setIcon($('#btn-theme'), dark ? 'theme-light' : 'theme-dark');
  $('#btn-theme').title = (dark ? '라이트 모드로 전환' : '다크 모드로 전환') + (state.prefs.theme === 'system' ? ' (현재: 시스템 설정)' : '');
}
$('#btn-theme').addEventListener('click', () => api.setPrefs({ theme: darkMQ.matches ? 'light' : 'dark' }));
$('#btn-width').addEventListener('click', () => api.setPrefs({ width: cycle(WIDTHS, state.prefs.width) }));
$('#btn-open').addEventListener('click', () => api.openDialog());
$('#empty-open').addEventListener('click', () => api.openDialog());
$('#btn-back').addEventListener('click', () => api.nav('back'));
$('#btn-fwd').addEventListener('click', () => api.nav('forward'));
$('#doc-title').addEventListener('click', () => api.reveal());

// 테마 변경 시 Mermaid 다시 그리기
darkMQ.addEventListener('change', () => {
  updateThemeButton();
  if (state.editor) state.editor.setDark(darkMQ.matches);
  if (!state.doc) return;
  const token = ++state.renderToken;
  renderMermaid(token);
});

/* ───────────────────────── 찾기 (본문만 검색, CSS Custom Highlight API) ───────────────────────── */
const findbar = $('#findbar');
const findInput = $('#find-input');
const find = { ranges: [], idx: -1 };

function clearHighlights() {
  if (window.CSS && CSS.highlights) { CSS.highlights.delete('find'); CSS.highlights.delete('find-current'); }
}
function gotoMatch(i) {
  const n = find.ranges.length;
  if (!n) return;
  find.idx = (i + n) % n;
  const r = find.ranges[find.idx];
  CSS.highlights.set('find-current', new Highlight(r));
  const el = r.startContainer.parentElement;
  if (el) el.scrollIntoView({ block: 'center' });
  $('#find-count').textContent = `${find.idx + 1}/${n}`;
}
function runFind() {
  clearHighlights();
  find.ranges = [];
  find.idx = -1;
  const q = findInput.value.toLowerCase();
  const count = $('#find-count');
  if (!q || !state.doc) { count.textContent = ''; return; }
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const t = node.nodeValue.toLowerCase();
    for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + q.length)) {
      const r = new Range();
      r.setStart(node, i);
      r.setEnd(node, i + q.length);
      find.ranges.push(r);
    }
  }
  if (!find.ranges.length) { count.textContent = '없음'; return; }
  CSS.highlights.set('find', new Highlight(...find.ranges));
  gotoMatch(0);
}
function openFind() {
  if (!state.doc) return;
  findbar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value) runFind();
}
function closeFind() {
  findbar.hidden = true;
  $('#find-count').textContent = '';
  find.ranges = [];
  clearHighlights();
}
findInput.addEventListener('input', runFind);
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); gotoMatch(find.idx + (e.shiftKey ? -1 : 1)); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
$('#find-next').addEventListener('click', () => gotoMatch(find.idx + 1));
$('#find-prev').addEventListener('click', () => gotoMatch(find.idx - 1));
$('#find-close').addEventListener('click', closeFind);
$('#btn-find').addEventListener('click', () => (findbar.hidden ? openFind() : closeFind()));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !findbar.hidden) closeFind(); });

/* ───────────────────────── 드래그 앤 드롭 ───────────────────────── */
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  const f = e.dataTransfer && e.dataTransfer.files[0];
  const p = f && api.pathForFile(f);
  if (p) api.openPath(p);
});

/* ───────────────────────── main ↔ renderer ───────────────────────── */
api.onDoc((doc) => {
  if (doc.error) { showError(doc.error); return; }
  showDoc(doc);
});
api.onPrefs(applyPrefs);
api.onScroll((hash) => { if (hash) scrollToId(hash); });
api.onCommand((name) => {
  if (name === 'find') { if (state.mode === 'render') openFind(); else state.editor && state.editor.openSearch(); }
  else if (name === 'toggle-edit') toggleMode('edit');
  else if (name === 'mode-render') setMode('render');
  else if (name === 'save') save();
  else if (name === 'save-as') saveAs();
});
api.onRecent((list) => { state.recent = list; if (!state.doc) renderRecent(); });

(async function init() {
  const init = await api.ready();
  state.recent = init.recent || [];
  applyPrefs(init.prefs);
  if (init.doc) showDoc(init.doc); else showEmpty();
})();
