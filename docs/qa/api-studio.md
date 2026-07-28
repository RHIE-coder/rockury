# TestPlan: api-studio (설계부 — Studio · Versions)

> 정의(무엇을 검증하나)만 여기. 코드는 대상 모듈 옆 `*.test.ts`(vitest) + 앱 흐름 스위트 `e2e/suites/NN-*.mjs`.
> 대상 명세: `docs/spec/api-studio.md` · 불변식: `docs/spec/api-service.md` §4·§5.
> 회차 기록은 `docs/qa/runs/`.

## Scenario S1 — 파라미터 시그니처 (순수 로직)
- **CASE-apistudio-001** 시그니처 검증: 필수 파라미터 누락 시 실행 차단 + 빠진 이름 목록 반환. 다 채워지면 통과. (signature AC-3) → `api/studio/signature.test.ts`
- **CASE-apistudio-002** 타입 검증: `string`/`number`/`boolean`/`enum`/`object`/`array` 각각에 대해 맞는 값은 통과, 틀린 값은 어느 파라미터가 왜 틀렸는지 지목. (signature AC-1)
- **CASE-apistudio-003** enum 경계: 허용 목록 안 값은 통과, 목록 밖 값은 거부하며 허용 목록을 함께 반환. 빈 허용 목록은 정의 오류로 거부. (signature AC-2)
- **CASE-apistudio-004** 시그니처 직렬화: 파라미터 정의 → MCP 응답 형태(이름·타입·필수·기본값·설명)로 손실 없이 변환. (signature AC-5)

## Scenario S2 — 템플릿 치환과 내장 함수 (순수 로직)
- **CASE-apistudio-010** 참조 치환: `{{이름}}` 이 파라미터·환경 값으로 치환된다. 경로·쿼리·헤더·본문 모든 자리에서 동작. (template AC-1)
- **CASE-apistudio-011** 미상 참조 거부: 어디에도 없는 이름은 **실행 전에** 거부하고 그 이름을 지목한다. **빈 문자열로 조용히 치환하지 않는다.** (template AC-3 · resolution AC-3)
- **CASE-apistudio-012** 이스케이프: 리터럴 `{{` 는 치환되지 않고 그대로 남는다. (template AC-5)
- **CASE-apistudio-013** 함수 중첩: `{{base64(hmac('sha256', k, timestamp()))}}` 가 안쪽부터 평가되어 한 값으로 접힌다. (template AC-4)
- **CASE-apistudio-01A** 함수 호출 인식: `{{이름}}`(참조)과 `{{이름(...)}}`(함수 호출)을 가른다. 인자 개수가 안 맞으면 거부하고 기대 인자를 알린다. (template AC-2)
- **CASE-apistudio-014** 미상 함수 거부: 목록에 없는 함수 이름은 거부하고 가장 가까운 이름을 제안한다. (template AC-3)
- **CASE-apistudio-015** 내장 함수 — 인코딩: `base64`/`base64decode` 왕복 일치, `urlencode`/`urldecode` 왕복 일치, 비ASCII·빈 문자열도 안전. (`api-service.md` §5) → `api/functions/*.test.ts`
- **CASE-apistudio-016** 내장 함수 — 해시·서명: `md5`/`sha1`/`sha256` 이 알려진 벡터와 일치. `hmac(알고리즘, 키, 값)` 이 알려진 벡터와 일치하고 미지원 알고리즘은 거부. (§5)
- **CASE-apistudio-017** 내장 함수 — 문자열: `upper`/`lower`/`trim`/`replace` 가 빈 값·유니코드에서 안전. (§5)
- **CASE-apistudio-018 (불변식 §5)** **비결정 함수의 주입 가능성**: `now`/`timestamp`/`isoDate`/`uuid`/`random` 이 주입된 시각원·난수원을 쓴다 — 고정 시각·고정 시드를 주면 결과가 결정적이다. 주입 없이 전역을 직접 부르면 이 케이스가 실패한다. (§5)
- **CASE-apistudio-019** `now(포맷)` 포맷 처리: 지원 포맷은 정확히, 미지원 포맷 문자열은 거부. (§5)

