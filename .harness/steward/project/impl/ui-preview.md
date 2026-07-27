# ui-preview — 빌드된 Electron 앱을 띄워 실제로 조작·확인

steward build/review 단계에서 **화면이 바뀌었을 때** 쓴다. 이 프로젝트는 steward 도입 전부터
Playwright `_electron` 으로 빌드된 앱을 띄워 CSS/text 로케이터로 직접 조작·검증해 왔다 —
그 능력을 **그대로 살린다(steward 가 제한하지 않는다).**

## 절차
1. `npm run build` (`out/main/index.js` 필요).
2. Playwright `_electron` 로 런치 — **반드시 격리된 임시 userData**:
   `args: [MAIN, '--user-data-dir=<mkdtemp>']`. 실 앱 DB(`~/Library/Application Support/Rockury/rockury.db`)를
   절대 건드리지 않는다(불변식). 런치/드라이브 패턴은 `e2e/lib/harness.mjs` 를 그대로 쓴다.
3. 조작은 **CSS/text 로케이터만**. `getByRole` 등 접근성 쿼리는 이 창을 **크래시**시킨다.
4. 눈으로만 보지 말고 **실제로 click·fill** 하고 `document.body.innerText`·`th` 셀 등으로 단언한다
   (겉만 있는 기능은 정지 화면에 안 드러난다).
5. 스크린샷 증거가 필요하면 `ui-shot`(능력)을 쓴다.

## ⭐ 축적 규칙 (이 프로젝트의 핵심 개선점)
드라이브를 **1회용으로 버리지 말 것.** 지금까지 임시 스크립트로 띄워보고 버려서 회귀 자산이
안 쌓인 게 기회비용이었다. 검증한 흐름이 회귀 가치가 있으면(대부분 있다) 알맞은 스위트
(`e2e/suites/NN-*.mjs`)에 `check(...)` 로 **추가해 누적**한다 — 지우지 않는다(AGENTS.md 불변식 ·
`e2e/README.md` "확장"). 새 영역이면 스위트 파일을 만들고 러너(`e2e/smoke.mjs`)의 `SUITES` 에 등록한다.
임시 드라이브 스크립트는 scratchpad 에 두되, 살아남을 검사는 반드시 스위트로 **승격**한다.

## 함정 (실측 — `e2e/README.md`)
- 접근성 쿼리(`getByRole` 등) → 창 크래시. **CSS/text 로케이터만.**
- Radix 메뉴아이템 → Dialog 는 `setTimeout(onSelect,0)` 로 열림(앱 코드가 이미 회피).
- CodeMirror 입력: `.cm-content` click → `Ctrl/Cmd+A` → `Backspace` → type → `Escape`(자동완성 닫기).
- `node:sqlite` 는 ExperimentalWarning 를 stderr 로 냄(무해, 필터 가능).
- 운영부(연결 테스트) 흐름은 test-db 필요 → `npm run db:up`.
