# e2e — 빌드된 Electron 앱 구동 스모크

`npm run build` 로 만든 앱(`out/main/index.js`)을 Playwright `_electron` 으로 실제 띄워 핵심 플로우를 검증한다.
단위 로직은 `npm test`(vitest)가 덮고, 여기서는 "실제 앱이 뜨고 흐름이 돈다"를 확인한다.

## 실행
```bash
npm run build && npm run e2e
```
(스모크가 앱 로컬 DB `~/Library/Application Support/Rockury/rockury.db` 를 실행 전 초기화하므로 clean 시드로 검증됨)

## ⚠ 이 앱을 구동할 때의 함정 (실측)
- **접근성 쿼리(`getByRole` 등)는 이 Electron 창을 크래시**시킨다 → **CSS/text 로케이터만** 사용.
- Radix 메뉴아이템에서 곧바로 Dialog 를 열면 body `pointer-events:none` 이 잔존 → 앱 UI 가 코드에선 이미 `setTimeout(onSelect,0)` 로 회피(ContextBar).
- `node:sqlite` 는 ExperimentalWarning 를 stderr 로 출력(무해, 필터 가능).
- 선택 커밋은 `button[type="submit"]` 등으로 다이얼로그 버튼을 특정(타임라인의 "버전 컷"과 다이얼로그 "… 컷"이 텍스트로 겹침).

## 확장
새 플로우는 `smoke.mjs` 패턴(launch → click(CSS) → assert → screenshot)을 복사해 추가.
Electron 구동/드라이브를 프로젝트 스킬로 박제하려면 `/run-skill-generator` 사용 권장.

## surface-verify (UI 품질 게이트) — `npm run surface-verify`
`surface/verify.mjs` 가 셸 훅(`data-nav-service/module/view`)으로 **전 서비스×모듈×뷰를 자동 순회**하며
화면마다 대비(WCAG)/잘림/넘침/겹침/렌더 에러를 검사한다(판정 로직은 `surface/checks.mjs`, vitest 커버).
- **새 화면은 nav 등록만 하면 자동 커버** — 수동 등록 없음. 셸의 data-nav 훅을 지우면 안 된다
  (leaf < MIN_LEAVES 면 검증불가(2)로 크게 실패하는 안전핀 내장).
- 기존에 수용한 findings 는 `surface/baseline.json`(커밋되는 정본) — **새 회귀만 차단**한다.
  의도한 시각 변경으로 새 finding 이 생기면 확인 후 `node e2e/surface/verify.mjs --update-baseline`.
