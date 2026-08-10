# TestPlan: db-remote 기능 이관 (Tier A·B + Data 도우미 + 서비스 전역)

> 정의(무엇을 검증하나)만 여기. 코드는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 흐름 스위트 `e2e/suites/NN-*.mjs`.
> 회차 기록은 `docs/qa/runs/`.

## Scenario S1 — Data 그리드/도우미 (순수 로직)
- **CASE-remote-001** 키 배지 판정: 컬럼이 PK/FK/UK/IDX 각각일 때 올바른 배지 종류 집합을 돌려준다. (grid AC-1) → `console/data/*.test.ts`
- **CASE-remote-002** 타입 라벨 포맷: 컬럼 타입 → `char(36)`/`int`/`datetime` 표시 문자열. (grid AC-2)
- **CASE-remote-003** 시간값 포맷/정규화: 입력·NOW 값이 `YYYY-MM-DD HH:mm:ss[.SSS]` 로 정규화, 잘못된 입력 거부. (cell-helpers AC-2)
- **CASE-remote-004** UUID 생성값이 UUID v4 형식을 만족. (cell-helpers AC-1)
- **CASE-remote-005** 타임존 3-way 포맷: 같은 epoch 를 UTC/LOCAL(tz)/TIMESTAMP 로 각각 올바르게 포맷. (toolbar AC-4)
- **CASE-remote-006** CSV 변환(클립보드 복사·파일 Export 공용): 머리줄 + 컬럼 순서대로 값, NULL/undefined 는 빈 칸,
  쉼표·따옴표·줄바꿈이 든 값은 감싸고 따옴표는 이중화, 객체는 JSON 문자열, 행이 없어도 머리줄은 남는다.
  SQL INSERT 는 방언별 식별자 인용 + NULL·불린·작은따옴표 이스케이프. (toolbar AC-5 / AC-2) → `remote/data/exportRows.test.ts`

## Scenario S2 — 서비스 전역 (순수 로직)
- **CASE-remote-010** 테이블/뷰 분리: introspection 결과에서 뷰와 테이블을 올바르게 가른다. (table-list AC-1/AC-3)
- **CASE-remote-011** 전역 제약 집계: TableDef[] → 종류별(PK/FK/UK/IDX/CHECK) 개수와 평탄 목록. (constraints-tab AC-1/AC-2)
- **CASE-remote-012** 제약 종류 필터: ALL/각 종류 선택 시 목록이 올바르게 걸러진다. (constraints-tab AC-2)
- **CASE-remote-013** FK 참조 표기 문자열: 짧은 표기 `→ users (id)` / 상세 표기 `→ users (id) · ON DELETE … · ON UPDATE …`. (constraints-tab AC-3) → `console/constraintsView.test.ts`
- **CASE-remote-014** FK 정책 칩(공통 정본): ON DELETE·ON UPDATE 를 항상 둘 다, 이 순서로. 값이 없으면 `NO ACTION` 을 채우고 흐리게(implicit) + "지정하지 않아 DB 기본값" 안내. 실 DB 가 준 `NO ACTION` 도 흐리되 안내 문구는 안 붙인다. (definition.detail AC-F2/F3) → `workspaces/definition/fkPolicy.test.ts`
- **CASE-remote-015** FK 참조 대상 표기: 단일 `users (id)`, 복합 `orders (org_id, no)`, 대상/컬럼이 비면 `?` 자리 유지. (definition.detail AC-F1)
- **CASE-remote-016** 목록 그룹핑: 검색을 적용한 뒤 테이블/뷰로 가르고 각 묶음 순서 유지, 검색 전 전체 개수와 검색 후 개수를 함께 준다. 뷰 표식 없는 목록은 전부 테이블. (definition.table-list AC-4) → `db/tableList.test.ts`
- **CASE-remote-017** 뷰 표식 영속: 설계 저장소 왕복(`replaceTablesForDesign`→`listTables`)에서 `isView` 가 보존되고, 표식 없는 테이블은 false 로 정규화된다. (definition.table-list AC-4) → `main/store/stores.test.ts`
- **CASE-remote-01D** 고른 표 따라가기 판정: 다른 표가 골라졌으면 따라가고, 이미 그 표를 열고 있거나 고른 것이 없으면 안 움직인다. **저장 안 한 셀 변경이나 커밋 대기 트랜잭션이 있으면 안 따라간다.** 고름은 연결마다 따로 기억하고, 연결이 없으면 아무 데도 안 적는다. (definition.table-list AC-7) → `remote/focus.test.ts`

## Scenario S2b — Data 표시 품질 (순수 로직)
- **CASE-remote-018** 컬럼 폭 자동 계산: 짧은 값은 최소 폭, 아주 긴 값도 최대 폭을 넘지 않음, 가장 긴 값 기준(뒤에 짧은 값이 와도 안 줄어듦), 값이 짧아도 긴 컬럼명이면 헤더 기준, 키 배지만큼 가산, 행이 없어도 모든 컬럼에 폭 부여, 표본 상한 밖 행은 무시. (data.grid AC-6) → `console/data/colWidth.test.ts`
- **CASE-remote-019** 셀 표시 길이: null 은 `NULL`(4), 객체는 JSON 길이, 순환 참조도 안 터짐. (data.grid AC-6)
- **CASE-remote-01A** JSON 요약: 객체는 키 수·배열은 항목 수·빈 값·깨진 값(invalid)을 가르고, 정렬 저장된 값도 미리보기는 한 줄, 상한에서 말줄임. (data.json-cell AC-1) → `console/data/jsonCell.test.ts`
- **CASE-remote-01B** JSON 정렬/압축 왕복: 정렬→압축이 원래 압축형과 같고, 깨진 JSON 은 손대지 않고 원문 유지. 형식 오류 판정은 빈 값을 오류로 보지 않는다. (data.json-cell AC-3/AC-5)

