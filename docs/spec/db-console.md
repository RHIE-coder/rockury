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
- **AC-6** 컬럼 폭은 **내용에 맞춰 자동**으로 잡는다 — 헤더(컬럼명·타입 라벨·키 배지)와 실제 값 중 가장 긴 것 기준, 최소·**최대 폭 상한** 안에서(`data/colWidth`). 상한을 넘는 값은 계속 잘리고 셀 도구(툴팁·복사·JSON 뷰어)로 전체를 본다.
- **AC-7** 사용자가 직접 끌어 조절한 컬럼은 그 폭이 자동 계산을 이긴다. 테이블을 바꾸면 조절값은 초기화된다.

### Section db-console.data.cell-helpers — 값 생성 도우미 (이미지 #1·#2)
- **AC-1 (UUID)** uuid 종류 셀 편집 시 `UUID`(랜덤 식별값 생성)·`NULL` 칩 팝오버를 제공하고, `UUID` 클릭 시 유효한 UUID 를 채운다.
- **AC-2 (시간값)** date 종류 셀 편집 시 `YYYY-MM-DD HH:mm:ss[.SSS]` 입력 + `NOW`(현재시각, ms 포함)·`OK`(확정)·`ESC`(취소) 를 제공한다.
- **AC-3 (NULL)** 모든 편집 셀에서 NULL 토글이 가능하고 NULL 은 흐린 이탤릭으로 표시된다.
- **AC-4** boolean=select, json=뷰어/편집 모달, fk=참조 룩업 모달. FK 트리거는 텍스트 표기.

### Section db-console.data.json-cell — JSON 값 보기 (신설)
> 정본 로직: `console/data/jsonCell.ts`. 셀 폭 안에서는 JSON 원문을 읽을 수 없다는 게 출발점.
- **AC-1** JSON 셀은 원문 대신 **구조 요약 칩**(객체 `{} 키수`, 배열 `[] 항목수`, 깨진 값 `!`)과 공백을 정리한 한 줄 미리보기를 보인다.
- **AC-2** 셀을 누르면 값 뷰어가 열린다. 열 때 **보기 좋게 정렬**해 보여주고, 제목에 사람 말 요약(`객체 · 키 5개`)을 쓴다.
- **AC-3** 뷰어는 형식이 정상인지/어디가 깨졌는지를 항상 보인다. `정렬`·`한 줄로`·`복사` 를 제공한다.
- **AC-4** 읽기 전용 테이블(뷰·PK 없는 테이블)에서도 뷰어가 열린다 — 이때는 입력이 막히고 적용 버튼이 없다.
- **AC-5** 적용할 때 유효한 JSON 은 한 줄로 정리해 넣는다(우리가 보여주려고 넣은 들여쓰기가 저장 값에 섞이지 않게). 깨진 값은 사용자가 쓴 그대로 둔다.

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
- **AC-3** 각 제약 항목: 종류 텍스트 배지 + 이름 + `테이블 · 컬럼` + FK 는 짧은 참조 표기(`→ users (id)`). 하단 표의 Reference 열은 정책까지 붙인 표기를 쓴다. 표기는 Definition 의 FK 표기 규칙과 같은 정본에서 나온다.
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

### Surface db-console.definition (신설) — 스키마 정의 브라우저·편집기
> 실 DB introspection 결과(`TableDef[]`)를 Studio 의 Definition 화면 형태로 브라우징하고, 라이브 스키마를 **편집**한다.
> Diagram·Object 와 **같은 introspection 소스**를 공유하는 "역설계-조회/편집" 계열이며, nav 위치는 Console 의 **첫 뷰**(Definition → Diagram → Data 순).
> 편집은 draft 에 쌓여 baseline↔draft diff 를 DDL 로 미리 보이고 tx 게이트로 적용한다(아래 edit 섹션).
> (Migration 은 버전 기반 반영 파이프라인으로 계속 공존한다 — Console 직접 편집은 임의 DDL 을 이미 허용하는 Query 와 같은 성격.)

