# TestPlan: api-contract (판정 — Drift · Accept · Logs)

> 정의(무엇을 검증하나)만 여기. 코드는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 흐름 스위트 `e2e/suites/NN-*.mjs`.
> 대상 명세: `docs/spec/api-contract.md` · 불변식: `docs/spec/api-service.md` §4-①·②.
> 회차 기록은 `docs/qa/runs/`.

## Scenario S1 — 판정 등급 (순수 로직) — 앱이 거짓말하지 않게 하는 자리
- **CASE-apicontract-001 (불변식 ①)** **완전 판정 대상 게이팅**: gRPC·GraphQL·SOAP 만 완전 판정에 들어간다. REST·JSON-RPC·WebSocket·SSE·웹훅에 완전 판정을 시도하면 실패. (drift.complete AC-1) → `api/contract/grade.test.ts`
- **CASE-apicontract-002** 등급 강등 금지: 서버가 reflection/introspection 을 꺼 두었으면 결과가 **`완전 판정 불가`** 다. 관측 판정으로 조용히 내려가면 실패. (drift.complete AC-4)
- **CASE-apicontract-003** 불가 사유 구분: `기능 꺼짐` / `권한 없음` / `접속 실패` / **`아직 안 만듦`** 이 서로 다른 사유로 분류된다. 마지막 갈래는 우리 쪽 사정이라 '서버가 안 줬다'로 보이면 안 된다. (drift.complete AC-4)
- **CASE-apicontract-004** 완전 판정 커버리지: 결과에 커버리지 100% 가 명시된다. 커버리지 필드가 비면 실패. (drift.complete AC-3)
- **CASE-apicontract-005** 결과 모델 공유: GraphQL 과 gRPC 의 완전 판정이 **같은 결과 타입**을 낸다 — 판정 로직·결과 화면이 인터페이스별로 갈라지지 않는다. 갈라지면 gRPC 를 얹을 때 화면을 두 번 만들게 된다. (drift.complete AC-5)
- **CASE-apicontract-005b (proto 서술자 → 응답 모양)** 스칼라·배열(`repeated`)·중첩 메시지·열거형 허용 값이 옮겨진다. **`optional` 을 명시한 것만 `없을 수 있음`이고** 표시 없는 단일 필드는 `required` 로 못 박지 않고 `모름`이다(proto3 는 없음과 기본값이 안 갈린다). proto 의 map 은 배열이 아니라 객체다. 모르는 타입은 추측하지 않고 안쪽을 지어내지 않는다. 자기를 참조하는 메시지에서 무한히 파고들지 않는다. (drift.complete AC-8) → `shared/api/proto.test.ts`
- **CASE-apicontract-005c (메서드 이름 맞추기)** 선언의 `grpcMethod` 를 서버 경로에 맞춘다. 전체 경로·꼬리만 적은 경우 모두 하나뿐이면 고르고, **둘 이상 맞으면 짐작하지 않고 null** 이다. 응답 모양을 못 읽으면 빈 목록을 지어내지 않는다(메서드가 있다는 사실은 남는다). (drift.complete AC-7) → `shared/api/proto.test.ts`
- **CASE-apicontract-005d (서술자 묶기)** reflection 이 파일을 하나씩 주므로 태그·길이 머리를 붙여 한 덩어리로 잇는다. 길이가 127 을 넘으면 두 바이트로 적고, 같은 파일이 여러 번 와도 한 번만 담는다. **진짜 디코더에 물려 왕복**시켜 형식 가정 전체를 붙잡는다. → `shared/api/proto.test.ts`
- **CASE-apicontract-005e (reflection 왕복 — 진짜 서버)** reflection 을 켠 서버에서 서비스 목록·정의를 받아 우리 응답 모양으로 옮긴다. **판 넘기기는 두 서버로 확인한다** — v1alpha 만 켠 서버와 v1 만 켠 서버 각각에 붙어야 넘기기가 실제로 도는 것이다(같은 서버에 두 번 붙는 검사는 넘기기를 안 짚는다). 정의를 안 주는 서버는 `기능 꺼짐`, 토큰이 틀리면 `권한 없음`, **개별 심볼 조회가 거절당하면 그 사유 그대로** — 봐야 할 곳이 다르다. **못 실은 헤더(ASCII 아닌 값)는 사유에 이름이 실린다.** **사용자가 끊으면 받아 오던 것도 멈춘다.** (drift.complete AC-4/AC-11) → `main/api/grpcReflect.test.ts`
- **CASE-apicontract-005i (규약 칸 번호 — 골든 바이트)** reflection 요청·응답의 **칸 번호**를 바이트로 못 박는다(`list_services`=7 · `file_containing_symbol`=4 · `list_services_response`=6 · `file_descriptor_response`=4 · `error_response`=7). 구현과 검사용 서버가 같은 정의의 복사본이라, 이 검사가 없으면 **둘이 사이좋게 틀린 채** 전 게이트를 통과하고 실제 서버에서만 안 붙는다. 읽기 규칙(열거형 이름 · 64비트 글자 · 기본값 안 채움)도 여기서 고정한다. → `shared/api/reflectionProto.test.ts`
- **CASE-apicontract-005k (판정 대상이 아닌 서비스)** reflection·health·channelz 는 사용자의 API 가 아니라 목록에서 뺀다. **넓게 잡아 사용자 서비스를 걸러 내면 안 된다** — `grpc.reflectionary.MyService` 는 남는다. → `shared/api/reflectionProto.test.ts`
- **CASE-apicontract-005f (접속 대상 읽기)** 환경 주소에서 `호스트:포트` 와 암호화 여부를 읽는다. 경로·쿼리는 잘라 내고, 포트가 없으면 방식의 기본 포트를 쓴다. **방식이 없으면 평문으로 가정하되 가정했다고 밝힌다** — 조용히 정하면 TLS 서버에서 아무 말 없이 멎는다. gRPC 가 아닌 방식은 짐작하지 않고 사유를 단다. → `shared/api/grpcTarget.test.ts`
- **CASE-apicontract-005g (스키마가 덮는 범위로 가른다)** 스키마가 스트리밍까지 설명하면(gRPC reflection) 스트리밍 요청도 대조한다. 안 덮으면(GraphQL introspection) 대조하지 않고 관측 유무만 가린다. 어느 쪽이든 수신(웹훅)은 대조 대상이 아니다. **그 사실은 호출처가 넘기는 옵션이 아니라 `INTERFACE_META` 가 든다** — 옵션이면 새 종류를 얹을 때 빠뜨려도 아무것도 안 깨진다. (drift.complete AC-6/AC-8b) → `shared/api/drift.test.ts`
- **CASE-apicontract-005j (암호화되는지 모르면 비밀을 안 보낸다)** 주소에 방식이 없는데 헤더에 비밀이 실려 있으면 **붙기 전에 막고** `grpc://`·`grpcs://` 를 적으라고 안내한다. 방식을 적었으면 사람이 정한 것이므로 막지 않고, 비밀이 안 실렸으면 평문 자체는 잘못이 아니다. 주소의 `사용자:비번@` 는 잘라 낸다(환경 비밀이 아니라 가리는 그물에 안 걸린다). (stream.session AC-7b) → `shared/api/grpcTarget.test.ts`

