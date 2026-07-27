# TestPlan: db-studio (Studio › Definition 뷰 선언 · 공용 사이드 패널 · Seed 시드 세트 저작 + 버전 Diff)

> 정의(무엇을 검증하나)만 여기. 코드는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 흐름 `e2e/flows/<서비스>.mjs`.
> 회차 기록은 `docs/qa/runs/`. 명세 정본: `docs/spec/db-studio.md`.

## Scenario S1 — 세트 선언 판정 (순수 로직) → `services/db/workspaces/seed/seedSet.test.ts`
- **CASE-studio-001** 짝짓기 기준 기본값: PK 컬럼들을 기본값으로 주되, PK 가 자동증가(`AUTO_INCREMENT`·`serial`·`identity`)면 빈 배열을 준다. PK 가 복합이면 전부, PK 가 없으면 빈 배열. (declaration AC-1)
- **CASE-studio-002** 컬럼 역할 3상태: 한 컬럼은 `짝짓기`/`포함`/`무시` 중 정확히 하나이고, 토글은 `짝짓기 → 포함 → 무시 → 짝짓기` 로 돈다. 짝짓기와 무시에 동시에 들어가지 않으며(상호 배타), 짝짓기로 켜는 순서가 키 구성 순서다. 다른 컬럼의 역할은 건드리지 않는다. 무시 컬럼 감추기(`visibleSeedColumns`)는 꺼져 있으면 컬럼 목록을 **그대로**(같은 배열) 주고, 켜면 무시 컬럼만 순서 유지로 빼며 **선언은 건드리지 않는다**. 무시 컬럼이 없으면 켜도 변화가 없고, 전부 무시면 빈 목록이다. (declaration AC-3 / grid AC-1/AC-9)
- **CASE-studio-003** 세트 완전성 판정: 짝짓기 기준 없는 세트는 `비교 불가`로, 있는 세트는 정상으로 분류한다. (set-list AC-5 / declaration AC-2)
- **CASE-studio-004** 세트 등록 후보: 이미 세트가 있는 테이블과 뷰(`isView`)를 후보에서 제외한다. 후보가 없으면 빈 목록. (set-list AC-2)

- **CASE-studio-008** 짝짓기 기준 UNIQUE 뒷받침 판정: 짝짓기 기준과 **정확히 같은 구성**의 PK/UK 가 있으면 뒷받침됨(컬럼 순서 무시). 부분집합·상위집합·IDX(유일하지 않은 인덱스)는 인정하지 않는다. 제약이 없거나 짝짓기 기준 미선언이면 뒷받침 아님. (declaration AC-6)
- **CASE-studio-005** 시드가 채워야 하는 컬럼 판정: NOT NULL + 기본값 없음 + 자동증가 아님 → `필수`. NULL 허용·기본값 있음·자동증가는 제외. 공백만인 기본값은 "없음"으로 본다. (grid AC-8)
- **CASE-studio-006** 컬럼 머리 배지: PK/FK/UK/IDX 를 텍스트로, 복합 제약은 위치 번호(`UK1`·`UK2`), CHECK 참여 컬럼은 `CHK`, 타입 라벨은 소문자 정리, 컬럼 순서 유지. (grid AC-7)
- **CASE-studio-007** 컬럼 상세(툴팁): 타입·NULL 여부·기본값(또는 자동증가)·필수 여부·FK 참조 대상과 정책·CHECK 식·설명을 담는다. (grid AC-7) → `services/db/workspaces/seed/columnHint.test.ts`

