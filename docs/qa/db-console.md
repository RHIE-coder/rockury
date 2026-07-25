# TestPlan: db-console 기능 이관 (Tier A·B + Data 도우미 + 서비스 전역)

> 정의(무엇을 검증하나)만 여기. 코드는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 흐름 `e2e/smoke.mjs`.
> 회차 기록은 `docs/qa/runs/`.

## Scenario S1 — Data 그리드/도우미 (순수 로직)
- **CASE-console-001** 키 배지 판정: 컬럼이 PK/FK/UK/IDX 각각일 때 올바른 배지 종류 집합을 돌려준다. (grid AC-1) → `console/data/*.test.ts`
- **CASE-console-002** 타입 라벨 포맷: 컬럼 타입 → `char(36)`/`int`/`datetime` 표시 문자열. (grid AC-2)
- **CASE-console-003** 시간값 포맷/정규화: 입력·NOW 값이 `YYYY-MM-DD HH:mm:ss[.SSS]` 로 정규화, 잘못된 입력 거부. (cell-helpers AC-2)
- **CASE-console-004** UUID 생성값이 UUID v4 형식을 만족. (cell-helpers AC-1)
- **CASE-console-005** 타임존 3-way 포맷: 같은 epoch 를 UTC/LOCAL(tz)/TIMESTAMP 로 각각 올바르게 포맷. (toolbar AC-4)

## Scenario S2 — 서비스 전역 (순수 로직)
- **CASE-console-010** 테이블/뷰 분리: introspection 결과에서 뷰와 테이블을 올바르게 가른다. (table-list AC-1/AC-3)
- **CASE-console-011** 전역 제약 집계: TableDef[] → 종류별(PK/FK/UK/IDX/CHECK) 개수와 평탄 목록. (constraints-tab AC-1/AC-2)
- **CASE-console-012** 제약 종류 필터: ALL/각 종류 선택 시 목록이 올바르게 걸러진다. (constraints-tab AC-2)
- **CASE-console-013** FK 참조 표기 문자열: 짧은 표기 `→ users (id)` / 상세 표기 `→ users (id) · ON DELETE … · ON UPDATE …`. (constraints-tab AC-3) → `console/constraintsView.test.ts`
- **CASE-console-014** FK 정책 칩(공통 정본): ON DELETE·ON UPDATE 를 항상 둘 다, 이 순서로. 값이 없으면 `NO ACTION` 을 채우고 흐리게(implicit) + "지정하지 않아 DB 기본값" 안내. 실 DB 가 준 `NO ACTION` 도 흐리되 안내 문구는 안 붙인다. (definition.detail AC-F2/F3) → `workspaces/definition/fkPolicy.test.ts`
- **CASE-console-015** FK 참조 대상 표기: 단일 `users (id)`, 복합 `orders (org_id, no)`, 대상/컬럼이 비면 `?` 자리 유지. (definition.detail AC-F1)
- **CASE-console-016** 목록 그룹핑: 검색을 적용한 뒤 테이블/뷰로 가르고 각 묶음 순서 유지, 검색 전 전체 개수와 검색 후 개수를 함께 준다. 뷰 표식 없는 목록은 전부 테이블. (definition.table-list AC-4) → `db/tableList.test.ts`
- **CASE-console-017** 뷰 표식 영속: 설계 저장소 왕복(`replaceTablesForDesign`→`listTables`)에서 `isView` 가 보존되고, 표식 없는 테이블은 false 로 정규화된다. (definition.table-list AC-4) → `main/store/stores.test.ts`

## Scenario S2b — Data 표시 품질 (순수 로직)
- **CASE-console-018** 컬럼 폭 자동 계산: 짧은 값은 최소 폭, 아주 긴 값도 최대 폭을 넘지 않음, 가장 긴 값 기준(뒤에 짧은 값이 와도 안 줄어듦), 값이 짧아도 긴 컬럼명이면 헤더 기준, 키 배지만큼 가산, 행이 없어도 모든 컬럼에 폭 부여, 표본 상한 밖 행은 무시. (data.grid AC-6) → `console/data/colWidth.test.ts`
- **CASE-console-019** 셀 표시 길이: null 은 `NULL`(4), 객체는 JSON 길이, 순환 참조도 안 터짐. (data.grid AC-6)
- **CASE-console-01A** JSON 요약: 객체는 키 수·배열은 항목 수·빈 값·깨진 값(invalid)을 가르고, 정렬 저장된 값도 미리보기는 한 줄, 상한에서 말줄임. (data.json-cell AC-1) → `console/data/jsonCell.test.ts`
- **CASE-console-01B** JSON 정렬/압축 왕복: 정렬→압축이 원래 압축형과 같고, 깨진 JSON 은 손대지 않고 원문 유지. 형식 오류 판정은 빈 값을 오류로 보지 않는다. (data.json-cell AC-3/AC-5)