## Scenario S2 — 커버리지 정직 (순수 로직) — 미관측을 통과로 세지 않는다
- **CASE-apicontract-010 (불변식 ①)** **관측 커버리지 집계**: 요청 12개 중 Run 이 있는 것이 7개면 결과가 `7 관측 / 5 미관측` 이다. 미관측 5개를 일치로 세면 실패. (drift.observed AC-2) → `api/contract/coverage.test.ts`
- **CASE-apicontract-011** 미관측 목록: 무엇을 아직 안 쏴 봤는지 이름 목록이 결과에 담긴다. 개수만 있고 목록이 없으면 실패. (drift.observed AC-3)
- **CASE-apicontract-011b** 판정 불가와 통과를 가른다: 응답이 JSON 이 아니어서 모양을 못 뽑은 요청은 관측으로 세지 않고 `unparsable` 목록에 남는다. 응답이 없는 실행(연결 실패)도 관측이 아니다. (drift.observed AC-3b)
- **CASE-apicontract-011c (맞출 선언 없음)** 스트림·수신 관측을 어느 선언과도 못 맞추면 미관측이 아니라 `unjudged` 로 따로 세고, 요약·리포트에 건수가 실린다. 한 번도 안 붙어 본 것은 그냥 미관측이다(두 사실을 뭉치면 실패). 메시지 목록을 응답 본문으로 오독해 **없는 어긋남을 만들면 실패**. (drift.observed AC-6)
- **CASE-apicontract-017 (스트림 대조)** 메시지의 **이벤트 이름이 선언을 고른다**(`status` 가 스트림에선 이벤트 종류). 어긋난 필드를 `요청.이벤트.필드` 경로로 잡고, 선언에 없는 이벤트는 단발의 "상태 선언 없음"과 같은 자리로 잡는다. **이름 없는 메시지는 하나뿐인 선언에 갖다 붙이지 않고** 못 맞춘 건수로 센다(한 소켓에 여러 종류가 흐르는 것이 보통이라 그 추측은 조용히 틀린다). JSON 이 아닌 메시지도 통과가 아니다. 보낸 메시지는 관측이 아니다. 일부만 맞춘 요청은 관측으로 세되 **못 맞춘 건수가 남는다**. (drift.observed AC-6) → `shared/api/drift.test.ts` · `e2e/suites/35-api-stream.mjs`
- **CASE-apicontract-018 (수신 대조)** 받는 쪽 선언은 **기대 본문**이고, 받을 때 쓴 것과 **같은 함수**로 다시 본다. 선언이 없으면 통과가 아니라 못 맞춘 것이다. (drift.observed AC-6) → `shared/api/drift.test.ts` · `e2e/suites/36-api-inbox.mjs`
- **CASE-apicontract-011d (형제 경로·옛 기록)** **완전 판정도 스트리밍은 대조하지 않는다** — GraphQL introspection 에 subscription 루트가 없어서, 규칙을 관측 판정에만 두면 멀쩡한 서버의 subscription 이 "명세에만 있음(내 요청이 깨진다)"으로 잡힌다. 또한 **선언 모양이 아니라 그 실행이 무엇이었는지로 가른다** — 스트리밍으로 선언한 요청을 단발로 쏜 관측은 계속 판정된다. 커버리지 칸이 없던 **옛 판정 기록**을 읽어도 화면이 죽지 않는다(읽는 자리에서 맞춘다). (drift.observed AC-6/AC-7)
- **CASE-apicontract-012** "전부 관측됨" 조건: 미관측이 **0일 때만** 그 문구가 나온다. 1개라도 남으면 안 나온다. 판정 규칙 없음이 1개라도 있으면 그 문구가 안 나온다. (drift.observed AC-2/AC-6)
- **CASE-apicontract-013** 이상 없음 + 커버리지 동반: 어긋남 0 이어도 결과 문구에 커버리지가 붙는다. **커버리지 없는 "이상 없음"을 만들 수 없다.** (drift.result AC-5)
- **CASE-apicontract-014** 기준 버전 분리: 기준 버전이 다른 Run 은 같은 판정에 섞이지 않는다. 결과에 어느 버전 기준인지 실린다. (drift.observed AC-5)
- **CASE-apicontract-015** 최근 성공 Run 선택: 같은 요청에 Run 이 여럿이면 가장 최근 성공 Run 이 기준이 되고, 과거 Run 과 응답 모양이 달랐으면 그 사실이 표시된다. (drift.observed AC-4)
- **CASE-apicontract-016** 관측 대조 본체: Run 의 실제 응답과 선언한 응답 스키마를 **필드 단위**로 대조한다 — 있음/없음/타입 불일치를 각각 잡아낸다. 중첩 객체·배열 원소 안까지 들어간다. (drift.observed AC-1) → `api/contract/observe.test.ts`