#### Section db-console.definition.table-list — 테이블/뷰 목록 사이드바
- **AC-1** 활성 연결의 테이블·뷰를 이름순 목록으로 렌더하고, 각 행 우측에 컬럼 수를 표시한다. 뷰는 아이콘으로 구분(이모지 금지).
- **AC-2** 이름 또는 컬럼명 부분일치 검색 필터(대소문자 무시).
- **AC-3** 항목 클릭 시 활성 테이블을 전환한다. 기본 활성은 첫 테이블. 재조회로 스키마가 바뀌어 활성 id 가 사라지면 첫 테이블로 폴백. 편집 중이면 `+` 로 새 테이블을 추가한다.
- **AC-4** 목록은 **테이블 묶음과 뷰 묶음을 갈라** 각각 개수와 함께 섹션으로 보인다(Data 사이드바와 같은 구성). 해당 묶음이 비면 그 섹션 머리는 그리지 않는다.
- **AC-5** 이 목록은 화면마다 따로 그리지 않는다 — Definition(운영/설계)·Diagram 이 **같은 컴포넌트**(`db/TableListPanel`)와 같은 순수 로직(`db/tableList`)을 쓴다. 각 행에는 이름으로 집을 수 있는 `data-table-row` 훅이 있다(e2e 가 구조 대신 이 훅으로 행을 집는다 — 지우면 스모크가 깨진다).
- **AC-6** 사이드바는 이 목록을 `테이블` 탭으로 담고 `제약` 탭을 함께 둔다(`db/TableSidePanel`) — Data 사이드바와 같은 구성. 제약 탭의 규칙은 `db-studio.definition.side-panel` 이 정본이다.

#### Section db-console.definition.detail — 상세 (Table 뷰)
- **AC-1** 컬럼 그리드: `#`/`Name`/`Type`/`Keys`/`Null`/`Default`/`Comment`. 키는 서비스 공통 불변식대로 `PK`/`FK`/`UK`/`IDX` 텍스트 배지(복합키는 위치 표기), CHECK 참여 컬럼은 `CHK` 마커.
- **AC-2** 제약 목록: 종류 텍스트 배지 + 이름 + 참여 컬럼. FK 는 `→ ref테이블 (컬럼)` + **정책 칩 두 개**(아래 FK 표기 규칙), CHECK 는 식(expression) 표기.
- **AC-3** (읽기) FK 의 참조 테이블을 클릭하면 그 테이블로 점프한다(활성 전환 + Table 뷰).
- **AC-4** (편집) 인라인 편집 — 컬럼 추가/수정(이름·타입·NULL·기본값·코멘트)/삭제/이동, 키 토글(PK/UK/IDX), 제약 추가·수정·삭제(FK 참조·**ON DELETE 와 ON UPDATE 둘 다**, CHECK 식), 테이블 이름·코멘트·삭제.

##### FK 표기 규칙 (설계부·운영부 공통 불변식)
> 정본: `workspaces/definition/fkPolicy.ts` + `FkPolicyChips.tsx`. 새 화면에서 FK 를 그릴 때 직접 문자열을 만들지 않는다.
- **AC-F1** 참조 대상은 `테이블 (컬럼[, 컬럼])` 한 형태로만 쓴다(`users.id` 식 축약 금지).
- **AC-F2** `ON DELETE` 와 `ON UPDATE` 를 **항상 둘 다** 보인다. 한쪽만 그리면 "제약이 없다"는 오독을 부른다.
- **AC-F3** 값이 없으면 DB 가 실제로 적용하는 `NO ACTION` 을 채워 보이되 흐리게 그리고, 마우스를 올리면 그 정책이 무슨 뜻인지 쉬운 말로 알려 준다. (설계부가 미지정을 `RESTRICT` 로 보이던 표기는 DDL 생성 결과와 어긋나 폐기 — `ddl.ts` 는 값이 없으면 절 자체를 안 쓴다.)
- **AC-F4** 좁은 목록(Data 제약 목록 등)은 참조만 쓴 짧은 표기를, 폭이 있는 표는 정책까지 붙인 표기를 쓴다 — 둘 다 같은 정본 함수(`fkRefText`)에서 나온다.

#### Section db-console.definition.sql — SQL(DDL) 뷰
- **AC-1** `[Table|SQL]` 표현 토글(읽기 모드). SQL 뷰는 활성 테이블을 **연결 방언**으로 생성한 `CREATE TABLE` DDL 을 구문 강조로 렌더한다(`generateDdl`, Studio Definition 과 동일 하이라이터 공유).
- **AC-2** 연결 방언 배지를 표시한다(방언은 선택지가 아니라 연결의 고정 속성). `Copy` 로 DDL 을 클립보드에 복사.