## Scenario S3 — Query (순수 로직)
- **CASE-console-020** 키워드 추출: bare `{{x}}` 만 추출, `'{{x}}'` 는 제외. (query.editor AC-2)
- **CASE-console-021** 키워드 치환: 숫자/NULL 은 그대로, 문자열은 싱글쿼트+이스케이프. (query.editor AC-2)
- **CASE-console-022** 다중 문 분할: 문자열/주석 내 세미콜론을 오분할하지 않는다. (query.execution AC-2)

## Scenario S4 — Collection (순수 로직)
- **CASE-console-030** Run-All 상태 전이: 실패 시 이후 skipped, 재시도 시 실패 지점부터 running. (collection.run-all AC-1/AC-2)
- **CASE-console-031** 삭제 가드: 참조 중인 쿼리 삭제 시 거부 + 참조 목록 반환. (collection.items AC-2)

## Scenario S5 — 앱 구동 흐름 (e2e/smoke.mjs, CSS/text 로케이터만)
- **CASE-console-040** Data 뷰 진입 → 사이드바에 테이블/VIEWS 분리 표시, 헤더에 PK/FK 텍스트 배지 표시.
- **CASE-console-041** Constraints 탭 전환 → 종류 필터 칩과 제약 목록 렌더.
- **CASE-console-042** Query 뷰 → `{{키워드}}` 입력 시 값 입력칸 노출, 실행.
- **CASE-console-043** Collection 트리에서 저장 쿼리 클릭 → 에디터 로드.
- **CASE-console-044** Definition 뷰 진입 → 사이드바에 실 DB 테이블 목록(users/user_roles), 테이블 선택 후 `SQL` 토글 시 `CREATE TABLE` DDL 렌더. (definition.table-list/sql)
- **CASE-console-045** Definition 편집: `편집` → 테이블 추가·컬럼 추가 → 대기 변경 미리보기 → `적용` → 재역설계에 신규 테이블 반영. (definition.edit AC-1/2/4)
- **CASE-console-046** Definition 편집(파괴적): 테이블 삭제 시 파괴적 경고 → `적용`(확인) → 재역설계에서 사라짐(DB 원복). (definition.edit AC-3/4)
- **CASE-console-047** Diagram 편집: `편집` → 노드 선택 시 편집 패널(관계(FK)) → 캔버스 `테이블` 로 노드 증가+대기 변경 → `버리기` 로 읽기 복귀. (diagram AC-1/2/4)
- **CASE-console-048** Definition 목록이 테이블/뷰를 가른다 — 테스트 DB 의 `v_user_summary` 가 뷰 묶음에 뜬다. (definition.table-list AC-4)
- **CASE-console-049** Definition 상세의 FK 가 `ON DELETE`·`ON UPDATE` 를 동시에 보인다(테스트 DB `user_roles` 는 둘 다 CASCADE). (definition.detail AC-F2)
- **CASE-console-04A** Diagram 좌측 목록 패널이 있고, 항목을 누르면 캔버스 뷰포트가 실제로 움직인다(포커싱). (diagram.table-panel AC-1/AC-2)
- **CASE-console-04B** Data 의 JSON 셀이 구조 요약으로 보이고, 눌러 열면 뷰어가 형식 정상 여부와 정렬/한 줄 도구를 보인다. (data.json-cell AC-1/AC-2/AC-3)

## Scenario S6 — Definition (순수 로직)
- **CASE-console-050** 테이블 검색 필터: 이름/컬럼명 부분일치(대소문자 무시), 빈 질의는 전체를 원래 순서로, 매칭 없으면 빈 배열. (definition.table-list AC-2) → `console/definition/select.test.ts`
- **CASE-console-051** 활성 테이블 해석: id 로 찾되 없으면 첫 테이블 폴백, activeId=null 도 첫 테이블, 빈 목록은 undefined. (definition.table-list AC-3)
- **CASE-console-052** DDL 구문 강조 토큰화: 키워드/식별자/문자열/타입/숫자/주석 분류 + 무손실 분해(토큰을 이어붙이면 원문과 일치). (definition.sql AC-1) → `workspaces/definition/sqlHighlight.test.ts`
- **CASE-console-053** 편집 reducer(순수): 컬럼/제약/테이블 CRUD 가 draft 를 올바르게 변형(새 엔티티는 `new:` 접두 id). (definition.edit AC-1) → `console/schemaEdit/mutations.test.ts`
- **CASE-console-054** 편집→DDL 통합: 신규 컬럼→`ADD COLUMN`, 기존 컬럼 변경→`MODIFY`(id 보존), 삭제→`DROP`(파괴적), 테이블 rename→`RENAME`. (definition.edit AC-2/3) → `console/schemaEdit/mutations.test.ts`
- **CASE-console-055** Diagram FK 드래그(순수): `buildFkPatch` + addConstraint/updateConstraint → `ADD ... FOREIGN KEY (...) REFERENCES ...`. (diagram AC-3) → `console/schemaEdit/mutations.test.ts`
