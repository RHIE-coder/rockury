# Service: api-mcp (AI 노출면 — MCP 도구 · IPC coverage)

> AI 가 API 명세를 **읽고 쓰는** 창구. 서버 본체는 `ai` 서비스 것이고(`ai-server.md`),
> 여기는 **API 서비스가 그 위에 내놓는 도구 표면과 채널 등재**의 정본이다.
> 서비스 정본·불변식은 `api-service.md`.

공통 불변식
- **설계면만 연다** — 만들기·고치기 ✅ / **지우기 ❌ · 실행 ❌**(`api-service.md` §4-③).
  DB 서비스가 이미 같은 선을 그었다(`ai-server.md` § tools.write AC-7).
- **실행이 없으므로 자격증명을 줄 이유 자체가 없다.** 값을 숨기는 장치가 아니라, 값을 쓸
  일이 없는 구조다.
- 응답은 요약이다 — 쓴 내용을 되돌려주지 않는다(`ai-server.md` 공통 불변식과 동일).

---

## Surface: api-mcp.naming (도구 이름 규칙)

### Section api-mcp.naming.prefix — `api_` 접두어
> **충돌 실재:** DB 서비스가 `create_version`·`list_versions`·`get_version` 을 접두어 없이
> 쓰고 있다. API 도 버전을 다루므로 접두어 없이는 이름이 겹친다.

- **AC-1** API 서비스의 MCP 도구 이름은 **모두 `api_` 로 시작**한다.
- **AC-2** DB 의 무접두어 이름은 그대로 둔다 — **레거시 예외**다. IPC 채널 규칙이 이미 같은
  형태로 정해져 있다(`AGENTS.md`: "기존 DB 채널은 무접두어 그대로 둔다(레거시 예외)").
- **AC-3** 접두어가 빠진 API 도구가 생기면 명세 위반이다. 이름 충돌은 조용한 덮어쓰기를
  낳으므로 테스트로 막는다(`docs/qa/api-mcp.md` CASE-apimcp-001).

> **미해결 (사용자 결정 필요):** `AGENTS.md` 의 네임스페이스 표에는 IPC 채널·SQLite 테이블·
> preload 키만 있고 **MCP 도구 이름이 없다.** 다섯 서비스가 모두 도구를 내놓으면 같은 충돌이
> 반복된다. `AGENTS.md` 는 공용 파일이라 `main` 에서 고쳐야 하므로 여기서는 손대지 않았다.

---

## Surface: api-mcp.tools (도구 표면 — 읽기 5종 + 쓰기 4종)

### Section api-mcp.tools.read — 읽기 도구 5종
- **AC-1** `api_list_specs` — 명세 목록 + 인터페이스 종류 + 요청 수 + 최신 버전 번호.
- **AC-2** `api_get_spec` — 명세 하나를 **한 덩어리로** 준다: 요청 목록 · 각 요청의 파라미터
  시그니처 · 요청/응답 스키마 · 사람이 쓴 문서. 요청을 하나씩 100번 부르게 하면 AI 가 안 쓴다.
  `requests`(이름 배열)로 추려 읽을 수 있고, 목록에 없는 이름이 섞이면 조용한 빈 결과 대신
  "이 명세의 요청" 목록과 함께 `isError` 로 알린다(DB `get_schema` 와 같은 규율).
- **AC-3** `api_get_runs` — 실행 기록 요약. 요청·환경·상태·시각·**응답 모양**을 준다.
  **비밀 표식 값은 가려진 채로** 나간다(`api-runner.md` § send.observe AC-3).
- **AC-4** `api_get_drift` — 판정 결과. 등급(완전/관측) · **커버리지** · 결과 3종 분류 ·
  고칠 목록을 준다. **커버리지 없는 결과를 주지 않는다** — AI 가 "이상 없음"을
  "전부 확인됨"으로 오해하면 안 된다(`api-contract.md` § drift.result AC-5).
