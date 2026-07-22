# Service: db-console (DB 콘솔 — 운영부)

> 활성 연결의 실 DB 를 introspection 으로 역설계해 조회/편집/쿼리한다.
> 이 문서는 레거시(rky-mvp) 기능 이관(Tier A·B + Data 도우미 + 서비스 전역) 범위의 명세 정본이다.
> 위계: Service > Surface > Section > Component. ID 는 코드·테스트와 기계 대조용 안정 키.

공통 불변식
- 편집/DML 커밋은 트랜잭션 게이트(`txBegin → txExec → txCommit/txRollback`)를 거친다. (현행 유지 — 레거시의 비트랜잭션 apply 로 퇴보 금지.)
- 키 표기는 `PK`·`FK`·`UK`·`IDX`·`CHECK` **텍스트 배지만**. 열쇠 이모지 등 애매한 기호 금지.

---

## Surface: db-console.data (Data 뷰)

### Section db-console.data.table-list — 테이블/뷰 분리 목록 (이미지 #4)
- **AC-1** 사이드바가 일반 테이블과 뷰를 분리 렌더한다: 테이블 목록 위, `VIEWS` 섹션 아래.
- **AC-2** 각 테이블/뷰 행에 대략적 행수(또는 컬럼 수 대체값)를 우측에 표시한다.
- **AC-3** 뷰 행에는 `V` 텍스트 배지를 표시한다(이모지 금지). PK 없는 편집불가 테이블은 `읽기전용` 표시.
- **AC-4** 검색 필터로 이름 부분일치 필터링된다.

### Section db-console.data.grid — 그리드 + 키 배지 + 타입 라벨 (이미지 #3)
- **AC-1** 컬럼 헤더에 제약 종류 배지를 텍스트로 표시한다: `PK`/`FK`/`UK`/`IDX`. FK 에 열쇠 아이콘을 쓰지 않는다.
- **AC-2** 컬럼명 아래에 데이터 타입 라벨(예: `char(36)`, `int`, `datetime`)을 표시한다.
- **AC-3** 헤더 클릭 정렬 3-state(ASC→DESC→해제), 정렬 방향을 화살표로 표시.
- **AC-4** 편집된 셀/행은 변경 하이라이트, 삭제행 취소선, 신규행 `NEW` 배지+초록 하이라이트.
- **AC-5** 긴 값(임계 초과)은 hover 시 전체값(상한 내) 툴팁을 보인다.

### Section db-console.data.cell-helpers — 값 생성 도우미 (이미지 #1·#2)
- **AC-1 (UUID)** uuid 종류 셀 편집 시 `UUID`(랜덤 식별값 생성)·`NULL` 칩 팝오버를 제공하고, `UUID` 클릭 시 유효한 UUID 를 채운다.
- **AC-2 (시간값)** date 종류 셀 편집 시 `YYYY-MM-DD HH:mm:ss[.SSS]` 입력 + `NOW`(현재시각, ms 포함)·`OK`(확정)·`ESC`(취소) 를 제공한다.
- **AC-3 (NULL)** 모든 편집 셀에서 NULL 토글이 가능하고 NULL 은 흐린 이탤릭으로 표시된다.
- **AC-4** boolean=select, json=모달, fk=참조 룩업 모달은 현행 유지하되 FK 트리거는 텍스트 표기.

### Section db-console.data.toolbar — 툴바 (필터·Export·컬럼가시성·타임존)
- **AC-1** 필터 바: 컬럼/연산자/값 다중 조건(AND), 추가·삭제·초기화·적용. (현행 유지)
- **AC-2** Export: CSV/JSON/SQL INSERT (현행 유지).
- **AC-3** 컬럼 표시/숨김 토글 팝오버(Show all/Hide all) 제공.
- **AC-4** 날짜 표시 모드 3-way 토글(UTC/LOCAL/TIMESTAMP), LOCAL 시 IANA 타임존 선택.
- **AC-5** 셀/행 복사: 셀값 복사·행 JSON 복사.
- **AC-6** 미저장 변경이 있을 때 테이블 전환 시 폐기 확인.

### Section db-console.data.constraints-tab — Constraint 탭 (읽기 전용, 이미지 #5)
- **AC-1** 상단에 `Tables N` / `Constraints M` 탭. Constraints 탭 진입 시 활성 연결의 전 제약을 집계 목록으로 보인다.
- **AC-2** 종류 필터 칩: `ALL`/`PK`/`FK`/`UK`/`IDX`/`CHECK`, 각 개수 표시.
- **AC-3** 각 제약 항목: 종류 텍스트 배지 + 이름 + `테이블 · 컬럼` + FK 는 `→ ref테이블.컬럼 DEL:규칙`.
- **AC-4** 현재 선택 테이블의 제약을 하단 패널에 Type/Name/Columns/Reference 로 보인다.
- **AC-5** 읽기 전용 — 추가/삭제/수정 DDL 없음(후속 범위).

---

## Surface: db-console.query (Query 뷰)

### Section db-console.query.editor — 에디터 (파라미터화·자동저장·스키마 패널)
- **AC-1** CodeMirror + 방언 하이라이트 + 스키마 자동완성 + 포맷 + `⌘/Ctrl+↵` 실행. (현행 유지)
- **AC-2 (파라미터화)** `{{키워드}}` 를 추출해 실행 전 값 입력칸을 띄우고 치환한다. `'{{x}}'`(따옴표)는 리터럴로 두고 bare `{{x}}`만 치환. 미입력 시 실행 차단.
- **AC-3 (자동저장)** 라이브러리에 연결된 쿼리는 입력 멈춤 후 자동 저장(디바운스).
- **AC-4 (스키마 패널)** 테이블/컬럼 트리 + 검색 + `PK`/`FK` 텍스트 표기, 이름 클릭 시 에디터에 삽입, 테이블 클릭 시 미리보기.