## Scenario S3 — 결과 분류 (순수 로직)
- **CASE-apicontract-020** 결과 3종: `서버에만 있음` / `명세에만 있음` / `양쪽 있는데 다름` 으로 정확히 분류된다. 넷째 상태가 생기면 실패. (drift.result AC-1) → `api/contract/classify.test.ts`
- **CASE-apicontract-021** 차이 상세: "다름"은 필드 단위로 무엇이 어떻게 다른지 담는다(선언 `string` ↔ 실제 `number`). 항목 이름만 있으면 실패. (drift.result AC-2)
- **CASE-apicontract-022** `모름` 제외: 필수여부가 `모름`인 필드는 판정에서 빠지고 **제외 개수가 결과에 실린다.** 모름을 일치로 세면 실패. (drift.result AC-4)
- **CASE-apicontract-023** 등급 표시: 모든 결과에 `완전`/`관측` 등급이 붙는다. 등급 없는 결과를 만들 수 없다. (drift.result AC-3)
- **CASE-apicontract-024 (불변식 ②)** **표준 준수 판정 금지**: 판정 입력이 "선언한 명세"와 "관측/서버 스키마" 둘뿐이다. 외부 규약(REST 관례·상태코드 관습 등)을 기준으로 삼는 경로가 없다. (`api-service.md` §4-②)
- **CASE-apicontract-025** 리포트 내보내기: 결과 전량이 리포트에 담긴다(항목 누락 0). 등급·커버리지·결과 3종·제외 개수가 모두 실리고, AI 가 파싱할 수 있는 구조다. (drift.result AC-6)

