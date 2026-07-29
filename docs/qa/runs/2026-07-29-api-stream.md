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

---

# gate run — 2026-07-29 · API Runner › Inbox (로컬 웹훅 수신)

- 기준 커밋(HEAD=부모): `675ec53`
- 범위: **Runner › Inbox 신설.** 자리표시자 2 → 1(Mocking 만 남음).
  1. 순수 로직 — `shared/api/inbox.ts`(기대 본문 대조 4갈래 · 포트 제안 · 수신→Run · 목록 행 파생)
  2. 수신 서버 — `main/api/inboxServer.ts`(`node:http`, **`127.0.0.1` 고정 바인딩**,
     본문 2MB 상한, 목록 500건 상한)
  3. IPC/창구 — `main/ipc/api/inbox.ts` 4채널(전부 MCP 제외 등재) · preload `apiInbox`
  4. 화면 — `runner/InboxView.tsx` · `runner/inboxStore.ts`
  5. e2e — `e2e/suites/19-api-inbox.mjs`(앱 밖 노드에서 실제 HTTP 를 쏴서 검증)

- 결과:
  - typecheck (`npm run typecheck`): **PASS**
  - test (`npm test`): **PASS** — 1290 pass / 4 skip (이전 1263 → **+27**, 전부 `inbox.test.ts`)
  - build (`npm run build`): **PASS**
  - e2e (`npm run e2e`): **PASS** — ALL PASS, 19/19 스위트 · **407 체크**(이전 372 → +35).
    신규 `19-api-inbox` 35체크. 건너뜀 0 · 미실행 0
  - surface-verify (`npm run surface-verify`): **status=ok** · 차단 **0** · 관찰 120
    (자리표시자를 실화면으로 바꾼 것이라 화면 수 불변)

- drift:
  - `api-runner.md` § inbox.received **AC-6 신설**(대조 결과 네 갈래 — `선언 없음`·`대조 불가`를
    맞음으로 뭉치지 않는다 · 선언에 없는 필드가 더 와도 어긋남이 아니다 · `모름` 제외 건수) ·
    § inbox.listener **AC-7~AC-10 신설**(받는 모양만 · 비밀 수신 경로 · 상한/조용한 소실 금지 ·
    기록은 관문이 아니다) · AC-5 보강(코드 변경이 대기를 안 끊는다)
  - `docs/qa/api-runner.md` CASE-apirunner-**043 보강 · 043b 신설 · 044 보강 · 047 보강 ·
    056 전면 재작성**. 미구현 절에서 **Inbox 항목 삭제**(구현 완료)
  - **커버리지 구멍 재점검**: "Inbox — 로컬 수신 서버 미구현" **전제 해소** → 삭제.
    "외부 터널" 전제 유효 — 화면 상시 문구 + `127.0.0.1` 코드 고정으로 뒷받침한다고 보강

- 미검증으로 남긴 것:
  - **본문 2MB·목록 500건 상한** — "잘렸다/버렸다" 를 적는 것까지 구현했으나 e2e 로 안 밟았다
  - **앱 재시작 후 대기 꺼짐** — 아무것도 자동 복원하지 않아 구조적으로 보장되지만,
    `12-cold-restart` 가 API 스위트보다 먼저 돌아 재시작 검증에 안 들어간다(`main` 몫)
  - **UI 시각 리뷰** — Stream 회차와 같은 이유로 이번에도 못 돌렸다(에이전트 세션 한도).
    기계 검증(surface 차단 0 · e2e 35체크)만 통과

- 판정: **PASS**

---

# gate run — 2026-07-29 · API 있는 화면의 빈칸 9개

- 기준 커밋(HEAD=부모): `26b073a`
- 범위: **정본에 정의는 있는데 화면이 비어 있던 자리 9개.**
  Studio 5 — 요청 트리 폴더 계층·끌어 옮기기 · enum 허용 값 편집 · 응답 모양 손편집 ·
  편집 중 치환 미리보기 · markdown 미리보기
  Runner 3 — 전송 취소 UI · 다시 실행 · 두 Run 비교
  Environments 1 — 고아·구멍 표시

- 새 순수 로직(테스트 먼저): `shared/api/envHealth.ts`(12) · `runDiff.ts`(12) ·
  `tree.ts`(20) · `markdown.ts`(23) = **67건**

- 결과:
  - typecheck (`npm run typecheck`): **PASS**
  - test (`npm test`): **PASS** — 1357 pass / 4 skip (이전 1290 → **+67**)
  - build (`npm run build`): **PASS**
  - e2e (`npm run e2e`): **PASS** — ALL PASS, 20/20 스위트 · **450 체크**(이전 407 → +43).
    신규 `20-api-gaps` 43체크. 건너뜀 0 · 미실행 0
  - surface-verify: **status=ok** · 차단 **0** · 관찰 120

