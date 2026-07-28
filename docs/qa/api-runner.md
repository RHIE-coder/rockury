# TestPlan: api-runner (운영부 — Environments · Runner)

> 정의(무엇을 검증하나)만 여기. 코드는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 흐름 스위트 `e2e/suites/NN-*.mjs`.
> 대상 명세: `docs/spec/api-runner.md` · 불변식: `docs/spec/api-service.md` §2·§4.
> 회차 기록은 `docs/qa/runs/`.

## Scenario S1 — 값 해석 (순수 로직) — 이 서비스의 핵심 모델
- **CASE-apirunner-001** 해석 순서: `Request 기본값 < Environment 값 < 호출 파라미터`. 세 자리에 같은 이름이 있으면 호출 파라미터가 이긴다. 두 자리만 있어도 순서가 지켜진다. (resolution AC-1) → `api/runner/resolve.test.ts`
- **CASE-apirunner-002** 출처 표기: 해석 결과의 값마다 출처(`기본값`/`환경`/`호출`)가 실린다. 출처 없는 값은 결과에 없다. (resolution AC-2)
- **CASE-apirunner-003** 미해결 참조 차단: 어디에도 값이 없는 참조는 **실행 전에 차단**되고 이름이 지목된다. 빈 문자열 치환으로 넘어가면 실패. (resolution AC-3)
- **CASE-apirunner-004 (불변식 §2)** **두 바구니 분리**: 환경 값과 호출 파라미터가 한 목록으로 합쳐지지 않는다 — 해석기가 각 값의 갈래를 끝까지 들고 있다. 이름이 같아도 갈래가 섞이지 않는다. (values AC-3 · resolution AC-2)

## Scenario S2 — 환경 안전장치 (순수 로직)
- **CASE-apirunner-010** 복제 시 값 제거: 환경을 복제하면 변수 **이름만** 오고 값은 전부 빈다. 비밀 표식 여부는 유지된다. (list AC-3)
- **CASE-apirunner-011** 삭제 게이트: 실행 기록이 붙은 환경은 삭제되지 않고 **보관**으로 처리된다. 기록 없는 환경만 삭제된다. (list AC-4)
- **CASE-apirunner-012** 고아·구멍 판정: 어느 요청도 안 쓰는 값은 `고아`, 참조되는데 값이 빈 것은 `구멍`. 둘 다 아닌 것은 목록에 안 나온다. (values AC-4)
- **CASE-apirunner-013** 마스킹: 비밀 표식 값은 표시용 변환에서 `••••` 로 나오고 원문 길이가 유추되지 않는다. (values AC-2)
- **CASE-apirunner-015** 카드 데이터 파생: 환경 카드에 이름·서버 주소·마지막 실행 시각이 담긴다. 실행 이력이 없으면 시각 자리가 `없음`이지 빈 문자열이 아니다. (list AC-1)
- **CASE-apirunner-016** active 일치: 카드 선택과 컨텍스트 바 셀렉터가 **항상 같은 값**을 가리킨다. 한쪽만 바뀌는 경로가 없다. (list AC-2)
- **CASE-apirunner-017** 값 편집 모델: 같은 이름을 두 번 넣으면 거부, 비밀 표식 토글이 값 수정 후에도 보존된다. (values AC-1)
- **CASE-apirunner-014 (불변식 ⑥)** **나가는 문 전수 검사**: 내보내기·복제·MCP 응답 세 경로 모두에서 환경 값 실값이 결과에 **한 글자도 없다.** 경로 하나라도 새면 실패. (values AC-5) → `api/environments/redact.test.ts`