## Scenario S2 — 행 저작 판정 (순수 로직) → `services/db/workspaces/seed/seedRows.test.ts`
- **CASE-studio-010** 짝짓기 기준 값 만들기: 여러 컬럼을 선언 순서대로 이어 하나의 키로 만들고, NULL 과 빈 문자열을 다르게 취급한다. (grid AC-3)
- **CASE-studio-011** 중복·빈 짝짓기 기준 값 검출: 같은 키를 가진 행들을 모두 오류로 지목하고, 키 컬럼이 빈 행도 오류로 지목한다. 정상 행은 오류가 없다. (grid AC-3)
- **CASE-studio-012** 변수 자리표시자 추출: bare `{{X}}` 만 변수로 뽑고 `'{{X}}'`(따옴표 안)는 제외. 여러 행·여러 컬럼에서 뽑은 뒤 중복 제거·이름순. 변수가 없으면 빈 목록. (variables AC-1/AC-2)
- **CASE-studio-014** 필수 컬럼 빈 셀: NOT NULL·기본값 없는 컬럼이 NULL·빈 문자열·공백이면 그 행과 컬럼을 지목한다. 변수 자리표시자는 채운 것으로 본다. 필수 컬럼이 없으면 아무것도 지목하지 않는다. (grid AC-8)
- **CASE-studio-013** 행 짝짓기: 짝짓기 기준으로 두 시드 목록의 행을 짝지어 `양쪽/왼쪽만/오른쪽만` 으로 가른다. 키 컬럼 선언이 다르면 비교하지 않는다. (version-diff AC-3)

## Scenario S2b — 참조·별칭 판정 (순수 로직) → `services/db/workspaces/seed/seedRef.test.ts`
- **CASE-studio-060** 참조 표기 읽기·쓰기: `@테이블#별칭` 을 읽고, `formatSeedRef` 와 짝이 맞는다(되먹임에서 같은 규칙으로 되돌림). `@@` 는 리터럴 탈출이고 반영 시 `@x` 로 되돌린다. 규칙 불일치는 참조가 아니지만 "참조처럼 보인다"로 잡는다. 셀 키는 세트·행·컬럼을 가른다. (reference AC-2/AC-4)
- **CASE-studio-061** 기본 별칭: 짝짓기 기준 값에서 슬러그 생성(`admin@acme.com` → `admin-acme-com`), 연속·앞뒤 구분자 정리, 쓸 글자 없으면 빈 문자열. (reference AC-3)
- **CASE-studio-062** 별칭 검증: 빈 별칭은 오류 아님, 겹치면 양쪽 다 지목, 형식 위반 지목. (reference AC-1)
- **CASE-studio-063** 참조 검증: 정상 통과 · 세트 없는 테이블 · 없는 별칭 · FK 아닌 컬럼 · **FK 가 가리키는 테이블과 불일치** · 표기 오타 · `@@` 리터럴 제외. (reference AC-5)
- **CASE-studio-064** 순환 참조: 없으면 빈 목록, 서로 가리키면 순환으로 잡고, 자기 참조도 순환, 같은 순환을 두 번 보고하지 않고, 끊긴 참조는 순환을 만들지 않는다. (reference AC-6)
- **CASE-studio-065** 짝짓기 기준 자격·반영 준비: DB 가 만드는 값(자동증가·`uuid()`·`now()` 류)은 기준이 될 수 없고 이유를 문장으로 알린다. 역할 순환이 `짝짓기` 를 건너뛴다. 기준에 안정 컬럼이 0개면 `반영 불가`(`no-key`·`volatile-key`·`missing-table` 구분). (declaration AC-8/AC-9)

