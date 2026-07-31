# 병렬 개발 — 다섯 서비스를 동시에 만들 때

> **언제 읽나**: 워크트리(`../.worktrees/rockury/<svc>`)에서 일하고 있거나, 새 서비스·새 e2e
> 스위트·새 IPC 채널을 만들 때. 한 서비스만 손보는 보통의 작업에는 필요 없다.
> 규칙 정본은 여기이고, `AGENTS.md` 는 이 문서를 가리키기만 한다.

다섯 에이전트(UI/UX · API · DB · Infra · AI)가 각자 워크트리(= 한 저장소를 여러 폴더에 동시에
펼쳐 놓는 git 기능)에서 동시에 일한다. 준비: `node scripts/parallel/setup.mjs`
(현황 `… status` · 정리 `… remove`).

폴더는 저장소 **바깥**의 숨김 폴더 `../.worktrees/rockury/<svc>` 에 생긴다 — 저장소 안에 두면
빌드·테스트·검색이 `**` 로 훑을 때 자기 사본을 파고들고, 숨김 폴더라 상위 폴더 목록이 안
어질러진다. 저장소 밖이라 `.gitignore` 도 필요 없다.

## 서비스 id — 서비스당 토큰 하나

`uiux` · `api` · `db` · `infra` · `ai`.

이 토큰 하나가 nav registry 의 `Service.id`, IPC 채널 접두어, 폴더·파일 이름, 브랜치 이름에
전부 그대로 쓰인다. 토큰을 둘로 늘리면 "내 파일이 어느 쪽이냐"가 흐려진다.

**`ai` 와 `mcp` 를 헷갈리지 말 것.** `ai` 는 **서비스**(AI 기능 전체가 자랄 자리)이고,
MCP(에이전트 연동)는 그 서비스가 지금 가진 **기능 하나**다. 그래서 `src/main/ai/**`(MCP 프로토콜
서버 구현)과 `docs/spec/ai-server.md` 는 `mcp` 가 맞고, 서비스를 가리키는 자리(폴더·채널
접두어·브랜치)는 전부 `ai` 다 — MCP 게이트웨이 채널도 `ai:mcpStatus` 처럼 서비스 접두어를 쓴다.

## 내 파일이 어디까지인가 (`<svc>` = 서비스 id)

| 무엇 | 내 파일 |
|---|---|
| 화면 | `src/renderer/src/services/<svc>/**` |
| 메인 IPC 채널 | `src/main/ipc/<svc>/**` |
| 로컬 DB 스키마 | `src/main/store/migrations/<svc>.ts` |
| MCP 노출 지도 | `src/main/ai/coverage/<svc>.ts` |
| 렌더러 창구(preload) | `src/preload/services/<svc>.ts` |
| 앱 구동 e2e 흐름 | `e2e/suites/NN-*.mjs` (러너가 폴더를 읽으니 등록 불필요) |
| 화면 품질 기준선 | `e2e/surface/baseline/<svc>.json` (생성물 — 손으로 고치지 않는다) |
| 기획·테스트 정본 | `docs/spec/<svc>-*.md` · `docs/qa/<svc>-*.md` |

## 건드리지 않는 공용 파일

아래는 **새 서비스를 만들 때만** 바뀐다. 기능을 더할 때 열 일이 없다 — 열게 되면 대개 설계가
잘못된 것이다:

`nav/registry.ts` · `main/index.ts` · `main/ipc/registry.ts` · `store/db.ts` ·
`store/migrations/index.ts` · `ai/coverage/index.ts` · `preload/index.ts` ·
`preload/services/index.ts` · `e2e/smoke.mjs` · `e2e/lib/harness.mjs` ·
`src/renderer/src/ui/**`(공용 컴포넌트 — 고쳐야 하면 `main` 에서, 다섯 서비스에 영향).

## 이름이 부딪히는 자리

기계가 막아 주는 것과 사람이 지켜야 하는 것을 갈라 적는다.