## Scenario S4 — 흡수와 리포트 (순수 로직)
- **CASE-apicontract-030** 흡수 대상 한정: `서버에만 있음` 만 흡수 후보다. `명세에만 있음`·`다름` 은 흡수 목록에 안 들어간다. (accept.absorb AC-1 · accept.report AC-1)
- **CASE-apicontract-031** 흡수 미리보기: 수락 전에는 Draft 가 안 바뀐다. 미리보기에 추가·변경 항목이 정확히 담긴다. (accept.absorb AC-3)
- **CASE-apicontract-032** 흡수는 Draft 로만: 흡수 결과가 버전을 만들지 않는다. (accept.absorb AC-2)
- **CASE-apicontract-033 (불변식 ⑧)** 흡수가 깨지는 변경을 만들면 승인 게이트 플래그가 선다. 판정은 `api-studio.md` § versions.diff 와 **같은 함수**를 쓴다(두 곳에 규칙이 갈라지면 실패). (accept.absorb AC-4)
- **CASE-apicontract-034** 고칠 목록 리포트: 항목마다 요청 이름·무엇이 어긋났나·어느 관측 근거인지가 담긴다. AI 가 그대로 읽을 수 있는 구조. (accept.report AC-2)
- **CASE-apicontract-035** 자동 반영 금지: `명세에만 있음`·`다름` 이 명세에 자동으로 들어가는 경로가 없다. (accept.report AC-3)

## Scenario S5 — 이력 (순수 로직)
- **CASE-apicontract-040** 판정 이력 항목: 시각·환경·기준 버전·등급·커버리지·결과 요약이 모두 담긴다. (logs.history AC-1)
- **CASE-apicontract-041** 이력 불변성: 나중 판정이 지난 이력을 고치지 않는다. (logs.history AC-4)
- **CASE-apicontract-042** 이력 비교: 두 판정을 비교해 "지난번엔 없던 어긋남"을 가려낸다. (logs.history AC-3)
- **CASE-apicontract-043** 흡수 이력: 무엇을 언제 명세로 받아들였는지가 판정 이력과 **같은 타임라인**에 남는다. 흡수와 판정이 따로 놀면 "왜 이 필드가 명세에 있지"를 되짚을 수 없다. (logs.history AC-2)

## Scenario S6 — 앱 구동 흐름 (e2e/suites/32-api-contract, CSS/text 로케이터만)
- **CASE-apicontract-050** GraphQL Spec 에서 Drift 실행 → 결과에 **`완전 판정`** 배지와 커버리지 100% 가 보인다. (drift.complete AC-2/AC-3)
- **CASE-apicontract-051** REST Spec 에서 Drift 실행 → 결과에 **`관측 판정`** 배지와 `N 관측 / K 미관측` 이 보이고 미관측 목록이 열린다. (drift.observed AC-2/AC-3)
- **CASE-apicontract-052** 어긋남 0 인 REST Spec → 문구가 "이상 없음"만이 아니라 **커버리지를 달고** 보인다. (drift.result AC-5)
- **CASE-apicontract-053** `서버에만 있음` 항목 흡수 → 미리보기 → 수락 → Studio Draft 에 반영된 것이 보인다. 버전은 안 늘어난다. (accept.absorb AC-2/AC-3)
- **CASE-apicontract-054** `명세에만 있음` 항목은 흡수 버튼이 없고 **고칠 목록**에 있다. 리포트 내보내기가 동작한다. (accept.report AC-1/AC-2)
- **CASE-apicontract-055** reflection 꺼진 gRPC 서버 → **`완전 판정 불가`** 와 사유가 보인다. 관측 결과로 대체 표시되지 않는다. (drift.complete AC-4) → `e2e/suites/39-api-grpc.mjs`
- **CASE-apicontract-056** reflection 켠 gRPC 서버 → **`완전 판정`** 등급 · 사유 없음 · 스트리밍 메서드까지 대조된다(`observed` 가 스트리밍 요청을 포함한다). 선언한 타입이 서버 정의와 다르면 `다름`, 서버에만 있는 필드는 `서버에만 있음`으로 잡힌다. (drift.complete AC-2/AC-6) → `e2e/suites/39-api-grpc.mjs`

## 미구현 · 미검증 (조용한 통과 금지)
- **SOAP/WSDL** — 후순위. 케이스 없음. (완전 판정 대상 셋 중 남은 하나다.)
- **이름 없는 스트림 메시지의 대조** — WebSocket 프레임에는 이벤트 이름이 없어서 어느 선언과
  맞출지 못 정한다. **추측하지 않고 못 맞춘 건수로 세는 것까지**가 구현이다(017).
  본문 안의 판별 필드(`type` 같은 것)를 쓰려면 "어느 필드가 판별자인가"를 선언에 더해야 하는데,
  그건 모델을 늘리는 일이라 실제 필요가 나오면 그때 연다.