## Scenario S2c — Data 쪽 넘김 · 필터 · 저장 필터 (순수 로직 + 저장소)
- **CASE-remote-060** 행 수 세기 SQL: `buildCount` 가 조회와 **같은 WHERE·같은 바인드 파라미터**를 만들고, `ORDER BY`·`LIMIT`·`OFFSET` 은 붙이지 않는다. 조건이 없으면 `WHERE` 절 자체가 없다. (data.paging AC-3) → `remote/data/sqlBuilder.test.ts`
- **CASE-remote-061** 쪽 번호 정규화: 총 쪽수를 알 때 0 이하는 1쪽, 초과는 마지막 쪽으로 당겨 잡는다. 숫자가 아니면 원래 쪽을 그대로 돌려준다. **총 쪽수를 모를 때(`null`)는 위쪽 상한을 걸지 않는다** — 모른다는 이유로 이동을 막으면 안 된다. 행이 0이면 총 쪽수는 1쪽이다(빈 표에 "0쪽"은 없다). (data.paging AC-2/AC-4a) → `remote/data/paging.test.ts`
- **CASE-remote-062** 늦은 셈 무시: 셈 요청마다 일련번호를 매기고, 도착한 번호가 마지막에 띄운 번호가 아니면 결과를 버린다. (data.paging AC-5) → `remote/data/paging.test.ts`
- **CASE-remote-063** 표별 보기 상태: 표 A 에 조건을 걸고 B 로 옮겼다 A 로 돌아오면 A 의 조건·정렬·쪽·켬끔이 되살아나고, B 는 빈 상태로 남는다. 스키마가 다른 같은 이름 표는 **서로 다른 표**로 친다. (data.filter AC-2) → `remote/data/storeLogic.test.ts`
- **CASE-remote-064** 조건 켬/끔: 끄면 `WHERE` 없이 조회하되 조건 목록은 그대로 남고, 켜면 같은 조건이 다시 걸린다. 조건 수 배지는 꺼져 있어도 개수를 그대로 센다(0으로 만들지 않는다). (data.filter AC-3/AC-3a) → `remote/data/storeLogic.test.ts`
- **CASE-remote-065** 검색 카드 거르기·정렬: 부분일치로 거르고 **앞글자 일치를 위로** 올린다(`user` → `user_id` 가 `created_by_user` 보다 앞). 대소문자 무시. 검색어가 비면 원래 순서 그대로. 맞는 것이 없으면 빈 목록. (data.filter AC-1b) → `ui/searchSelect.test.ts`
- **CASE-remote-066** 검색 카드 키보드 커서: ↑↓ 가 걸러진 목록 안에서만 움직이고 양 끝에서 감싸돈다. 검색어를 고쳐 목록이 줄면 커서가 범위 밖으로 나가지 않는다. 빈 목록에서는 Enter 가 아무것도 안 고른다. (data.filter AC-1b) → `ui/searchSelect.test.ts`
- **CASE-remote-067** 저장 필터 저장소 왕복: 저장→목록→이름 수정→삭제가 `연결·스키마·표` 단위로 갈린다. 같은 이름 표라도 스키마가 다르면 섞이지 않고, 다른 표의 것은 목록에 안 나온다. (data.saved-filter AC-2/AC-3) → `main/store/stores.test.ts`
- **CASE-remote-068** 저장 필터 상태 판정: 조건이 쓰는 컬럼이 다 있으면 정상, 하나라도 없으면 **없는 컬럼 이름 목록과 함께** 못 쓰는 상태를 돌려준다. 값이 필요 없는 연산자(`IS NULL`)도 컬럼은 있어야 한다. 조건이 0개면 정상으로 친다. (data.saved-filter AC-4) → `remote/data/savedFilter.test.ts`
- **CASE-remote-069** 표 삭제 정리 **후보** 계산: 역설계 목록에 없는 저장 필터가 후보다 — 지금 안 보는 스키마의 것도, 표 목록이 통째로 빈 경우(그 접속의 마지막 표를 지운 경우)도 후보에 들어간다. 여기서는 아무것도 결정하지 않는다(결정은 06A). (data.saved-filter AC-5a) → `remote/data/savedFilter.test.ts`
- **CASE-remote-06A** "그 표 없음" 오류 판정: MySQL/MariaDB(`Table … doesn't exist`·`ER_NO_SUCH_TABLE`) · PostgreSQL(`relation … does not exist`·`42P01`) · SQLite(`no such table`) 만 참이다. **권한 거부·접속 오류·데이터베이스/스키마 없음·컬럼 없음은 전부 거짓** — 이 함수가 틀리면 사용자가 만든 저장 필터가 되돌릴 수 없이 사라진다. (data.saved-filter AC-5a) → `remote/data/tableGone.test.ts`

## Scenario S3 — Query (순수 로직)
- **CASE-remote-020** 키워드 추출: bare `{{x}}` 만 추출, `'{{x}}'` 는 제외. (query.editor AC-2)
- **CASE-remote-021** 키워드 치환: 숫자/NULL 은 그대로, 문자열은 싱글쿼트+이스케이프. (query.editor AC-2)
- **CASE-remote-022** 다중 문 분할: 문자열/주석 내 세미콜론을 오분할하지 않는다. (query.execution AC-2)

## Scenario S4 — Collection (순수 로직)
- **CASE-remote-030** Run-All 상태 전이: 실패 시 이후 skipped, 재시도 시 실패 지점부터 running. (collection.run-all AC-1/AC-2)
- **CASE-remote-031** 삭제 가드: 참조 중인 쿼리 삭제 시 거부 + 참조 목록 반환. (collection.items AC-2)

