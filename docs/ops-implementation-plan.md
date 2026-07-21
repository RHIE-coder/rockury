# 운영부(ops) 구현 플랜 & 세션 인수인계

> 목적: 컨텍스트 clear 후 이 문서 + `docs/db-service-ia.md` 만 읽고 바로 이어서 작업하기 위한 재개점.
> 최종 갱신: 2026-07-21 (**Phase 0/1/2a/2b/2c/3 완료** — 운영부 전 기능 실동작. 남은 것: 2e Diagram(real) + 향후 향상)

---

## 1. 지금까지 구현된 것 (설계부 = 대체로 완성)

DB 서비스의 **설계부(design)** 는 로컬 SQLite 저장소 위에 실제 동작한다. **운영부(ops)도 대부분 실동작** — Environments(연결/테스트), Console(Object 역설계·Query 실행·Data 편집, 모두 트랜잭션 게이트), Migration(Drift/Plan/Run/Logs). 남은 것: Console Diagram(2e, 시각화) + 향후 향상들.

### 로컬 메타 저장소 (Rockury 자체 DB)
- 엔진: **Electron 43 번들 Node 24의 내장 `node:sqlite`** (`DatabaseSync`). 네이티브 모듈 없음 → `electron-rebuild` 불필요.
- 위치: `app.getPath('userData')/rockury.db` (dev 실행 시 `~/Library/Application Support/Rockury/rockury.db`).
- 파일:
  - `src/main/store/db.ts` — 연결·마이그레이션(`designs`/`tables`/`versions` 테이블)·첫 실행 시드
  - `src/main/store/designs.ts` — 설계 CRUD (list/create/update/delete, delete는 테이블 cascade)
  - `src/main/store/tables.ts` — 테이블 정의(문서형: columns/constraints를 JSON 블롭), `listTables`/`replaceAllTables`
  - `src/main/store/versions.ts` — 버전 스냅샷(list/create), snapshot=JSON
  - `src/main/store/seed.ts` — commerce-core 4테이블 + 버전 v0.3.13/v0.3.14 시드
  - `src/main/ipc/store.ts` — designs/tables/versions IPC 핸들러 (현재는 raw invoke; ops에서 봉투 패턴으로 승격 예정)
  - `src/preload/index.ts` — `window.rockury.{designs,tables,versions}` API

### 렌더러 (설계부 기능)
- **벤더 네이티브 설계**: dialect는 Design의 고정 속성. `services/db/dialects.ts`, 타입 카탈로그+자동완성 `services/db/typeCatalog.ts`.
- **Design 스토어**: `services/db/designs/store.ts` (IPC 하이드레이션), 생성/관리 다이얼로그.
- **Definition**(Studio): `services/db/workspaces/definition/` — 표/SQL 편집, 컬럼/제약, 다중컬럼 CHECK 파생칩+CHK마커, 테이블 write-through 영속.
- **Versions**: `services/db/versions/` — `store.ts`, `semver.ts`, `diff.ts`(스냅샷 diff 엔진), `TimelineView`(컷), `VersionDiffView`(diff①), `CutVersionDialog`, `VersionSync`.
- **버전 렌즈**: 컨텍스트 바 Version 셀렉터(설계 영역). Draft=편집 / 커밋버전=읽기전용. `useDesignTables`/`useStudioReadOnly`가 버전 인지.
- **컨텍스트 바**: `shell/ContextBar.tsx` — Design / Version(설계) / Env(운영) ambient 셀렉터. 옵션은 `nav/contextOptions.ts` 런타임 레지스트리.
- nav 선택은 localStorage 영속(`useNav` persist), 설계·버전·테이블은 SQLite 영속.

