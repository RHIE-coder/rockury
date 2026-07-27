# Rockury — 프로젝트 규칙 (모든 코딩 에이전트 공용 정본)

> 이 파일이 프로젝트 지침의 **단일 정본**이다. Claude Code 는 `CLAUDE.md` 가 이 파일을 `@import` 한다.
> **작업 진행 방식**(경로 판정·작업 단계·응답 규율·쉬운 말)은 **steward 하네스**가 관장한다
> (세션 시작 시 자동 로드) — 여기 중복해 적지 않는다. 값·능력은 `.harness/steward/config.yaml`.

Electron + electron-vite · React 19 + TS 7 · Tailwind v4 + Radix · Zustand 5 · **화이트 테마 고정**.
현재 집중: **DB 서비스**. 설계부(Studio/Versions)·운영부(Environments/Console/Migration) 모두
로컬 SQLite(`node:sqlite`) + 실 드라이버(mysql2/pg/node:sqlite) 위에 구현됨. Diagram(Console 실 ERD·Studio 가상 편집 ERD)까지 완료. 남은 것은 선택적 향상(Studio Seed/Mocking/Documenting/Validation·Overview·Reference 등).
설계 근거·결정 → `docs/before-steward-background/db-service-ia.md` · 로드맵/진행·재개점 → `docs/before-steward-background/ops-implementation-plan.md`.
살아있는 기획/테스트 정본(steward) → `docs/spec/` · `docs/qa/`.

## 응답
- **간결·핵심만.** 해결하면 뭘 했는지 1~2줄. 요청 없으면 설명 안 붙인다. (steward "쉬운 말" 규율 위에서.)

## 🌿 Git (MUST)
- **`main` 은 통합 전용이다 — 직접 작업하지 않고 병합만 받는다.**
  각 서비스는 자기 브랜치 `feat/<서비스 id>` 에서 일한다: `feat/uiux` · `feat/api` · `feat/db` ·
  `feat/infra` · `feat/ai`. (2026-07-27 사용자 지시로 개정 — 그전 규칙은 "main 직접 작업"이었고,
  5서비스 병렬 개발을 켜면서 뒤집었다.)
- 예외: **어느 서비스에도 안 속하는 것**(공용 파일 구조, `AGENTS.md`, 의존성 추가)은 `main` 에서 한다.
- 커밋/푸시는 사용자가 요청할 때만. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## 👥 병렬 개발 규칙 (5서비스 동시 작업)
다섯 에이전트(UI/UX · API · DB · Infra · AI)가 각자 워크트리(= 한 저장소를 여러 폴더에
동시에 펼쳐 놓는 git 기능)에서 동시에 일한다. 준비: `node scripts/parallel/setup.mjs`
(현황 `… status` · 정리 `… remove`). 폴더는 저장소 **바깥**의 숨김 폴더
`../.worktrees/rockury/<서비스 id>` 에 생긴다 — 저장소 안에 두면 빌드·테스트·검색이 `**` 로
훑을 때 자기 사본을 파고들고, 숨김 폴더라 상위 폴더 목록이 어질러지지 않는다.
저장소 밖이므로 `.gitignore` 는 필요 없다(git 시야가 저장소 밖까지 미치지 않는다).

### 서비스 id — 서비스당 토큰 하나
`uiux` · `api` · `db` · `infra` · `ai`. 이 토큰 하나가 nav registry 의 `Service.id`,
IPC 채널 접두어, 폴더·파일 이름, 브랜치 이름에 전부 그대로 쓰인다 —
토큰을 둘로 늘리면 "내 파일이 어느 쪽이냐"가 흐려진다.

**`ai` 와 `mcp` 를 헷갈리지 말 것.** `ai` 는 **서비스**(AI 기능 전체가 자랄 자리)이고,
MCP(에이전트 연동)는 그 서비스가 지금 가진 **기능 하나**다. 그래서
`src/main/ai/**`(MCP 프로토콜 서버 구현)과 `docs/spec/ai-server.md` 는 `mcp` 가 맞고,
서비스를 가리키는 자리(폴더·채널 접두어·브랜치)는 전부 `ai` 다 —
MCP 게이트웨이를 다루는 채널도 `ai:mcpStatus` 처럼 서비스 접두어를 쓴다.

### 내 파일이 어디까지인가 (`<svc>` = 서비스 id)
| 무엇 | 내 파일 |
|---|---|
| 화면 | `src/renderer/src/services/<svc>/**` |
| 메인 IPC 채널 | `src/main/ipc/<svc>/**` |
| 로컬 DB 스키마 | `src/main/store/migrations/<svc>.ts` |
| MCP 노출 지도 | `src/main/ai/coverage/<svc>.ts` |
| 렌더러 창구(preload) | `src/preload/services/<svc>.ts` |
| 앱 구동 e2e 흐름 | `e2e/flows/<svc>.mjs` |
| 화면 품질 기준선 | `e2e/surface/baseline/<svc>.json` (생성물 — 손으로 고치지 않는다) |
| 기획·테스트 정본 | `docs/spec/<svc>-*.md` · `docs/qa/<svc>-*.md` |