## Scenario S5 — 앱 구동 흐름 (e2e/suites/07-remote-schema · 08-remote-query-data · 09-remote-collection, CSS/text 로케이터만)
- **CASE-remote-040** Data 뷰 진입 → 머리줄에 `Data · <연결 이름>` 과 테이블 수, 사이드바에 `테이블`/`뷰` 구역 분리 표시, 그리드 헤더에 PK/FK 텍스트 배지 표시. 그리드 아래에 제약 칸은 **없다**(사이드 패널 `제약` 탭이 정본). (data.header AC-1/AC-2 · data.table-list AC-1 · data.constraints-tab AC-4)
- **CASE-remote-041** 사이드 패널 `제약` 탭 전환 → 종류 필터 칩과 제약 목록 렌더. 탭은 사이드바 안에 있고 이름은 `테이블·뷰`/`제약` 이다. (data.constraints-tab AC-1/AC-2)
- **CASE-remote-042** Query 뷰 → `{{키워드}}` 입력 시 값 입력칸 노출, 실행.
- **CASE-remote-042a** Query 의 **좌·우·양쪽 패널 접기/펼치기**: 각각 접으면 폭 0 + 세로 띠가 남고, 양쪽 손잡이 하나로 둘을 한 번에 여닫는다(펼치면 접기 전 폭으로). (db-design.definition.side-panel AC-5/AC-5a)
- **CASE-remote-042b** **결과 행 상세** — 행을 누르면 모달이 뜨고, 잘리던 긴 값이 다 보이며 JSON 은 들여써서 보인다. `다음` 으로 행을 넘긴다. (result-grid.row-detail AC-1~AC-5)
- **CASE-remote-043** Collection 트리에서 저장 쿼리 클릭 → 에디터 로드.
- **CASE-remote-043a** Collection 도 같은 좌·우·양쪽 접기와 인라인 결과의 행 상세를 갖는다(Query 와 **같은 부품**). (side-panel AC-5a · result-grid.row-detail AC-1)
- **CASE-remote-044** Definition 뷰 진입 → 사이드바에 실 DB 테이블 목록(users/user_roles), 테이블 선택 후 `SQL` 토글 시 `CREATE TABLE` DDL 렌더. (definition.table-list/sql)
- **CASE-remote-044b** **고른 표가 뷰를 넘어 유지된다** — Definition 에서 `user_roles` 를 고르고 Diagram·Data 로 옮겨도 같은 표가 활성이고, Data 에서 `users` 를 고르면 Definition 이 따라온다. (definition.table-list AC-7)
- **CASE-remote-045** Definition 편집: `편집` → 테이블 추가·컬럼 추가 → 대기 변경 미리보기 → `적용` → 재역설계에 신규 테이블 반영. (definition.edit AC-1/2/4)
- **CASE-remote-046** Definition 편집(파괴적): 테이블 삭제 시 파괴적 경고 → `적용`(확인) → 재역설계에서 사라짐(DB 원복). (definition.edit AC-3/4)
- **CASE-remote-047** Diagram 편집: `편집` → **누를 수 있는** 노드를 hit-test 로 골라(첫 노드는 캔버스 밖·좌측 패널 아래에 놓일 수 있다) 선택 시 **상세 서랍이 Definition 편집 화면을 그대로** 연다 → 캔버스 `테이블` 로 노드 증가+대기 변경 → `버리기` 로 읽기 복귀. (diagram AC-1/2/4, diagram.detail AC-2)
- **CASE-remote-048** Definition 목록이 테이블/뷰를 가른다 — 테스트 DB 의 `v_user_summary` 가 뷰 묶음에 뜬다. (definition.table-list AC-4)
- **CASE-remote-049** Definition 상세의 FK 가 `ON DELETE`·`ON UPDATE` 를 동시에 보인다(테스트 DB `user_roles` 는 둘 다 CASCADE). (definition.detail AC-F2)
- **CASE-remote-04A** Diagram 좌측 목록 패널이 있고, 항목을 누르면 캔버스 뷰포트가 실제로 움직인다(포커싱). (diagram.table-panel AC-1/AC-2)
- **CASE-remote-04B** Data 의 JSON 셀이 구조 요약으로 보이고, 눌러 열면 뷰어가 형식 정상 여부와 정렬/한 줄 도구를 보인다. (data.json-cell AC-1/AC-2/AC-3)
- **CASE-remote-04B2** Data 의 **행 번호**를 누르면 행 상세 모달이 열리고(셀 편집과 부딪히지 않는 자리), 숨긴 컬럼까지 자르지 않고 보인다. (result-grid.row-detail AC-1a/AC-1b)
- **CASE-remote-04K** Data 쪽 넘김: 총 쪽수가 채워지고(`…` → 숫자), 쪽 입력에 숫자를 쳐서 이동하고, `마지막`·`처음` 이 동작하며, 쪽을 옮기면 표가 **맨 위로** 돌아간다(스크롤 위치 0). (data.paging AC-1/AC-2/AC-4/AC-6)
- **CASE-remote-04L** Data 필터: 컬럼 칸을 눌러 **검색 카드**가 열리고 타이핑으로 컬럼이 좁혀진다. 조건을 적용한 뒤 **켬/끔 스위치를 끄면 전체 행이 돌아오고 조건 줄은 남아 있으며**, 다시 켜면 같은 조건이 걸린다. (data.filter AC-1/AC-1b/AC-3)
- **CASE-remote-04M** Data 필터 표별 기억: 표 A 에 조건을 걸고 B 로 옮기면 B 에는 조건이 없고, A 로 돌아오면 A 의 조건이 그대로다. (data.filter AC-2)
- **CASE-remote-04N** 저장 필터: 이름을 붙여 저장 → 조건을 지운 뒤 목록에서 골라 되살린다 → **앱을 껐다 켜도 남는다.** 다른 표에서는 그 항목이 목록에 없다. (data.saved-filter AC-1/AC-2/AC-3)
- **CASE-remote-04O** 컬럼이 사라진 저장 필터가 **빨간 계열로** 표시되고 적용이 막힌다 — 없어진 컬럼 이름과 이유를 그 자리에 밝히고, 같은 표의 멀쩡한 저장 필터는 그대로 쓸 수 있다. 색은 계산된 값으로 잰다(`rgb()`·`oklab()` 두 표기 모두 — Tailwind v4 는 투명도가 붙으면 `oklab()` 으로 낸다). (data.saved-filter AC-4)
- **CASE-remote-04P** **쪽 크기 회귀** — 마지막 쪽에 서 있다가 다른 표에서 쪽 크기를 키우고 돌아오면, 범위 밖이 된 쪽이 마지막 쪽으로 스스로 되돌아온다(빈 표에 `9 / 2` 가 뜨지 않는다). 쪽 번호는 표마다 기억하는데 쪽 크기는 전체가 하나를 쓰기 때문에 생기는 어긋남. (data.paging AC-2)
- **CASE-remote-04Q** **오삭제 회귀** — **권한이 없어 목록에서만 빠진** 표의 저장 필터는 살아남는다. 픽스처가 심는 제한 권한 계정(`rky_limited` — `testdb.roles` 만 볼 수 있다)으로 붙어, 보이지 않는 `users` 의 저장 필터가 정리되지 않는지 본다. 반대편(진짜 지워진 표는 정리된다)은 전권 계정을 쓰는 위 `filter_probe` 블록이 덮는다. (data.saved-filter AC-5a)
  > **미검증(의도적)**: "권한은 남아 있는데 표만 지워진" 조합은 MySQL 이 **없는 표에도 권한 부족을 먼저 답해서**(`ER_TABLEACCESS_DENIED` 우선) 제한 계정으로는 재현되지 않는다. 그건 우리 판정이 아니라 벤더 규칙이고, 우리 쪽 판정(`isTableMissingError`)은 실 DB 에서 받아 온 오류 문구로 `CASE-remote-06A` 가 전수 고정한다.