### 운영부 (Phase 0+1 — 이번 세션 구현 완료)
- **Phase 0 얇은 기반**:
  - 드라이버 `mysql2`·`pg`(순수 JS, externalizeDepsPlugin 로 번들 제외). crypto verbatim 이식.
  - `src/main/infra/crypto.ts`(safeStorage), `src/main/infra/db/{mysql,pg,sqlite}Client.ts`.
    - ⚠ **sqliteClient 는 rky 의 better-sqlite3 대신 `node:sqlite` readOnly 로 어댑트**(네이티브 금지).
  - `src/main/ipc/envelope.ts` — `{success,data,error}` 봉투 헬퍼(+`envelope.test.ts`). 신규 ops 핸들러부터 적용.
- **Phase 1 Environments + Connections**:
  - main 4-레이어: `store/db.ts`(environments 테이블) → `store/environments.ts`(repository, node:sqlite) → `services/environmentService.ts`(암복호화 + 4벤더 testConnection) → `ipc/environments.ts`(봉투). `index.ts` 배선.
  - preload: `window.rockury.environments.*` (`unwrap` 으로 성공 data / 실패 throw). **비밀번호는 레코드에 노출 안 됨**.
  - 렌더러 `services/db/environments/`: `validate.ts`(순수 — 폼 검증·기본포트·**벤더 일치 불변식**, +test) · `store.ts`(하이드레이션 + 휘발성 statusMap) · `EnvironmentsView.tsx`(카드 그리드, 클릭=active Env) · `EnvironmentDialog.tsx`(폼+SSL+타깃버전+연결테스트 배너) · `EnvSync.tsx`(컨텍스트 바 Env 옵션 동기화, DesignDialogs 오버레이에 마운트).
  - 검증됨: 4벤더 test-db 연결→serverVersion(8.4.7/11.8.6/16.11/SQLite 3.51.2), e2e 로 생성·연결·재시작 잔존.
  - 주의: `appliedVersion` 은 Phase 3 전까지 null(수동).

### 운영부 Phase 2a — Introspection (이번 세션 구현 완료)
- **main 어댑터(electron-free, 드라이버만 의존)**: `services/introspection/{types,mysql,postgres,sqlite}.ts` — 벤더 카탈로그(mysql/mariadb=information_schema, pg=pg_catalog+`current_schema()`, sqlite=`pragma_*` 함수)를 **벤더 중립 IR**(tables/columns/keys(pk·uk·idx)/foreignKeys)로 뽑는다.
  - pg 는 파티션 자식(`relispartition`) 제외. FK 규칙은 어댑터가 `FkAction` 으로 정규화(`toFkAction`). 인덱스 방향은 mysql만 정확, pg/sqlite는 ASC 고정(2a 한계). **CHECK 제약은 미수집(follow-up)**.
- **오케스트레이터**: `services/introspectionService.ts` — 환경 설정으로 접속→어댑터→IR(조회 전용, 매번 open/close). IPC `ipc/introspection.ts`(`introspection:run`, 봉투) + `index.ts` 배선.
- **preload**: `window.rockury.introspection.run(envId)`.
- **렌더러(순수 정규화 + 소비자)**: `services/db/console/introspection.ts` — **순수 `normalizeSchema(IR, designId) → TableDef[]`**(id=이름 기반 결정적, +`introspection.test.ts`) + `columnKeyKinds`. `console/store.ts`(환경별 캐시) · `console/ObjectView.tsx`(테이블 펼침·컬럼/키 배지·FK 참조) → Console › Object 배선.
- **검증**: 순수 8케이스(vitest). 어댑터 실 DB 통합 `introspection.integration.test.ts`(4벤더, **기본 skip** — `INTROSPECT_IT=1` 로 실행). e2e: 카드→active Env→Console › Object 역설계(users/user_roles) 확인.
- **다음 토대**: 이 `TableDef[]` 가 2e Diagram(real)·3b Drift(`versions/diff.ts` 재사용)의 공통 입력.

