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

## Scenario S1c — 프리셋 만들기·승격 (순수 로직) → `services/infra/catalog/presets.test.ts`
- **CASE-icat-110** 탐침 없이 **모양만** 있는 종류를 만들 수 있고, 만든 것은 카탈로그 검증을 그대로 통과한다.
  종류 id 가 비거나 공백이 섞이면 거부한다(표현식·저장 키·설계 노드 참조로 쓰이는 값). (types.presets AC-3)
- **CASE-icat-111** 승격 — 탐침 없는 종류에만 붙고, **종류 id 를 그대로 이어받는다.**
  모양(아이콘·색·담길 곳·문서 틀)도 따라온다. 이게 깨지면 이미 그려 둔 노드가 '알 수 없는 종류'로 떨어진다. (types.presets AC-4)

## Scenario S1d — 연결 시험 (순수 로직) → `services/infra/catalog/connectionTest.test.ts`
- **CASE-icat-100** 시험에 쓸 탐침은 **지금 실제로 돌릴 수 있는 것(cli)** 만 고른다. 프리셋·http·builtin 은 건너뛴다.
  고를 것이 없으면 `null` — 화면은 버튼을 감춘다. (providers.credentials AC-4)
- **CASE-icat-101** 실패 이유를 뭉개지 않는다 — 시간 초과 · 종료 코드 · 표준 오류를 그대로 옮기고,
  단서가 하나도 없으면 **지어내지 않고 모른다고 말한다.** (providers.credentials AC-4 · probe.editor AC-5)

## Scenario S5 — 명령 조립 (순수 로직) → `src/main/ipc/infra/command.test.ts`
- **CASE-icat-040** `{{cred.*}}`·`{{node.*}}` 치환이 **인자 배열의 한 칸 안에서만** 일어난다. (probe.execution AC-1)
- **CASE-icat-041** 치환값에 공백·따옴표·세미콜론·`&&` 가 있어도 인자가 쪼개지거나 명령이 추가로 실행되지 않는다. (probe.execution AC-1)
- **CASE-icat-042** 정의되지 않은 자리표시자는 치환하지 않고 **오류로 세운다**(빈 문자열로 밀어 넣지 않는다). (probe.execution AC-1)
- **CASE-icat-043** 실행 이력 레코드에 치환 **후** 값(자격증명)이 남지 않는다 — 치환 전 형태로 기록. (probe.execution AC-3)
- **CASE-icat-044** 우리 것이 아닌 `{{…}}`(도커 출력 서식)는 손대지 않고 흘려보낸다. (probe.shape AC-8)
- **CASE-icat-045** 우리 이름공간(`cred`·`node`·`arg`)이면 값이 없을 때 반드시 던진다. (probe.shape AC-8)
- **CASE-icat-102** **상대가 되뱉은 자격증명을 가린다** — 표준 출력·표준 오류·실행 오류에서 자격증명 값을
  참조 표기(`{{cred.<id>}}`)로 바꾼다. **가리되 자리는 남긴다**(통째로 지우면 무엇이 틀렸는지 못 읽는다).
  긴 값 먼저 · 정규식 특수문자 안전 · 비밀 없는 공급자(도커)의 오류는 손대지 않는다. (providers.credentials AC-6)

## Scenario S5b — AWS 탐침 고정 표본 (순수 로직) → `services/infra/catalog/builtin/aws.test.ts`
> 실 계정 없이 검증하는 자리. 표본(`awsSamples.json`)의 **구조와 키 이름은 실제 CLI 출력 그대로**이고
> 값만 지어냈다. 여기를 편하게 고치면 테스트가 우리 상상을 검증하게 된다.
> **덮지 못하는 것**: 명령줄이 맞는지(옵션·리전) · 권한 · 응답 페이지 나눔 → 실 계정(M3)의 몫.

- **CASE-icat-120** VPC — 이름은 `Tags[?Key=='Name']`(배열 속 조건부 값), `rockury:node` 태그가 대조 근거로 실린다.
  태그가 없는 VPC 도 버리지 않는다.