## Scenario S3 — 가져오기·내보내기 (순수 로직)
- **CASE-apistudio-020** OpenAPI 3.x → Spec: 경로·메서드·파라미터(필수 여부 포함)·응답 스키마·설명이 옮겨진다. YAML/JSON 둘 다. (import AC-1) → `api/import/openapi.test.ts`
- **CASE-apistudio-021** `.proto` → Spec: 서비스·메서드·메시지 타입이 옮겨지고 **스트리밍 종류(unary/server/client/양방향)가 정의에서 자동으로 정해진다.** (import AC-2 · shape AC-3)
- **CASE-apistudio-022** GraphQL SDL/introspection → Spec: 타입·필드·인자·nullable 이 옮겨진다. (import AC-3)
- **CASE-apistudio-023** 해석 못 한 항목 보고: 지원 안 하는 구문이 섞이면 **버리지 않고** 목록으로 돌려준다. 목록이 비어야만 "전부 가져옴". (import AC-5)
- **CASE-apistudio-024** 합치기 미리보기: 기존 Spec 에 합칠 때 추가/변경/충돌을 분류해 돌려주고, 수락 전에는 아무것도 안 바뀐다. (import AC-4)
- **CASE-apistudio-025 (불변식 ⑥)** **내보내기 값 제거**: 환경 값·자격증명·base URL 실값이 산출물에 **한 글자도 없다.** 변수 이름은 남는다. 비밀 표식이 아닌 환경 값도 마찬가지로 빠진다. (export AC-2) → `api/export/redact.test.ts`
- **CASE-apistudio-026** 내보내기 왕복: 내보낸 OpenAPI/proto/SDL 을 다시 가져오면 구조가 보존된다(값 자리는 빈 채로). (export AC-1 · import AC-1)

## Scenario S3b — 인터페이스별 요청 모양 (순수 로직)
> 인터페이스 종류는 Spec 고정 속성이다. 종류가 편집 표면을 결정한다.
- **CASE-apistudio-070 (구조 강제)** **미지원 칸 부재**: 종류별로 편집 표면에 나오는 칸 집합이 정확하고, 그 종류가 안 쓰는 칸은 목록에 **없다**(비활성 상태로 들어 있으면 실패). (shape AC-7)
- **CASE-apistudio-071** REST 조립: 메서드·경로·쿼리·헤더·본문이 담기고 경로 안 `{{이름}}` 이 치환된다. 쿼리 인코딩이 정확. (shape AC-1)
- **CASE-apistudio-072** GraphQL 조립: 질의문 + variables 가 규격대로 직렬화된다. introspection 결과가 있으면 필드 자동완성 후보가 그 스키마에서 나온다. (shape AC-2)
- **CASE-apistudio-073** JSON-RPC 조립: 메서드 이름 + params 가 담기고 **id 가 자동 부여**되며 한 세션 안에서 중복되지 않는다. (shape AC-4)
- **CASE-apistudio-074** WebSocket/SSE: 접속 주소·접속 헤더만 갖고 **본문 칸이 없다**. 보낼 메시지는 요청 정의가 아니라 실행 화면 몫. (shape AC-5)
- **CASE-apistudio-075** 웹훅: **보내는 모양이 없다.** 기대 본문 스키마만 갖는다. 보내기 관련 필드를 넣으면 거부. (shape AC-6)