### 운영부 Phase 2c — Query (이번 세션 구현 완료)
- **main**: `services/queryService.ts` — `run`(즉시 실행, 멀티문+타임아웃, open→close) + ⭐**트랜잭션 파괴 게이트**(`txBegin`→`txExec`(영향행수)→`txCommit`/`txRollback`; 세션을 txId 로 보관, open 시 stale 자동 롤백 스윕). `services/query/splitStatements.ts`(순수 — 문자열/주석/괄호 인지 분리, **rky 주석 결함 수정**, +test). `ipc/query.ts`(봉투) + `index.ts` 배선.
- **preload**: `window.rockury.query.{run,txBegin,txExec,txCommit,txRollback}`.
- **렌더러**: `console/query/classify.ts`(순수 — read/dml/ddl + destructive(WHERE 없는 UPDATE/DELETE·DROP·TRUNCATE) 판정, +test) · `console/query/store.ts`(분류→라우팅: read 즉시 / dml 게이트 / ddl 자동커밋경고) · `console/QueryView.tsx`(SQL 편집·실행·⌘↵·결과 그리드·**파괴적 확인 바**). Console › Query 배선.
- **검증**: 순수 splitStatements 10 + classify 10 (vitest). e2e: SELECT 결과 그리드 + WHERE 없는 UPDATE → 커밋 대기 바 → 롤백.
- **미포함(향후)**: EXPLAIN 패널(rky `explainSql` 있음), 쿼리 히스토리 영속·dedup, 저장 쿼리/폴더, CodeMirror+자동완성+포매터, 결과 가상화. pg/sqlite 실행 경로는 아직 e2e 미커버(mysql 만) — 수동 확인.

### 운영부 Phase 2b — Data (이번 세션 구현 완료)
- **main**: `queryService` 에 **파라미터 바인드 실행** 추가 — `runParams`(새 연결) · `txExecParams`(열린 tx). sqlite 바인드는 `coerceSqliteParams`(boolean→0/1). IPC `query:runParams`/`query:txExecParams` + preload.
- **렌더러(순수)**: `console/data/sqlBuilder.ts`(+test) — 방언별 식별자 인용(mysql 백틱/pg·sqlite 쌍따옴표) + 플레이스홀더(pg `$n`/그 외 `?`) + `buildSelect/Insert/Update/Delete`(값은 전부 params, **문자열 조립 제거**) + `pkColumns`/`canEdit`(PK 없으면 읽기전용).
- **렌더러**: `console/data/store.ts`(선택 테이블 행 로드 + **pending 버퍼**: edits/deletes/inserts, rowKey=PK 직렬화) · `console/DataView.tsx`(좌 테이블 목록/우 편집 그리드 · pending SQL 프리뷰 · 페이지네이션). **커밋은 2c 트랜잭션 게이트 재사용**(txBegin→txExecParams×N→영향행수→commit/rollback). PK 없는 테이블은 읽기전용 배지.
- **검증**: sqlBuilder 순수 14케이스(vitest). e2e: users 조회 → first_name 편집 → 저장(트랜잭션 게이트) → 롤백.
- **미포함(향후)**: 타입별 셀 에디터(날짜/JSON/불리언/FK 피커)·타임존·NULL 세팅 토글·필터/정렬 UI·결과 가상화. 현재는 텍스트 입력 + NULL 표시.