- **CASE-icat-121** 서브넷 — 부모(`VpcId`)가 실려 중첩이 서고, `pending` 은 정상이 아니라 주의다.
- **CASE-icat-122** EC2 — `Reservations[].Instances[]`(목록 안 목록)를 평평하게 펴고, 상태는
  `State.Name`(숫자 `State.Code` 가 아니라)에서 온다. 사전에 없는 상태가 0건이어야 한다.
- **CASE-icat-123** RDS 는 `DBSubnetGroup.VpcId` 에 부모가 중첩돼 있고, ALB 의 상태는 `State.Code` 다
  (EC2 와 키 이름이 같은데 뜻이 다르다).
- **CASE-icat-124** 여러 탐침 결과를 합치면 VPC > 서브넷 > EC2 3겹이 선다. **한 탐침만 돌리면 부모가 끊긴다** —
  그래서 뽑기 단계에서 부모를 지우면 안 된다(끊긴 것은 버리지 않고 최상위로 올리며 보고한다).

## Scenario S5c — 액션 (순수 로직) → `services/infra/catalog/actions.test.ts`
- **CASE-icat-130** 인자 검사 — 필수가 비면(공백만 넣은 것도 빈 것으로 본다) 무엇이 빠졌는지 낸다.
  **스키마에 없는 값은 버린다**(카탈로그가 선언한 것만 명령에 들어간다). 선택 인자는 빈 문자열로 채운다. (actions.definition AC-2)
- **CASE-icat-131** 잠금 판정 — 읽기 전용 연결에서 `danger` 액션만 잠긴다. 연결이 없으면 아무것도 못 돈다. (actions.definition AC-3)
- **CASE-icat-132** 치환값 — 실물 값은 `node`, 폼 값은 `arg` 로 **분리**된다.
  겹치는 이름을 써도 서로 덮지 않는다(덮으면 엉뚱한 대상에 명령이 나간다). (actions.definition AC-6)
- **CASE-icat-133** 실행 전 미리보기 — 사람이 읽을 명령 한 줄을 만들고, cli 가 아닌 호출도 무엇인지 말한다. (actions.definition AC-5)

## Scenario S5d — 내장 카탈로그 액션 가드 → `services/infra/catalog/builtin/builtin.test.ts`
- **CASE-icat-138** **바꾸는 동사면 반드시 `danger`, 읽기만 하는 동사면 `danger` 아님.**
  모르는 동사는 통과시키지 않는다 — 새 동사를 넣는 사람이 어느 쪽인지 밝히게 만든다.
  하이픈 동사(`reboot-instances`)도 앞부분을 떼어 본다.
  ※ M1 때 이 가드는 "내장 액션은 **전부** danger"였는데, 그건 액션이 하나뿐이라 우연히 맞았을 뿐이고
  M4 에서 로그·자세히 보기가 들어오자 바로 깨졌다. 진짜 불변식으로 바꿨다.
- **CASE-icat-139** 액션의 인자는 명령에 **실제로 쓰인다**(`{{arg.<id>}}` 가 명령줄에 있다) —
  받아 놓고 안 쓰는 칸을 만들지 않는다.

## Scenario S6 — 저장 계층 (임시 SQLite) → `src/main/ipc/infra/store.test.ts`
- **CASE-icat-050** 카탈로그 CRUD: 출처(내장/내가 만듦/가져옴) 보존, 내장은 갱신 거부. (registry.sources AC-3)
- **CASE-icat-051** 공급자 연결 저장 시 자격증명이 암호문으로 들어가고 평문 컬럼이 없다. (providers.credentials AC-2)
- **CASE-icat-052** 공급자 연결을 지우면 그 스냅샷은 지워지고 **설계본은 남는다**. (providers.data AC-2)
- **CASE-icat-053** `infra_` 접두어 없는 테이블 선언은 마이그레이션에서 거부된다(네임스페이스 규칙). (design.data AC-5 · 공용)

