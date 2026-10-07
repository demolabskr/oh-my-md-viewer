// 소스 보기 / 에디터 모드용 CodeMirror 6 번들 (처음 진입할 때만 로드)
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, indentUnit } from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel, closeSearchPanel } from '@codemirror/search';

const PHRASES = {
  Find: '찾기', Replace: '바꾸기', next: '다음', previous: '이전', all: '모두', 'match case': '대소문자 구분',
  regexp: '정규식', 'by word': '단어 단위', replace: '바꾸기', 'replace all': '모두 바꾸기', close: '닫기',
  'Go to line': '줄 이동', go: '이동', 'current match': '현재 항목', 'on line': '줄',
};

function baseTheme(dark) {
  return EditorView.theme({
    '&': { height: '100%', color: 'var(--fg)', backgroundColor: 'var(--bg)', fontSize: '14px' },
    '.cm-scroller': { fontFamily: 'var(--mono-font)', lineHeight: '1.65', overflow: 'auto' },
    '.cm-content': { caretColor: 'var(--fg)', padding: '14px 0 80px' },
    '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none', borderRight: '1px solid var(--border)' },
    '.cm-activeLine': { backgroundColor: 'var(--hover)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--hover)', color: 'var(--fg)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: dark ? 'rgba(68,147,248,.35)' : 'rgba(9,105,218,.22)' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--fg)', borderColor: 'var(--border)' },
    '.cm-panels input, .cm-panels button': { font: '13px var(--ui-font)', color: 'var(--fg)' },
    '.cm-panels input[type=text], .cm-panels input:not([type])': { backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '4px', padding: '3px 6px' },
    '.cm-panels button': { backgroundColor: 'var(--hover)', border: '1px solid var(--border)', borderRadius: '4px', backgroundImage: 'none', padding: '2px 8px' },
    '.cm-panels label': { fontSize: '12px', color: 'var(--muted)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(255,211,61,.4)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#ff9632', color: '#000' },
  }, { dark });
}

const themeFor = (dark) => [baseTheme(dark), syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle, { fallback: true })];

window.__editor = {
  /**
   * @param {{parent: HTMLElement, doc: string, readOnly: boolean, dark: boolean,
   *          onChange: () => void, onSave: () => void}} o
   */
  create(o) {
    const themeC = new Compartment();
    const roC = new Compartment();
    let dark = !!o.dark;
    let readOnly = !!o.readOnly;

    const makeState = (doc) => EditorState.create({
      doc,
      extensions: [
        EditorState.phrases.of(PHRASES),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        markdown({ base: markdownLanguage }),
        EditorView.lineWrapping,
        search({ top: true }),
        highlightSelectionMatches(),
        keymap.of([
          { key: 'Mod-s', run: () => { o.onSave(); return true; } },
          indentWithTab,
          ...searchKeymap,
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        themeC.of(themeFor(dark)),
        roC.of(EditorState.readOnly.of(readOnly)),
        EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': 'Markdown 소스' }),
        EditorView.updateListener.of((u) => { if (u.docChanged) o.onChange(); }),
      ],
    });

    const view = new EditorView({ state: makeState(o.doc), parent: o.parent });
    const lineCount = () => view.state.doc.lines;

    return {
      getValue: () => view.state.doc.toString(),
      /** 문서를 통째로 교체하고 되돌리기 기록을 초기화한다 */
      setValue(text) { view.setState(makeState(text)); },
      setReadOnly(v) {
        readOnly = !!v;
        view.dispatch({ effects: roC.reconfigure(EditorState.readOnly.of(readOnly)) });
      },
      setDark(v) {
        dark = !!v;
        view.dispatch({ effects: themeC.reconfigure(themeFor(dark)) });
      },
      focus: () => view.focus(),
      openSearch: () => { view.focus(); openSearchPanel(view); },
      closeSearch: () => closeSearchPanel(view),
      /** 화면 맨 위에 보이는 줄 (1부터) */
      topLine() {
        const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
        return view.state.doc.lineAt(block.from).number;
      },
      scrollToLine(n) {
        const line = view.state.doc.line(Math.max(1, Math.min(n, lineCount())));
        view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 4 }) });
      },
      measure: () => view.requestMeasure(),
    };
  },
};
