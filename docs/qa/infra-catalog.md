# TestPlan: infra-catalog (카탈로그 · 탐침 · 공급자 연결)

> 정의(무엇을 검증하나)만 여기. 코드는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 흐름 스위트 `e2e/suites/NN-*.mjs`.
> 명세 정본: `docs/spec/infra-catalog.md`.

## Scenario S1 — 카탈로그 형식 검증 (순수 로직) → `services/infra/catalog/schema.test.ts`
- **CASE-icat-001** 정상 카탈로그를 통과시키고 파싱 결과에 노드 종류가 다 담긴다. (types.definition AC-1)
- **CASE-icat-002** `canNestIn`/`canLinkTo` 가 **없는 종류**를 가리키면 실패하고 어느 필드인지 알린다. (types.definition AC-2)
- **CASE-icat-003** 자격증명 **값이 박힌** 카탈로그를 거부한다 — 참조(`{{cred.x}}`)만 통과. (공통 불변식)
- **CASE-icat-004** 앱이 아는 것보다 높은 `schemaVersion` 은 **부분 적재 없이 통째로 거부**. (registry.sources AC-4)
- **CASE-icat-005** 탐침 없는 종류(프리셋)도 유효하다. (types.definition AC-3)
- **CASE-icat-006** 내보내기 직전 검사: 결과 JSON 어디에도 자격증명 값이 없다. (registry.export AC-1)
- **CASE-icat-007** 검증 실패는 전부-실패다 — 실패한 파일에서 일부 종류만 살아남지 않는다. (registry.import AC-3)
- **CASE-icat-008** `canContain` 이 없는 종류를 가리키면 실패하고, `"*"` 는 통과한다. (types.definition AC-2/AC-5)

## Scenario S1b — 사용자 카탈로그 만들기 (순수 로직) → `services/infra/catalog/userCatalog.test.ts`
- **CASE-icat-090** 새 사용자 카탈로그는 만들자마자 형식 검증을 통과한다. 종류 0개·공급자 id 빈 값은 거부. (probe.editor AC-6)
- **CASE-icat-091** 종류 추가는 뒤에 붙고, 같은 id 는 **자리를 지키며** 덮어쓴다(목록 순서 불변). (probe.editor AC-6)
- **CASE-icat-092** 내장 카탈로그 복제 — 내용은 그대로, 공급자 id 만 새로. (registry.sources AC-3)
- **CASE-icat-093** 가져오기 승인용 "실행될 명령" 목록 — 탐침·액션 모두, 위험 표시 포함, 프리셋은 0건. (registry.import AC-1)

## Scenario S2 — 표현식·옮기기 (순수 로직) → `services/infra/catalog/extract.test.ts`
- **CASE-icat-010** 단순 경로로 목록·id·이름·상태를 뽑는다. (probe.shape AC-3/AC-4)
- **CASE-icat-011** 배열 속 조건부 값(`tags[?key=='name'].value | [0]`)을 뽑는다 — 점 표기로는 못 하는 경우. (probe.shape AC-3)
- **CASE-icat-012** 접두어 없는 표현식은 JMESPath 로 읽는다(기본값). 모르는 접두어는 오류. (probe.shape AC-3)
- **CASE-icat-013** `externalId` 가 비면 그 항목은 노드로 만들지 않고 **왜 버렸는지 남긴다**(조용한 누락 금지). (probe.shape AC-4)
- **CASE-icat-014** `parentExternalId` 로 부모-자식이 이어지고, 부모가 목록에 없으면 최상위로 둔다(노드 증발 금지). (probe.shape AC-4)
- **CASE-icat-015** 표현식 평가에 임의 코드 실행 경로가 없다 — 코드처럼 생긴 입력이 평가되지 않는다. (probe.shape AC-6)
- **CASE-icat-016** 한글·하이픈 키는 따옴표로 감싸야 읽힌다 — `pathToExpr` 가 대신 처리한다. (probe.editor AC-2)
- **CASE-icat-017** `ndjson`(줄마다 JSON)을 배열로 묶어 읽는다. 깨진 줄은 몇 번째 줄인지 알린다. (probe.shape AC-7)
- **CASE-icat-018** 통짜 JSON 이 아닌 출력에 "줄마다 JSON 이면 ndjson 으로 두세요"를 안내한다. (probe.shape AC-7)

## Scenario S3 — 상태 사전 (순수 로직) → `services/infra/catalog/status.test.ts`
- **CASE-icat-020** 사전에 있는 값은 정상/주의/멈춤/없어짐으로 옮겨진다. (probe.shape AC-5)
- **CASE-icat-021** **사전에 없는 값은 '모름'** 이고 원본 문자열이 함께 보존된다 — 정상으로 치지 않는다. (probe.shape AC-5)
- **CASE-icat-022** 상태 필드 자체가 없으면 '모름'. 빈 문자열도 '모름'. (probe.shape AC-5)

## Scenario S4 — 아이콘 참조 (순수 로직) → `services/infra/catalog/icon.test.ts`
- **CASE-icat-030** 세 접두어(`phosphor:` · `pack:` · `data:`)를 각각 갈라 푼다. (types.icons AC-1)
- **CASE-icat-031** 모르는 접두어·없는 이름은 **기본 아이콘으로 떨어지고 경고를 남긴다**(예외를 던져 그림을 깨뜨리지 않는다). (types.icons AC-2)
- **CASE-icat-032** 빌드용 수집기: 카탈로그·프리셋을 훑어 실제 쓰인 아이콘 이름만 모은다(중복 제거·미사용 제외). (types.icons AC-4)

