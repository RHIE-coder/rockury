# TestPlan: mcp-server (MCP 서버 — 읽기 4종 + 쓰기 4종)

> 정의(무엇을 검증하나)만 여기. 코드는 `src/main/mcp/*.test.ts`(vitest) + store `src/main/store/*.test.ts`
> + 앱 흐름 `e2e/smoke.mjs`. 회차 기록은 `docs/qa/runs/`. 명세: `docs/spec/mcp-server.md`.

## Scenario S1 — 요청 관문 (순수 로직, 기존 1단계 자산)
- **CASE-mcp-001** 토큰 판정: 일치→통과, 불일치/누락/`Bearer` 접두 없음→401(상수시간 비교). (http.gate AC-1) → `src/main/mcp/security.test.ts` [자동]
- **CASE-mcp-002** Host/Origin 판정: 비로컬 Host 403(토큰 맞아도)·비로컬/파싱불가 Origin 403·Host 누락 403, 로컬 Origin·Origin 없음(CLI/에이전트)은 통과. (http.gate AC-1/AC-2) → `src/main/mcp/security.test.ts` [자동]

## Scenario S2 — HTTP 리스너·생명주기 (통합: 실 리스너·포트 0·임시 DB, 기존 1단계 자산)
→ `src/main/mcp/http.test.ts` [자동]
- **CASE-mcp-010** `GET /health` 무인증 — 이름·버전만 반환(pid 등 프로세스 정보 미노출). (http.gate AC-3)
- **CASE-mcp-011** initialize→tools/list — 읽기 4종+쓰기 4종(총 8종) 노출, 삭제류 도구 부재. (tools.read AC-1~4, tools.write AC-1~3/AC-5/AC-7)
- **CASE-mcp-012** 보안 거부 실선: 무토큰 401·악성 Origin 403·무세션 400 — 거부 응답은 일반화 문구. (http.gate AC-1/AC-4)
- **CASE-mcp-013** 본문 4MB 상한 초과 요청은 처리 거부(리셋 또는 4xx). (http.gate AC-5)
- **CASE-mcp-014** 세션 64 상한 + LRU 축출 — 최근 사용 세션은 생존, 유휴 세션이 밀려남. (http.gate AC-5)
- **CASE-mcp-015** 접속 키 재발급: 구 키 즉시 401·새 키 즉시 유효·저장소 영속. (http.lifecycle AC-3, agents.token AC-2)
- **CASE-mcp-016** 재시작 토큰 유지(클라이언트 설정 안정)·레거시 `mcp.json` 시작 시 정리·정지 후 접속 불가. (http.lifecycle AC-2/AC-3)

## Scenario S3 — 읽기 도구 4종 (핸들러 단위: 임시 SQLite+시드, 기존 1단계 자산)
→ `src/main/mcp/tools.test.ts` [자동]
- **CASE-mcp-020** `list_designs`: 방언·테이블 수·최신 버전 번호. (tools.read AC-1)
- **CASE-mcp-021** `get_schema`: 설계 draft 의 테이블·컬럼·제약 전체. (tools.read AC-2)
- **CASE-mcp-022** `list_versions`: 스냅샷 본문 없이 메타만, 최신순. (tools.read AC-3)
- **CASE-mcp-023** `get_version`: 특정 버전 스냅샷 전체. (tools.read AC-4)
- **CASE-mcp-024** 미상 designId/버전 번호 → isError 상당 오류 + 해결 안내(`list_designs`/`list_versions` 유도). (tools.read AC-5)
- **CASE-mcp-025** 버전 컷 이후 `list_designs.latestVersion` 이 최신을 추적. (tools.read AC-1)