## Scenario S3 — 시드 Diff (순수 로직) → `services/db/versions/seedDiff.test.ts`
- **CASE-studio-020** 세트 단위 차이: 세트 추가·삭제를 잡는다. 양쪽에 다 있는 세트는 행 비교로 내려간다. (version-diff AC-3)
- **CASE-studio-021** 행 단위 차이: 행 추가·삭제·값 변경(어느 컬럼이 무엇에서 무엇으로)을 잡는다. (version-diff AC-3)
- **CASE-studio-022** 무시 컬럼 제외: 무시 컬럼 값만 다른 행은 차이가 아니다. (version-diff AC-3)
- **CASE-studio-023** 변수 이름 비교: 같은 변수 이름끼리는 차이가 아니고, 변수 이름이 바뀌면 차이다. (variables AC-3)
- **CASE-studio-024** 선언 변경: 짝짓기 기준·무시 컬럼·`설계에 없는 행` 처리 변경을 차이로 잡는다(차이 라벨도 화면과 같은 말: `설계에 없는 행  그대로 둠 → 삭제 후보`). (version-diff AC-4)
- **CASE-studio-025** 옛 스냅샷 폴백: `seeds` 없는 스냅샷을 빈 목록으로 읽어 비교가 깨지지 않는다. 한쪽만 시드가 있으면 전부 추가/삭제로 잡힌다. (version-diff AC-2)
- **CASE-studio-026** 짝짓기 기준 없는(또는 양쪽 선언이 다른) 세트: 행을 짝짓지 않고 `비교 불가`로 표시한다. 행 개수/값이 실제로 다르면 **침묵하지 않고** 그 세트를 변경으로 올린다(행 delta 는 비우고). 내용이 완전히 같으면 조용하다. 행 로컬 id 차이는 차이가 아니다. (declaration AC-2 / version-diff AC-3b)
- **CASE-studio-027** 요약 집계: 스키마 변경이 0 이고 시드 변경만 있을 때 "변경 없음"이 되지 않는다. (version-diff AC-5)

## Scenario S4 — 저장 계층 (임시 SQLite) → `src/main/store/stores.test.ts`
- **CASE-studio-030** 시드 세트 라운드트립: 선언(짝짓기 기준·무시 컬럼·`설계에 없는 행` 처리)과 행이 저장→조회에서 보존된다. (persistence AC-1/AC-2)
- **CASE-studio-031** 설계 스코프 교체: 설계 X 의 세트를 저장해도 설계 Y 의 세트가 남는다. (persistence AC-1)
- **CASE-studio-032** MCP 커버리지: 새 IPC 채널이 노출 또는 제외 사유로 등재돼 `coverage.test.ts` 가 통과한다. (persistence AC-3) → `src/main/ai/coverage.test.ts`