- **AC-5** 미상 id 는 프로토콜 오류가 아닌 `isError` + 해결 안내(어느 도구로 확인할지)를 준다.
- **AC-6** `api_list_versions` — 버전(불변 스냅샷) 이력 메타: 번호 · 메모 · 잠금 · 시각(최신순,
  스냅샷 본문 제외). 읽기만이다 — **컷 도구는 없다**(§ tools.write AC-5).

### Section api-mcp.tools.write — 쓰기 도구 4종
> DB 서비스가 겪은 것을 그대로 받는다: **통째 반영만 있으면 주석 한 줄을 고치려도 전체를
> 다시 보내야 하고 그 과정에서 새 오타가 섞인다**(`ai-server.md` § tools.write 2026-07-26
> 결정). 그래서 처음부터 **통째(`set`) + 부분(`patch`) 짝**으로 낸다.

- **AC-1** `api_create_spec` — 이름 · **인터페이스 종류** · 설명으로 명세 생성.
  종류는 고정 속성이므로 **사용자 몫**이다 — 누락·미지원 값이면 만들지 않고 "임의로 고르지
  말고 사용자에게 물어보라"는 지시 + 선택지 목록을 `isError` 로 돌려준다(DB `create_design`
  의 방언 처리와 같은 규율).
- **AC-2** `api_update_spec` — 이름·설명만 수정. 인터페이스 종류는 입력 표면에 없다.
- **AC-3** `api_set_spec` — Draft 명세 전체를 통째로 반영한다(빠진 요청은 삭제).
  용도는 **새 명세를 처음 채우거나 전체를 갈아엎을 때**로 한정한다.
- **AC-4** `api_patch_spec` — 연산 목록을 **순서대로 원자 적용**한다(하나라도 실패하면 전부
  미반영, 몇 번째 연산인지 밝힌다). 연산: `add_request` · `remove_request` · `rename_request` ·
  `set_docs` · `add_param` · `update_param` · `remove_param` · `set_request_fields` ·
  `set_response_schema`. 조준은 **이름**으로 한다 — 내부 id 를 알려고 먼저 읽을 필요가 없다.
  손대지 않은 부분은 id 까지 보존된다.
- **AC-5 (Draft 까지만)** 쓰기는 모두 Draft 에 들어간다. **버전 컷 도구는 없다** —
  `api_create_version` 을 만들지 않는다. 컷은 사람이 앱에서 한다(`api-service.md` §4-⑦).
  이것이 DB 와 갈리는 점이다(DB 는 `create_version` 을 열었다).
- **AC-6** 구조 검증 실패는 `isError` + 해결 안내를 주고, **저장소에는 아무것도 쓰지 않는다**
  (부분 반영 없음).
- **AC-7 (삭제 경계)** 명세·환경이라는 **그릇을 통째로 없애는 도구는 없다.** 그 안의 내용
  편집(요청 추가/삭제)은 `api_patch_spec` 범위 안이다 — DB 가 `drop_table` 을 허용한 것과
  같은 경계선이다.
- **AC-8** 쓰기 성공 시에만 렌더러 리하이드레이션 이벤트를 보낸다(`isError` 는 이벤트 없음).
  열린 Studio 화면에 결과가 즉시 보인다. 자기 메아리 금지(렌더러발 저장은 이벤트 미유발).
  채널은 **`api:changed`** 다 — DB 서비스의 `store:changed` 를 빌려 쓰지 않는다. 서비스끼리
  런타임으로 얽히면 병렬 개발의 전제가 깨지고, `store` preload 키는 db 소유다.

### Section api-mcp.tools.absent — 없는 도구 (명세로 못 박음)
- **AC-1 (실행 없음)** `api_send` · `api_run` 류를 만들지 않는다.
  **근거:** AI 는 터미널에서 더 잘 쏜다 — MCP 로 주면 요청 id·환경 id·파라미터 모양을
  맞춰야 해서 오히려 어려워진다. 그리고 프로젝트에 `.env` 가 이미 열려 있어 앱만 잠그는 것은
  문 하나 잠그고 창문 여는 꼴이다. 실행을 안 주면 자격증명 문제 자체가 생기지 않는다.