### 건드리지 않는 공용 파일
아래는 **새 서비스를 만들 때만** 바뀐다. 기능을 더할 때 열 일이 없다 — 열게 되면 대개
설계가 잘못된 것이다: `nav/registry.ts` · `main/index.ts` · `main/ipc/registry.ts` ·
`store/db.ts` · `store/migrations/index.ts` · `mcp/coverage/index.ts` ·
`preload/index.ts` · `preload/services/index.ts` · `e2e/smoke.mjs` · `e2e/flows/index.mjs` ·
`src/renderer/src/ui/**`(공용 컴포넌트 — 고쳐야 하면 `main` 에서, 다섯 서비스에 영향).

### 네임스페이스 (충돌 방지)
- **IPC 채널**: `<svc>:<동작>` (예: `infra:listContainers`, `ai:mcpStatus`). 기존 DB 채널은 무접두어 그대로 둔다(레거시 예외).
- **SQLite 테이블**: `<svc>_` 접두어. 두 서비스가 같은 테이블을 선언하면 앱이 안 켜진다(런타임 검사).
- **preload 최상위 키**: 서비스마다 달라야 한다. 겹치면 조립이 실패한다.

### 병합
1. **받기** — `main` 이 움직였으면 본진에서 `node scripts/parallel/setup.mjs sync` 한 번.
   뒤처진 워크트리만 빨리감기하고, **앞서 있거나 갈라진 것은 건드리지 않고 안내만** 한다
   (`reset --hard` 는 어떤 경로로도 실행되지 않는다 — 작업물 보호).
   갈라졌다고 나오면 그 폴더에서 `git rebase main` 후 다시.
2. **올리기** — 기능이 끝나면 게이트(`npm run typecheck && npm test && npm run build`) 통과 후
   본진에서 `git merge --ff-only feat/<서비스>`. `main` 은 다른 폴더가 열고 있으므로 병합은 본진 몫이다.
3. 새 파일 위주라 충돌이 거의 없다 — 충돌이 잦으면 공용 파일을 건드리고 있다는 신호다.

### Claude Code 가 만드는 임시 워크트리
`claude --worktree <이름>` 이나 서브에이전트 `isolation: worktree` 는 **저장소 안**
`.claude/worktrees/` 에 임시 워크트리를 만든다(위의 상설 5개와는 별개 — 잠깐 쓰고 버리는 용도).
`.gitignore` 에 등재돼 있어 `git status` 를 더럽히지 않는다.
그 워크트리에는 추적 안 되는 파일이 안 따라가므로 **`.worktreeinclude`** 에 적어 둔다 —
지금은 `.harness-main`(steward 활성 스위치)이 들어 있다. 빠지면 하네스가 **꺼진 채로**
작업하게 되고(경로 판정·테스트 의무·게이트 전부 누락) 그 사실이 조용히 지나간다.

### 워크트리로 격리되지 않는 것 (한 번에 한 명)
- **앱을 손으로 띄워 확인** — 로컬 DB(`userData/rockury.db`) 파일 하나를 공유하고, 앱은 단일 인스턴스 잠금이 걸려 있다.
- **`npm run db:reset`** — 도커 테스트 DB 는 고정 포트(13306/13307/15432) 공유. 남이 쓰는 중에 리셋하면 그 사람 테스트가 깨진다.
- **의존성 추가(`package.json`/lock)** — `main` 에서 한 명만. 나머지는 rebase 로 받아간다.
- 자동 e2e(`npm run e2e`)는 임시 userData + MCP 포트 0 이라 **동시에 돌려도 안전하다**.

## ✅ 테스트 의무 (MUST — 예외 없음)
테스트 없이 로직을 머지하지 않는다.
1. **순수/도메인 로직 추가·변경 → 같은 커밋에 `*.test.ts` 동반.** 대상 예: diff/스냅샷, semver,
   DDL 생성, 타입 카탈로그, 파생(derive), SQL 빌더/안전 판정, introspection 매핑 등 "입력→출력이
   결정적인" 모든 것. 테스트는 대상 모듈 **옆에** `foo.test.ts`(vitest, node). 예: `src/renderer/src/services/db/**/*.test.ts`.
2. 완료 게이트: `npm run typecheck && npm test && npm run build`. 실 앱 흐름을 건드렸으면 `npm run e2e` 추가.
   (steward gate 단계 + git pre-commit 훅이 강제.)
