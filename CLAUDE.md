# Rockury — 작업 규칙 (매 세션 자동 로드)

Electron + electron-vite · React 19 + TS 7 · Tailwind v4 + Radix · Zustand 5 · 화이트 테마 고정.
현재 집중: **DB 서비스**. 설계부(Studio/Versions)는 로컬 SQLite(`node:sqlite`) 위에 구현됨. 운영부(Environments/Console/Migration)는 미구현.
설계 배경·결정은 `docs/db-service-ia.md`, 다음 작업 계획은 `docs/ops-implementation-plan.md` 참고.

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
