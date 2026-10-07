# OMMV (oh-my-md-viewer)

Windows용 Markdown 뷰어. [md-reader](https://md-reader.github.io/) 확장처럼 `.md` 파일을 더블클릭하면 바로 렌더링해서 보여준다.
Electron 기반이며, 설치형 `.exe`(NSIS)로 만들어 `.md` 기본 앱으로 쓸 수 있다.

- 저장소: <https://github.com/demolabskr/oh-my-md-viewer>
- 라이선스: [MIT](LICENSE)

> 🤖 **에이전틱 코딩으로 만든 프로젝트입니다.** 코드와 문서는 사람이 직접 작성한 것이 아니라 AI 에이전트(Claude, Anthropic)가 작성했습니다. 자세한 내용은 [제작 방식](#제작-방식)을 참고하세요.

## 기능

| 구분 | 내용 |
|---|---|
| 렌더링 | GFM(표·작업목록·취소선·자동링크), 각주, 정의목록, 첨자(`H~2~O`, `x^2^`), ==형광펜==, 이모지 `:tada:`, GitHub 알림(`> [!NOTE]`), YAML front matter |
| 코드 | highlight.js 구문 강조 + 언어 표시 + 복사 버튼 |
| 다이어그램·수식 | Mermaid(플로우차트·시퀀스·간트 등, 테마 연동, 필요할 때만 로드), KaTeX(`$..$`, `$$..$$`) |
| 탐색 | 왼쪽 목차(스크롤 연동·한글 제목 지원), 문서 간 상대 링크 이동, 뒤로/앞으로, 본문 찾기 |
| 보기·편집 | **보기 모드**(렌더링)와 **편집 모드**(CodeMirror 에디터, 수정 후 저장). 모드를 바꿔도 스크롤 위치가 대응되고, 저장 전 내용은 미리보기에 바로 반영된다. 인코딩(UTF-8/BOM/UTF-16)과 줄바꿈(CRLF/LF)은 저장할 때 원래대로 유지하며, EUC-KR 문서는 UTF-8로 변환할지 묻는다. 저장하지 않은 변경은 닫기·이동 전에 확인하고, 파일이 외부에서 바뀌면 내 수정을 지키고 알림 배너로 알려준다 |
| 보기 | 라이트/다크 전환 버튼(시스템 설정으로 되돌리기는 `보기 → 테마`), 본문 너비 4단계, 확대·축소(Ctrl+휠), 사용자 CSS |
| 편의 | 파일 변경 시 자동 새로고침(에디터 저장 방식 무관), 드래그 앤 드롭, 최근 파일, PDF 내보내기·인쇄, 항상 최대화로 열기(듀얼 모니터면 마지막에 있던 모니터에서 열림) |
| 인코딩 | UTF-8(BOM 포함)·UTF-16 자동 인식, UTF-8이 아니면 EUC-KR(CP949)로 해석 |
| 보안 | 문서 안의 `<script>`·이벤트 속성은 DOMPurify로 제거. **Markdown(`.md` 등) 파일만 열며**, 문서 안의 다른 파일·폴더·네트워크(UNC) 경로 링크는 열지 않는다. 네트워크(UNC) 경로로 가는 요청은 이미지·CSS까지 차단한다 (자세한 내용은 [SECURITY.md](SECURITY.md)) |

### 단축키

| 키 | 동작 | 키 | 동작 |
|---|---|---|---|
| Ctrl+O | 열기 | Ctrl+F | 찾기 (Enter / Shift+Enter 이동) |
| Ctrl+N | 새 창 | Ctrl+B | 목차 토글 |
| F5 / Ctrl+R | 다시 불러오기 | Alt+← / Alt+→ | 뒤로 / 앞으로 |
| Ctrl+P | 인쇄 | Ctrl + `+` / `-` / `0` | 확대 / 축소 / 원래 크기 |
| Alt | 메뉴 막대 표시 | F11 | 전체 화면 |
| Shift+Alt+V | 보기 모드로 | Shift+Alt+E | 편집 모드 ↔ 보기 모드 토글 |
| Ctrl+S | 저장 (편집 모드) | Ctrl+Shift+S | 다른 이름으로 저장 |

`보기` 메뉴(보기 모드 / 편집 모드)와 툴바의 **보기 / 편집** 버튼으로도 바꿀 수 있다. 편집 모드에서 Ctrl+F 는 에디터 검색 패널을 연다.

## 설치 방법

Windows 10/11 (x64)을 지원한다.

### 방법 1. 설치 파일로 설치 (권장)

1. 저장소의 [Releases](https://github.com/demolabskr/oh-my-md-viewer/releases) 페이지에서 `OMMV-Setup-<버전>.exe` 를 내려받는다.
2. 실행해서 설치한다. 사용자 단위 설치라 관리자 권한이 필요 없고, 설치 경로는 바꿀 수 있다.
   - 코드 서명이 없어서 SmartScreen 경고가 뜰 수 있다. **추가 정보 → 실행**을 누른다.
3. 설치가 끝나면 시작 메뉴/바탕화면에 **OMMV** 바로가기가 생기고, `.md` 열기 항목에 등록된다.
4. [`.md` 기본 앱으로 지정](#md-기본-앱으로-지정)을 한다.

제거는 **Windows 설정 → 앱 → 설치된 앱 → OMMV** 에서 한다.

### 방법 2. 소스에서 직접 빌드

필요한 것: [Git](https://git-scm.com/), [Node.js](https://nodejs.org/) 20 이상, [pnpm](https://pnpm.io/). pnpm은 9·10·12 버전에서 설치/빌드를 확인했다. (`package.json` 의 `packageManager` 는 9.12.2 로 지정되어 있다.)

#### 사전 준비: Chocolatey로 Git·Node.js 최신 버전 맞추기

[Chocolatey](https://chocolatey.org/)(`choco`)가 없으면 설치하고, 이미 있으면 Chocolatey 자체를 업데이트한 뒤 Git과 Node.js를 최신으로 맞춘다.
**관리자 권한 PowerShell** 에서 실행한다. (시작 메뉴에서 PowerShell 우클릭 → 관리자 권한으로 실행)

```powershell
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    # choco 가 없으면 설치 (공식 설치 스크립트)
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
} else {
    # choco 가 있으면 choco 자체를 먼저 업데이트
    choco upgrade chocolatey -y
}

# Git, Node.js(최신 Current 릴리스) 설치 또는 업데이트 — 이미 최신이면 아무 일도 하지 않는다
choco upgrade git nodejs -y
```

그다음 **PowerShell 창을 닫고 새로 열어서**(PATH 반영) 확인하고 pnpm을 설치한다. (Node.js 25부터는 Corepack이 기본 포함되지 않으므로 `corepack enable` 대신 npm으로 설치한다.)

```powershell
node -v
npm -v
npm install -g pnpm        # 이미 있으면 최신으로 갱신된다
pnpm -v
```

> 안정성을 더 중시하면 `nodejs` 대신 LTS 전용 패키지인 `nodejs-lts` 를 쓴다: `choco upgrade git nodejs-lts -y`
> (`nodejs` 와 `nodejs-lts` 를 함께 설치하지 않는다. 바꾸려면 기존 것을 먼저 `choco uninstall` 한다.)

#### 빌드

```powershell
git clone https://github.com/demolabskr/oh-my-md-viewer.git
cd oh-my-md-viewer
pnpm install
pnpm run dist
```

`release\OMMV-Setup-1.0.0.exe` 가 생성된다. 이후 과정은 방법 1의 2번부터 같다.

- `winCodeSign` 압축 해제 중 "Cannot create symbolic link" 오류가 나면 **Windows 설정 → 개발자 모드**를 켜거나, 관리자 권한 터미널에서 다시 실행한다.
- 설치 파일 없이 폴더 형태로만 확인하려면 `pnpm run pack` → `release\win-unpacked\OMMV.exe`.
- 처음 빌드/실행할 때 Electron 바이너리를 내려받느라 시간이 걸린다. pnpm 10 이상의 설치 스크립트 허용 목록은 `pnpm-workspace.yaml` 에 있다.

### 개발 모드로 실행

```powershell
pnpm install
pnpm start -- sample\sample.md      # 샘플 문서로 실행
```

## `.md` 기본 앱으로 지정

설치하면 `.md .markdown .mdown .mkd .mkdn .mdwn` 연결 항목이 등록된다. Windows 정책상 기본 앱 지정은 사용자가 직접 해야 한다.

1. 아무 `.md` 파일 우클릭 → **연결 프로그램 → 다른 앱 선택**
2. **OMMV** 선택 → **항상** 클릭

앱 메뉴 `도움말 → 기본 앱으로 설정…` 으로 Windows 기본 앱 설정 화면을 바로 열 수 있다. (메뉴 막대는 Alt 키로 표시)

## 사용자 CSS

`도움말 → 사용자 CSS 편집…` 으로 `%APPDATA%\OMMV\custom.css` 를 연다. 저장 후 F5.

```css
#article.markdown-body { font-family: "Pretendard", "Malgun Gothic", sans-serif; font-size: 17px; }
```

## 구조

```
main.js                 메인 프로세스: 창·메뉴·파일 읽기·감시·링크 처리·인쇄/PDF
preload.js              렌더러에 노출하는 최소 API (contextIsolation, sandbox)
src/renderer.js         Markdown → HTML, 목차, Mermaid, 찾기, 모드 전환·저장 등 UI 로직
src/editor-entry.js     편집 모드용 CodeMirror 6 (처음 진입할 때만 로드)
src/app.css             앱 스타일 (GitHub 스타일 + 다크 대응)
scripts/build-web.mjs   esbuild 로 dist/ 생성 (renderer.js, mermaid.bundle.js, editor.bundle.js, style.css, KaTeX 폰트)
sample/                 동작 확인용 문서
```

렌더러는 Electron 전용 API 없이 `window.api` 만 사용하므로, 나중에 용량을 줄이려면 Tauri(WebView2)로 껍데기만 교체할 수 있다.

## 참고

- 설치 후 용량은 Chromium 포함이라 크다(압축 설치 파일 약 80~90MB). Mermaid 번들(약 5MB)은 Mermaid 블록이 있는 문서에서만, 에디터 번들(약 0.5MB)은 편집 모드에 처음 들어갈 때만 로드된다.
- 설정은 `%APPDATA%\OMMV\prefs.json` 에 저장된다.

## 제작 방식

이 프로젝트는 **에이전틱 코딩(agentic coding)** 으로 만들었다.

- 코드, 빌드 스크립트, 이 README는 사람이 직접 짠 것이 아니라 AI 에이전트(Claude, Anthropic)가 작성했다.
- 사람(demolabskr)은 요구사항과 방향을 정하고, 에이전트가 구현·자동 점검·수정을 반복했다.
- 렌더링과 앱 동작은 에이전트가 자동화 테스트로 확인했지만, Windows 설치 파일 빌드와 파일 연결은 실제 Windows 환경에서 검증이 필요하다. 문제가 있으면 [이슈](https://github.com/demolabskr/oh-my-md-viewer/issues)로 알려 달라.

## 라이선스

[MIT](LICENSE) © 2026 demolabskr