- drift:
  - **구현하다 정본의 빈틈을 하나 찾아 메웠다** — `RunRecord` 가 **호출 파라미터를 안 담고
    있었다.** `send.observe AC-1` 은 "요청 · **파라미터** · 환경 …" 이라고 적혀 있는데
    저장은 안 했다(조립된 주소에서는 되돌릴 수 없다 — 치환은 한 방향이다). 다시 실행이
    그 빈틈을 드러냈다. `api_runs.call_json` 추가 + 구 스키마 `alter` 보정.
  - `api-runner.md`: observe **AC-1 보강**(파라미터를 따로 담는 이유) · history **AC-3 보강**
    (가려진 값은 되살리지 않고 지목 · 새 기록이 하나 더) · **AC-4 보강**(순서가 뜻을 갖는다 ·
    판정과 다른 자리 · 비교 불가를 "같다"로 안 바꾼다) · values **AC-4 보강** ·
    execute **AC-3 보강**(취소 손잡이는 화면이 만든다)
  - `api-studio.md`: tree **AC-1 보강**(폴더는 엔티티가 아니라 경로 · 자기 자손 금지 이유 ·
    검색 중 평평) · response **AC-2 보강**(새 필드 기본값은 `모름`) · docs.authored **AC-2 보강**
    (어디까지 그리는지 · 링크 스킴 제한 · 토막 트리) · **template AC-7 신설**(enum 편집)
  - QA: `api-studio.md` **003b 신설** · 051·032·062 보강 / `api-runner.md` 012·026·036 보강 ·
    **036b 신설**. 미구현 절에서 **9개 항목 삭제**(구현 완료)
  - **커버리지 구멍 재점검**: 삭제한 9개 전제가 전부 해소됐다. 새로 등재한 것 2건 —
    폴더 이름 바꾸기·폴더째 옮기기의 **화면 손잡이 없음**(순수 로직은 있고 테스트로 덮임),
    스트림·수신 기록의 다시 실행은 **의도적으로 안 만듦**

- 구현하다 드러난 것 (고침):
  - `string → enum` 전환이 **구조적으로 막혀 있었다.** 빈 허용 목록은 저장이 거부되는데
    (옳은 규칙), 글자마다 저장하면 허용 값을 치기 전 빈 상태를 반드시 지난다. 타입과 허용
    값을 **함께 커밋**하도록 고쳤다(`NameInput` 과 같은 수법 — 커밋 시점을 옮긴다).
  - `api:send` 의 막힘 문구가 **가리지 않은 쪽**을 쓰고 있었다(스트림에서 고친 것과 같은 결함).
    같이 고쳤다.

- 미검증으로 남긴 것:
  - **UI 시각 리뷰** — 이번에도 못 돌렸다(세션 한도). markdown 미리보기·트리 들여쓰기·비교
    패널의 시각 품질은 기계 검증(surface 차단 0)만 통과했고 사람 눈 미확인
  - 폴더 이름 바꾸기·폴더째 옮기기의 화면 손잡이(위 등재)

- 판정: **PASS**

---

# gate run — 2026-07-29 · API Studio › Mocking (자리표시자 0)

- 기준 커밋(HEAD=부모): `d9aa5fd`
- 범위: **Studio › Mocking 신설 — 마지막 자리표시자.** 이제 IA 의 모든 자리가 실제 화면이다.
  1. 순수 로직 — `shared/api/mock.ts`(가짜 본문 생성 · 필수여부 번역 · 경로 대조 · 상태 고르기 ·
     흉내 낼 수 있는 범위 판정)
  2. 서버 — `main/api/mockServer.ts`(`node:http`, **`127.0.0.1` 고정 바인딩**)
  3. IPC/창구 — `main/ipc/api/mocking.ts` 4채널(전부 MCP 제외 등재) · preload `apiMock`
  4. 화면 — `studio/MockingWorkspace.tsx`
  5. e2e — `e2e/suites/21-api-mocking.mjs`(앱 밖 노드에서 실제 HTTP 를 쏴서 검증)

- 결과:
  - typecheck (`npm run typecheck`): **PASS**
  - test (`npm test`): **PASS** — 1385 pass / 4 skip (이전 1357 → **+28**)
  - build (`npm run build`): **PASS**
  - e2e (`npm run e2e`): **PASS** — ALL PASS, 21/21 스위트 · **481 체크**(이전 450 → +31).
    신규 `21-api-mocking` 31체크. 건너뜀 0 · 미실행 0
  - surface-verify: **status=ok** · 차단 **0** · 관찰 120

