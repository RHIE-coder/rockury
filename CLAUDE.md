# Rockury — 작업 규칙 (매 세션 자동 로드)

Electron + electron-vite · React 19 + TS 7 · Tailwind v4 + Radix · Zustand 5 · 화이트 테마 고정.
현재 집중: **DB 서비스**. 설계부(Studio/Versions)·운영부(Environments/Console/Migration) 모두 로컬 SQLite(`node:sqlite`) + 실 드라이버(mysql2/pg/node:sqlite) 위에 구현됨. 남은 것은 선택적 향상(2e Diagram 등).
설계 배경·결정은 `docs/db-service-ia.md`, 진행/재개점은 `docs/ops-implementation-plan.md` 참고.

## 🌿 Git 규칙 (MUST)
- **main 브랜치에서 직접 작업·커밋한다. feature 브랜치를 만들지 않는다.** (사용자 지시 — 기본 "브랜치 먼저" 관례를 이 프로젝트에선 덮어씀.)
- 커밋/푸시는 사용자가 요청할 때만. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## ✅ 테스트 의무 (MUST — 예외 없음)

이 프로젝트는 **테스트 없이 로직을 머지하지 않는다.** 앱은 계속 커지고, 사이드이펙트는 반드시 생긴다.

1. **순수/도메인 로직을 추가·변경하면 같은 커밋에 `*.test.ts`를 반드시 동반한다.**
   - 대상 예: diff/스냅샷, 버전(semver), DDL 생성, 타입 카탈로그, 파생 로직(derive), SQL 빌더/안전 판정, introspection 매핑 등 "입력→출력이 결정적인" 모든 것.
   - 테스트는 대상 모듈 **옆에** `foo.test.ts`로 두고 상대 경로 임포트(vitest, node 환경). 예시는 `src/renderer/src/services/db/**/*.test.ts`.
2. **작업 완료 게이트 (매번 실행, 통과해야 "done"):**
   ```
   npm run typecheck && npm test && npm run build
   ```
   운영부 등 실 앱 흐름을 건드렸으면 추가로 `npm run e2e`.
3. **버그를 고치면 그 버그를 재현하는 회귀 테스트를 먼저/함께 추가한다.**
4. UI 컴포넌트/스토어 자체는 단위테스트 강제 대상이 아니지만(가치 낮으면 생략 가능), **그 안의 순수 로직은 분리해 테스트한다.** 실 앱 흐름은 `e2e/`로 덮는다.
5. "나중에 테스트 추가" 금지. 로직과 테스트는 한 묶음.

> 이 규칙은 `/clear` 후에도 유효하다. 테스트를 건너뛰고 싶으면 **먼저 사용자에게 명시적으로 확인**받는다.

## 🔒 절대 불변식 (기계가 강제 — 어기면 CI/테스트가 실패)
1. **테스트·스크립트는 실 사용자 데이터를 절대 파괴하지 않는다.**
   - 앱 로컬 DB(`~/Library/Application Support/Rockury/rockury.db`)를 테스트가 지우거나 그 경로로 앱을 띄우면 **안 된다**.
   - e2e 는 **반드시 격리된 임시 userData**(`--user-data-dir=<mkdtemp>`)로 앱을 띄우고 그 임시 디렉터리만 정리한다.
   - 이 불변식은 `e2e/isolation.test.ts` 가 `smoke.mjs` 를 검사해 강제한다(실 경로 참조/실 DB rmSync 시 `npm test` 실패). **회귀 시 즉시 빨간불.**
2. **커밋 게이트는 git pre-commit 훅이 강제한다**(`scripts/git-hooks/pre-commit`, `core.hooksPath` 로 추적·공유). `npm run typecheck && npm test && npm run build` 통과해야 커밋된다. `npm install` 시 `prepare` 가 훅 경로를 자동 설정. **`--no-verify` 우회는 사용자 승인 없이 쓰지 않는다.**
3. **e2e 는 버리는 1회용이 아니라 누적 회귀 자산이다.** 새 실 앱 흐름은 스모크에 체크를 더해 쌓고, 지우지 않는다.

## 검증 인프라
- 단위: `npm test`(vitest). watch: `npm run test:watch`.
- e2e 스모크: `npm run build && npm run e2e` (Playwright `_electron`). 함정·패턴은 `e2e/README.md`.
- 실 DB: `npm run db:up` (docker mysql:13306 / mariadb:13307 / postgresql:15432 + sqlite 파일).

## 앱 구동 e2e 함정 (실측)
- **접근성 쿼리(`getByRole` 등)는 이 Electron 창을 크래시**시킨다 → **CSS/text 로케이터만** 사용.
- Radix 메뉴아이템→Dialog 는 `setTimeout(onSelect,0)` 로 열어야 body `pointer-events:none` 잔존 회피.
- 앱 로컬 DB: `~/Library/Application Support/Rockury/rockury.db` (검증 전후 정리).

## 코드 관례
- 로컬 저장소는 `node:sqlite`(내장). 네이티브 모듈(better-sqlite3 등) 도입 금지 — `electron-rebuild` 회피가 의도된 선택.
- zustand 5: `create<T>()(...)` **curried** 형태 사용.
- 주석·식별자는 주변 코드 스타일(한국어 주석 다수)에 맞춘다.