## Scenario S3c — 응답 모양 선언 (순수 로직)
- **CASE-apistudio-076** 상태별 보관: HTTP 상태코드 · gRPC 코드 · 스트림 이벤트 종류별로 응답 스키마가 갈라져 저장·조회된다. (response AC-1)
- **CASE-apistudio-077** 관측에서 제안: Run 의 실제 응답에서 스키마를 **제안**으로 만든다. 제안이 Draft 에 **자동 반영되지 않는다** — 수락 전에는 명세가 안 바뀐다. (response AC-3)
- **CASE-apistudio-078** 선언 없음 보존: 선언하지 않은 상태는 `선언 없음`으로 남는다. 빈 값을 `응답 없음`으로 해석하면 실패(둘은 다른 뜻이다). (response AC-4)

## Scenario S4 — 문서 생성 (순수 로직)
- **CASE-apistudio-030** 자동 생성분: 정의 → 파라미터 표·응답 필드 표·상태 목록이 생성된다. 정의를 바꾸면 결과가 따라 바뀐다. (docs.generated AC-1)
- **CASE-apistudio-031** 예시 출처 표기: 관측 기록이 있으면 실제 응답에서 만들고 `실제 관측`, 없으면 스키마에서 만들고 `스키마 생성` 으로 표기. 표기 없는 예시는 생성하지 않는다. (docs.generated AC-3)
- **CASE-apistudio-032** markdown 렌더: 링크·코드블록·표가 미리보기에서 올바르게 렌더된다. (docs.authored AC-2)
- **CASE-apistudio-033** MCP 동봉: 사람이 쓴 문서가 `api_get_spec` 응답에 그대로 실린다 — AI 가 구현할 때 주로 읽는 부분이다. (docs.authored AC-4)

## Scenario S5 — 버전 diff · 깨지는 변경 판정 (순수 로직)
> **요청과 응답은 방향이 반대다** — 요청은 더 요구하면 깨지고, 응답은 덜 주면 깨진다.
> 이 비대칭을 뒤집어 구현하면 아래 케이스가 반드시 실패한다.
- **CASE-apistudio-040** 요청 쪽 깨짐: 필수 파라미터 **추가** · 파라미터 타입 변경 · `enum` 값 **제거** · 요청 필수 필드 추가 → 전부 `깨짐`. (versions.diff AC-2) → `api/versions/breaking.test.ts`
- **CASE-apistudio-041** 응답 쪽 깨짐: 응답 필드 **제거** · 타입 변경 · **필수→nullable** · 선언 상태 제거 → 전부 `깨짐`. (versions.diff AC-3)
- **CASE-apistudio-042** 안전한 변경: 선택 파라미터 추가 · 응답 필드 추가 · 응답 enum 값 추가 · 설명 변경 → 전부 `안전`(경고도 아님). (versions.diff AC-4)
- **CASE-apistudio-043 (비대칭 회귀)** 같은 연산이 방향에 따라 다르게 판정된다: `enum` 값 추가는 **요청에서 안전 / 응답에서도 안전**이고, `enum` 값 제거는 **요청에서 깨짐**. nullable→필수는 **요청에서 깨짐 / 응답에서 안전**. 한 판정 함수가 방향 인자를 무시하면 실패한다. (versions.diff AC-2/AC-3/AC-4)
- **CASE-apistudio-044** `모름` 제외: 필수여부가 `모름`인 필드는 판정에서 빠지고, **제외한 개수가 결과에 실린다.** 모름을 안전으로 치면 실패. (versions.diff AC-5 · response AC-2)
- **CASE-apistudio-045** diff 집계: 추가/삭제/변경된 요청·파라미터·응답 필드 수가 정확하고, 손대지 않은 항목은 결과에 안 나온다. (versions.diff AC-1)

