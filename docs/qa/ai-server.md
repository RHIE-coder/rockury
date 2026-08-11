# TestPlan: ai-server (MCP 서버 — 읽기 4종 + 쓰기 5종)

> 정의(무엇을 검증하나)만 여기. 코드는 `src/main/ai/*.test.ts`(vitest) + store `src/main/store/*.test.ts`
> + 앱 흐름 스위트 `e2e/suites/NN-*.mjs`. 회차 기록은 `docs/qa/runs/`. 명세: `docs/spec/ai-server.md`.

## Scenario S1 — 요청 관문 (순수 로직, 기존 1단계 자산)
- **CASE-ai-001** 토큰 판정: 일치→통과, 불일치/누락/`Bearer` 접두 없음→401(상수시간 비교). (http.gate AC-1) → `src/main/ai/security.test.ts` [자동]
- **CASE-ai-002** Host/Origin 판정: 비로컬 Host 403(토큰 맞아도)·비로컬/파싱불가 Origin 403·Host 누락 403, 로컬 Origin·Origin 없음(CLI/에이전트)은 통과. (http.gate AC-1/AC-2) → `src/main/ai/security.test.ts` [자동]

## Scenario S2 — HTTP 리스너·생명주기 (통합: 실 리스너·포트 0·임시 DB, 기존 1단계 자산)
→ `src/main/ai/http.test.ts` [자동]
- **CASE-ai-010** `GET /health` 무인증 — 이름·버전만 반환(pid 등 프로세스 정보 미노출). (http.gate AC-3)
- **CASE-ai-011** initialize→tools/list — 읽기 4종+쓰기 5종(총 9종) 노출, 삭제류 도구 부재. (tools.read AC-1~4, tools.write AC-1~3/AC-5/AC-7)
- **CASE-ai-012** 보안 거부 실선: 무토큰 401·악성 Origin 403·무세션 400 — 거부 응답은 일반화 문구. (http.gate AC-1/AC-4)
- **CASE-ai-013** 본문 4MB 상한 초과 요청은 처리 거부(리셋 또는 4xx). (http.gate AC-5)
- **CASE-ai-014** 세션 64 상한 + LRU 축출 — 최근 사용 세션은 생존, 유휴 세션이 밀려남. (http.gate AC-5)
- **CASE-ai-015** 접속 키 재발급: 구 키 즉시 401·새 키 즉시 유효·저장소 영속. (http.lifecycle AC-3, agents.token AC-2)
- **CASE-ai-016** 재시작 토큰 유지(클라이언트 설정 안정)·레거시 `mcp.json` 시작 시 정리·정지 후 접속 불가. (http.lifecycle AC-2/AC-3)

## Scenario S3 — 읽기 도구 4종 (핸들러 단위: 임시 SQLite+시드, 기존 1단계 자산)
→ `src/main/ai/tools.test.ts` [자동]
- **CASE-ai-020** `list_designs`: 방언·테이블 수·최신 버전 번호. (tools.read AC-1)
- **CASE-ai-021** `get_schema`: 설계 draft 의 테이블·컬럼·제약 전체. (tools.read AC-2)
- **CASE-ai-022** `list_versions`: 스냅샷 본문 없이 메타만, 최신순. (tools.read AC-3)
- **CASE-ai-023** `get_version`: 특정 버전 스냅샷 전체. (tools.read AC-4)
- **CASE-ai-024** 미상 designId/버전 번호 → isError 상당 오류 + 해결 안내(`list_designs`/`list_versions` 유도). (tools.read AC-5)
- **CASE-ai-025** 버전 컷 이후 `list_designs.latestVersion` 이 최신을 추적. (tools.read AC-1)

## Scenario S4 — 설계 스코프 저장 (store 단위, 신설 — T1)
→ `src/main/store/stores.test.ts` (관례: 임시 SQLite·setDbPath seam) [자동]
- **CASE-ai-030** `replaceTablesForDesign` 격리: 설계 X 교체 시 설계 Y 의 행 수·내용이 바이트 단위로 불변. (tools.write AC-4)
- **CASE-ai-031** 빈 목록 반영: X 의 행 전부 삭제(설계 비우기), Y 불변. (tools.write AC-4)
- **CASE-ai-032** tx 원자성: 불량 레코드가 섞인 배치는 전체 롤백 — 부분 반영 0, 기존 행 보존. (tools.write AC-4/AC-6)
- **CASE-ai-033** 순서·JSON 왕복: 저장 순서(position) 유지, columns/constraints 직렬화 왕복 정합 — 구 `replaceAllTables` 가 하던 계약의 승계 확인. (tools.write AC-4)

