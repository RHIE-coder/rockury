# e2e — 빌드된 Electron 앱 구동 스모크

`npm run build` 로 만든 앱(`out/main/index.js`)을 Playwright `_electron` 으로 실제 띄워 핵심 플로우를 검증한다.
단위 로직은 `npm test`(vitest)가 덮고, 여기서는 "실제 앱이 뜨고 흐름이 돈다"를 확인한다.

## 실행
```bash
npm run db:up                 # docker test-db(mysql/mariadb/postgresql) — 기본 전제
npm run build && npm run e2e
```
옵션: `npm run e2e -- --no-db`(test-db 필요한 스위트 건너뜀) · `--only=03-studio-definition,04-studio-seed`
· `--continue`(스위트가 깨져도 다음까지) · `--list`(스위트 목록).

`src/`·`e2e/` 를 건드린 커밋은 **pre-commit 훅이 자동으로 e2e 를 돌린다**.
빠져나갈 문: `SKIP_E2E=1 git commit ...`(통째로) · `E2E_ARGS=--no-db git commit ...`(test-db 스위트만).

> 실 앱 DB 는 **절대** 건드리지 않는다 — 매 실행 격리된 임시 userData(`--user-data-dir=<mkdtemp>`)로
> 띄우고 끝나면 그 임시 디렉터리만 지운다. `isolation.test.ts` 가 `e2e/**/*.mjs` 전체를 검사해 강제한다.

## 구조 (스위트)
```
smoke.mjs             러너 — suites/ 를 자동 발견해 이름순 실행, 체크포인트 기록, 요약 출력
lib/harness.mjs       앱 기동·조작 헬퍼(ctx: page/check/click/body/typeSql/relaunch) + 체크포인트
suites/NN-*.mjs       실제 체크. export const meta = { name, needsDb, desc } + export async function run(ctx)
```
- **등록 목록이 없다** — 러너가 `suites/` 폴더를 읽어 파일 이름 순으로 돌린다. 파일을 놓으면 자동 포함.
- 실행 순서 = **상태 의존 순서**(앞 스위트가 만든 설계·연결을 뒤가 쓴다) → 파일 이름의 번호를 임의로 바꾸지 말 것.
- `needsDb: true` 스위트는 test-db 필요. `--no-db` 로 건너뛰면 **"미검증"으로 표시**된다(조용한 통과 없음).
- 체크포인트: `.harness/steward/artifacts/e2e-checkpoint.json` — 체크 하나마다 flush 하므로
  중간에 죽어도 어디까지 돌았고 무엇이 미실행인지 남는다.

## ⚠ 이 앱을 구동할 때의 함정 (실측)
- **접근성 쿼리(`getByRole` 등)는 이 Electron 창을 크래시**시킨다 → **CSS/text 로케이터만** 사용.
- Radix 메뉴아이템에서 곧바로 Dialog 를 열면 body `pointer-events:none` 이 잔존 → 앱 UI 가 코드에선 이미 `setTimeout(onSelect,0)` 로 회피(ContextBar).
- `node:sqlite` 는 ExperimentalWarning 를 stderr 로 출력(무해, 필터 가능).
- 선택 커밋은 `button[type="submit"]` 등으로 다이얼로그 버튼을 특정(타임라인의 "버전 컷"과 다이얼로그 "… 컷"이 텍스트로 겹침).

## 확장
새 플로우는 **알맞은 스위트에 `check(...)` 를 더한다**(지우지 않는다 — 누적 회귀 자산).
새 영역이면 `suites/NN-이름.mjs` 를 만들고(`meta` + `run(ctx)`) **놓기만 하면 끝** — 러너가
`suites/` 폴더를 읽어 파일 이름 순으로 자동 실행하므로 등록 목록이 없다(공용 파일을 안 건드린다).
번호가 곧 실행 순서이니, 앞 스위트가 만든 상태를 쓰는 스위트는 그보다 큰 번호를 붙인다.
Electron 구동/드라이브를 프로젝트 스킬로 박제하려면 `/run-skill-generator` 사용 권장.

## surface-verify (UI 품질 게이트) — `npm run surface-verify`
`surface/verify.mjs` 가 셸 훅(`data-nav-service/module/view`)으로 **전 서비스×모듈×뷰를 자동 순회**하며
화면마다 대비(WCAG)/잘림/넘침/겹침/렌더 에러를 검사한다(판정 로직은 `surface/checks.mjs`, vitest 커버).
- **새 화면은 nav 등록만 하면 자동 커버** — 수동 등록 없음. 셸의 data-nav 훅을 지우면 안 된다
  (leaf < MIN_LEAVES 면 검증불가(2)로 크게 실패하는 안전핀 내장).
- 기존에 수용한 findings 는 `surface/baseline/<서비스>.json`(커밋되는 정본, 서비스별 분할) — **새 회귀만 차단**한다.
  의도한 시각 변경으로 새 finding 이 생기면 확인 후 `node e2e/surface/verify.mjs --update-baseline`.
- **검사 창은 주 디스플레이 + 1440×900 고정** — 커서가 있는 화면(좁은 세로 모니터 등)에 창이 뜨면
  macOS 가 폭을 잘라(1080 등) 잘림 판정이 실행마다 뒤집혔다(flake 실측). 그 크기를 못 만들면
  조용히 다른 폼팩터로 재지 않고 **검증불가로 실패**한다. 크기를 바꾸면 기준선 재수립이 필요하다.