- **CASE-remote-04R** **표 전환 중 `undefined` 회귀(2026-08-08 제보)** — 표를 바꾸면 헤더는 새 표(역설계)에서 곧장 오는데 행만 옛 표 것으로 남아, 화면이 없는 키로 값을 꺼내 편집 칸마다 글자 `undefined` 가 찍혔다. 표를 고르는 순간 행·컬럼이 비고, 읽는 동안 그리드 자리에 **도는 표시**가 뜨며, 다 읽으면 새 표의 행이 자리잡는다. 조회는 로컬 도커라 눈 깜짝할 새 끝나므로 e2e 는 `runParams` 를 **일부러 늦춰** 그 순간을 결정적으로 잡는다(안 그러면 조용히 통과한다). (data.grid AC-8/AC-8a/AC-8b) → `remote/data/storeLogic.test.ts` · `e2e/suites/08-remote-query-data`
- **CASE-remote-04R2** **늦게 온 조회 회귀(같은 제보의 두 번째 갈래)** — 표 A 를 고른 직후 B 를 고르면 A 의 응답이 나중에 도착해 B 헤더 밑에 A 행이 박힌다(증상은 똑같이 `undefined`). 마지막에 띄운 조회만 반영되고, 늦게 온 **실패**도 남의 오류를 띄우지 않는다. 새로고침도 마찬가지 — 역설계를 읽는 사이 다른 표를 고르면 그 표가 이기고, 새로고침이 끝나며 화면이 아까 표로 되돌아가지 않는다. (data.grid AC-8c/AC-8d) → `remote/data/storeLogic.test.ts`
- **CASE-remote-04R3** **빈 자리의 다시 읽기** — 보던 표를 밖에서 지우고 새로고침하면 화면이 `선택된 테이블 없음` 이 되는데, 그 자리에서도 `새로고침` 을 누를 수 있다. 없으면 새로 만든 표를 목록에 올릴 길이 앱 재시작뿐이다. (data.grid AC-8e) → `e2e/suites/08-remote-query-data`
- **CASE-remote-04C** **배치 유실 회귀** — 노드를 옮기고 캔버스도 옮긴 **직후** 다른 화면(Remote 밖 뷰)으로 나갔다 Diagram 으로 돌아오면 노드 위치와 화면 위치가 그대로다. 디바운스가 끝나기 전에 떠나도 저장된다. (diagram.layout AC-2)
- **CASE-remote-04D** 그룹 만들기 → 테이블 두 개를 영역에 넣고 **영역을 끌면 두 노드가 같은 거리만큼 함께 움직인다.** 그룹 안 노드 하나만 끌면 그것만 움직인다. (diagram.group AC-1/AC-2)
- **CASE-remote-04E** 그룹 접기 → 소속 노드가 캔버스에서 사라지고 그룹 상자는 남는다. 펴면 접기 전 자리로 돌아온다. (diagram.group AC-4)
- **CASE-remote-04F** 좌측 `그룹` 탭에서 **그룹만 보기** → 캔버스 노드 수가 그 그룹 크기로 줄고, 끄면 되돌아온다. 지우기는 **확인 창**을 띄우고(소속 테이블 목록·개수 표시), 운영부 확인 창에는 `그룹만 지우기` 만 있으며 지운 뒤에도 테이블은 남는다. (diagram.group-panel AC-1/AC-2/AC-2a/AC-2b/AC-4)
- **CASE-remote-04G** 노드 클릭 → 아래 서랍에 컬럼·제약이 뜨고 `SQL` 토글로 `CREATE TABLE` 이 보인다. FK 참조를 누르면 캔버스가 그 테이블로 이동하고 서랍도 바뀐다. `크게 보기` 로 모달이 열리고 닫힌다. (diagram.detail AC-1/AC-3/AC-4/AC-5)
- **CASE-remote-04H** 그룹·배치가 **앱을 껐다 켜도 남는다**(콜드 재시작). (diagram.layout AC-1 · diagram.group AC-7) → `e2e/suites/99-cold-restart`
- **CASE-remote-04J** **그룹 상자 가장자리가 클릭을 가로채지 않는다** — 크기 조절의 투명한 변이 pointer-events 를 잡으면 가장자리에 걸친 테이블을 누를 수 없다(실측: 편집 진입 후 노드 클릭이 30초 대기 끝에 실패했다). 잡는 곳은 모서리 손잡이만. (diagram.group AC-6a)
- **CASE-remote-04I** 캔버스에서 테이블을 **그룹 영역 밖으로 끌어내면 소속이 풀린다.** 드래그가 실제로 일어났는지 먼저 가른 뒤 저장본으로 소속 수를 확인한다. (diagram.group AC-3)
  > **미검증(의도적)**: 반대 방향인 "영역 안으로 끌어 넣기"는 앱 흐름으로 안 덮는다. 스모크 DB 는 테이블이 32개라 `자동 맞춤` 배율이 최소(0.1)까지 내려가고, 그때 그룹 상자가 28×18 px 라 합성 마우스가 목표 지점에 안정적으로 떨어지지 않았다(세 방식 모두 실측 실패 — 상자 중앙 조준·소속 노드 조준·확대 후 조준). 판정은 양방향이 **같은 순수 함수**(`groupAtPoint` + `setMembership`)를 쓰며 CASE-remote-058 이 둘 다 고정한다. 테이블 수가 적은 전용 스모크 픽스처가 생기면 이 칸을 채운다.