## Scenario S5 — 쓰기 도구 (핸들러 단위, 신설 — T3. 방언 선택·부분 수정은 S9)
→ `src/main/ai/tools.test.ts` 확장 [자동]
- **CASE-ai-040** `create_design` 정상: 생성 후 `list_designs` 에 등장, 방언 반영, id 는 앱 슬러그 규칙. (tools.write AC-1)
- **CASE-ai-041** `create_design` 이름 누락(zod 구조 위반) → isError + 해결 안내. 방언 누락·미지원은 별도 규율(S9 CASE-ai-080/081). (tools.write AC-1/AC-6)
- **CASE-ai-042** `update_design` 정상 갱신 + 미상 designId → isError + `list_designs` 안내. (tools.write AC-2/AC-6)
- **CASE-ai-043** `set_schema` 정상: 설계 draft 전체 반영 → `get_schema` 왕복 정합(테이블·컬럼·제약). (tools.write AC-3)
- **CASE-ai-044** `set_schema` 미상 designId → isError + 안내(설계 존재 확인 선행). (tools.write AC-3/AC-6)
- **CASE-ai-045** `set_schema` 구조 위반(컬럼/제약 형태 불량) → isError + 기존 스키마 원상(반영 0 — S4 원자성의 도구 경유 확인). (tools.write AC-3/AC-6)
- **CASE-ai-046** `set_schema` 설계 격리: X 반영 후 Y 의 `get_schema` 불변 — 격리를 도구 표면에서 재확인. (tools.write AC-3/AC-4)
- **CASE-ai-047** `create_version` 정상: 컷 스냅샷 = 컷 시점 draft(`get_version` 정합) + `latestVersion` 갱신. (tools.write AC-5)
- **CASE-ai-048** `create_version` 번호 중복(`designId@number` PK 충돌) → isError + `list_versions` 확인 안내 — DB 예외가 프로토콜 오류로 새지 않음. (tools.write AC-5/AC-6)
- **CASE-ai-049** `create_version` 번호 형식 위반(`vX.Y.Z` 아님) → isError, DB 미기록. (tools.write AC-5/AC-6)

## Scenario S6 — 렌더러 리하이드레이션 (신설 — T2)
- **CASE-ai-050** MCP 쓰기 성공 → 열린 창에 `store:changed {domain, designId}` push — 도구별 도메인 매핑(create/update_design→designs, set_schema→tables, create_version→versions). (tools.rehydration AC-1) → `src/main/ai/*.test.ts`(발행 seam 주입) [자동]
- **CASE-ai-051** 도구 실패(isError) 시 이벤트 미발행 — 실패한 쓰기가 화면 재조회를 유발하지 않음. (tools.rehydration AC-1) [자동]
- **CASE-ai-052** 렌더러발 저장(`tables:replaceForDesign` IPC 직접 호출) → `store:changed` 미발행(자기 메아리 금지). (tools.rehydration AC-3) [자동]
- **CASE-ai-053** 루프 방지: 리하이드레이션으로 갱신된 tables 는 write-through 를 되쏘지 않음(플래그 순수 로직). (tools.rehydration AC-3) → 렌더러 definition 스토어 옆 `*.test.ts` [자동]

## Scenario S7 — 커버리지 핀 (기계 강제, 기존 자산 + 이번 갱신 대상)
→ `src/main/ai/coverage.test.ts` [자동]
- **CASE-ai-060** IPC 채널 전수 = 노출∪제외 — 신규 `tables:replaceForDesign` 등재 + `designs:create`/`designs:update`/`versions:create` 노출 전환. (공통 불변식 스테일 방지 핀)
- **CASE-ai-061** 유령 등재 방지 — 제거된 `tables:replaceAll` 이 지도·코드 양쪽에서 소거됨. (공통 불변식)
- **CASE-ai-062** 지도 도구 키 = TOOL_NAMES(9종 — 읽기 4 + 쓰기 5) · 한 채널의 노출/제외 동시 등재 금지. (공통 불변식)
- **CASE-ai-063** 삭제류 미노출 핀: `designs:delete`/`versions:delete` 등 파괴 채널이 노출 지도에 등장하지 않고, 제외 사유가 확정 문구("파괴적 조작은 사람이 앱에서만")로 갱신 — "2단계 검토" 잔존 금지. (tools.write AC-7)