## Scenario S5 — 앱 구동 흐름 (e2e/flows/db.mjs, CSS/text 로케이터만)
- **CASE-studio-040** Studio › Seed 진입 → 시드 세트 없을 때 빈 상태 CTA 표시. (set-list AC-4)
- **CASE-studio-041** 테이블에서 세트 등록(후보에 뷰 없음 — 앞서 만든 설계 뷰가 후보에 안 뜬다) → **자동증가 PK 라 짝짓기 경고** → 컬럼당 역할 토글 **1개**로 `포함 → 무시 → 짝짓기` 순환해 기준 지정 → 경고 해제 → 무시 컬럼 지정 → 행 추가·값 입력 → 목록에 행 수 반영. (set-list AC-1/AC-2/AC-5, declaration AC-1/AC-2/AC-3, grid AC-1/AC-2)
- **CASE-studio-042** 중복 짝짓기 기준 값 입력 → 두 행 모두 오류 표시, 값을 바꿔 해소하면 오류 사라짐. (grid AC-3)
- **CASE-studio-042b** 컬럼 머리에 제약이 보인다(`PK` 배지 · `필수` 배지) + 필수인데 빈 셀이 있는 행이 표시되고, 값을 채우면 표시가 풀린다. (grid AC-7/AC-8)
- **CASE-studio-041b** 짝짓기 기준이 UNIQUE 로 뒷받침되면 안내가 없고, UNIQUE 없는 구성으로 바꾸면 UPSERT 불가 안내가 뜬다. (declaration AC-6)
- **CASE-studio-042c** 별칭 입력 → 참조 표기(`@테이블#별칭`) 입력 시 참조 표식이 붙고, 깨진 참조·관계 불일치는 오류로 표시된다. (reference AC-1/AC-5/AC-7)
- **CASE-studio-042d** PK 생성 규칙 고르기: `DB 가 만든다` 면 줄이 없고, `시드가 정한다` 로 바꾸면 규칙 목록이 나온다. **숫자 PK(`orders.id` BIGINT)에는 문자열 규칙이 목록에 없다** — `셀에 직접 쓴 값` + `직접 입력…` 둘뿐. 규칙이 비면 미리보기가 `값 없음`(반영 막힘)을 알린다. `직접 입력…` 을 고르면 자유 입력칸과 조각 칩 4개가 열리고, 칩을 누르면 규칙 끝에 붙으며 미리보기가 결과로 바뀐다. 그 경로에서만 오타 자리표시자 · **타입 불일치**(숫자 PK 에 `{uuid}`) · **상수 규칙**(전 행 같은 PK — 행마다 달라지는 규칙으로 바꾸면 해제)을 알린다. `DB 가 만든다` 로 되돌리면 줄이 사라진다. (apply-contract AC-2a)
- **CASE-studio-042g** 규칙 목록의 타입 필터링 반대쪽: `roles.id` 가 `char(36)` 인 설계에서는 `{uuid}` 를 고를 수 있고, 고르면 미리보기가 UUID 모양 값을 보이며 타입 경고가 없다. (apply-contract AC-2a)
- **CASE-studio-042e** 행 삭제 버튼이 **호버 없이** 보인다 — Console › Data 와 같은 자리(행번호 옆 고정 칸)·같은 표기. (grid AC-1)
- **CASE-studio-042f** 무시 컬럼 감추기: 무시 컬럼이 있으면 토글이 나오고, 켜면 그 컬럼 머리가 표에서 빠진다(컬럼 수 −1). 감춰도 **선언은 그대로**다 — 선언 바의 무시 **개수**가 유지되고 컬럼 이름은 설명(마우스 올림)에 남는다. 다시 끄면 컬럼 수가 원복된다. (grid AC-9/AC-10)
- **CASE-studio-043** 셀에 `{{ADMIN_PASSWORD_HASH}}` 입력 → 변수 표식 + 세트 머리의 변수 목록에 등장. (variables AC-1/AC-2)
- **CASE-studio-044** 저장소(`seedSets.list`)에 선언·행 반영 + **콜드 재시작**(앱 종료→재기동) 후 세트·행·변수 잔존. (persistence AC-1/AC-2)
- **CASE-studio-044b** `설계에 없는 행` 을 `삭제 후보` 로 고르면 그 뜻을 경고로 보인다. (declaration AC-4)
- **CASE-studio-045** 시드를 담아 버전 컷 → 타임라인에 시드 행 수 표시 + Versions › Version Diff 에 시드 섹션(시드 없던 옛 버전과 비교 → 세트/행 추가) 표시. (version-diff AC-1/AC-2/AC-3/AC-5) — 행 값 변경 케이스는 단위테스트 CASE-studio-021 이 덮는다.

## Scenario S6 — 뷰 선언 (Studio › Definition) → `services/db/workspaces/definition/ddl.test.ts` · `versions/diff.test.ts` · `main/store/stores.test.ts`
- **CASE-studio-050** 뷰 DDL: `isView` 인 대상은 `CREATE TABLE` 이 아니라 `CREATE VIEW … AS <본문>` 으로 나온다. `OR REPLACE` 는 MySQL·MariaDB·PostgreSQL 에만 붙고 SQLite 에는 안 붙는다. PostgreSQL 은 설명을 `COMMENT ON VIEW` 로 따로 낸다. (definition.view AC-5)
- **CASE-studio-051** 뷰 DDL 경계: 본문 끝 세미콜론이 겹치지 않고, 본문이 비면 무엇이 비었는지 알리되 DDL 구조는 깨지지 않는다. 뷰 이름도 식별자 인용을 탈출하지 못한다(주입 방어). (definition.view AC-5)
- **CASE-studio-052** 뷰 Diff: 테이블 ↔ 뷰 전환과 본문(`viewSql`) 변경을 각각 차이로 잡고, 안 바뀌면 조용하다. (definition.view AC-6)
- **CASE-studio-053** 뷰 저장 왕복: `viewSql` 이 저장→조회에서 보존되고, 뷰가 아닌 테이블은 빈 문자열로 정규화된다. (definition.view AC-6)