## Scenario S7 — MCP 노출 지도 (기존 강제 테스트에 편승) → `src/main/ai/coverage/coverage.test.ts`
- **CASE-icat-060** `infra:*` 채널이 전부 등재돼 있다(미등재 시 `npm test` 실패). (mcp AC-1)
- **CASE-icat-061** `infra:runAction` · `infra:runProbe` · 자격증명 채널은 **제외**로 등재되고 사유가 적혀 있다. (mcp AC-2/AC-3)

## Scenario S9 — 앱 구동 흐름 · 액션 (e2e/suites/16-infra-actions, `meta.needsDb: true`)
> **15 와 따로 두는 이유**: 15 는 `CASE-iarch-087`("대조 전후로 컨테이너가 하나도 안 변한다")을 못박고,
> 여기서는 반대로 **액션이 실물을 실제로 바꾸는지**를 봐야 한다. 한 스위트에 두면 서로의 전제를 깬다.
> 자기 pid 이름의 **일회용 컨테이너**를 `docker create`(실행 없이 만들기만)로 세우고 끝나면 지운다 —
> 남의 컨테이너는 건드리지 않는다.

- **CASE-icat-130**(앱) 인자 폼이 카탈로그 스키마대로 뜨고, 필수를 비우고 누르면 **안 돌고** 무엇이 빠졌는지 뜬다.
- **CASE-icat-131**(앱) 읽기 전용 연결에서 `재시작`은 잠기고 **왜 잠겼는지** 뜬다. `자세히 보기`는 열려 있다.
  읽기 전용이 아닌 연결에서는 `재시작`이 열린다.
- **CASE-icat-133**(앱) 실행 전에 돌아갈 명령이 보인다.
- **CASE-icat-134**(앱) 출력 패널에 **종료 코드**와 표준 출력이 그대로 남고, 읽기 액션은 실물을 바꾸지 않았다.
- **CASE-icat-135**(앱) ⭐ **창구를 직접 불러도**(화면을 우회해도) 읽기 전용 연결의 위험 액션은 거부된다 —
  화면에서만 막으면 잠금이 아니라 권유다.
- **CASE-icat-136**(앱) ⭐ 위험 액션은 표시가 붙고 **한 번 더 묻고**, 확인 전에는 실물이 그대로이며,
  확인하면 **실물이 실제로 바뀐다**(멈춤 → 실행 중). Rockury 가 실물에 닿는 유일한 통로임을 실측한다.
- **CASE-icat-137**(앱) 액션 실행이 이력에 `kind=action` 으로 남고, **이력에는 치환 전 명령**이 남아
  실물 식별자도 자격증명도 눌러앉지 않는다.

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
  ※ `99-cold-restart` 는 DB 서비스 흐름이라 건드리지 않고, **이 스위트 안에서 `ctx.relaunch()` 로** 확인한다.
- **CASE-icat-100/101**(앱) 연결 시험을 눌러 **실제로 한 번 돌린다.** 이 기계에 그 CLI 가 있든 없든
  **성공/실패 중 하나를 분명히 말해야** 하고, 실패면 사유가 남고, **결과 어디에도 평문 자격증명이 없다.**
  (이 마지막 체크가 2026-07-29 에 실제 누출을 잡았다 → `CASE-icat-102` 신설.)
- **CASE-icat-110**(앱) `새 프리셋` 으로 탐침 없는 종류를 만들면 목록에 `모양만` · `내가 만듦` 으로 뜬다.
- **CASE-icat-111**(앱) 프리셋 `승격` → 안내 띠 → 탐침 편집기가 이어받음(**id 칸 잠김**) → 저장 →
  **같은 id 에 탐침이 붙고 종류가 늘지 않는다**(덮어썼지 새로 만들지 않았다).
  ※ 뷰를 옮기면 편집기 화면 상태는 초기화된다(영속 대상이 아니다) — 스위트가 탐침을 다시 짠다.