### 운영부 Phase 3 — Migration (이번 세션 구현 완료)
- **3c DDL diff→ALTER 생성(최대 리스크·crown jewel)**: `migration/ddlDiff.ts`(+test 14케이스) — 두 스냅샷 델타를 실행 가능한 SQL 로. CREATE(새 테이블, `generateDdl` 재사용)/DROP TABLE/ADD·DROP COLUMN/컬럼 변경(mysql `MODIFY`·`CHANGE`, pg `ALTER COLUMN` 분해, sqlite 미지원 기록)/제약 ADD·DROP(pg `DROP CONSTRAINT`, mysql `DROP FK/INDEX/PK`, CREATE INDEX)/RENAME/코멘트. **파괴적 플래그 + destructiveCount + unsupported[]**. `ddl.ts` 에 `quoteId`/`mapType`/`isMyDialect` export 해 재사용.
- **3a 스냅샷 기준선 · 3e 로그**: main `store/migration.ts`(env_snapshots: sha256 checksum · migration_logs 체인) + `db.ts` 테이블 + `ipc/migration.ts`(봉투) + preload. 환경 `setApplied`(appliedVersion 갱신) 추가.
- **3b Drift[diff②] · 3d Run**: 렌더러 `migration/store.ts`(오케스트레이터) + `migration/views.tsx`(Drift/Plan/Run/Logs).
  - Drift = introspect→normalize vs 마지막 스냅샷 → **`versions/diff.diffSnapshots` 재사용**. 기준선 없으면 캡처.
  - Plan = 타깃 버전 vs 실제 → `generateMigration` SQL 프리뷰 + diff③ 요약 + 파괴적 경고.
  - Run = **2c `query.tx*` 게이트로 실행** + 파괴적 승인 체크박스 → 커밋 시 post-apply 스냅샷+appliedVersion+로그.
- **검증**: ddlDiff 14케이스(vitest, 총 96 pass). e2e: 기준선 캡처→드리프트 없음→로그(실 mysql). **실 DDL apply 는 test-db 파괴적이라 e2e 제외** — 생성기 단위테스트 + tx 게이트(2c e2e 검증)로 커버, 실제 반영은 수동 확인.
- **미포함(향후)**: 드리프트 Backward 자동 버전화(현재 기준선 갱신만), conflict 머지 UX, seed/mock 반영, Validation.

### 의존성 (이 세션에서 최신화 완료)
React 19.2 · Electron 43 · Vite 7 · electron-vite 5 · @vitejs/plugin-react 5 · TypeScript 7 · zustand 5 · lucide-react 1.25 · react-resizable-panels 3(핀; v4는 API 재작성이라 보류) · @types/node 26 · @types/react 19.

---

## 2. 핵심 아키텍처 결정 (상세는 `db-service-ia.md`)
- **dialect ⊂ Design**: 벤더는 설계 생성 시 결정되는 고정 속성. 화면·DDL은 그 방언 네이티브. 벤더 이동=포팅(새 설계).
- **Version = 경계 객체(boundary object)** (결정 ③-a): 설계부 생산 ↔ 운영부 소비. 설계=렌즈(컨텍스트 바), 운영=환경 바인딩(Env가 운반). 관리 홈=Versions 모듈. 조율자=**Migration**(액션)+**Overview**(대시보드). L1 서비스로 안 올림.
- **로컬 저장소 = 지상 진실**: 적용 버전 등은 Rockury 로컬 DB 기록, 실제 구조는 Reverse로 읽어 스냅샷 비교로 드리프트 판정.
- **파괴적 변경은 항상 사람 승인 게이트**.

---

## 3. 검증 방법 (영속 테스트 — 이제 리포에 있음)
- **단위 테스트**: `npm test` (vitest). 순수 로직 커버 — `versions/semver`·`versions/diff`·`typeCatalog`·`definition/derive`·`definition/ddl`. 테스트는 대상 옆 `*.test.ts`. 23케이스, ~300ms. **새 순수 로직 추가 시 반드시 테스트 동반**.
- **e2e 스모크**: `npm run build && npm run e2e` (`e2e/smoke.mjs`). 빌드된 앱을 Playwright `_electron`으로 띄워 설계선택→Definition→버전컷 확인. 상세·함정은 `e2e/README.md`.
  - **Gotcha**: `getByRole` 등 접근성 쿼리는 이 Electron 창을 크래시시킴 → **CSS/text 로케이터만**. Radix 메뉴→Dialog는 `setTimeout(onSelect,0)`로 회피(ContextBar 적용됨). node:sqlite ExperimentalWarning 무해. 스모크가 앱 DB를 실행 전후 초기화.