## Scenario S4 — 설계 스코프 저장 (store 단위, 신설 — T1)
→ `src/main/store/stores.test.ts` (관례: 임시 SQLite·setDbPath seam) [자동]
- **CASE-mcp-030** `replaceTablesForDesign` 격리: 설계 X 교체 시 설계 Y 의 행 수·내용이 바이트 단위로 불변. (tools.write AC-4)
- **CASE-mcp-031** 빈 목록 반영: X 의 행 전부 삭제(설계 비우기), Y 불변. (tools.write AC-4)
- **CASE-mcp-032** tx 원자성: 불량 레코드가 섞인 배치는 전체 롤백 — 부분 반영 0, 기존 행 보존. (tools.write AC-4/AC-6)
- **CASE-mcp-033** 순서·JSON 왕복: 저장 순서(position) 유지, columns/constraints 직렬화 왕복 정합 — 구 `replaceAllTables` 가 하던 계약의 승계 확인. (tools.write AC-4)

## Scenario S5 — 쓰기 도구 4종 (핸들러 단위, 신설 — T3)
→ `src/main/mcp/tools.test.ts` 확장 [자동]
- **CASE-mcp-040** `create_design` 정상: 생성 후 `list_designs` 에 등장, 방언 반영, id 는 앱 슬러그 규칙. (tools.write AC-1)
- **CASE-mcp-041** `create_design` 불량 입력(필수 필드 누락·미상 방언 — zod 구조 위반) → isError + 해결 안내. (tools.write AC-1/AC-6)
- **CASE-mcp-042** `update_design` 정상 갱신 + 미상 designId → isError + `list_designs` 안내. (tools.write AC-2/AC-6)
- **CASE-mcp-043** `set_schema` 정상: 설계 draft 전체 반영 → `get_schema` 왕복 정합(테이블·컬럼·제약). (tools.write AC-3)
- **CASE-mcp-044** `set_schema` 미상 designId → isError + 안내(설계 존재 확인 선행). (tools.write AC-3/AC-6)
- **CASE-mcp-045** `set_schema` 구조 위반(컬럼/제약 형태 불량) → isError + 기존 스키마 원상(반영 0 — S4 원자성의 도구 경유 확인). (tools.write AC-3/AC-6)
- **CASE-mcp-046** `set_schema` 설계 격리: X 반영 후 Y 의 `get_schema` 불변 — 격리를 도구 표면에서 재확인. (tools.write AC-3/AC-4)
- **CASE-mcp-047** `create_version` 정상: 컷 스냅샷 = 컷 시점 draft(`get_version` 정합) + `latestVersion` 갱신. (tools.write AC-5)
- **CASE-mcp-048** `create_version` 번호 중복(`designId@number` PK 충돌) → isError + `list_versions` 확인 안내 — DB 예외가 프로토콜 오류로 새지 않음. (tools.write AC-5/AC-6)
- **CASE-mcp-049** `create_version` 번호 형식 위반(`vX.Y.Z` 아님) → isError, DB 미기록. (tools.write AC-5/AC-6)

## Scenario S6 — 렌더러 리하이드레이션 (신설 — T2)
- **CASE-mcp-050** MCP 쓰기 성공 → 열린 창에 `store:changed {domain, designId}` push — 도구별 도메인 매핑(create/update_design→designs, set_schema→tables, create_version→versions). (tools.rehydration AC-1) → `src/main/mcp/*.test.ts`(발행 seam 주입) [자동]
- **CASE-mcp-051** 도구 실패(isError) 시 이벤트 미발행 — 실패한 쓰기가 화면 재조회를 유발하지 않음. (tools.rehydration AC-1) [자동]
- **CASE-mcp-052** 렌더러발 저장(`tables:replaceForDesign` IPC 직접 호출) → `store:changed` 미발행(자기 메아리 금지). (tools.rehydration AC-3) [자동]
- **CASE-mcp-053** 루프 방지: 리하이드레이션으로 갱신된 tables 는 write-through 를 되쏘지 않음(플래그 순수 로직). (tools.rehydration AC-3) → 렌더러 definition 스토어 옆 `*.test.ts` [자동]