#### Section db-console.definition.edit — 편집 적용 파이프라인 (신설)
- **AC-1** `편집` 진입 시 현재 introspection 을 baseline 으로 스냅샷하고 draft 를 연다(연결 단위, Diagram 과 공유). 편집은 draft 에만 쌓인다.
- **AC-2** 하단 미리보기 바가 baseline↔draft diff(`generateMigration`)로 생성될 `ALTER/CREATE/DROP` DDL 과 대기 변경 수를 보인다(구문 강조, 펼침).
- **AC-3** 파괴적 문(DROP·이름변경 등)은 개수를 경고하고 적용 전 확인을 받는다. MySQL/MariaDB 는 DDL 자동 커밋이라 별도 경고.
- **AC-4** `적용` 은 tx 게이트(`query.txBegin→txExec→txCommit`)로 실행하고 실패 시 롤백한다. 성공 시 재역설계 후 편집을 종료한다. `버리기` 는 draft 를 버린다.
- **AC-5** sqlite 등에서 자동 생성 불가한 변경(컬럼/제약 정의 변경)은 `unsupported` 로 미리보기에 표시한다(수동 처리 안내).

#### 공통
- **AC-1** 미접속 시 "연결을 선택하세요" 안내 화면(placeholder)을 보인다.
- **AC-2** `새로고침` 으로 활성 연결을 재역설계한다(Diagram·Object 와 캐시 공유).

### Surface db-console.diagram.table-panel — ERD 좌측 사이드 패널 (신설)
> Data 사이드바와 같은 구성의 패널을 ERD 왼쪽에 둔다 — 노드가 많으면 캔버스에서 테이블을 눈으로 찾기 어렵다.
> 설계부(Studio › Diagram)·운영부(Console › Diagram 읽기/편집) 셋 다 **같은 컴포넌트**(`console/diagram/DiagramTablePanel` → `db/TableSidePanel`)를 쓴다.
- **AC-1** 좌측 패널에 `테이블`/`제약` 두 탭을 보인다. `테이블` 탭은 테이블/뷰를 갈라 목록으로 보인다(Definition·Data 와 같은 공용 패널·같은 규칙 — `db-studio.definition.side-panel`).
- **AC-2** 항목을 누르면 그 노드를 선택하고 **캔버스를 그 노드로 옮긴다**(부드럽게 이동, 과확대 방지 상한). 선택 상태는 캔버스 클릭과 공유한다.
- **AC-3** 필터(`관계만`)로 캔버스에서 빠진 테이블은 목록에서도 빠진다 — 눌러도 갈 곳이 없는 항목을 보이지 않기 위해 선택·필터 상태를 캔버스와 같은 곳에서 든다.
- **AC-4** `제약` 탭의 항목을 누르면 그 제약이 걸린 테이블 노드로 캔버스가 이동한다(AC-2 와 같은 이동).

### Surface db-console.diagram (편집) — ERD 캔버스 편집 (신설)
> Console › Diagram 을 편집 가능하게. Definition 과 **같은 연결 단위 편집 스토어·적용 파이프라인**(baseline↔draft diff → DDL 미리보기 → tx 게이트 → 재역설계)을 공유하며, 캔버스가 편집 표면이 된다. 시각 레이어(노드/엣지/배치)는 읽기 Diagram·Studio ERD 와 공유.
- **AC-1** `편집` 진입 시 draft 를 편집 가능한 ERD 로 렌더한다(모든 컬럼에 관계 핸들 개방, 노드 드래그 가능).
- **AC-2** 노드 클릭 시 사이드 편집 패널 — 테이블 이름·삭제, 컬럼 추가/이름·타입 편집/NULL 토글/PK 토글/삭제, FK 목록·삭제.
- **AC-3** 컬럼의 오른쪽 핸들을 다른 테이블로 끌면 FK 를 만든다(참조 컬럼 기본값 = 대상 PK, `buildFkPatch`).
- **AC-4** 캔버스 상단 `테이블` 로 새 테이블 추가, 검색·간략 토글 제공. 노드 위치는 연결 단위로 영속(읽기 Diagram 과 공유).
- **AC-5** 하단 미리보기 바(db-console.definition.edit 와 동일)로 대기 변경·DDL·파괴적 경고를 보이고 tx 게이트로 적용한다.