### Section db-console.query.execution — 실행 (라우팅 안전·EXPLAIN 트리)
- **AC-1** read/dml/ddl 분류 라우팅, DML 트랜잭션 게이트, destructive 경고, DDL 자동커밋 경고.
- **AC-2 (스크립트 안전 라우팅)** 에디터에 여러 문(`;` 구분)이 있으면 **첫 문이 아니라 전체 문**으로 성격을 판정한다.
  한 문장이라도 DML 이면 스크립트 전체를 트랜잭션 게이트로 보낸다 — 뒤에 숨은 DML 이 게이트를 우회해 자동 커밋되는 것을 막는다.
  (실행 자체의 다중 문 순차 처리는 main `queryService`(splitStatements)가 담당. 재사용/순서/항목별 제어가 필요한 다중 SQL 은 Collection 이 담당.)
- **AC-3 (EXPLAIN)** 실행계획을 재귀 트리로 렌더(접기/펼치기, 비용·행수 요약).

### Section db-console.query.results — 결과 (export)
- **AC-1** 결과 그리드(행번호, NULL/객체/원시값 구분), 메타(행수·ms·affected). (현행 유지)
- **AC-2 (export)** 결과를 CSV/JSON 으로 내보낸다(Data 뷰 export 유틸 재사용).

### Section db-console.query.history — 히스토리 강화
- **AC-1** 소스 필터(All/Query/Data/Collection) + 검색 + 항목 클릭 Re-run.
- **AC-2** 우측 슬라이드 드로어로 최근 실행을 빠르게 재실행.

---

## Surface: db-console.collection (Collection 뷰)

### Section db-console.collection.tree — 라이브러리 트리 (열기/실행·rename)
- **AC-1** 폴더/쿼리 계층 트리, 폴더 생성, DnD 재정렬(자기 자손 드롭 방지). (현행 유지)
- **AC-2 (열기/실행)** 트리의 저장 쿼리를 클릭/더블클릭하면 에디터로 로드하거나 실행한다(현행의 죽은 동선 해소).
- **AC-3 (rename)** 폴더/쿼리/컬렉션 이름 변경.

### Section db-console.collection.items — 컬렉션 아이템 = 저장쿼리 참조
- **AC-1** 컬렉션 아이템은 SQL 사본이 아니라 라이브러리 쿼리를 **참조**한다.
- **AC-2** 참조 중인 쿼리를 삭제하려 하면 거부하고 참조 컬렉션을 알린다(삭제 가드).

### Section db-console.collection.run-all — 실행 (전체/개별, 원자성)
- **AC-1 (전체 실행)** Run-All: 여러 쿼리를 한 트랜잭션에 순차 실행, 항목별 상태(pending/running/ok/error/skipped), 실패 시 이후 skip.
- **AC-2 (재시도)** 실패 지점부터 재시도(Retry).
- **AC-3 (중단)** 실행 중 Abort → 세션 롤백.
- **AC-4 (결과)** 각 SELECT 결과를 모달로 확인.
- **AC-5 (개별 실행·원자성)** 아이템을 하나씩 실행할 수 있다. 단, 개별 실행은 **개별 커밋하지 않고** 열린 트랜잭션에
  이어 붙는다(없으면 새로 연다) — 커밋/롤백 전까지 하나의 원자적 트랜잭션. 도중 한 문장이 실패하면 세션 전체가 롤백된다.

---

## 재설계(레거시 rky-mvp 구조 이식) — 갱신된 화면 구성

### Surface db-console.query (재설계) — 저장쿼리를 "객체"로
- **AC-R1** 좌측 = 저장쿼리 **폴더/파일 트리**(검색·새폴더/새쿼리·우클릭 rename/move to/delete·DnD 재정렬).
- **AC-R2** 중앙 = 선택한 쿼리 편집기: 이름·설명 인라인 편집(자동저장) + SQL 편집기(Run/Format/EXPLAIN, {{키워드}}) + 결과 그리드.
- **AC-R3** 우측 = Schema 패널(토글, 기본 열림) — 테이블/뷰·컬럼(클릭 삽입·미리보기).

### Surface db-console.collection (재설계) — 컬렉션 폴더 트리 + QUERIES 소스
- **AC-R1** 좌측 = 컬렉션 **폴더/파일 트리**(검색·새폴더/새컬렉션·rename·delete·DnD). (`collection_folders` + `collections.folder_id`)
- **AC-R2** 중앙 = 선택 컬렉션의 아이템 + Run-All/개별 실행(원자성) + 결과 모달.
- **AC-R3** 우측 = QUERIES(저장쿼리 트리) — 클릭해 컬렉션에 참조 추가.

### Surface db-console.history (신설) — 다중 소스 실행 이력 (독립 뷰)
- **AC-1** Query/Data/Collection 실행을 `source` 로 구분해 기록(`query_history.source`). 커밋된 것만 기록(tx 게이트 경로).
- **AC-2** 독립 Console 뷰(Query 하위 아님 — 소스가 셋이라). Time/Source/SQL/Rows/Speed/Status + 소스필터 + SQL 검색 + 페이지네이션.
- **AC-3** 행 클릭 시 SQL 을 Query 에디터로 보낸다. 이력 비우기.
