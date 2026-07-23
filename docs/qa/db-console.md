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
- **CASE-console-013** FK 참조 표기 문자열: `→ ref.col DEL:규칙` 생성. (constraints-tab AC-3)

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

## Scenario S6 — Definition (순수 로직)
- **CASE-console-050** 테이블 검색 필터: 이름/컬럼명 부분일치(대소문자 무시), 빈 질의는 전체를 원래 순서로, 매칭 없으면 빈 배열. (definition.table-list AC-2) → `console/definition/select.test.ts`
- **CASE-console-051** 활성 테이블 해석: id 로 찾되 없으면 첫 테이블 폴백, activeId=null 도 첫 테이블, 빈 목록은 undefined. (definition.table-list AC-3)
- **CASE-console-052** DDL 구문 강조 토큰화: 키워드/식별자/문자열/타입/숫자/주석 분류 + 무손실 분해(토큰을 이어붙이면 원문과 일치). (definition.sql AC-1) → `workspaces/definition/sqlHighlight.test.ts`