## Scenario S3 — 요청 조립·실행 (순수 로직)
- **CASE-apirunner-020** 최종 요청 조립: 시그니처 + 환경 + 템플릿 → 경로·쿼리·헤더·본문이 완성된다. 경로 안 치환과 쿼리 인코딩이 정확. (compose AC-2)
- **CASE-apirunner-021** 미리보기 마스킹: 최종 요청 미리보기에서도 비밀 표식 값은 가려진다. (compose AC-3)
- **CASE-apirunner-022** 보내기 차단 조건: 필수 파라미터 누락 또는 미해결 참조가 있으면 조립 결과가 `차단`이고 이유가 실린다. (compose AC-4)
- **CASE-apirunner-023** 오류 분류: 연결 실패 · 타임아웃 · TLS 오류 · HTTP 오류 응답이 서로 다른 종류로 분류된다. 하나로 뭉뚱그리면 실패. (execute AC-4)
- **CASE-apirunner-024** curl/fetch 생성: 조립된 요청 → 실행 가능한 curl·fetch 문자열. **비밀 표식 값은 변수 이름으로 남고 실값이 안 박힌다.** (execute AC-5)
- **CASE-apirunner-025** 본문 표현 판정: 응답 본문을 JSON·텍스트·바이너리로 분류하고, 바이너리는 내용 대신 크기·형식만 낸다(거대 본문으로 화면이 죽지 않게). (execute AC-2)
- **CASE-apirunner-026** 취소 기록: 취소된 실행도 Run 으로 남고 결과가 `취소` 다 — 실패와 구분된다. (execute AC-3 · observe AC-1)

## Scenario S4 — 관측 기록 (순수 로직)
- **CASE-apirunner-030** Run 구성: 요청·파라미터·환경·**기준 버전**·요청 전문·응답 전문·시각·소요가 모두 담긴다. 기준 버전이 빠지면 실패(판정이 버전을 못 가른다). (observe AC-1)
- **CASE-apirunner-031** Run 불변성: 명세를 바꾼 뒤에도 지나간 Run 의 내용이 그대로다. (observe AC-2)
- **CASE-apirunner-032** Run 마스킹: 저장된 Run 에 비밀 표식 값이 가려진 채로 들어간다 — 기록 열람·MCP 어느 경로로도 실값이 안 나온다. (observe AC-3) → `shared/api/redact.test.ts`
- **CASE-apirunner-032b (응답 경로)** **서버가 되돌려준 비밀도 지운다** — 응답 본문·응답 헤더·오류 문구까지 훑는다(키를 에코하는 서버). 긴 값부터 지워 짧은 값이 긴 값을 잘라 먹지 않는다. 4글자 미만은 안 지운다. **우리가 모르는 값(서버 발급 토큰)은 못 지운다** — 그래서 MCP 에는 본문을 안 준다. (observe AC-3b)
- **CASE-apirunner-033** 기록 실패 격리: Run 저장이 실패해도 실행 결과는 정상 반환된다. (observe AC-4)
- **CASE-apirunner-034** 상한 처리: 보관 상한을 넘겨 지워진 건수가 집계되어 표시된다. **조용히 사라지면 실패.** (history.list AC-5)
- **CASE-apirunner-035** 기록 필터: 요청별·환경별·상태별·기간 필터가 조합으로 동작한다. (history.list AC-2)
- **CASE-apirunner-036** 두 Run 비교: 응답의 추가/삭제/변경된 필드를 가려낸다. (history.list AC-4)
- **CASE-apirunner-037** 목록 행 파생: 시간 **역순** 정렬, 각 행에 요청 이름·환경·상태·소요가 담긴다. (history.list AC-1)