## Scenario S8 — 앱 구동 흐름 (e2e/suites/01-boot-mcp · 02-ai-agents · 05-mcp-write — 접근성 쿼리 금지, CSS/text 로케이터만)
- **CASE-ai-070** 기존: 상태 IPC→initialize→tools/list→`list_designs`(시드) + 무토큰 401 + `mcp.json` 미생성. (검증 절, http.gate/tools.read) [자동]
- **CASE-ai-071** 기존: AI 화면 — 게이트웨이 열림 표시·등록 명령(URL 포함)·키 기본 마스킹·재발급 실 흐름(구 키 즉시 401·새 키 접속). (agents.gateway AC-1/AC-2, agents.token AC-1/AC-2) [자동]
- **CASE-ai-074** 재등록 명령: 상태 payload 의 claude/codex 재등록 명령이 `remove`(rockury) 를 add 앞에 두고 현재 키를 담는다 — 재발급 후에도 새 키로 갱신됨. (agents.token AC-3) → `src/main/ai/registration.test.ts` [자동]
- **CASE-ai-075** e2e: AI 화면에 "접속 키를 바꾼 뒤" 재등록 안내 + Claude/Codex 재등록 복사 버튼이 보이고, 재발급 후 재등록 명령이 새 키를 담는다. (agents.token AC-3) → `e2e/suites/02-ai-agents.mjs` [자동]
- **CASE-ai-072** 신설: 쓰기 리하이드레이션 — Design 화면을 연 채 MCP `set_schema` 호출 → 신규 테이블명이 화면 텍스트에 즉시 나타남(수동 재조회 없이). (tools.write AC-3, tools.rehydration AC-1/AC-2) [자동]
- **CASE-ai-073** 신설: `create_version` 호출 → Versions 타임라인에 새 버전 번호 텍스트 등장 + tools/list 에 쓰기 5종 노출 확인. (tools.write AC-5, tools.rehydration AC-2) [자동]

## Scenario S9 — 부분 수정·위생 검사·선택 요구 (신설 — 3단계)
> 실제 사고에서 나왔다: 33개 테이블 설계를 `set_schema` 로 반영했더니 ⑴ 주석 한 곳에 U+FFFD 가
> 박힌 채 저장됐고 ⑵ 그 한 글자를 고치려면 전체 재전송뿐이었으며 ⑶ 응답 에코가 127KB 였다.

### 방언 선택 요구 → `src/main/ai/tools.test.ts` [자동]
- **CASE-ai-080** `create_design` 방언 누락 → 생성하지 않고 "임의로 고르지 말고 사용자에게 물어보라" + 선택지 4종을 담은 isError. 설계 목록 불변, 이벤트 없음. (tools.write AC-1)
- **CASE-ai-081** 미지원 방언(`oracle`) → 같은 선택 안내(그럴듯한 값으로 재시도 유도 금지). (tools.write AC-1)
- **CASE-ai-082** 표기 흔들림(`  MySQL  `) → 정규화해 수용(물어볼 일이 아님). (tools.write AC-1)

### 응답 요약·읽기 필터 → `src/main/ai/tools.test.ts` [자동]
- **CASE-ai-083** `set_schema` 응답에 스키마 본문이 없다 — 테이블별 개수 요약만. (공통 불변식 "응답은 요약", tools.write AC-3)
- **CASE-ai-084** `get_schema` `tables` 필터로 필요한 테이블만 반환. (tools.read AC-2)
- **CASE-ai-085** 필터에 없는 이름 → 조용한 빈 결과 대신 "이 설계의 테이블" 목록과 함께 isError. (tools.read AC-2/AC-5)

### 저장 전 위생 검사 → `src/main/ai/textGuard.test.ts` · `tools.test.ts` [자동]
- **CASE-ai-086** `set_schema` 입력에 U+FFFD → 인자 기준 경로(`tables[0].columns[0].comment`)·코드포인트·문맥과 함께 거부, 저장소 불변·이벤트 없음. (tools.write AC-9)
- **CASE-ai-087** `patch_schema`·`create_design`·`create_version` 도 같은 관문을 지난다. (tools.write AC-9)
- **CASE-ai-094** 판정 정확도: 치환문자·짝 잃은 서로게이트(상위/하위/문자열 끝)·제어문자·문장 속 BOM 은 잡고, 정상 한글·이모지(서로게이트 쌍·ZWJ 결합)·탭/개행은 통과. 객체 키도 검사. 10곳 초과 시 나머지는 개수로. (공통 불변식)