- **AC-2 (삭제 없음)** `api_delete_*` 를 만들지 않는다. 파괴적 조작은 사람이 앱에서만.
- **AC-3 (버전 컷 없음)** AC-5.
- **AC-4** 도구 목록에 위 셋 중 하나라도 생기면 명세 위반이고 테스트가 실패한다.

---

## Surface: api-mcp.coverage (IPC 채널 등재)

> `AGENTS.md` 절대 불변식 ④: `src/main/ipc/**` 의 모든 채널은 `src/main/ai/coverage/<서비스>.ts`
> 에 **노출 또는 제외(사유)** 로 등재돼야 하고 `coverage.test.ts` 가 재귀로 강제한다.
> 미등재도, 지운 채널을 지도에 남기는 것도 `npm test` 실패다.

### Section api-mcp.coverage.map — 채널군별 처분
- **AC-1** API 서비스의 모든 IPC 채널은 `api:` 접두어를 쓰고 `src/main/ai/coverage/api.ts` 에 등재된다.
- **AC-2** 채널군별 처분은 아래와 같다:

  | 채널군 | 처분 | 대응 도구 / 제외 사유 |
  |---|---|---|
  | `api:listSpecs` · `api:getSpec` | 노출 | `api_list_specs` · `api_get_spec` |
  | `api:listVersions` | 노출 | `api_list_versions` (읽기만 — 컷은 아래에서 제외) |
  | `api:createSpec` · `api:updateSpec` · `api:setSpec` · `api:patchSpec` | 노출 | 쓰기 4종 |
  | `api:listRuns` · `api:getRun` | 노출 | `api_get_runs` — 응답 **모양까지**, 본문은 안 준다 |
  | `api:getDrift` · `api:listContractLogs` | 노출 | `api_get_drift` — 등급·커버리지를 반드시 함께 |
  | `api:runDrift` | **제외** | 판정 실행은 서버에 실제로 붙는 조작(introspection 요청). 결과 읽기는 열려 있다 |
  | `api:previewAbsorb` · `api:acceptAbsorb` | **제외** | 실제가 옳다고 단정할 근거가 없다 — 명세로 받아들이는 판단은 사람 몫(§ accept.absorb AC-3) |
  | `api:previewImport` | **제외** | 파일 조작. AI 는 문서를 직접 읽을 수 있다 |
  | `api:send` · `api:openStream` · `api:sendMessage` · `api:closeStream` | **제외** | 실행은 사람이 앱에서만 — § tools.absent AC-1 |
  | `api:startInbox` · `api:stopInbox` | **제외** | 로컬 포트를 여는 조작. 사람이 앱에서만 |
  | `api:deleteSpec` · `api:deleteEnvironment` · `api:deleteRun` | **제외** | 파괴적 조작은 사람이 앱에서만 |
  | `api:createVersion` · `api:lockVersion` | **제외** | 버전 컷은 사람 — § tools.write AC-5 |
  | `api:listEnvironments` · `api:saveEnvironment` | **제외** | 환경은 서버 주소·자격증명을 든다. AI 가 값을 알 이유가 없다 |
  | `api:import` · `api:export` | **제외** | 파일 시스템 조작. AI 는 파일을 직접 읽고 쓸 수 있다 |

- **AC-3** 두 서비스가 같은 채널을 등재하면 실패한다(조용한 덮어쓰기 방지) — 기존 규칙 그대로.
- **AC-4** 새 `api:` 채널을 만들면 이 표를 함께 갱신한다. 표에 없는 채널이 코드에 있으면
  `coverage.test.ts` 가 실패한다.