## Scenario S7 — 공용 사이드 패널·뷰 선언 앱 흐름 (e2e/flows/db.mjs)
- **CASE-studio-060** Studio › Definition 사이드 패널 `제약` 탭: 테이블별 그룹과 제약 행이 뜨고, 종류 필터(FK)가 다른 종류를 걸러내며, 제약을 누르면 그 테이블로 이동한다. (definition.side-panel AC-2/AC-3)
- **CASE-studio-061** 사이드바 `+` → `뷰 추가` → 뷰 배지가 뜨고 제약 구역이 사라지며 본문 SELECT 편집기가 나타난다. 목록이 테이블/뷰로 갈린다. (definition.view AC-1/AC-3/AC-4, definition.side-panel AC-2)
- **CASE-studio-062** 본문 SELECT 를 쓰면 SQL 폼이 `CREATE OR REPLACE VIEW` + 그 본문을 내고 `CREATE TABLE` 은 내지 않는다. 뷰 표식·본문이 로컬 저장소까지 왕복한다. (definition.view AC-5/AC-6)

## Scenario S6 — 반영 계획 (순수 로직) → `services/db/workspaces/seed/seedApplyPlan.test.ts`
- **CASE-studio-070** 없는 행은 INSERT — 값은 파라미터 바인드(문자열 조립 금지), DB 생성 PK 는 담지 않는다. (apply-contract AC-1/AC-2)
- **CASE-studio-071** 있는 행은 다른 값만 UPDATE, WHERE 는 **짝짓기 기준**(PK 아님). 값이 같으면 문장 없음. 무시 컬럼 제외. DB 가 숫자로 준 값도 문자열 시드 값과 같게 본다. (apply-contract AC-1)
- **CASE-studio-072** 변수 치환: 환경 값으로 바꾸고, 값이 없으면 막는다. (apply-contract AC-9)
- **CASE-studio-073** 참조 해석: 실 DB 에 있으면 그 환경의 실제 PK, 없으면 시드가 정하는 PK 로 계산. DB 생성 PK 면 막고 무엇을 바꿔야 하는지 알린다. 대상 테이블이 먼저 실행되고(위상정렬), 순환은 막는다. (apply-contract AC-5)
- **CASE-studio-074** PK 방어선: 시드 PK 를 이미 다른 행이 쓰면 중단. 기존 행의 PK 가 설계와 달라도 바꾸지 않고 알린다. "시드가 정한다"인데 값·규칙이 없으면 막는다. **시드 행끼리** 같은 PK 를 만드는 것도 막는다 — 상수 규칙(`u-fixed`)이든 셀에 같은 값을 두 번 썼든 겹친 행만 빼고 앞선 행은 그대로 두며, 행마다 달라지는 규칙에는 오탐이 없다. (apply-contract AC-3/AC-4/AC-4b)
- **CASE-studio-075** 삭제 후보: 전권 세트에서 실 DB 에만 있는 행을 후보로. 보장만 세트는 만들지 않는다. (declaration AC-4)
- **CASE-studio-076** 전제 미충족: 짝짓기 기준 없음·기준 값 빈 행을 막는다. (declaration AC-9)
- **CASE-studio-077** 결정적 PK: 같은 입력 → 같은 UUID, 형태·버전 자리 검증, 씨앗은 설계·테이블·행 정체성, 템플릿 자리표시자 펼치기(모르는 것은 남긴다). (apply-contract AC-2) → `services/db/workspaces/seed/seedPk.test.ts`
- **CASE-studio-077b** 규칙 미리보기: 값이 어느 컬럼에 들어가는지와 그 값을 돌려주되, **반영 계획과 같은 값**이어야 한다. 규칙이 있으면 규칙(셀 값을 이긴다), 없으면 셀 값, 둘 다 없으면 `없음`(반영이 막히는 상태). 복합 PK 는 첫 컬럼만 규칙. PK 없는 테이블·`DB 가 만든다` 면 보여줄 것 없음. (apply-contract AC-2a)
- **CASE-studio-077c** 모르는 자리표시자 검출: `{uuidd}` 같은 오타를 골라내고(중복은 한 번만), 아는 네 개는 통과. 화면 안내 목록과 판정이 갈라지지 않는다. (apply-contract AC-2a)
- **CASE-studio-077e** 규칙 고르기 목록: 숫자·날짜·불리언·JSON PK 는 `셀 값` 하나만, `char(36)` 은 `{uuid}` 포함 전부, 36자보다 짧은 문자 PK 는 `{uuid}` 만 빠지고, 길이 선언 없는 `text` 는 `{uuid}` 허용. 컬럼을 모르면 셀 값만. **목록에 나오는 규칙은 전부 행마다 값이 달라진다.** (apply-contract AC-2a)
- **CASE-studio-077f** 상수 규칙 판정: `{uuid}`·`{key}`·`{alias}` 중 하나라도 있으면 행마다 달라지고, `{table}` 만이거나 리터럴이면 안 달라진다(전 행 같은 PK). (apply-contract AC-2a/AC-4b)
- **CASE-studio-077d** PK 값 타입 판정: 숫자 컬럼에 숫자 아닌 값(대표 사고 — `bigint` PK 에 `{uuid}`)과 선언된 길이 초과를 잡는다. `char(36)`+UUID 는 딱 맞아 오탐 없음, `decimal(12,2)` 의 괄호를 길이로 오독하지 않음, 길이 선언 없는 `text` 와 변수 `{{이름}}` 은 판정하지 않는다. (apply-contract AC-2a)

