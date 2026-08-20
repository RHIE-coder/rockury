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
- **잘림**은 "볼 길이 없다"를 잡는 검사다. 잘린 칸 옆에 펼침 손잡이(`[data-clip-toggle]`,
  `ui/clipped`)가 붙어 있으면 `expandable` 로 표시돼 안 센다 — 호버 툴팁은 면제 대상이 아니다

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

## 8. 소스가 git 안에 온전히 들어가는가

둘 다 **빌드·타입검사·테스트가 전부 통과하는데도 저장소만 망가지는** 종류라 사람 눈에 안 걸린다.

- `e2e/tracked.test.ts` — `src`·`e2e`·`scripts` 의 파일이 전부 git 에 추적되는가.
  **왜**: `.gitignore` 의 `coverage` 규칙이 깊이를 안 가려 `src/main/ai/coverage/` 8개 파일이
  조용히 커밋에서 빠졌다. main 폴더엔 로컬 파일이 남아 있어, 새 워크트리를 만들고서야 터졌다.
- `e2e/textSource.test.ts` — git 이 바이너리로 보는 파일이 있는가(`git ls-files --eol`).
  `src`·`e2e`·`scripts`·`docs`·`.harness` 를 본다 — 문서도 대상이다(설명하는 문장에 실제 NUL 을
  적는 사고가 실제로 났다).
  **왜**: 짝짓기 키의 구분자 NUL 을 `'\u0000'` 이 아니라 **실제 바이트**로 적어 그 파일만
  diff·blame 이 "Bin 1234 -> 5678 bytes" 로 나왔다. 2026-08-11 에 한 파일만 고치고 아홉 개를
  놓쳐 나흘 뒤 우연히 드러났다. 판정은 NUL 을 직접 세지 않고 **git 에게 묻는다** — 직접 세면
  git 의 판정 규칙을 여기서 다시 구현하는 꼴이 된다.
  구분자를 NUL 로 고른 것 자체는 그대로다(이름에 절대 못 들어가는 글자라 고른 것) — 표기만
  이스케이프로 적는다.

## 9. 공유 제보 폴더는 워크트리가 지우지 못한다

`.harness/steward/project/hooks/no-shared-feedback-delete.mjs` — 워크트리 세션의 `Bash` 명령이
`.harness/feedback` 을 지우거나 옮기려 하면 거부한다(`.claude/settings.json` 의 `PreToolUse`).
판정은 `no-shared-feedback-delete.test.mjs` 가 `npm test` 에서 지킨다.

**왜**: 워크트리의 `.harness/feedback` 은 사본이 아니라 main 폴더 한 자리를 가리키는 링크다.
그런데 `AGENTS.md` 는 매 세션 "읽고 고쳤으면 폴더를 지운다"고 말한다 — 그대로 따르면 다른
서비스가 아직 처리 못 한 제보까지 함께 사라진다. gitignore 대상이라 **되돌릴 커밋이 없다.**
병렬 개발의 제보 규칙 넷 중 유일하게 복구가 안 되는 항목이라 여기만 기계로 막았다(나머지
셋은 어겨도 시간 몇 분이라 가드 비용이 더 비싸다).

**막지 않는 것**: main 폴더에서 지우는 것(다 처리한 제보를 치우는 정상 흐름), 그리고 읽기.
`grep -rn "rm" .harness/feedback/` 처럼 글자로만 들어 있는 경우까지 막으면 제보를 읽는 일
자체가 안 되므로, **명령 자리에 있는** 동사만 센다.

**걸렸다면**: 지우지 말고 그 폴더에 `done-<서비스>.md` 를 남긴다. 남의 몫이 섞여 있으면
`handoff-<받을서비스>.md` 도. 폴더 삭제는 main 폴더에서 병합할 때 한다.
