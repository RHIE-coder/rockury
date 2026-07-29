# gate run — 2026-07-29 · API GraphQL 구독 전송

- 기준 커밋(HEAD=부모): `8b93117` (그 위에 main `88b65e6` 을 받아 rebase)
- 범위: **GraphQL 구독 전송 신설** + 리뷰 5관점 반영(지적 51건 중 high 8 전부 해소).
  1. 순수 로직 — `shared/api/graphqlWs.ts`(규약 상태기계 · 손잡기 순서 · 서버 메시지 해석 ·
     `id` 검사 · 인용 상한 · 구독 주소 변환 · 평문 고지) · `shared/api/stream.ts`
     (`graphql-ws` 전송 · `graphqlSubscribeBlocker` · 전송 이름)
  2. 전송 — `main/api/streamSession.ts`(`openGraphqlWs`·`applyGqlWs` · **회차 빗장·회차 가드** ·
     `roundEnded` 가 통로를 실제로 닫는다)
  3. 배선 — `main/ipc/api/stream.ts`(질의문·변수 `{{변수}}` 치환 · 붙기 전 차단 ·
     소켓 주소 · 사유를 가린 쪽에서)
  4. 화면 — `StreamView.tsx`(구독 사전 차단 · 사유 배너 여러 줄+스크롤)
  5. 검사 — `e2e/lib/api/wsFrames.mjs`(35번과 공유) · `e2e/lib/api/graphqlWsServer.mjs`
     (규약대로만 답하는 **진짜** 서버 4종) · `e2e/suites/40-api-graphql-sub.mjs` 신설
  6. `main` — e2e 스위트 구간 api 30–49 로 확장 + **구간 밖 번호 기계 차단**(`88b65e6`)

- 결과:
  - typecheck (`npm run typecheck`): **PASS**
  - test (`npm test`): **PASS** — 2081 pass / 4 skip (이전 2039 → **+42**)
    (신규: `graphqlWs.test.ts` 38 / 보강: `stream.test.ts` +4 · `isolation.test.ts` +1)
  - build (`npm run build`): **PASS**
  - e2e (`npm run e2e`): **PASS** — ALL PASS, 29/29 스위트 · **801 체크**(이전 776 → +25).
    신규 `40-api-graphql-sub` 27체크. `--no-db` 없이 전량 실행 — 건너뜀 0 · 미실행 0
  - surface-verify (`npm run surface-verify`): **status=ok** · 화면 58개 · 차단 **0**

- drift:
  - **정본을 갱신했다**(대부분 리뷰가 찾아낸 규칙의 명문화다):
    - `api-runner.md` § stream.session **AC-7c 보강 · AC-7d 신설** —
      붙기 전에 막기 · 질의문·변수도 치환 · 우리 `id` 의 답만 관측 · 규약 순서 어기는 서버에
      장단 안 맞추기 · 자른 뒤 가리기 · 평문 고지 · **회차가 끝나면 통로를 닫는다**(전 전송 공통)
    - `api-runner.md` § stream.session AC-7 — 전송 넷이 다 섰다
    - `api-service.md` §7 — 열린 항목에서 전송 항목 제거
  - 테스트 정의(`docs/qa/api-runner.md`):
    - **047a~047j · 058 신설**, 042b·055 **정정**
  - **정본이 삭제된 검사를 덮는다고 적던 것을 고쳤다**(리뷰 D-9·U-9):
    CASE-042b·055 의 "GraphQL 구독은 열리지 않고 사유가 온다" 가 동작과 정반대로 남아 있었다.
    직전 회차 Q-9 와 같은 종류의 재발이라 그 사실도 함께 적는다.

- 미검증으로 **남긴 것**(QA 문서에 등재, 조용한 통과 금지):
  - 구독 자동 재접속이 실제로 도는 것 · `wss://`(TLS) 경로 — 검사용 서버가 평문이다
  - 회차가 끝난 뒤 **열린 소켓 수를 세는 검사**는 없다(앱 안의 핸들을 봐야 한다).
    고친 근거는 리뷰의 실측(30회 → 핸들 60개)이다
  - 평문 고지 · `id` 가 다른 메시지 · 손잡기 전 소음 상한 — 단위 테스트로만 덮였다
  - `Session.send()` 의 else 갈래 — graphql 에 duplex 를 더하는 날 열린다
