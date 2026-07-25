# Service: mcp-server (MCP 서버 — 에이전트 연동)

> AI 에이전트(Claude Code·Codex 등)가 Rockury 를 도구로 조작할 수 있게 하는
> MCP(Model Context Protocol) 서버. **Electron 메인 프로세스 안**에서 돈다 — 별도 프로세스 없음.
> 위계: Service > Surface > Section > Component. ID 는 코드·테스트와 기계 대조용 안정 키.

공통 불변식
- **생명주기 한몸**: 앱 시작=서버 시작, 앱 종료(강제 포함)=서버 종료. "앱은 사는데 서버만 죽는"
  경우는 리스너 예외뿐 → 시작 실패 시 30초 재시도(`http.ts`), 요청 오류는 삼켜 기록(크래시 전파 금지).
- **앱이 유일한 작성자**: 에이전트는 SQLite 파일을 직접 만지지 않고 이 서버를 거친다(렌더러 경합 차단).
- **쓰기 경합 차단**: ① 테이블 저장은 설계 스코프(`tables:replaceForDesign` — 해당 설계 행만
  tx 로 교체)만 존재한다 — 전량 교체 채널(`tables:replaceAll`)은 제거됐다. ② MCP 쓰기 성공 시
  메인이 열린 모든 창에 `store:changed`(`{domain, designId}`)를 보내 렌더러가 그 스코프만
  재로딩한다 — 렌더러의 낡은 메모리 사본이 에이전트 변경을 되덮지 못한다. 같은 설계를 사람과
  에이전트가 동시에 편집하는 경우는 마지막 저장 승리(last-write-wins)로 수용 — 리하이드레이션이
  화면을 곧 따라잡는다.
- **파괴는 사람 몫**: 삭제류(설계 삭제·버전 삭제 등 파괴적 조작)는 MCP 도구로 노출하지 않는다 —
  앱 화면에서만. 제외 사유는 `coverage.ts` 제외 지도가 정본.
- **보안 3중선**: `127.0.0.1` 바인딩 + Bearer 토큰 + Origin/Host 검증(`security.gateRequest`).
  셋 다 통과해야 처리. 토큰 비교는 상수시간.
- **비밀은 키체인에만**: 접속 키는 OS 키체인 암호화(safeStorage, `tokenStore.ts`)로 저장 —
  디스크에 평문 토큰이 없다. 키는 재발급 전까지 고정(클라이언트 설정 안정), 재발급(rotate)은
  즉시 적용되어 구 키가 401 이 된다.
- **잔여 파일 없음**: 접속 정보 파일(구 `mcp.json`)을 만들지 않는다 — 과거 버전이 남긴 파일은
  시작 시 정리. 주소·상태의 정본은 앱 AI 화면(상태 IPC)과 `GET /health`. 수용된 잔여 위험
  (멀티유저 머신 포트 선점, 감사 M-1)은 `http.ts` loadOrCreateToken 주석이 정본.
- **스테일 방지 핀(기계 강제)**: `src/main/ipc` 의 모든 채널은 `coverage.ts` 에
  노출(도구 대응) 또는 제외(사유)로 등재돼야 한다 — `coverage.test.ts` 가 미등재·유령 등재를
  `npm test` 실패로 만든다. → AGENTS.md 절대 불변식 4.

---

## Surface: mcp-server.http (HTTP 리스너)

### Section mcp-server.http.lifecycle — 시작/정지/발견
- **AC-1** `app.whenReady` 에서 시작, `will-quit` 에서 정지. 시작 실패는 앱 부팅을 막지 않고 30초 뒤 재시도.
- **AC-2** 접속 정보 파일을 만들지 않는다 — 레거시 `mcp.json` 은 시작 시 제거. 주소는 AI 화면·`/health` 로 확인.
- **AC-3** 토큰은 키체인 저장소에 유효 토큰이 있으면 재사용 — 재시작에도 클라이언트 설정이 깨지지 않는다.
- **AC-4** 포트: env `ROCKURY_MCP_PORT` → 기본 41729, 점유 시 +1~+9 폴백, `0`이면 OS 배정(e2e 격리).
- **AC-5** 단일 인스턴스(`requestSingleInstanceLock`) — DB·포트 소유자는 항상 하나.

