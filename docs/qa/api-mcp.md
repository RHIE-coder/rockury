# TestPlan: api-mcp (AI 노출면 — MCP 도구 · IPC coverage)

> 정의(무엇을 검증하나)만 여기. 코드는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 흐름 스위트 `e2e/suites/NN-*.mjs`.
> 대상 명세: `docs/spec/api-mcp.md` · 불변식: `docs/spec/api-service.md` §4-③.
> 회차 기록은 `docs/qa/runs/`.

## Scenario S1 — 이름 충돌 방지 (순수 로직)
- **CASE-apimcp-001** `api_` 접두어 강제: API 서비스가 등록한 모든 도구 이름이 `api_` 로 시작한다. 하나라도 빠지면 실패. (naming.prefix AC-1/AC-3) → `main/ai/tools.test.ts`
- **CASE-apimcp-002** 전역 이름 유일성: 등록된 전체 도구 목록에 **중복 이름이 없다.** DB 의 `create_version`·`list_versions`·`get_version` 과 API 도구가 겹치지 않는다. (naming.prefix AC-2)

## Scenario S2 — 없는 도구 (순수 로직) — 명세를 기계가 지킨다
- **CASE-apimcp-010 (불변식 ③)** **실행 도구 부재**: 등록 목록에 요청을 쏘는 도구가 없다. `api_send`·`api_run`·`api_execute` 류 이름이 생기면 실패. (tools.absent AC-1/AC-4) → `main/ai/coverage/api.test.ts`
- **CASE-apimcp-011 (불변식 ③)** **삭제 도구 부재**: `api_delete_*` 가 없다. (tools.absent AC-2)
- **CASE-apimcp-012** **버전 컷 도구 부재**: `api_create_version` 이 없다. 컷은 사람 몫이다 — DB 와 갈리는 지점이라 특히 회귀가 쉽다. (tools.write AC-5 · tools.absent AC-3)

## Scenario S3 — 읽기 도구 (순수 로직)
- **CASE-apimcp-020** `api_get_spec` 한 덩어리: 요청 목록 · 파라미터 시그니처 · 요청/응답 스키마 · 사람이 쓴 문서가 **한 응답에** 담긴다. 요청별로 나눠 부르게 만들면 실패. (tools.read AC-2)
- **CASE-apimcp-021** `requests` 추리기: 이름 배열로 일부만 읽을 수 있고, 목록에 없는 이름이 섞이면 **조용한 빈 결과 대신** 사용 가능한 이름 목록과 함께 `isError`. (tools.read AC-2)
- **CASE-apimcp-022 (불변식 ⑥)** `api_get_runs` 마스킹: 응답에 비밀 표식 값의 실값이 **한 글자도 없다.** (tools.read AC-3)
- **CASE-apimcp-023 (불변식 ①)** `api_get_drift` 커버리지 동봉: 응답에 등급과 커버리지가 **반드시** 들어간다. 커버리지 없는 판정 결과를 반환할 수 없다 — AI 가 "이상 없음"을 "전부 확인됨"으로 오해하는 것을 구조로 막는다. (tools.read AC-4)
- **CASE-apimcp-024** 미상 id 처리: 프로토콜 오류가 아닌 `isError` + 어느 도구로 확인할지 안내. (tools.read AC-5)
- **CASE-apimcp-026** `api_list_versions`: 번호·메모·잠금·시각을 최신순으로 주고 **스냅샷 본문은 안 준다**(목록이 무거워진다). 읽기 전용이라 컷 도구가 짝으로 생기지 않는다. (tools.read AC-6)
- **CASE-apimcp-025** `api_list_specs` 필드: 명세마다 이름·**인터페이스 종류**·요청 수·최신 버전 번호가 담긴다. 종류가 빠지면 AI 가 어떤 도구로 다뤄야 할지 모른다. (tools.read AC-1)

## Scenario S4 — 쓰기 도구 (순수 로직)
- **CASE-apimcp-030** `api_create_spec` 인터페이스 종류 강제: 누락·미지원 값이면 만들지 않고 "사용자에게 물어보라" 지시 + 선택지 목록을 `isError` 로 준다. 표기 흔들림(대소문자·공백)은 정규화해 받는다. (tools.write AC-1)
- **CASE-apimcp-031** `api_update_spec` 표면 제한: 인터페이스 종류가 입력 표면에 없다. 넣어 보내면 무시가 아니라 거부. (tools.write AC-2)
- **CASE-apimcp-032** `api_set_spec` 통째 반영: 실행 후 `api_get_spec` 결과가 보낸 입력과 일치하고, 빠진 요청은 삭제된다. 응답은 요약이다(본문 되돌려주기 금지). (tools.write AC-3)
- **CASE-apimcp-033** `api_patch_spec` 원자성: 연산 목록 중 하나라도 실패하면 **전부 미반영**이고, 실패 메시지가 **몇 번째 연산인지** 밝힌다. (tools.write AC-4/AC-6)
- **CASE-apimcp-034** `api_patch_spec` 이름 조준: 요청·파라미터를 **이름으로** 지목한다 — 내부 id 를 알려고 먼저 읽을 필요가 없다. 손대지 않은 부분은 id 까지 보존된다. (tools.write AC-4)
- **CASE-apimcp-035** `api_patch_spec` 연산 전종: `add_request`·`remove_request`·`rename_request`·`set_docs`·`add_param`·`update_param`·`remove_param`·`set_request_fields`·`set_response_schema` 각각이 Draft 를 올바르게 변형한다. (tools.write AC-4)
- **CASE-apimcp-036** 검증 실패 시 무기록: 구조 검증에 걸리면 저장소에 아무것도 안 쓴다(부분 반영 없음). (tools.write AC-6)
- **CASE-apimcp-037** 그릇 보존: `api_patch_spec` 으로 명세·환경 자체를 없앨 수 없다. 요청 삭제는 되고 명세 삭제는 안 된다. (tools.write AC-7)

