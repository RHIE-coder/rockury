# 기계가 지키는 것들 — 왜 있고, 걸리면 어떻게 하나

> **언제 읽나**: 가드가 걸려 실패했는데 왜 그런지 모를 때, 또는 가드를 고치거나 새로 만들 때.
> 평소에는 읽을 필요가 없다 — **실패 메시지가 이 문서보다 정확하다.**
>
> 여기 적힌 규칙을 `AGENTS.md` 에 다시 적지 않는다. 기계가 강제하는 것을 사람 지침으로도
> 적어 두면, 지침이 길어져 정작 기계가 못 잡는 규칙이 묻힌다.

각 항목은 **사고에서 나왔다.** 가드를 지우려면 그 사고가 왜 다시 안 나는지부터 말해야 한다.

## 1. 테스트는 실 사용자 데이터를 파괴하지 않는다

`e2e/isolation.test.ts` — `e2e/**/*.mjs` 전체를 재귀로 검사한다.

- 실 앱 userData 경로(`Application Support/Rockury`) 참조 → 실패
- 임시 userData 밖의 `rmSync` → 실패
- 앱을 띄우면서 `--user-data-dir=<mkdtemp>` 격리가 없으면 → 실패
- 검사 대상이 0건이어도 실패한다(글롭이 깨져 "검사할 게 없어 통과"하는 상태를 막는다)

**왜**: 과거에 테스트가 실 사용자 DB 를 지웠다. 검사 대상을 폴더 스캔으로 둔 것은 파일을 쪼개
가드를 빠져나가지 못하게 하기 위해서다.

## 2. 커밋 게이트

`scripts/git-hooks/pre-commit` (`core.hooksPath` 로 추적·공유, `npm install` 시 `prepare` 가 설정).

`typecheck && test && build` 를 통과해야 커밋된다. UI 를 고쳤으면 `surface-verify` 기록이
그보다 최신이어야 한다.

**e2e 는 기본으로 안 돈다.** 지시가 있을 때만 `RUN_E2E=1 git commit …`(전체) 또는
`RUN_E2E=--only=<스위트> git commit …`. `e2e/lib/runScope.test.ts` 가 자동 실행 부활과
옛 건너뛰기 열쇠의 재등장을 막는다.

**왜**: e2e 를 훅에서 자동으로 돌리던 시절, 글자 하나 고치고도 전수 조사가 돌았다.
같은 지적이 세 번 나와 자동 실행을 뗐다(2026-07-30).

## 3. e2e 는 누적 회귀 자산이다

구조: 러너 `e2e/smoke.mjs` + 하네스 `e2e/lib/harness.mjs` + 스위트 `e2e/suites/NN-*.mjs`.

- 러너가 폴더를 읽으므로 **등록 목록이 없다** — 공용 파일을 안 건드리고 스위트를 더할 수 있다
- 새 실 앱 흐름은 알맞은 스위트에 체크를 더하거나 새 스위트를 놓는다. **지우지 않는다**
- 번호 규칙·서비스 구간은 `docs/agents/parallel-dev.md`
- `meta.needsDb: true` 인 스위트를 `--no-db` 로 건너뛰면 **"미검증"으로 표시**된다(조용한 통과 금지)
- 체크 하나마다 `.harness/steward/artifacts/e2e-checkpoint.json` 에 기록되어, 중간에 죽어도
  어디까지 돌았고 무엇이 미실행인지 남는다

**돌리는 법**: `npm run build && npm run e2e -- --only=<스위트,...>`.
옵션 `--only` · `--all` · `--list` · `--no-db` · `--continue`.
범위 없이 부르면 러너가 거부한다(종료코드 2 + 다음 수 안내 — `e2e/lib/runScope.mjs`).
docker test-db 전제 — 없으면 `npm run db:up`.

**앱 구동 함정**(실측)은 `e2e/README.md` 가 정본이다. 여기 옮겨 적지 않는다.

## 4. UI 품질 게이트

`e2e/surface/verify.mjs` — 셸 훅(`data-nav-service` / `data-nav-module` / `data-nav-view`)으로
전 서비스×모듈×뷰를 자동 순회한다. 새 화면은 **nav 에 등록만 하면** 커버리지에 들어온다.

- 이 `data-nav-*` 훅을 지우면 순회가 깨지고 안전핀(`MIN_LEAVES`)이 검증불가로 실패한다
- 검사 창은 **주 디스플레이 + 1440×900** 으로 못박혀 있다. 커서가 있는 화면(좁은 세로 모니터
  등)에 창이 뜨면 macOS 가 폭을 잘라 잘림 판정이 실행마다 뒤집혔다(flake 실측). 크기를 못
  만들면 조용히 다른 폼팩터로 재지 않고 **검증불가로 실패**한다. 창 크기를 바꾸면 기준선 재수립
- 기준선은 서비스별 생성물 `e2e/surface/baseline/<svc>.json` — 손으로 고치지 않는다

## 5. MCP 서버는 앱 능력과 함께 자란다

`src/main/ipc/**` 의 모든 채널은 `src/main/ai/coverage/<svc>.ts` 에 **노출(도구 대응) 또는
제외(사유)** 로 등재돼야 한다. `src/main/ai/coverage.test.ts` 가 하위 폴더까지 재귀로 스캔해
강제한다.

- 새 IPC 채널을 미등재로 두면 → `npm test` 실패
- 지운 채널을 지도에 남겨도 → 실패
- 두 서비스가 같은 채널을 등재해도 → 실패(조용한 덮어쓰기 방지)

## 6. 디자인 토큰

`src/renderer/src/styles/tokens.test.ts` — `@theme` 에 없는 키의 유틸리티를 쓰면 실패한다.

**왜**: Tailwind v4 는 미선언 키의 유틸리티를 **아무 말 없이 안 만든다**. 선언 없이
`bg-danger-soft` 를 쓰면 그 자리가 전부 투명하게 그려진다(2026-07-29 api 에서 24곳).

## 7. 기계로 못 막는 것 — 화면 문구

"자명한가"는 문장 모양이 아니라 그 화면의 문맥 판정이다. 문자열 검사로는 정상 문구까지 걸린다
(db 서비스만 세도 68곳). 그래서 규칙은 `AGENTS.md` 에 두고, 회귀는 **대상별 테스트**로 못박는다
(예: `ddl.test.ts` 의 "자명한 것을 주석으로 되풀이하지 않는다").

surface-verify 판정기(`e2e/surface/checks.mjs`)에 문구 검사를 넣으면 전 화면을 자동으로 훑을 수
있지만, 다섯 서비스 기준선 재수립이 딸려온다 — 사용자 판단 대기.