## Scenario S5b — 범위(scope) · 여러 스키마 (순수 로직 + 실 DB)
- **CASE-remote-04S1** **참조 해석**(`db/schemaRef`): 이름이 같아도 스키마가 다르면 다른 테이블. `refSchema` 가 비면 FK 가 걸린 테이블과 같은 스키마에서 찾고, 못 찾으면 `undefined`(= 범위 밖). 스키마가 양쪽 다 비면 예전 데이터 그대로 이어진다. 화면 표기는 스키마가 섞였을 때만 접두어. (scope.model AC-5) → `db/schemaRef.test.ts`
- **CASE-remote-04S2** **벤더별 층 판정**(`db/scope`): PostgreSQL 은 database 층 + schema 다중, MySQL·MariaDB 는 database 다중(위층 없음), SQLite 는 선택기 없음. 마지막 하나는 못 끈다. 없어진 스키마는 떨어뜨리고 순서는 가용 목록을 따른다. (scope.model AC-1~3 · scope.selector AC-3/AC-5) → `db/scope.test.ts`
- **CASE-remote-04S2b** **손잡이 문구**: 고른 것이 있으면 그 이름, 없으면 화면에 실제로 올라온 스키마 이름, 아직 아무것도 안 읽었을 때만 자리 이름(`범위`). `기본` 같은 말을 쓰지 않는다 — 그렇게 적었더니 사용자가 손잡이를 못 찾았다(2026-07-30). (scope.selector AC-2) → `db/scope.test.ts`
- **CASE-remote-04S3** **database 전환 = 연결 전환**: 같은 서버·포트·계정·방언에서 그 database 에 붙는 연결을 찾고, 하나라도 다르면 안 찾는다. 없으면 `null`(= 말없이 만들지 않는다). 초안은 자격을 물려받고 database 만 바꾼다. (scope.selector AC-4) → `db/scope.test.ts`
- **CASE-remote-04S4** **정규화가 스키마를 안 잃는다**: 같은 이름 테이블이 두 스키마에서 와도 둘 다 살아남고(id 에 스키마 포함), 컬럼·제약이 자기 스키마 테이블에만 붙으며, 교차 스키마 FK 가 `refSchema` 를 달고 그 스키마의 테이블로 이어진다. (scope.introspection AC-3) → `remote/introspection.test.ts`
- **CASE-remote-04S5** **ERD 선이 스키마를 본다**: 교차 스키마 FK 는 `refSchema` 가 가리키는 노드로 잇고, 범위 밖 참조는 선을 안 만들며(없는 관계를 그리지 않는다), 자기참조는 이름이 아니라 대상 노드가 자기 자신인지로 가른다. (scope.model AC-5) → `remote/diagram/graph.test.ts`
- **CASE-remote-04S6** **전체 스크립트 순서가 스키마를 본다**: `refSchema` 가 가리키는 테이블을 먼저 만들고, 범위 밖 참조는 순서에 안 걸린다. (scope.model AC-5) → `workspaces/definition/schemaScript.test.ts`
- **CASE-remote-04S7** **저장 왕복**: 테이블의 스키마가 로컬 저장소를 왕복하고, 안 적은 테이블은 기본 스키마(undefined)로 돌아온다. 같은 이름 테이블이 스키마만 달리해 공존한다. 연결의 범위 목록도 왕복한다. (scope.selector AC-5/AC-6) → `main/store/stores.test.ts`
- **CASE-remote-04S9** **목록이 스키마로 묶인다**: 스키마 이름순 묶음 + 묶음 안에서 테이블/뷰 가르기. 스키마명으로도 검색되고, 검색으로 한 스키마만 남아도 머리는 계속 그린다(판정은 전체 목록 기준). 스키마가 하나뿐이면 머리를 안 그린다. (scope.display AC-1~3) → `db/tableList.test.ts`
- **CASE-remote-04SA** **범위 밖 참조 판정**: 범위 안에서 이어지면 안 잡고, 안 켠 스키마는 `addable`, 고를 수 있는 목록에 없거나 목록을 못 읽었으면 `unavailable`. 같은 대상은 카드 하나로 묶고 출발점만 쌓으며, 대상 이름순으로 정렬한다. MySQL 교차 database 도 같은 판정을 탄다. (scope.outside AC-2/AC-3/AC-5) → `remote/outsideRef.test.ts`
- **CASE-remote-04SB** **ERD 가 밖 대상을 카드로 잇는다**: 스키마 목록을 주면 밖 대상 노드(`out:<스키마>.<이름>`)를 만들고 그리로 선을 잇는다. 켤 수 없는 대상은 종류가 다르다. 스키마 목록을 안 주면 예전 그대로(카드도 선도 없음). 범위 안에서 이어지면 카드를 안 만든다. (scope.outside AC-1) → `remote/diagram/graph.test.ts`
- **CASE-remote-04S8** **실 DB**: PostgreSQL 스키마 두 개를 함께 읽고 교차 스키마 FK 가 `refSchema` 를 달고 나온다. 한쪽만 고르면 다른 쪽은 안 들어오되 FK 는 밖을 가리킨 채 남는다. MySQL 은 database 두 개를 함께 읽는다. SQLite 는 `main` 하나. (scope.introspection AC-1) → `main/services/introspection/introspection.integration.test.ts` (`INTROSPECT_IT=1`, docker 전제)