## Scenario S5 — coverage 등재 (순수 로직) — `AGENTS.md` 불변식 ④
- **CASE-apimcp-040** 전수 등재: `src/main/ipc/api/**` 의 모든 채널이 `src/main/ai/coverage/api.ts` 에 **노출 또는 제외(사유)** 로 있다. 미등재 채널이 하나라도 있으면 실패. (coverage.map AC-1/AC-4) → 기존 `coverage.test.ts` 가 재귀 스캔으로 강제
- **CASE-apimcp-041** 유령 등재 금지: 지도에 있는데 코드에 없는 채널이 없다. (coverage.map AC-4)
- **CASE-apimcp-042** 제외 사유 필수: 제외로 등재된 채널은 사유 문자열이 비어 있지 않다. (coverage.map AC-2)
- **CASE-apimcp-043** 실행·삭제 채널의 처분: `api:send`·`api:openStream`·`api:startInbox`·`api:delete*`·`api:createVersion`·`api:saveEnvironment`·`api:export` 가 **제외**로 등재돼 있다. 이 중 하나라도 노출로 바뀌면 실패. (coverage.map AC-2 · tools.absent)
- **CASE-apimcp-044** 서비스 간 중복 금지: 다른 서비스가 이미 등재한 채널을 API 가 또 등재하면 실패(조용한 덮어쓰기 방지). (coverage.map AC-3)

## Scenario S6 — 쓰기 반영 (순수 로직)
- **CASE-apimcp-050** 성공 시에만 이벤트: 쓰기 성공이면 `api:changed` 를 보내고, `isError` 면 안 보낸다. DB 의 `store:changed` 를 빌려 쓰지 않는다. (tools.write AC-8)
- **CASE-apimcp-051** 자기 메아리 금지: 렌더러발 저장은 이벤트를 유발하지 않고, 리하이드레이션으로 갱신된 상태가 다시 저장을 되쏘지 않는다(쓰기 1회당 저장 1회). (tools.write AC-8)

## Scenario S7 — 앱 구동 흐름 (e2e/suites/30-api-studio 안, CSS/text 로케이터만)
> 별도 스위트를 두지 않았다 — MCP 쓰기 반영은 Studio 화면에서 확인해야 뜻이 있고, 그 화면 흐름이
> 이미 13번에 있다. 16번은 가져오기·내보내기 스위트다.
- **CASE-apimcp-060** MCP 로 `api_create_spec` → `api_patch_spec` 으로 요청 추가 → **열려 있던 Studio 화면에 즉시 보인다.** (tools.write AC-1/AC-4/AC-8)
- **CASE-apimcp-061** MCP 로 `api_get_spec` → 파라미터 시그니처와 사람이 쓴 문서가 한 응답에 담겨 온다. (tools.read AC-2)
- **CASE-apimcp-062** MCP 도구 목록 조회 → **실행·삭제·버전 컷 도구가 없다.** (tools.absent AC-4)
- **CASE-apimcp-063** 사람이 앱에서 실행한 Run 을 MCP `api_get_runs` 로 읽으면 응답 모양은 오고 **비밀 값은 가려져** 온다. (tools.read AC-3)

## 열린 항목 (사용자 결정 필요 — 이 문서가 혼자 못 정함)
- **`AGENTS.md` 네임스페이스 표에 MCP 도구 이름 규칙이 없다.** 지금은 API 만 `api_` 접두어를
  쓰기로 이 문서에서 정했지만, 다섯 서비스가 모두 도구를 내놓으면 같은 충돌이 반복된다.
  `AGENTS.md` 는 공용 파일이라 `main` 에서 고쳐야 한다.
- **e2e 스위트 번호.** API 스위트는 지금 **13~21** 인데 기존 `12-cold-restart.mjs` 가
  그보다 앞서 돈다. 즉 **API 가 만든 상태는 재시작 검증에 안 들어간다** — Inbox 의
  "앱 재시작 후 대기 꺼짐"(inbox.listener AC-4)이 정확히 이것 때문에 미검증이다.
  고치려면 cold-restart 를 API 뒤로 옮겨야 하는데 그건 공용 파일 순서 변경이라 `main` 몫이다.