- **실 DB(test-db)**: `npm run db:up` (docker: mysql 13306 / mariadb 13307 / postgresql 15432 + sqlite 파일). `npm run db:reset`로 재적용. 운영부(Phase 1+) e2e에서 사용.
- **매 변경 게이트**: `npm run typecheck` + `npm test` + `npm run build` (+ 운영부 작업 시 `npm run e2e`).
- 새 e2e 플로우는 `e2e/smoke.mjs` 패턴 복사. Electron 구동을 스킬로 박제하려면 `/run-skill-generator`.

---

## 4. rky-mvp 참조 이식 전략
참조 프로젝트: `/Users/rhiemh/Workspace/__active-box__/rockury/rky-mvp` (FSD, 실 드라이버로 운영부+@를 이미 구현한 선행본).

### "이식"의 3분류
- **① verbatim (rky 특화 결합 0)**: `infrastructure/crypto.ts`(safeStorage), `infrastructure/database/{mysql,pg,sqlite}Client.ts`. 그대로 복사 안전.
- **② adapt (로직 유지, 이음새 재배선)**: `connectionService`(임포트만), `connectionRepository`(better-sqlite3→node:sqlite, API 거의 동일), `connectionHandlers`(→{success,data,error} 봉투 승격).
- **③ rewire/drop (도메인 다름)**: `IConnection` 독립 → **Environment=Connection+design_id+타깃/적용버전**. `IPackage` 폐기. `querySafetyService`(죽은 코드) 안 씀 → 트랜잭션 게이트만.

### 빌려올 핵심 (검증된 것)
- Connection: safeStorage 크리덴셜, {success,data,error} IPC 봉투, config(react-query)↔status(zustand statusMap) 분리, testConnection `{latencyMs,serverVersion}`, 4-레이어(handler→service→repository→driver), dnd 재정렬.
- Data: **pending-change 버퍼 + SQL 프리뷰**, **PK 없으면 읽기전용**(`canEdit=hasPk`), 타입별 셀 에디터(JSON/날짜/NULL/UUID/FK), 타임존 셀렉터. `sqlBuilder.ts:escapeValue`.
- Query: ⭐**트랜잭션 파괴적 게이트**(`useQueryExecution.execute`: BEGIN→실행→영향행수→Confirm/Rollback), **EXPLAIN-with-rollback**(안전 프리플라이트), `splitStatements`(따옴표/괄호 인지), CodeMirror+lang-sql+schema autocomplete+sql-formatter.

### 가져오며 반드시 고칠 결함
데이터 편집 트랜잭션으로 감싸기 · 문자열조립SQL→파라미터 바인드 · 커넥션 풀 검토 · querySafetyService(첫문장만·주석미제거 오분류) 안 씀 · 쿼리 취소/타임아웃·히스토리 dedup·결과 가상화 추가 · `ignorePatterns`/`permissionMode` 죽은 필드 정리.

---

## 5. 구현 플랜 (의존도 순, 각 단계 독립 가치)

### Phase 0 — 얇은 기반 ✅ 완료
- `mysql2`·`pg` 추가(순수 JS, 네이티브 없음). `src/main/infra/db/{mysql,pg,sqlite}Client.ts` + `crypto.ts` 이식.
  - sqliteClient 만 `node:sqlite` readOnly 로 어댑트(better-sqlite3 대체).
- IPC `{success,data,error}` 봉투 헬퍼 도입(신규 핸들러부터).
- ops 신규 코드에 4-레이어 seam(infra→repository→service→ipc). 기존 designs/versions 저장소는 유지.