- drift:
  - `api-studio.md` § mocking.server 를 **AC-1 한 줄에서 AC-1~AC-8 로 확장**했다 —
    지어내지 않음(501 과 사유, 404 가 아닌 이유) · 값은 일부러 가짜처럼 · 필수여부를 값으로
    번역(`없을 수 있음` → null · `모름` → 짐작 건수) · 상태 고르기(서버 안 끊음) ·
    **관측이 아니다** · 범위(REST 만, 강등 금지, 화면·창구 양쪽에서 막음) · 로컬 전용/꺼짐 시작
  - `api-service.md` §3 IA 에서 "Mocking(후속)" 표기 제거 · §7 열린 항목에서 Mocking 삭제
  - `docs/qa/api-studio.md` **Scenario S8 신설**(CASE-apistudio-090~096) ·
    미구현 절에서 Mocking 삭제 → **"유일한 미커버 인수조건" 이 해소됐다**
  - `docs/qa/api-mcp.md` 열린 항목의 **스위트 번호가 stale**(13~16)이던 것을 13~21 로 고치고,
    Inbox 의 재시작 미검증이 정확히 이 순서 문제 때문임을 명시

- 미검증으로 남긴 것:
  - **UI 시각 리뷰** — 세 회차 연속 못 돌렸다(에이전트 세션 한도). 기계 검증만 통과
  - GraphQL·JSON-RPC·gRPC 모의 — 흉내 내지 않는 것이 **의도**이고 그 사실을 검사한다(095)

- 판정: **PASS**

---

# gate run — 2026-07-29 · 스트림·수신 관측의 대조 규칙

- 기준 커밋(HEAD=부모): `2ae7613`
- 범위: 판정이 **드러내기만 하던 것을 실제로 대조**하게 했다.
  · 스트림 — 메시지의 **이벤트 이름**이 선언을 고른다(`ResponseDef.status` 가 그 자리)
  · 수신 — 선언은 **기대 본문**이고, 받을 때 쓴 것과 **같은 함수**로 다시 본다
  · 이름 없는 메시지는 **하나뿐인 선언에 갖다 붙이지 않고** 못 맞춘 건수로 센다
  · `DriftResult.unroutedMessages` 신설(0 이어도 실린다)

- 결과:
  - typecheck · build: **PASS**
  - test (`npm test`): **PASS** — 1395 pass / 4 skip (이전 1385 → +10)
  - e2e (`npm run e2e`): **PASS** — 21/21 스위트 · **487 체크**(이전 481 → +6)
  - surface-verify: **status=ok** · 차단 **0**

- 구현하다 드러난 것 (고침):
  - **판정이 메시지 본문을 못 읽고 있었다.** 목록 조회가 본문을 안 싣도록 바꾼 것(성능)과
    새 대조 규칙이 정면으로 부딪혔다 — 단위 테스트는 통과하는데 실제 앱에서는 전부
    `unjudged` 로 떨어졌다(e2e 가 잡았다). `latestSessionRuns` 를 만들어 **요청마다 최신
    세션 하나씩만** 본문까지 읽는다 — 단발이 "가장 최근 성공 Run" 을 쓰는 것과 같은 규칙이라
    규칙이 갈리지 않고 읽는 양이 요청 수만큼으로 묶인다.
  - **SSE 에는 이름 없는 메시지가 없다** — 규약이 `event` 기본값을 `message` 로 정한다.
    이름 없는 경우는 WebSocket 프레임이다. e2e 검사를 각각이 실제로 성립하는 자리로 옮겼다.

- drift:
  - `api-contract.md` § drift.observed **AC-6 을 전면 재작성** — 대조 방법(이벤트 이름 ·
    기대 본문) · 추측 금지 · 하나도 못 맞춤/일부만 맞춤의 구분 · 최신 세션 하나만 ·
    읽는 양을 묶는 이유
  - `docs/qa/api-contract.md` **017·018 신설** · 011c 문구 정정 · 미구현 절 갱신
  - `docs/qa/api-runner.md` · `docs/spec/api-service.md` 에서 "스트림 판정 규칙 없음" 항목 삭제,
    **남은 한계(이름 없는 메시지)를 그 자리에 등재**