- **CASE-remote-04SC** **DDL 스키마 한정**: 스키마가 하나뿐이면 한정 이름도 `CREATE SCHEMA` 도 안 붙는다(예전 출력과 동일). 섞이면 한정 이름 + `CREATE SCHEMA IF NOT EXISTS`(MySQL 은 `CREATE DATABASE`), 기본 스키마는 안 만들고, SQLite 는 둘 다 안 붙는다. 교차 스키마 FK 는 참조도 한정 이름. (db-design.definition.sql AC-0/AC-0a) → `workspaces/definition/schemaScript.test.ts`
- **CASE-remote-04SD** **반영 계획 스키마 한정**: 스키마가 하나뿐이면 예전과 같은 계획. 섞이면 CREATE/DROP/ALTER 의 SQL 과 표시 이름이 모두 한정 이름이 되고, 스키마 이동은 `ALTER TABLE … SET SCHEMA` 로 나온다(안 내면 옛 스키마에 남는다). (db-remote.scope.model AC-5) → `migration/ddlDiff.test.ts`
- **CASE-remote-04SE** **id 중복 방지**: MySQL 은 FK 와 같은 이름의 인덱스를 함께 만든다 — 제약 id 에 종류가 들어가 둘이 안 겹친다(실측 콘솔 오류 `k:testdb.api_keys.fk_api_keys_user` 중복 회귀). (scope.introspection AC-3) → `remote/introspection.test.ts`

## Scenario S6 — Definition (순수 로직)
- **CASE-remote-050** 테이블 검색 필터: 이름/컬럼명 부분일치(대소문자 무시), 빈 질의는 전체를 원래 순서로, 매칭 없으면 빈 배열. (definition.table-list AC-2) → `console/definition/select.test.ts`
- **CASE-remote-051** 활성 테이블 해석: id 로 찾되 없으면 첫 테이블 폴백, activeId=null 도 첫 테이블, 빈 목록은 undefined. (definition.table-list AC-3)
- **CASE-remote-052** DDL 구문 강조 토큰화: 키워드/식별자/문자열/타입/숫자/주석 분류 + 무손실 분해(토큰을 이어붙이면 원문과 일치). (definition.sql AC-1) → `workspaces/definition/sqlHighlight.test.ts`
- **CASE-remote-052b** **전체 스키마 스크립트 순서**: FK 로 참조당하는 테이블이 먼저 나오고 뷰는 맨 뒤, 자기 참조·목록 밖 참조는 순서에 안 걸리며, 서로 참조하는 고리는 CREATE 에서 뺀 FK 가 끝에서 `ALTER TABLE … ADD CONSTRAINT` 로 걸린다(SQLite 는 미루지 않는다). 같은 입력이면 같은 스크립트. (db-design.definition.sql AC-1) → `workspaces/definition/schemaScript.test.ts`
- **CASE-remote-052c** **저장 파일 이름**: 테이블 범위는 테이블 이름, 전체 범위는 설계/연결 이름. 경로로 읽힐 글자(`/ : * ? " < > |`)·제어문자·앞뒤 점은 걸러지고, 다 걸러지면 기본 이름(`schema.sql`)으로 떨어진다. (db-design.definition.sql AC-3) → `workspaces/definition/sqlFile.test.ts`
- **CASE-remote-053** 편집 reducer(순수): 컬럼/제약/테이블 CRUD 가 draft 를 올바르게 변형(새 엔티티는 `new:` 접두 id). (definition.edit AC-1) → `console/schemaEdit/mutations.test.ts`
- **CASE-remote-054** 편집→DDL 통합: 신규 컬럼→`ADD COLUMN`, 기존 컬럼 변경→`MODIFY`(id 보존), 삭제→`DROP`(파괴적), 테이블 rename→`RENAME`. (definition.edit AC-2/3) → `console/schemaEdit/mutations.test.ts`
- **CASE-remote-055** Diagram FK 드래그(순수): `buildFkPatch` + addConstraint/updateConstraint → `ADD ... FOREIGN KEY (...) REFERENCES ...`. (diagram AC-3) → `console/schemaEdit/mutations.test.ts`