### Phase 1 — Environments + Connections ✅ 완료
- 도메인: `Environment = { id, designId, name, dbType, host, port, database, user, encryptedPassword, sslEnabled, sslConfig?, targetVersion, appliedVersion?, sortOrder }`. `environments` 테이블(node:sqlite), `design_id`.
- main: `environmentRepository`(node:sqlite), `environmentService`(list/create/update/delete + testConnection), crypto(safeStorage).
- preload: `window.rockury.environments.*` (봉투 패턴).
- 렌더러: Environments 모듈(설계별 환경 카드: Connection·타깃/적용버전·상태 시맨틱컬러), 환경 생성/편집 다이얼로그(연결 폼+SSL+타깃 버전 피커), 연결 테스트(latency·serverVersion 배너), 컨텍스트 바 **Env 셀렉터 활성화**(activeInAreas:['ops'], 골격 존재), 상태=zustand statusMap(휘발, DB에 안 넣음).
- 검증: 4벤더 test-db testConnection→serverVersion. 재시작 후 환경 잔존.
- 주의: appliedVersion은 Phase 3 전까지 수동/null.

### Phase 2 — Console (실제를 읽는다)
- **2a. Introspection(핵심 신규)** ✅ 완료: 벤더별 역설계 → `TableDef` 정규화 → Console › Object. (CHECK 미수집·인덱스 방향 pg/sqlite ASC 고정은 follow-up)
- **2b. Data** ✅ 완료: pending 버퍼 + SQL 프리뷰 + PK 게이트 + **파라미터 바인드** + tx 게이트 재사용. (타입별 셀 에디터·타임존·필터/정렬·가상화는 향후)
- **2c. Query** ✅ 완료: queryService(run+트랜잭션 게이트+타임아웃) + splitStatements/classify + QueryView. (EXPLAIN·히스토리·저장쿼리·CodeMirror·가상화·dedup 은 향후)
- **2d. Object**: introspection 기반 객체 브라우저.
- **2e. Diagram(real)**: @xyflow/react + dagre 실 ERD(여유 시).

### Phase 3 — Migration (페이오프) ✅ 완료
- **3a** post-apply 스냅샷 기준선(env_snapshots + checksum) · **3b** Drift[diff②] (`diffSnapshots` 재사용) · **3c** Plan[diff③] (`ddlDiff.generateMigration` — ALTER 생성) · **3d** Run (tx 게이트) · **3e** Logs.
- 향후: 드리프트 Backward 자동 버전화, conflict 머지 UX, seed/mock, Validation.

### 규모·리스크
- 큰 신규 2개: **Introspection(2a)**, **SQL diff→ALTER 생성(3c)**. 나머지는 이식+재배선(리스크 낮음).
- Phase 1이 가장 안전한 출발(기존 저장소 패턴과 유사).

---

## 6. 즉시 다음 단계
Phase 0/1/2a/2b/2c/3 완료 — 운영부 전 모듈(Environments/Console/Migration)이 실 DB 위에서 동작.
**남은 것은 선택적 향상들** (핵심 흐름은 모두 구현·검증됨):
- **2e Diagram(real)**: `@xyflow/react` + dagre 로 introspection `TableDef[]` 를 실 ERD 로. (신규 의존성 필요, 순수 시각화)
- **Migration 심화**: 드리프트 Backward 자동 버전화(현재 기준선 갱신만), conflict 머지 UX(겹치는 드리프트), Validation(반영 후 일치 검증).
- **Console 심화**: 2c EXPLAIN 패널(`explainSql` 유틸 이식)·쿼리 히스토리·저장 쿼리·CodeMirror·결과 가상화 / 2b 타입별 셀 에디터·타임존·필터·정렬.
- **설계부 잔여**: Studio Seed/Mocking/Documenting/Validation/Diagram, Overview 대시보드, Reference — 아직 placeholder.
- **정리**: 2a CHECK 제약·인덱스 방향(pg/sqlite), pg/sqlite 쿼리·편집·반영 경로 e2e(현재 mysql 만).

재개 시: `npm run db:up` → 위 중 택1 → 순수 로직 `*.test.ts` 동반 → typecheck·test·build·e2e.
