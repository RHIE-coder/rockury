# gate run — 2026-07-29 · API 서비스 (명세 정본 + 구현 4개 증분)

- 기준 커밋(HEAD=부모): 069875d
- 범위: **API 서비스 신설 전체.** 정본 9문서(`docs/spec/api-*.md` 5 · `docs/qa/api-*.md` 4) +
  구현 4개 증분:
  1. 설계부 — 도메인 타입 · 순수 로직(함수·템플릿·해석·시그니처·깨지는 변경·부분 수정) ·
     저장소(`api_specs`/`api_requests`/`api_versions`) · IPC 9채널 · MCP 도구 9종 ·
     Studio(Requests·Docs) · e2e 13
  2. 운영부 — 조립/출처/차단 · 관측 모양 · 비밀 지우기 · 전송(실패 5갈래) ·
     `api_environments`/`api_runs` · Environments · Runner(Send·History) · e2e 14
  3. 판정 — drift 엔진(등급 2종·커버리지) · GraphQL introspection · 흡수 ·
     `api_contract_logs` · Contract(Drift·Accept·Logs) · e2e 15
  4. 주고받기 — YAML 부분집합 · OpenAPI/proto/GraphQL 가져오기 · 세 형식 내보내기 ·
     TransferDialog · e2e 16
- 결과:
  - typecheck (`npm run typecheck`): **PASS**
  - test (`npm test`): **PASS** — 1197 pass / 4 skip (신규 335)
    (shared/api: functions 21 · template 21 · resolve 13 · signature 18 · breaking 20 · patch 16 ·
     compose 20 · observed 15 · redact 11 · drift 24 · graphql 19 · absorb 12 · yaml 26 ·
     importOpenapi 23 · importOther 23 · exportSpec 18 / main: apiSpecs 19 · apiOps 15 · httpSend 8)
  - build (`npm run build`): **PASS**
  - e2e (`npm run e2e`): **PASS** — ALL PASS, 16/16 스위트 · 311 체크. 신규 4스위트 100체크:
    13-api-studio 22 · 14-api-runner 27 · 15-api-contract 26 · 16-api-transfer 25
  - surface-verify (`npm run surface-verify`): **status=ok** · 차단 0 · 관찰(baseline) 120
- drift:
  - 정본은 이번 작업에서 **신설**했고(spec 5 · qa 4), 구현 중 드러난 어긋남을 게이트에서 정렬했다:
    - `api-mcp.md`: 읽기 도구 4→**5종**(`api_list_versions`) · coverage.map 을 실제 채널 이름으로
      전면 갱신 · 연산 이름 `set_request_shape`→**`set_request_fields`** ·
      알림 채널이 `api:changed` 임을 명시(DB 의 `store:changed` 를 빌리지 않는다)
    - `api-studio.md` export AC-2: **헤더는 이름만 나간다**를 명문화(값 템플릿은 안 나감).
      내보내기에서 헤더가 통째로 빠져 계약이 사라지던 것을 구현·명세 양쪽에서 고쳤다.
    - `api-runner.md` observe **AC-3b 신설**: 응답 본문·헤더·오류 문구에서도 아는 비밀을 지운다.
      요청만 가리면 서버가 되돌려준 값이 남는다(e2e 로 실측해 잡음). 한계(모르는 값은 못 지움)도 명시.
    - `api-contract.md` drift.observed **AC-3b 신설**: JSON 이 아니어서 모양을 못 뽑은 것은
      통과가 아니라 `unparsable`. drift.complete AC-4 에 **`아직 안 만듦`** 사유 추가(우리 쪽 사정을
      "서버가 안 줬다"로 보이지 않게).
  - 인수조건 커버리지: **154 / 155**. 유일한 미커버는 `api-studio.mocking.server AC-1`(후속 범위,
    해당 QA 문서에 명시).
  - QA 커버리지 구멍 재점검: 각 QA 문서의 "미구현·미검증" 절을 **지금 사실에 맞게 다시 썼다** —
    Stream·Inbox·Versions 화면·전송 취소 UI·재실행·Run 비교·폴더 트리·응답 손편집·
    enum 편집·편집 중 미리보기·markdown 미리보기가 **정의는 있으나 미구현**임을 항목별로 적었다.
    (이전 문구는 "1차 로컬 전용" 같은 낡은 전제였다.)
  - 스테일 포인터 1건 수정: `docs/qa/api-mcp.md` S7 이 없는 스위트(`16-api-mcp`)를 가리키고 있었다
    → 실제 자리(`13-api-studio` 안)와 그 이유로 교체.
  - 공용 파일 영향: `src/main/ai/tools.ts` 2줄(도구 배열 합치기 + 타입 export) ·
    가드 테스트 3건을 **정확 일치 → 포함(superset)** 으로(무손실 의도는 유지, 서비스 성장 허용).
    그 외 공용 파일 미변경 — `main/index.ts`·`preload/index.ts`·각 registry 는 손대지 않았다.
- findings: review 단계 미실행(build 4회 연속). 리뷰는 후속.
- 판정: **PASS**