## Scenario S7 — Diagram 배치·그룹 (순수 로직) → `console/diagram/group.test.ts` · `console/diagram/seed.test.ts`
- **CASE-remote-055b** **사라졌다 돌아온 노드의 자리**: 화면(prev)에 없던 노드가 다시 등장하면 **저장된 자리**를 쓰고, 화면에 있는 노드는 화면 값이 이긴다(`화면 > 저장본 > 자동 배치`). 접힌 그룹을 펴거나 필터를 끄면 배치가 사라지던 회귀. (diagram.layout AC-5a) → `console/diagram/seed.test.ts`
- **CASE-remote-056** **위치 병합 저장**: 보이는 노드만 저장해도 이미 저장돼 있던 **안 보이는 노드의 위치가 남는다**. 보이는 노드는 새 값으로 갱신되고, 캔버스에서 사라진(스키마에서 없어진) 테이블만 정리된다. (diagram.layout AC-3)
- **CASE-remote-057** **그룹 영역 계산**: 소속 노드들을 여백과 함께 감싸는 사각형. 소속이 없으면 최소 크기 유지(빈 그룹도 끌어다 놓을 자리가 있어야 한다). 접힌 그룹은 상자 크기만 남는다. (diagram.group AC-6/AC-4)
- **CASE-remote-058** **소속 판정·갱신**: 노드를 놓은 자리가 어느 그룹 영역 안인지로 소속을 정하고, 겹친 그룹이 여럿이면 더 안쪽(작은) 그룹을 고른다. 어느 영역에도 안 들어가면 소속에서 빠진다. 한 테이블은 최대 한 그룹. (diagram.group AC-3)
- **CASE-remote-059** **그룹 이동 → 소속 노드 동반 이동**: 그룹 이동량(dx,dy)을 소속 노드에 그대로 더한다. 접힌 그룹은 숨은 노드에도 같은 양이 더해진다(펴면 제자리). (diagram.group AC-2/AC-4)
- **CASE-remote-05A** **접힌 그룹의 관계선**: 접힌 그룹 안팎을 잇는 관계는 그룹 상자를 끝점으로 바꿔 남기고, 그룹 **안↔안** 관계는 감춘다. 관계가 조용히 사라지지 않는다. (diagram.group AC-4)
- **CASE-remote-05B** **필터 합성**: `관계만` 과 `그룹만 보기` 를 함께 켜면 둘 다 적용된다(교집합). 어느 쪽도 안 켜면 전체. (diagram.group-panel AC-4)
- **CASE-remote-05C** **그룹 색 자동 배정**: 색을 안 고르면 순서대로 팔레트에서 돌려 쓰고, 고른 색은 그대로 지킨다. (diagram.group AC-5)
- **CASE-remote-05D** **그룹 영속 왕복**: `saveLayout`→`getLayout` 에서 그룹(이름·색·멤버십·접힘)이 보존되고, 그룹 열이 없던 옛 레코드는 빈 목록으로 읽힌다(구 데이터 호환). (diagram.group AC-7) → `main/store/stores.test.ts`
- **CASE-remote-05E** **손으로 정한 상자 크기**: 크기가 있으면 소속을 멀리 옮겨도 그 자리·크기를 지키고, 최소 크기 아래로는 안 내려가며, **접힘이 손 크기보다 우선**한다. (diagram.group AC-6a)
- **CASE-remote-05G** **동반 삭제 확인 문구**: `{N}개 테이블도 함께 삭제합니다` 를 개수에 맞게 만들고, 그대로 입력해야 통과한다(앞뒤 공백만 허용). 개수가 다르거나 글자가 어긋나면 막는다. (diagram.group-panel AC-2c)
- **CASE-remote-05F** **그룹 기준 자동 배치**: 묶음을 안 주면 예전 배치와 **완전히 같고**, 주면 같은 묶음 노드가 서로 더 붙는다. 묶음에 없는 노드가 섞이거나 없는 노드를 가리켜도 안 터지고 좌표는 실제 노드에만 나온다. (diagram.layout AC-4a) → `console/diagram/layout.test.ts`

## Scenario S8 — 권한(Grant) 읽기·층 판정 (순수 로직)
- **CASE-remote-070** MySQL 원시 → 권한 IR 정규화: `SHOW GRANTS` 문자열·계정 카탈로그 행을 중립 IR(계정×객체×권한×층)로 편다. `*.*` 는 전역 층, `` `db`.* `` 는 DB 층, `` `db`.`t` `` 는 테이블 층. `ALL PRIVILEGES` 는 낱권한으로 전개, 이름 안의 백틱 이스케이프를 되돌리고, 계정은 `user@host` 짝으로 정규화. `USAGE` 만 있는 계정은 권한이 비되 **계정 자체는 사라지지 않는다.** (grants.vendor AC-1/AC-3) → `main/services/grants/mysql.test.ts`
- **CASE-remote-071** PostgreSQL ACL → 권한 IR 정규화: `pg_roles`·aclitem(`grantee=arwd/grantor`)을 IR 로. 문자 코드 매핑(r=SELECT·a=INSERT·w=UPDATE·d=DELETE), `PUBLIC`(빈 grantee) 경유 권한, **ACL 이 NULL 인 표는 "권한 없음"이 아니라 소유자 기본권한**, 스키마 한정 이름 보존, role 소속은 이름 나열까지(전개 없음). (grants.vendor AC-1/AC-3/AC-3a) → `main/services/grants/pg.test.ts`
- **CASE-remote-072** 층 합성(유효 권한): 전역/DB/테이블 층에서 온 권한이 한 객체의 유효 권한으로 합쳐지고 **권한마다 출처 층이 남는다.** 같은 권한이 여러 층에서 오면 출처를 **전부** 보존한다 — 한 층만 회수하고 "왜 아직 되지" 하는 미궁 방지가 이 표시의 존재 이유. 아무 층에도 없으면 유효 권한에도 없다. (grants.privileges AC-2) → `remote/grants/effective.test.ts`
- **CASE-remote-073** 못 보는 계정(가짜 연결 라우터 — `introspection/mysql.test.ts` 패턴): 계정 카탈로그(mysql.user 계열·pg_roles)가 안 보이는 일반 계정에서 오류로 죽지 않고 **자기 권한만** 담아 성공으로 돌아오며, warnings 에 사유가 남는다. 실패의 두 형태(**빈 결과 · 권한 오류**) 모두 같은 답이어야 한다(introspection 에서 둘 다 겪었다). 관리자 계정이면 전 계정 + warnings 빈 배열. (grants.accounts AC-1/AC-2 · grants.vendor AC-2) → `main/services/grants/mysql.test.ts` · `main/services/grants/pg.test.ts`

