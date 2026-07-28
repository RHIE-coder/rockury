# gate run — 2026-07-29 · API Runner › Stream (WebSocket · SSE)

- 기준 커밋(HEAD=부모): `65e23ae`
- 범위: **Runner › Stream 신설** + 리뷰 5관점 반영. 자리표시자 3 → 2.
  1. 순수 로직 — `shared/api/sse.ts`(SSE 프레임 증분 파서) ·
     `shared/api/stream.ts`(전송 선택 · 패널 가시성 · 타임라인 필터/내보내기 ·
     재접속 정책 · 세션→Run · 결과 갈래)
  2. 전송 — `main/api/streamSession.ts`(WebSocket 전역 + `fetch` 스트림, 세션 등록부,
     자동 재접속, 연결 제한시간, 상한 4종, 화면 밀기 묶음)
  3. IPC/창구 — `main/ipc/api/stream.ts` 4채널(전부 MCP 제외 등재) · preload `apiStream`
  4. 화면 — `runner/StreamView.tsx` · `runner/streamStore.ts` ·
     `runner/HistoryView.tsx`(세션 메시지 열람) · `contract/DriftView.tsx`(판정 규칙 없음)
  5. 저장 — `api_runs` 에 `shape`·`messages_json`·`message_count`(+ 구 스키마 `alter` 보정),
     목록 조회 컬럼 투영, `getRun` 직접 조회
  6. 판정 — `DriftCoverage.unjudged` 신설 · `normalizeDrift` · 완전/관측 두 경로 공통 규칙
  7. e2e — `e2e/suites/18-api-stream.mjs` 신설(자체 SSE 서버 + 손으로 구현한 WebSocket 서버)

- 결과:
  - typecheck (`npm run typecheck`): **PASS**
  - test (`npm test`): **PASS** — 1263 pass / 4 skip (이전 1197 → **+66**)
    (신규: `sse.test.ts` 19 · `stream.test.ts` 32 / 보강: `drift.test.ts` 24→35 ·
     `redact.test.ts` +2 · `patch.test.ts` +2)
  - build (`npm run build`): **PASS**
  - e2e (`npm run e2e`): **PASS** — ALL PASS, 18/18 스위트 · **372 체크**(이전 333 → +39).
    신규 `18-api-stream` 39체크. `--no-db` 없이 전량 실행 — 건너뜀 0 · 미실행 0
  - surface-verify (`npm run surface-verify`): **status=ok** · 화면 44개 · 차단 **0** ·
    관찰(baseline 수용) 120

- drift:
  - **정본을 갱신했다**(코드가 앞서간 것을 뒤에서 맞춘 것이 아니라, 리뷰가 찾아낸 규칙을 명문화):
    - `api-runner.md` § stream.session **AC-7~AC-14 신설** — 전송 범위(강등 금지) · 비밀 세션 경로 ·
      연결 제한시간 · 재접속 총 상한 · 원격 입력 상한 · 화면 상한=기록 상한 ·
      주인 없는 세션 정리 · 세션 관측 열람. 세션 식별자를 화면이 만드는 이유도 명시
    - `api-runner.md` § send.observe **AC-3b 보강** — 되돌려주는 형태가 원문이 아닐 수 있다
      (URL 인코딩·base64). 해시·서명은 못 지운다는 한계. 우리가 만든 문자열은 지우는 그물을
      믿지 않고 조립기가 가린 것을 쓴다
    - `api-contract.md` § drift.observed **AC-6 신설 + AC-7 신설** — 판정 규칙 없는 관측
      (`unjudged`) · 못 붙은 세션은 미관측 · 선언이 아니라 실행으로 가른다 ·
      완전 판정도 같은 규칙 · 저장된 옛 판정 결과 보정
    - `api-service.md` §7 — 열린 항목 2건 추가(gRPC·GraphQL subscription 전송 · 스트림 판정 규칙)
  - **테스트 정의도 갱신**: `docs/qa/api-runner.md` CASE-apirunner-**042b·042c·042d·042e·042f 신설** ·
    042·045·055 보강 / `docs/qa/api-contract.md` CASE-apicontract-**011c·011d 신설** · 012 보강
  - **커버리지 구멍 재점검(전제가 낡았는지)**:
    - `docs/qa/api-runner.md` 의 "Stream 미구현" 항목 — **전제 해소됨**, 삭제하고 구현 항목으로 승격
    - "전송 취소 UI" — 전제 **일부 해소**(스트림 끊기는 구현). 단발 전송 쪽만 남았다고 좁혔다
    - "gRPC 스트리밍 4종" — 전제 유효. **다만 지금은 "사유를 띄우는 것까지가 구현"** 임을 명시하고
      그 사실을 검사하는 케이스(042b·e2e)를 붙였다
    - `docs/qa/api-contract.md` 의 스트림 대조 규칙 — 전제 유효. `unjudged` 로 드러내는 것까지가
      구현임을 명시
  - **명세 영향 없음으로 판정한 변경**: `shared/api/patch.ts` 의 `add_request` 기본 모양
    (`unary` → 그 인터페이스의 첫 모양). 화면이 이미 쓰던 규칙과 같게 맞춘 것이라 새 정책이
    아니다 — 다만 `docs/spec/api-mcp.md` § tools.write 의 연산 목록에는 모양 인자가 이미 있어
    노드 갱신 불필요. 회귀 테스트 2건 동반.

- 미검증으로 남긴 것 (조용한 통과 금지 — `docs/qa/api-runner.md` 미구현 절에 등재):
  - **UI 시각 리뷰 관점** — 에이전트가 API 세션 한도로 조기 종료해 **못 돌렸다.**
    12축 rubric 채점·스크린샷 증거 없음. 기계 검증(surface-verify 차단 0 · e2e 39체크)은 통과.
    색맹 대비·상태 배지 5종 대비·밀도는 **사람 눈으로 미확인**
  - 자동 재접속·타임라인 5,000건 상한·연결 제한시간 30초의 **e2e** (순수 로직은 테스트로 덮임)
  - 세션 도중 환경에 비밀을 새로 추가하면 그 뒤 메시지가 안 가려짐 (미해결로 등재)
  - `token-guard` 능력 **미바인딩** (프로젝트 설정대로 — 하드코딩 색 정적 검사 없음)

- 판정: **PASS** — 전체 검사 4종 + UI 게이트 통과, 정본·테스트 정의 갱신 완료.