## Scenario S7 — 커버리지 핀 (기계 강제, 기존 자산 + 이번 갱신 대상)
→ `src/main/mcp/coverage.test.ts` [자동]
- **CASE-mcp-060** IPC 채널 전수 = 노출∪제외 — 신규 `tables:replaceForDesign` 등재 + `designs:create`/`designs:update`/`versions:create` 노출 전환. (공통 불변식 스테일 방지 핀)
- **CASE-mcp-061** 유령 등재 방지 — 제거된 `tables:replaceAll` 이 지도·코드 양쪽에서 소거됨. (공통 불변식)
- **CASE-mcp-062** 지도 도구 키 = TOOL_NAMES(8종) · 한 채널의 노출/제외 동시 등재 금지. (공통 불변식)
- **CASE-mcp-063** 삭제류 미노출 핀: `designs:delete`/`versions:delete` 등 파괴 채널이 노출 지도에 등장하지 않고, 제외 사유가 확정 문구("파괴적 조작은 사람이 앱에서만")로 갱신 — "2단계 검토" 잔존 금지. (tools.write AC-7)

## Scenario S8 — 앱 구동 흐름 (e2e/smoke.mjs — 접근성 쿼리 금지, CSS/text 로케이터만)
- **CASE-mcp-070** 기존: 상태 IPC→initialize→tools/list→`list_designs`(시드) + 무토큰 401 + `mcp.json` 미생성. (검증 절, http.gate/tools.read) [자동]
- **CASE-mcp-071** 기존: AI 화면 — 게이트웨이 열림 표시·등록 명령(URL 포함)·키 기본 마스킹·재발급 실 흐름(구 키 즉시 401·새 키 접속). (agents.gateway AC-1/AC-2, agents.token AC-1/AC-2) [자동]
- **CASE-mcp-074** 재등록 명령: 상태 payload 의 claude/codex 재등록 명령이 `remove`(rockury) 를 add 앞에 두고 현재 키를 담는다 — 재발급 후에도 새 키로 갱신됨. (agents.token AC-3) → `src/main/mcp/registration.test.ts` [자동]
- **CASE-mcp-075** e2e: AI 화면에 "접속 키를 바꾼 뒤" 재등록 안내 + Claude/Codex 재등록 복사 버튼이 보이고, 재발급 후 재등록 명령이 새 키를 담는다. (agents.token AC-3) → `e2e/smoke.mjs` [자동]
- **CASE-mcp-072** 신설: 쓰기 리하이드레이션 — Studio 화면을 연 채 MCP `set_schema` 호출 → 신규 테이블명이 화면 텍스트에 즉시 나타남(수동 재조회 없이). (tools.write AC-3, tools.rehydration AC-1/AC-2) [자동]
- **CASE-mcp-073** 신설: `create_version` 호출 → Versions 타임라인에 새 버전 번호 텍스트 등장 + tools/list 에 쓰기 4종 노출 확인. (tools.write AC-5, tools.rehydration AC-2) [자동]

## 알려진 커버리지 구멍 (의도적 — 근거 포함)
- **http.lifecycle AC-1(시작 실패 30초 재시도)**: Electron 생명주기 타이머 — 단위 seam 없음, e2e 로 포트 선점 시나리오 구성 비용 과대. 자동화 보류(수동 확인 항목).
- **http.lifecycle AC-4(포트 점유 시 +1~+9 폴백)**: 자동화 가능(포트 선점 후 startMcp) — 미착수 구멍으로 등재, 후속 자동화 후보.
- **http.lifecycle AC-5(단일 인스턴스 락)**: 두 번째 앱 인스턴스 기동이 필요 — e2e 비용 대비 실익 낮아 보류.
- **키체인(safeStorage) 실경로**: vitest 는 평문 폴백만 검증(CASE-mcp-015/016) — 실 키체인 영속은 e2e 재발급 흐름(CASE-mcp-071)이 간접 검증.
- **agents.gateway AC-1 모션 축소 존중 · agents.token AC-1 화면 재진입 재마스킹**: 시각/세션 상태 — 수동 확인.