3. 버그를 고치면 그 버그를 재현하는 **회귀 테스트를 먼저/함께** 추가.
4. UI 컴포넌트/스토어 자체는 강제 대상 아님 — 그 안의 **순수 로직은 분리해 테스트**, 실 앱 흐름은 `e2e/` 로 덮는다.
5. **"나중에 테스트 추가" 금지 — 로직과 테스트는 한 묶음.** 건너뛰려면 **먼저 사용자에게 명시적으로 확인**받는다.

## 🔒 절대 불변식 (기계가 강제 — 어기면 CI/테스트 실패)
1. **테스트·스크립트는 실 사용자 데이터를 절대 파괴하지 않는다.** 앱 로컬 DB
   (`~/Library/Application Support/Rockury/rockury.db`)를 테스트가 지우거나 그 경로로 앱을 띄우면 **안 된다**.
   e2e 는 격리된 임시 userData(`--user-data-dir=<mkdtemp>`)로 띄우고 그 임시 디렉터리만 정리한다.
   `e2e/isolation.test.ts` 가 **`e2e/**/*.mjs` 전부를**(러너 `smoke.mjs` + 서비스 흐름 `flows/*.mjs`
   + `surface/verify.mjs`) 재귀로 검사해 강제 — 실 경로 참조/실 DB rmSync 시 `npm test` 실패.
   새 흐름 파일은 등록 없이 자동으로 검사에 들어온다(파일 목록 하드코딩 금지).
2. **커밋 게이트는 git pre-commit 훅이 강제**(`scripts/git-hooks/pre-commit`, `core.hooksPath` 로 추적·공유).
   typecheck && test && build 통과해야 커밋. `npm install` 시 `prepare` 가 훅 경로 자동 설정.
   **`--no-verify` 우회는 사용자 승인 없이 쓰지 않는다.**
3. **e2e 는 버리는 1회용이 아니라 누적 회귀 자산이다.** 새 실 앱 흐름은 **자기 서비스 흐름 파일
   `e2e/flows/<서비스>.mjs`** 에 체크를 더해 쌓고 지우지 않는다(러너 `e2e/smoke.mjs` 는 흐름을 순회할
   뿐이라 건드리지 않는다). (steward `ui-preview` 능력도 검증 드라이브를 흐름 파일로 승격하도록 규정.)
   **UI 품질 게이트(`e2e/surface/verify.mjs`)는 셸 훅(`data-nav-service/module/view`)으로 전 서비스×모듈×뷰를
   자동 순회**하므로 새 화면은 nav 에 등록만 하면 커버리지에 자동으로 들어온다 — 이 data-nav 훅을 지우면
   순회가 깨지고 안전핀(MIN_LEAVES)이 검증불가(2)로 실패한다. 훅을 지우지 말 것.
4. **MCP 서버는 앱 능력과 함께 자란다(스테일 금지).** MCP(에이전트 연동) 서버는 메인 프로세스 내장
   (`src/main/ai/`, 명세 `docs/spec/ai-server.md`). `src/main/ipc/**` 의 모든 채널은
   **`src/main/ai/coverage/<서비스>.ts`** 에 **노출(도구 대응) 또는 제외(사유)** 로 등재돼야 하며
   `coverage.test.ts` 가 하위 폴더까지 재귀로 스캔해 강제한다 — 새 IPC 채널을 미등재로 두거나,
   지운 채널을 지도에 남기면 `npm test` 실패. 새 채널을 만들면 MCP 도구를 함께 갱신하거나
   의식적으로 제외 사유를 적는다. 두 서비스가 같은 채널을 등재해도 실패한다(조용한 덮어쓰기 방지).

## 검증 인프라
- 단위: `npm test`(vitest). watch: `npm run test:watch`.
- e2e 스모크: `npm run build && npm run e2e`(Playwright `_electron`). 함정·패턴은 `e2e/README.md`.
- 실 DB: `npm run db:up`(docker mysql:13306 / mariadb:13307 / postgresql:15432 + sqlite 파일).

## 앱 구동 e2e 함정 (실측)
- **접근성 쿼리(`getByRole` 등)는 이 Electron 창을 크래시**시킨다 → **CSS/text 로케이터만** 사용.
- Radix 메뉴아이템→Dialog 는 `setTimeout(onSelect,0)` 로 열어야 body `pointer-events:none` 잔존 회피.

## 코드 관례
- 로컬 저장소는 `node:sqlite`(내장). 네이티브 모듈(better-sqlite3 등) 도입 금지 — `electron-rebuild` 회피가 의도된 선택.
- zustand 5: `create<T>()(...)` **curried** 형태 사용.
- 주석·식별자는 주변 코드 스타일(한국어 주석 다수)에 맞춘다.