## Scenario S5 — 명령 조립 (순수 로직) → `src/main/ipc/infra/command.test.ts`
- **CASE-icat-040** `{{cred.*}}`·`{{node.*}}` 치환이 **인자 배열의 한 칸 안에서만** 일어난다. (probe.execution AC-1)
- **CASE-icat-041** 치환값에 공백·따옴표·세미콜론·`&&` 가 있어도 인자가 쪼개지거나 명령이 추가로 실행되지 않는다. (probe.execution AC-1)
- **CASE-icat-042** 정의되지 않은 자리표시자는 치환하지 않고 **오류로 세운다**(빈 문자열로 밀어 넣지 않는다). (probe.execution AC-1)
- **CASE-icat-043** 실행 이력 레코드에 치환 **후** 값(자격증명)이 남지 않는다 — 치환 전 형태로 기록. (probe.execution AC-3)
- **CASE-icat-044** 우리 것이 아닌 `{{…}}`(도커 출력 서식)는 손대지 않고 흘려보낸다. (probe.shape AC-8)
- **CASE-icat-045** 우리 이름공간(`cred`·`node`·`arg`)이면 값이 없을 때 반드시 던진다. (probe.shape AC-8)

## Scenario S6 — 저장 계층 (임시 SQLite) → `src/main/ipc/infra/store.test.ts`
- **CASE-icat-050** 카탈로그 CRUD: 출처(내장/내가 만듦/가져옴) 보존, 내장은 갱신 거부. (registry.sources AC-3)
- **CASE-icat-051** 공급자 연결 저장 시 자격증명이 암호문으로 들어가고 평문 컬럼이 없다. (providers.credentials AC-2)
- **CASE-icat-052** 공급자 연결을 지우면 그 스냅샷은 지워지고 **설계본은 남는다**. (providers.data AC-2)
- **CASE-icat-053** `infra_` 접두어 없는 테이블 선언은 마이그레이션에서 거부된다(네임스페이스 규칙). (design.data AC-5 · 공용)

## Scenario S7 — MCP 노출 지도 (기존 강제 테스트에 편승) → `src/main/ai/coverage/coverage.test.ts`
- **CASE-icat-060** `infra:*` 채널이 전부 등재돼 있다(미등재 시 `npm test` 실패). (mcp AC-1)
- **CASE-icat-061** `infra:runAction` · `infra:runProbe` · 자격증명 채널은 **제외**로 등재되고 사유가 적혀 있다. (mcp AC-2/AC-3)

## Scenario S8 — 앱 구동 흐름 (e2e/suites/13-infra-catalog, CSS/text 로케이터만)
> ⚠ 접근성 쿼리(`getByRole` 등)는 이 Electron 창을 크래시시킨다 → CSS/text 로케이터만.

- **CASE-icat-070** Catalog 모듈의 세 뷰(공급자·노드 종류·탐침)가 열리고 nav 훅(`data-nav-*`)이 붙어 있다. (nav AC-1/AC-2)
- **CASE-icat-071** 내장 카탈로그가 목록에 뜨고 출처가 `내장` 으로 표시된다. 편집 버튼이 잠겨 있다. (registry.sources AC-1/AC-3)
- **CASE-icat-072** 카탈로그 가져오기 → **실행될 명령 목록**이 먼저 뜨고, 승인 전에는 저장되지 않는다. (registry.import AC-1/AC-2)
- **CASE-icat-073** 형식이 깨진 파일을 가져오면 어느 필드가 문제인지 뜨고 목록이 늘지 않는다. (registry.import AC-3)
- **CASE-icat-074** 탐침 편집: 명령 실행 → 원본 출력 표시 → 목록/이름/상태를 클릭으로 집기 → **표현식이 자동으로 채워짐**. (probe.editor AC-1/AC-2)
- **CASE-icat-075** 미리보기에 뽑힌 노드 수가 뜨고, '모름' 상태가 있으면 그 목록이 따로 뜬다. (probe.editor AC-3)
- **CASE-icat-076** 없는 명령을 실행하면 **종료 코드와 표준 오류가 그대로** 뜬다(뭉개지 않음). (probe.editor AC-5)
- **CASE-icat-077** 탐침 저장 → 노드 종류 목록에 `내가 만듦` 으로 등장. (probe.editor AC-6)
- **CASE-icat-078** 공급자 연결에 자격증명 입력 → 저장 후 화면·목록 어디에도 평문이 안 보인다. (providers.credentials AC-3)
- **CASE-icat-079** 프리셋(그라파나)을 노드 종류 목록에서 찾을 수 있다. (types.presets AC-2)
- **CASE-icat-081** 탐침 저장 → 노드 종류 목록에 `내가 만듦` + `탐침 있음` 으로 등장. (probe.editor AC-6)
- **CASE-icat-082** 카탈로그 목록: 내장은 삭제 대신 복제만. 내보낸 JSON 에 자격증명 값 없음. (registry.sources AC-3 · export AC-1)
- **CASE-icat-080** 앱을 껐다 켠 뒤 사용자 카탈로그·공급자 연결이 남아 있다(콜드 재시작 영속).
  ※ `12-cold-restart` 는 DB 서비스 흐름이라 건드리지 않고, **이 스위트 안에서 `ctx.relaunch()` 로** 확인한다.
