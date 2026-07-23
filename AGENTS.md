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
- **main 에서 직접 작업·커밋한다. feature 브랜치를 만들지 않는다.** (사용자 지시 — Claude Code/steward
  기본 "브랜치 먼저" 관례를 이 프로젝트에선 덮어씀.)
- 커밋/푸시는 사용자가 요청할 때만. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

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
   `e2e/isolation.test.ts` 가 `smoke.mjs` 를 검사해 강제(실 경로 참조/실 DB rmSync 시 `npm test` 실패).
2. **커밋 게이트는 git pre-commit 훅이 강제**(`scripts/git-hooks/pre-commit`, `core.hooksPath` 로 추적·공유).
   typecheck && test && build 통과해야 커밋. `npm install` 시 `prepare` 가 훅 경로 자동 설정.
   **`--no-verify` 우회는 사용자 승인 없이 쓰지 않는다.**
3. **e2e 는 버리는 1회용이 아니라 누적 회귀 자산이다.** 새 실 앱 흐름은 `smoke.mjs` 에 체크를 더해 쌓고
   지우지 않는다. (steward `ui-preview` 능력도 검증 드라이브를 `smoke.mjs` 로 승격하도록 규정.)
   **UI 품질 게이트(`e2e/surface/verify.mjs`)는 셸 훅(`data-nav-service/module/view`)으로 전 서비스×모듈×뷰를
   자동 순회**하므로 새 화면은 nav 에 등록만 하면 커버리지에 자동으로 들어온다 — 이 data-nav 훅을 지우면
   순회가 깨지고 안전핀(MIN_LEAVES)이 검증불가(2)로 실패한다. 훅을 지우지 말 것.

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