## Scenario S8b — 권한 세트·대조·문장 생성 (순수 로직 + 저장소)
- **CASE-remote-074** 세트 저장소 왕복: 세트(이름 + 테이블 이름/패턴 × 권한들)의 저장→목록→이름 수정→삭제. 스키마에 **연결 참조 자체가 없고**, **연결을 지워도 세트가 남는다(회귀 — 재활용 동기의 핵심)**. (grants.sets AC-1/AC-2/AC-3) → `main/store/stores.test.ts`
- **CASE-remote-075** 패턴 전개: `pokemon_*` 가 실제 테이블 목록에서 접두 일치로 전개된다. `*` 없는 항목은 정확 일치, `스키마.` 한정 허용. **매칭 0개 패턴은 빈 전개로 남되 조용히 사라지지 않는다**(대조가 "매칭 없음"을 보일 재료). 정규식 특수문자가 든 테이블 이름에 오작동하지 않는다. (grants.sets AC-5) → `remote/grants/pattern.test.ts`
- **CASE-remote-076** 세트↔계정 대조(diff): 모자람(세트에 있는데 계정에 없음)과 넘침(계정에 있는데 세트에 없음)을 가른다. **양쪽 개수를 항상 함께 돌려준다** — 기대 0 · 실측 0 은 "일치"가 아니라 **"아무것도 대조되지 않음"**(FK 사건 교훈: 0=0 거짓 통과 금지). 패턴 전개를 거친 뒤 대조하고, 판정 기준은 **유효 권한**이다(테이블에 직접 없어도 전역·DB 층에서 오면 모자람이 아니다). 넘침의 출처가 위층이면 REVOKE 후보로 만들지 않는다. (grants.diff AC-2/AC-3/AC-5/AC-6) → `remote/grants/diff.test.ts`
- **CASE-remote-077** GRANT/REVOKE 문장 생성: diff → 벤더별 문장. MySQL 은 백틱 + `'u'@'h'`, PG 는 큰따옴표 식별자 + 역할 이름 — 식별자·계정 인용이 벤더 규칙을 지킨다. 모자람 → GRANT, 넘침 → REVOKE 인데 **REVOKE 는 기본 제외**(옵션을 켠 때만 나온다). 미리보기와 실행이 **같은 함수의 출력**을 쓴다(미리보기≠실행 어긋남 방지). diff 가 비면 문장도 없다. (grants.apply AC-1/AC-2/AC-4) → `main/services/grants/statements.test.ts`
- **CASE-remote-078** 접속 계정 자기 회수 차단(코드 레벨): 지금 접속 중인 계정을 겨눈 REVOKE 는 REVOKE 옵션을 켜도 생성·실행 목록에서 빠지고 **차단 사유가 결과에 남는다**(조용히 빠지면 사용자가 "왜 안 됐지"를 못 푼다). 자기 자신에게 GRANT 는 허용. 동일성 판정은 MySQL 은 `user@host` 짝, PG 는 역할 이름. (grants.apply AC-3/AC-3a) → `main/services/grants/statements.test.ts`

## Scenario S8c — 권한 실 DB (통합)
- **CASE-remote-079** 실 DB 왕복: docker test-db 의 MySQL·PostgreSQL 에서 관리자 계정으로 계정×객체×권한×층 IR 이 나오고, 제한 계정으로는 자기 권한만 + "못 본다" 경고. GRANT 적용 → 재조회에 반영, REVOKE(옵션 켬)도 반영 — **미리보기 문장과 실행 결과가 일치**. 끝나면 원복. (grants.vendor AC-1 · grants.apply AC-4) → `main/services/grants/grants.integration.test.ts` (`GRANTS_IT=1` — `INTROSPECT_IT` 패턴, docker 전제)

## Scenario S9 — 권한 탭 앱 흐름 (e2e/suites/53-db-grants.mjs, CSS/text 로케이터만 · 실행은 사용자 지시 시)
- **CASE-remote-07A** 탭 진입·현황: Remote 에 Grant 탭이 있고, 관리자 연결에서 좌측에 계정 목록이 뜬다. 계정을 고르면 우측에 DB 그룹별 객체×권한 표와 **층 배지**(전역/DB/테이블). SQLite 연결에서는 본문이 `SQLite — 권한 개념 없음` 한 줄. (grants.accounts AC-1 · grants.privileges AC-1/AC-2 · grants.vendor AC-4)
- **CASE-remote-07B** 못 보는 계정 표시: 제한 권한 계정 연결로 진입하면 계정 목록 자리가 **오류가 아니라 경고 줄**("계정 목록을 읽을 권한이 없습니다 …")로 보이고, 자기 계정의 권한 표는 그대로 뜬다. `계정 없음` 표기는 나오면 안 된다. (grants.accounts AC-2)
- **CASE-remote-07C** 세트 저장: 현황에서 계정의 권한을 떠 이름 붙여 저장 → 세트 목록에 뜨고, 골라 열면 내용(패턴×권한)이 보인다. (grants.sets AC-3/AC-4)
- **CASE-remote-07D** 대조 표시: 세트를 골라 계정과 대조 → 모자람·넘침이 **갈라** 보이고 **양쪽 개수**가 함께 적힌다. 일부러 권한 하나를 빼 둔 픽스처 계정으로 모자람이 실제로 잡히는지 보고, "일치"와 "아무것도 대조되지 않음"이 다른 표기로 보인다. 새로고침하면 다시 계산된다. (grants.diff AC-2/AC-3)
- **CASE-remote-07E** 적용 안전장치(미리보기까지): 대조에서 적용 바를 열면 **문장 미리보기가 먼저** 뜨고, REVOKE 토글은 기본 꺼짐이며, 승인 전에는 실행이 일어나지 않는다 — 취소로 닫고 재조회해 무변화 확인. (grants.apply AC-1/AC-2)
  > **미검증(의도적)**: 승인→실제 실행의 앱 흐름은 e2e 로 안 덮는다. e2e 스모크 DB 의 권한을 바꾸면 뒤 스위트가 기대하는 픽스처 권한이 오염된다. 실행의 정확성은 CASE-remote-077(문장)·078(차단)·079(실 DB 왕복, 원복 포함)가 고정한다. 전제: e2e 픽스처가 계정 권한을 불변 전제로 쓰는 동안 유효.