### Section mcp-server.http.gate — 요청 관문
- **AC-1** 토큰 불일치/누락 → 401. 비로컬 Host → 403. 비로컬/불량 Origin → 403(토큰이 맞아도).
- **AC-2** Origin 없는 요청(CLI/에이전트)은 토큰·Host 만으로 통과.
- **AC-3** `GET /health` 는 무인증(이름·버전만 — pid 등 프로세스 정보 노출 금지).
- **AC-4** 거부 응답은 일반화(`unauthorized`/`forbidden`) — 어느 방어에 걸렸는지는 로그로만(오라클 금지).
- **AC-5** 자원 상한: 요청 본문 4MB, 세션 64개(초과 시 LRU 축출 — 최근 사용 세션은 보호).

## Surface: mcp-server.tools (도구 표면 — 읽기 4종 + 쓰기 4종)

### Section mcp-server.tools.read — 설계 열람 도구 4종
- **AC-1** `list_designs` — 설계 목록 + 방언 + 테이블 수 + 최신 버전 번호.
- **AC-2** `get_schema` — 설계의 draft 스키마 전체(테이블·컬럼·제약).
- **AC-3** `list_versions` — 버전 메타(번호·메모·잠금·시각), 스냅샷 본문 제외, 최신순.
- **AC-4** `get_version` — 특정 버전 스냅샷 전체.
- **AC-5** 미상 id/번호는 프로토콜 오류가 아닌 `isError` 결과 + 해결 안내(어느 도구로 확인할지)를 준다.

### Section mcp-server.tools.write — 설계 쓰기 도구 4종
> 쓰기는 이 4종이 전부다. 세밀 조작(add_table 등) 도구 분화는 하지 않는다 — 문서형 저장과
> 일치하게 설계 단위로 통째 반영한다(2026-07-25 사용자 결정).
- **AC-1** `create_design` — 이름·방언(dialect)·설명으로 설계 생성. id 는 앱 규칙(이름 슬러그 +
  충돌 시 `-2`…)으로 생성해 반환하고, 직후 `list_designs` 에 나타난다.
- **AC-2** `update_design` — 이름·설명만 수정(방언은 고정 속성 — 입력 표면에 없음). 수정 결과가
  `list_designs` 에 즉시 반영된다.
- **AC-3** `set_schema` — 설계 하나의 draft 스키마 전체(테이블·컬럼·제약)를 통째로 반영한다.
  실행 후 `get_schema` 결과가 보낸 입력과 일치한다.
- **AC-4** 격리성: 테이블 저장(`tables:replaceForDesign`)은 대상 설계의 행만 교체한다(tx) —
  다른 설계의 행은 불변. `set_schema` 와 렌더러 write-through 모두 이 경로만 쓴다.
- **AC-5** `create_version` — 대상 설계의 현재 draft 를 그 시점 스냅샷으로 잘라 버전을 만든다
  (에이전트가 스냅샷 본문을 주입하지 않는다). 번호는 `v0.1.0` 같은 semver 유사 형식(앱 버전
  규칙)만 허용, 기존 번호와 중복 금지 — 성공 시 `list_versions` 최신 행으로 조회된다.
- **AC-6** 미상 designId·구조 검증(zod) 실패는 프로토콜 오류가 아닌 `isError` 결과 + 해결 안내를
  준다(read AC-5 와 동일 규율) — 이때 저장소에는 아무것도 쓰지 않는다(부분 반영 없음).
- **AC-7** 삭제 도구는 없다 — `designs:delete`·`versions:delete` 는 coverage 제외 지도에 확정
  사유("파괴적 조작은 사람이 앱에서만")로 남는다. 도구 목록에 삭제류가 생기면 명세 위반.