### 부분 수정 → `src/main/ai/patch.test.ts` · `tools.test.ts` [자동]
- **CASE-ai-088** `patch_schema` 주석 한 줄 수정 → 그 컬럼만 바뀌고 컬럼 id·나머지 테이블은 그대로. (tools.write AC-8)
- **CASE-ai-089** 여러 연산 일괄 적용(`add_column` after 위치 지정·`add_constraint` 컬럼 이름 지정·`set_table_comment`) + 응답은 `changes` 목록. (tools.write AC-8)
- **CASE-ai-090** 컬럼 개명 → 남의 FK `refColumns` 자동 갱신. 테이블 개명 → 가리키던 FK `refTable` 자동 갱신. CHECK 식은 못 고치므로 `warnings`. (tools.write AC-8)
- **CASE-ai-091** 연산 중 하나 실패 → 앞선 연산 포함 반영 0, 메시지가 몇 번째 연산인지 밝힘. (tools.write AC-6/AC-8)
- **CASE-ai-092** 미상 designId·빈 연산 목록·미지의 op → isError + 쓸 수 있는 op 목록 안내. (tools.write AC-6/AC-8)
- **CASE-ai-093** 설계 격리: `patch_schema` 후 다른 설계 스키마 불변. (tools.write AC-4/AC-8)
- **CASE-ai-095** 참조 보호: 제약이 쓰는 컬럼·남의 FK 가 가리키는 컬럼/테이블 삭제는 거부하고 무엇을 먼저 뗄지 알린다. 제약을 먼저 떼면 삭제된다. (tools.write AC-8)
- **CASE-ai-096** 조준 실패 안내: 없는 테이블·컬럼은 그 설계/테이블의 실제 이름 목록을 함께 준다. (tools.write AC-6/AC-8)
- **CASE-ai-097** `create_design` 의 첫 스키마: `schemaName` 을 주면 그대로, 생략하면 방언별 기본값(pg `public` · mysql/mariadb 설계 이름 식별자 · sqlite `main`)이 `declaredSchemas[0]` 에 담긴다. **mysql 에 `public` 이 들어가지 않는다** — 그런 데이터베이스는 없다. 못 쓸 이름은 isError. (tools.write AC-1) → `shared/db/schemaCatalog.test.ts`
- **CASE-ai-098** `patch_schema add_table` 의 소속: `schema` 생략 시 설계의 첫 선언 스키마 → 없으면 쓰는 스키마가 하나일 때 그것 → 근거가 없으면 안 담는다. `changes` 에 한정 이름(`testdb.logs`)이 적힌다. **회귀**: 예전엔 스키마를 통째로 버려 그 표 하나 때문에 설계 전체의 SQL 이 한정 이름을 잃었다. (tools.write AC-8a) → `ai/patch.test.ts`
- **CASE-ai-099** `patch_schema rename_schema`: 표 전부 이동 + 옛 이름을 가리킨 `refSchema` 갱신 + 선언 목록 자리 유지. `from: ''` 은 스키마 없는 표를 거둔다. 없는 스키마·중복 이름·못 쓸 글자는 거부. rename 이 없는 호출은 선언을 되쓰지 않는다. (tools.write AC-8b) → `ai/patch.test.ts`
- **CASE-ai-100** `update_design declaredSchemas`: 통째 교체 + 순서 유지. **표가 앉은 스키마를 빼면 거부**하고 `rename_schema`/`set_schema` 로 안내한다 — 그 표가 목록에서 조용히 사라지지 않게. (tools.write AC-2)
- **CASE-ai-101** 교차 스키마 FK: `set_schema` 의 `tables[].schema`·`constraints[].refSchema` 와 `patch_schema` 의 같은 필드가 입력 표면에 **문서화되어** 있고 `get_schema` 왕복에서 보존된다. 예전엔 `looseObject` 덕에 우연히만 통과했다. (tools.write AC-3/AC-8)

## 알려진 커버리지 구멍 (의도적 — 근거 포함)
- **http.lifecycle AC-1(시작 실패 30초 재시도)**: Electron 생명주기 타이머 — 단위 seam 없음, e2e 로 포트 선점 시나리오 구성 비용 과대. 자동화 보류(수동 확인 항목).
- **http.lifecycle AC-4(포트 점유 시 +1~+9 폴백)**: 자동화 가능(포트 선점 후 startMcp) — 미착수 구멍으로 등재, 후속 자동화 후보.
- **http.lifecycle AC-5(단일 인스턴스 락)**: 두 번째 앱 인스턴스 기동이 필요 — e2e 비용 대비 실익 낮아 보류.
- **키체인(safeStorage) 실경로**: vitest 는 평문 폴백만 검증(CASE-ai-015/016) — 실 키체인 영속은 e2e 재발급 흐름(CASE-ai-071)이 간접 검증.
- **agents.gateway AC-1 모션 축소 존중 · agents.token AC-1 화면 재진입 재마스킹**: 시각/세션 상태 — 수동 확인.