## Scenario S7 — 되먹임 계획 (순수 로직) → `services/db/workspaces/seed/seedImportPlan.test.ts`
- **CASE-studio-080** 실 DB 에만 있는 행 → 새 후보 + 별칭 제안. DB 생성 PK·무시 컬럼은 담지 않는다. (apply-contract AC-6)
- **CASE-studio-081** 값이 다른 행 → 변경 후보(무엇이 어떻게 다른지). 같으면 후보 아님. (apply-contract AC-6)
- **CASE-studio-082** 설계에만 있는 행은 사실 보고(채택 대상 아님). (db-migration.seed AC-4)
- **CASE-studio-083** FK 값을 참조 표기로 되돌린다. 되돌릴 근거가 없으면 원값을 두고 **알린다**. (apply-contract AC-6/AC-7)
- **CASE-studio-084** 준비 안 된 세트는 가져오지 않고 이유를 남긴다. (declaration AC-9)

## Scenario S8 — 실 DB 반영·되먹임 (e2e/flows/db.mjs · 실 MySQL)
- **CASE-studio-090** 역설계로 들여온 설계에 `roles` 시드 세트 등록 → 짝짓기 기준(name) 지정 → UNIQUE 뒷받침 안내 없음. (declaration AC-6/AC-8)
- **CASE-studio-091** Migration › Seed 계획: 넣기 1개, 막는 것 0개. (db-migration.seed AC-2)
- **CASE-studio-092** 적용 → **커밋 전에는 실 DB 에 없고**, 커밋 후 심어진다. 재계획 시 할 일 없음(멱등). (db-migration.seed AC-3)
- **CASE-studio-093** 실 DB 에서 값을 바꾼 뒤 되먹임 → `값이 다름` 후보 → 채택 → 설계 시드에 담긴다. (db-migration.seed AC-4)
- **CASE-studio-094** 검사 후 심은 행을 지워 테스트 DB 를 원복한다(누적 자산이 DB 를 더럽히지 않는다).