| 대상 | 규칙 | 어기면 |
|---|---|---|
| IPC 채널 | `<svc>:<동작>` (예: `infra:listContainers`) | 사람이 지킨다. 기존 DB 채널은 무접두어 그대로(레거시 예외) |
| SQLite 테이블 | `<svc>_` 접두어 — **관례** | 접두어 자체는 기계가 안 본다. 다만 **두 서비스가 같은 테이블을 선언하면 앱이 안 켜진다**(`store/migrations/index.ts` 의 `assertConsistent`) |
| preload 최상위 키 | 서비스마다 달라야 한다 | 겹치면 조립이 던진다(`preload/services/index.ts` 의 `assembleApi`) |
| MCP 도구 이름 | `<svc>_<동작>` (예: `api_get_spec`) | 사람이 지킨다. 도구는 IPC 와 달리 **한 목록에 평평하게** 놓여 이름이 유일해야 한다 — 접두어가 없어 `create_version`·`list_versions` 에서 api·db 가 실제로 부딪혔다. 기존 DB 도구는 무접두어 그대로 |
| 디자인 토큰 | 새 색·간격은 `styles/globals.css` 의 `@theme` 에 선언하고 쓴다 | `tokens.test.ts` 가 막는다. 선언 없이 쓰면 Tailwind v4 가 **아무 말 없이** 유틸리티를 안 만들어 그 자리가 투명해진다(2026-07-29 api 에서 24곳) |

## e2e 스위트 번호 — 서비스별 구간

파일 이름의 번호가 곧 실행 순서이고, 그 순서는 **상태 의존**이다(앞 스위트가 만든 설계·연결을
뒤가 쓴다). 임의로 바꾸지 않는다.

| 구간 | 주인 |
|---|---|
| `01`–`12` | 기존 블록(공용·db·ai 혼재) — 내부 순서가 상태 의존이라 재배치하지 않는다 |
| `13`–`19` | infra |
| `20`–`29` | uiux |
| `30`–`49` | api |
| `50`–`59` | db |
| `60`–`69` | ai |

`isolation.test.ts` 가 구간 밖 번호·중복 번호·`meta.name` ↔ 파일 이름 어긋남을 `npm test` 에서
막는다. **구간이 넘치면 이 표와 그 테스트의 `BANDS` 를 함께 넓힌다** — 말없이 옆 칸을 쓰면 그
서비스가 자기 첫 스위트를 놓는 순간 `main` 에서 깨진다(2026-07-29 에 infra·uiux·api 셋이 동시에
13번을 잡았다).

## 병합

1. **받기** — `main` 이 움직였으면 본진에서 `node scripts/parallel/setup.mjs sync` 한 번.
   뒤처진 워크트리만 빨리감기하고, 앞서 있거나 갈라진 것은 건드리지 않고 안내만 한다
   (`reset --hard` 는 어떤 경로로도 실행되지 않는다 — 작업물 보호).
   갈라졌다고 나오면 그 폴더에서 `git rebase main` 후 다시.
2. **올리기** — 게이트(`npm run typecheck && npm test && npm run build`) 통과 후 본진에서
   `git merge --ff-only feat/<svc>`. `main` 은 다른 폴더가 열고 있으므로 병합은 본진 몫이다.
3. 새 파일 위주라 충돌이 거의 없다 — 충돌이 잦으면 공용 파일을 건드리고 있다는 신호다.

## 워크트리로 격리되지 않는 것 (한 번에 한 명)

- **앱을 손으로 띄워 확인** — 로컬 DB 파일 하나를 공유하고 단일 인스턴스 잠금이 걸려 있다.
  **앱은 언제나 하나만 뜬다.** 함정: 두 번째 사람 눈엔 "창이 떴다"로 보이는데 **그 창은 남의
  워크트리 코드**다. 그래서 ⑴ 두 번째 실행이 어느 폴더 앱이 떠 있는지 알리고 종료하고
  (`src/main/instanceNotice.ts`), ⑵ 개발 모드 타이틀바에 소스 폴더 배지가 뜬다(배포본엔 없음).
  검증은 앱 대신 `npm test` 로 — 병렬 안전하다.
- **`npm run db:reset`** — 도커 테스트 DB 는 고정 포트(13306/13307/15432)를 공유한다.
- **의존성 추가(`package.json`/lock)** — `main` 에서 한 명만. 나머지는 rebase 로 받아간다.
- `npm run e2e` 는 임시 userData + MCP 포트 0 이라 동시에 돌려도 안전하다.

## Claude Code 가 만드는 임시 워크트리

`claude --worktree <이름>` 이나 서브에이전트 `isolation: worktree` 는 **저장소 안**
`.claude/worktrees/` 에 임시 워크트리를 만든다(위의 상설 5개와 별개). 추적 안 되는 파일은 안
따라가므로 **`.worktreeinclude`** 에 적어 둔다 — 지금은 `.harness-main`(steward 활성 스위치)이
들어 있다. 빠지면 하네스가 **꺼진 채로** 작업하게 되고 그 사실이 조용히 지나간다.
