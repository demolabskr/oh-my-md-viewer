// 렌더러(HTML/JS/CSS)를 dist/ 로 번들링한다.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'dist';
const nm = (...p) => path.join('node_modules', ...p);
const read = (...p) => fs.readFileSync(nm(...p), 'utf8');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });

const common = {
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'chrome130',
  outdir: OUT,
  legalComments: 'none',
  // katex 는 최상위에 설치된 한 버전만 번들한다 (mermaid·markdown-it-katex 의 구버전 중복 방지)
  alias: { katex: path.resolve('node_modules', 'katex') },
  logLevel: 'warning',
};

// 1) 렌더러 본체 + Mermaid(지연 로딩용 별도 번들)
await build({ ...common, entryPoints: { renderer: 'src/renderer.js' } });
await build({ ...common, entryPoints: { 'mermaid.bundle': 'src/mermaid-entry.js' } });
// 소스 보기/에디터(CodeMirror)도 처음 진입할 때만 로드
await build({ ...common, entryPoints: { 'editor.bundle': 'src/editor-entry.js' } });

// 2) CSS: github-markdown + highlight.js(light/dark) + KaTeX + 앱 스타일
let katexCss = read('katex', 'dist', 'katex.min.css');
// woff2 만 사용 (Chromium 지원) → 용량 절감
katexCss = katexCss.replace(/,url\(fonts\/[^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, '');
for (const f of fs.readdirSync(nm('katex', 'dist', 'fonts'))) {
  if (f.endsWith('.woff2')) fs.copyFileSync(nm('katex', 'dist', 'fonts', f), path.join(OUT, 'fonts', f));
}

const css = [
  read('github-markdown-css', 'github-markdown.css'),
  read('highlight.js', 'styles', 'github.css'),
  `@media (prefers-color-scheme: dark){\n${read('highlight.js', 'styles', 'github-dark.css')}\n}`,
  katexCss,
  fs.readFileSync('src/app.css', 'utf8'),
].join('\n');
fs.writeFileSync(path.join(OUT, 'style.css'), css);

// 3) HTML
fs.copyFileSync('src/index.html', path.join(OUT, 'index.html'));

const size = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB';
console.log(`built dist/: renderer.js ${size('renderer.js')}, mermaid.bundle.js ${size('mermaid.bundle.js')}, editor.bundle.js ${size('editor.bundle.js')}, style.css ${size('style.css')}`);