- 미검증으로 남긴 것:
  - **이름 없는 메시지의 본문 판별 필드 대조** — 안 만든다. "어느 필드가 판별자인가"를
    선언에 더해야 하는데 모델이 늘어서, 실제 필요가 나오면 그때 연다(등재됨)
  - **UI 시각 리뷰** — 네 회차 연속 못 돌렸다

- 판정: **PASS**

---

# gate run — 2026-07-29 · 늦게 더한 비밀 · 미검증 e2e 3건

- 기준 커밋(HEAD=부모): `69df383`
- 범위:
  1. **미해결 1건 해소** — 세션·대기 **도중** 환경에 비밀을 더하면 그 뒤 오는 것이 안 가려지던 것.
     가리는 목록을 시작 시점에 가두지 않고 **매번 최신 환경을 읽는다**(읽기 실패는 시작 시점
     목록으로 물러난다 — 가리는 것이 없는 것보다 낫다).
  2. **미검증 e2e 3건 해소** — 자동 재접속이 실제로 도는 것 · 수신 본문 2MB 상한 ·
     늦게 더한 비밀

- 결과:
  - typecheck · build · test: **PASS** — 1395 pass / 4 skip
  - e2e: **PASS** — 21/21 스위트 · **493 체크**(이전 487 → +6)
  - surface-verify: **status=ok** · 차단 **0**

- drift:
  - `api-runner.md` § stream.session **AC-8 보강** · § inbox.listener **AC-8 보강**
    (가리는 목록을 시작 시점에 안 가둔다)
  - `docs/qa/api-runner.md` **042g 신설** · 미구현 절에서 "세션 중 환경 편집" **삭제**(해소),
    본문 상한·자동 재접속 항목을 **실제로 남은 것만** 남기게 좁힘

- 여전히 미검증으로 남긴 것 (좁혀진 상태):
  - **수신 목록 상한 500건** · **재접속 총 상한 20회** — 유발하려면 스위트가 분 단위로 길어진다.
    정책 자체는 단위 테스트로 덮였다
  - **연결 제한시간 30초** — 같은 이유
  - **앱 재시작 후 대기 꺼짐** — `12-cold-restart` 실행 순서(`main` 몫)
  - **UI 시각 리뷰** — 이번 회차에 다시 띄웠다(결과는 별도)

- 판정: **PASS**

---

# gate run — 2026-07-29 · UI 시각 리뷰 반영 (네 회차 밀린 것)

- 기준 커밋(HEAD=부모): `e02fcdf`
- 범위: UI 시각 관점 리뷰(화면 8종 실물 드라이브 5회) 지적 22건 중 **high 5 + medium 8 해소**.
  산출물 `.harness/steward/artifacts/feat-api/findings-ui.md`

- 결과:
  - typecheck · build · test: **PASS** — 1395 pass / 4 skip
  - e2e: **PASS** — 21/21 스위트 · 493 체크
  - surface-verify: **status=ok · 차단 0 · 관찰 120 → 107** (저대비 칩 13개 제거)

- 가장 큰 것: **`--color-danger-soft` 가 선언조차 안 돼 있었다.** 세트의 다른 4개
  (`accent-soft`·`accent-2-soft`·`success-soft`·`info-soft`)는 다 있는데 이것만 빠졌고,
  Tailwind v4 가 미선언 키의 유틸리티를 안 만들어 **쓰는 자리 24곳이 전부 투명**하게
  렌더됐다 — 위험 표시만 채움이 없어 **위계가 정확히 반전**됐다.
  `#fdf2f1`(danger 얹어 4.61:1, AA 통과) 로 선언. `globals.css` 는 공용 파일이지만
  **추가만** 했고 쓰는 곳이 이 서비스뿐이라 다른 서비스에 영향 없음.

- **기계 검증의 한계가 드러났다:** `surface-verify` 순회는 각 화면의 기본 빈 상태만 훑어서
  데이터가 있어야 나타나는 칩과 투명 배경을 못 본다. "차단 0" 을 이 화면들의 통과 근거로
  쓰면 안 된다. `token-guard` 미바인딩이 이번 건을 놓친 직접 원인이다.

- drift: 정본 변경 없음(전부 화면 표현). `docs/qa/api-runner.md` 미구현 절의
  "UI 시각 미확인" 항목을 **남긴 지적 6건**으로 교체.

- 남긴 것 6건: `accent-2` 대비(db 공유 토큰 — `main` 몫) · 환경 값 행 흔들림(추정) ·
  Inbox 상세 헤더 접기 · 넓은 폭 목록 분리(`main` 몫) · `KIND_META.risk` 미표시 ·
  리사이즈 손잡이 포커스(공용 파일, `main` 몫)

- 판정: **PASS**