### Section mcp-server.tools.rehydration — 쓰기 반영(렌더러 리하이드레이션)
- **AC-1** MCP 쓰기 도구가 **성공했을 때만** 메인이 열린 모든 창에 `store:changed`
  (`{domain: 'designs'|'tables'|'versions', designId}`)를 보낸다 — `isError` 결과는 이벤트 없음.
- **AC-2** 이벤트를 받은 렌더러 스토어(designs/definition/versions)는 해당 domain·designId
  스코프만 다시 읽는다 — 열린 Studio 화면에 `set_schema` 결과가 즉시 보인다(e2e).
- **AC-3** 자기 메아리 금지: 렌더러발 저장(IPC)은 `store:changed` 를 유발하지 않고,
  리하이드레이션으로 갱신된 tables 는 write-through 를 되쏘지 않는다 — 쓰기 1회당 저장 1회(루프 0).

## Surface: mcp-server.agents (AI › Agents 화면 — 좌측 레일 맨 아래 서비스, 내부 id 는 `mcp`)

> 연동 방식은 **등록 명령 복사(전역, 1회)** 하나다. 프로젝트별 `.mcp.json` 셋업 방식은
> 2026-07-24 사용자 결정으로 제거 — 앱은 사용자 프로젝트 파일을 건드리지 않는다.

### Section mcp-server.agents.gateway — 게이트웨이 상태 밴드
- **AC-1** 서버가 뜨면 ink 밴드에 **초록 라이브 점이 깜빡이며**(모션 축소 설정 존중) "에이전트 게이트웨이
  열림" + 접속 URL(mono)을 보인다. 꺼져 있으면 회색 점 + "준비 중" + 자동 복구 안내.
- **AC-2** Claude Code / Codex 전역 등록 명령을 클립보드로 복사(토큰 포함 — 화면 표시는 마스킹뿐).

### Section mcp-server.agents.token — 접속 키(Bearer) 관리
- **AC-1** 기본 마스킹 표시(끝 4자만) + 보기 토글 + 복사. 화면 재진입 시 다시 마스킹.
- **AC-2** **재발급**: 인라인 확인("기존 등록 에이전트 연결이 끊긴다") 후 실행 — 즉시 적용되어
  구 키는 401, 새 키가 키체인에 영속되고 등록 명령이 재생성된다.
- **AC-3** **재등록 안내**: 접속 키가 바뀌면(재발급) 이미 등록한 에이전트를 새 키로 다시 등록하는
  명령을 화면이 제공한다 — 재발급 직후 그 자리 + "연결 방법 › 접속 키를 바꾼 뒤" 상시. 재등록 명령은
  `remove → add`(claude/codex 모두 중복 이름 add 를 CLI 가 거부할 수 있어 remove 를 앞세움)이며
  새 키를 담는다. Codex 는 토큰을 환경변수로 참조해 사실상 새 키만 반영하면 됨을 함께 안내.
  명령 문자열 생성은 순수 모듈 `src/main/mcp/registration.ts`(테스트 대상).

## 검증
- 단위/통합: `src/main/mcp/*.test.ts` — 관문 판정·도구 핸들러(읽기·쓰기 — 정상/미상 id/불량 입력
  `isError`)·프로토콜 흐름(실 리스너)·커버리지 핀·재발급(구 키 401·영속)·접속 정보 파일 미생성·
  레거시 정리. `src/main/store/stores.test.ts` — 설계 스코프 교체 격리(다른 설계 행 불변).
- e2e: `e2e/smoke.mjs` — 실 앱에서 상태 IPC→initialize→tools/list→tools/call·401 거부 +
  쓰기 흐름(도구 호출→열린 화면 즉시 반영·자기 메아리 없음) + AI 화면 초록 상태등·키 마스킹·
  재발급 실 흐름(구 키 즉시 무효) + mcp.json 미생성.