## Scenario S5 — 스트림·수신 (순수 로직)
- **CASE-apirunner-040** 보내기 패널 가시성 판정: 양방향(WebSocket·gRPC 양방향/클라이언트)은 패널 있음, 서버 스트리밍(SSE·gRPC server-streaming)은 **패널 없음**(비활성이 아니라 없음). (stream.session AC-3)
- **CASE-apirunner-041** 타임라인 조립: 보낸 것/받은 것이 방향 표식과 함께 시간순으로 정렬된다. 재접속 시도도 항목으로 들어간다. (stream.session AC-2/AC-4)
- **CASE-apirunner-042** 세션 → Run: 세션 하나가 Run 하나가 되고 메시지 목록이 그 관측 내용이다. (stream.session AC-6)
- **CASE-apirunner-043** 수신 본문 대조: 들어온 본문을 선언한 기대 스키마와 대조해 맞음/어긋남을 가린다. **스키마 선언이 없으면 `선언 없음`이고 맞음이 아니다.** (inbox.received AC-3)
- **CASE-apirunner-044** 포트 충돌 처리: 쓰는 포트면 이유를 알리고 다른 포트를 제안한다. (inbox.listener AC-2)
- **CASE-apirunner-045** 타임라인 도구: 검색·필터가 메시지 목록에 동작하고, 메시지 하나 복사·전체 내보내기가 원문을 보존한다. (stream.session AC-5)
- **CASE-apirunner-046** 수신 목록 행: 들어온 요청이 시간순으로 쌓이고 메서드·경로·크기·시각이 담긴다. 헤더·본문 전문이 보존된다. (inbox.received AC-1/AC-2)
- **CASE-apirunner-047** 수신 → Run: 웹훅 수신 하나가 Run 하나가 된다 — 웹훅도 관측 기록이다. (inbox.received AC-4)
- **CASE-apirunner-048** 수신 응답 코드: 기본 `200`, 지정하면 그 코드로 응답한다(재전송 유도를 위해 실패 코드도 낼 수 있어야 한다). (inbox.received AC-5)

## Scenario S6 — 앱 구동 흐름 (e2e/suites/14-api-runner, CSS/text 로케이터만)
- **CASE-apirunner-050 (오조작 방지)** 앱 진입 직후 Environment 가 **선택되지 않음**이고 실행 버튼이 비활성이다. 이유 툴팁이 보인다. (guard AC-1)
- **CASE-apirunner-051** 환경 선택 → 실행 버튼 활성. 서비스를 나갔다 오면 다시 선택 안 됨으로 돌아간다. (guard AC-1/AC-4)
- **CASE-apirunner-052** 운영 표식 환경 선택 → 상단 상시 경고 띠가 보이고, 실행 시 요청 이름과 환경 이름이 들어간 확인 게이트가 뜬다. (guard AC-2/AC-3)
- **CASE-apirunner-053** Send: 파라미터 입력 → 최종 요청 미리보기에 **출처 표시**가 보인다 → 실행 → 응답과 소요 시간 표시. (compose AC-1/AC-3 · execute AC-1)
- **CASE-apirunner-054** History: 실행 후 기록에 항목이 늘고, 열면 요청/응답 전문이 보이며 다시 실행이 동작한다. (history AC-1/AC-3)
- **CASE-apirunner-055** Stream: SSE 접속 → 타임라인에 이벤트가 쌓이고 **보내기 패널이 없다**. 끊기 후 상태와 이유가 보인다. (stream.session AC-1/AC-2/AC-3)
- **CASE-apirunner-056** Inbox: 수신 대기 켜기 → 주소 표시 + **"이 컴퓨터 안에서만 닿습니다"** 안내. 로컬에서 쏜 요청이 목록에 뜬다. 앱 재시작 후 대기는 꺼짐으로 시작. (inbox.listener AC-1/AC-3/AC-4)

## 미구현 · 미검증 (조용한 통과 금지)
> 아래는 **정의는 있으나 아직 만들지 않은 것**이다. 케이스가 적혀 있다고 통과한 것이 아니다.
- **Stream(S5 의 040~042·045 · S6 의 055)** — WebSocket·SSE 전송 계층부터 미구현. 화면은 자리표시자.
- **Inbox(S5 의 043·044·046~048 · S6 의 056)** — 로컬 수신 서버 미구현. 화면은 자리표시자.
- **전송 취소 UI(026 의 일부)** — 분류·`AbortSignal` 은 구현·테스트 완료, IPC 취소 경로와 버튼이 없다.
- **재실행·두 Run 비교(036 · S6 054 의 "다시 실행")** — 화면 미구현.
- **고아·구멍 표시(012)** — 판정 로직 자리는 있으나 화면에 안 붙었다.
- **외부 터널** — 1차 로컬 전용이므로 외부 콜백 수신 케이스는 없다. 터널 도입 시 승격.
- **gRPC 스트리밍 4종** — 구현 순서상 GraphQL·REST 이후다.