## Scenario S5b — 버전 타임라인 (순수 로직)
- **CASE-apistudio-046** 스냅샷 불변: 컷한 뒤 Draft 를 고쳐도 그 버전의 스냅샷은 안 바뀐다. 버전은 명세 **전체**의 스냅샷이지 요청 단위가 아니다. (versions.timeline AC-1/AC-4)
- **CASE-apistudio-047** 컷 권한: 컷은 사람 경로로만 가능하다 — MCP 쓰기 경로에서 컷이 일어나는 통로가 없다. (versions.timeline AC-2 · `api-service.md` §4-⑦)
- **CASE-apistudio-048** 관측 붙은 버전 잠금: Run 이 하나라도 붙은 버전은 잠기고 수정이 거부된다. 지나간 관측의 기준이 흔들리면 판정이 무의미해진다. (versions.timeline AC-3)
- **CASE-apistudio-049** 번호 규칙: 전역 단조 증가. 이미 쓴 번호·역행 번호는 거부된다. (versions.timeline AC-4)

## Scenario S6 — 트리·목록 (순수 로직)
- **CASE-apistudio-050** 검색 필터: 이름·경로 부분일치(대소문자 무시), 빈 질의는 전체를 원래 순서로, 매칭 없으면 빈 결과. (tree AC-2)
- **CASE-apistudio-051** 드롭 방지: 폴더를 자기 자손으로 옮기려 하면 거부. (tree AC-1)
- **CASE-apistudio-052** 상태 표식 판정: 판정 기록이 없는 요청은 **미관측**이고 일치가 아니다. 일치/어긋남/미관측 세 상태가 섞이지 않는다. (tree AC-4 · `api-service.md` §4-①)

## Scenario S7 — 앱 구동 흐름 (e2e/suites/13-api-studio, CSS/text 로케이터만)
- **CASE-apistudio-060** API 서비스 진입 → Studio › Requests 에 요청 트리와 인터페이스 배지(텍스트)가 렌더된다. (tree AC-1/AC-3)
- **CASE-apistudio-061** 요청 선택 → 파라미터 시그니처 칸과 환경 값 칸이 **구획이 갈려** 보인다. (signature AC-4)
- **CASE-apistudio-062** 본문에 `{{함수()}}` 입력 → **편집 중에** 치환 미리보기가 보인다. (template AC-6)
- **CASE-apistudio-063** OpenAPI 파일 가져오기 → 미리보기에 추가 항목이 뜨고, 수락 후 트리에 요청이 늘어난다. (import AC-1/AC-4)
- **CASE-apistudio-064** Docs 뷰 → 자동 생성 표가 보이고 **편집이 막혀 있다**. 사람 작성 markdown 칸은 편집된다. (docs.generated AC-2 · docs.authored AC-1/AC-3)
- **CASE-apistudio-065** 깨지는 변경을 만든 뒤 버전 컷 → **승인 게이트**가 뜨고 무엇이 왜 깨지는지 항목별로 보인다. 취소하면 컷이 안 된다. (versions.diff AC-6 · `api-service.md` §4-⑧)
- **CASE-apistudio-066** 내보내기 실행 → 산출물에 환경 값이 없고, 내보내기 전 "값은 빠지고 이름만 나갑니다" 안내가 보인다. (export AC-2/AC-3)

## 미구현 · 미검증 (조용한 통과 금지)
> 아래는 **정의는 있으나 아직 만들지 않은 것**이다. 케이스가 적혀 있다고 통과한 것이 아니다.
- **Mocking** — 후속 범위다. 케이스 없음(유일한 미커버 인수조건). 구현 시 이 절에서 승격한다.
- **요청 트리 폴더 계층·끌어 옮기기(051)** — 지금은 평평한 목록이다.
- **응답 모양 손편집(076·078)** — 지금은 가져오기·판정 흡수로만 채워진다.
- **enum 허용 값 편집(003 의 화면 쪽)** — 저장·검증은 되는데 편집 UI 가 없다.
- **편집 중 치환 미리보기(062)** — Runner › Send 에는 있고 Studio 편집기에는 없다.
- **markdown 미리보기(032)** — 지금은 원문 textarea 만.
- **인터페이스별 shape** — SOAP(후순위)는 케이스 없음.
