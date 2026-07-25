/**
 * MCP 노출 지도 — "앱 능력(IPC 채널) ↔ MCP 도구" 대응의 단일 정본.
 *
 * 스테일 방지 핀: coverage.test.ts 가 src/main/ipc/*.ts 를 스캔해 실제 채널 전수를
 * 이 지도와 대조한다. 새 IPC 채널이 여기 등재(노출 또는 제외+사유) 없이 생기면,
 * 혹은 지도에 남은 채널이 코드에서 사라지면(유령 등재) `npm test` 가 실패한다.
 * → 앱이 발전할 때 MCP 서버가 낡은 채로 방치되는 것을 게이트가 막는다(AGENTS.md 불변식).
 *
 * 새 채널을 추가하는 개발자/에이전트의 선택지:
 *  ① tools.ts 에 도구를 만들고 MCP_TOOL_CHANNELS 에 대응 등재
 *  ② MCP_EXCLUDED_CHANNELS 에 "왜 노출하지 않는지" 사유와 함께 등재
 */

/** 도구명 → 그 도구가 덮는 IPC 채널. 키 집합은 tools.ts TOOL_NAMES 와 일치해야 한다(테스트 강제). */
export const MCP_TOOL_CHANNELS: Record<string, string[]> = {
  list_designs: ['designs:list'],
  get_schema: ['tables:list'],
  list_versions: ['versions:list'],
  get_version: ['versions:list'],
  // ── 쓰기 4종(2단계) — 삭제류는 여기 못 들어온다(파괴적 조작은 사람이 앱에서만, 테스트 핀). ──
  create_design: ['designs:create'],
  update_design: ['designs:update'],
  set_schema: ['tables:replaceForDesign'],
  create_version: ['versions:create']
}

/** 의도적으로 노출하지 않는 채널 → 사유. "아직 결정 안 함"은 사유가 아니다 — 보류라면 왜 보류인지 적는다. */
export const MCP_EXCLUDED_CHANNELS: Record<string, string> = {
  // ── 창 제어: 원격 조작 대상 아님 ──
  'window:minimize': 'UI 창 제어 — 원격 노출 실익 없음',
  'window:toggle-maximize': 'UI 창 제어 — 원격 노출 실익 없음',
  'window:close': 'UI 창 제어 — 원격 노출 실익 없음',

  // ── Studio › Seed(시드 세트): 지금은 앱 화면 전용 ──
  //   시드는 실 DB 에 심어질 기준 데이터이고, 그 값에 환경 변수 자리표시자가 섞인다.
  //   에이전트가 시드를 쓰는 것은 반영 파이프라인((b) 설계→운영 UPSERT)의 안전장치가 선 뒤에
  //   함께 설계한다 — 읽기도 그때 같은 도구로 노출한다(반쪽 노출로 의미가 왜곡되는 것을 피함).
  'seedSets:list': '시드 저작은 앱 화면 전용 — 반영 파이프라인((b) 단계)과 함께 도구 설계 예정',
  'seedSets:replaceForDesign': '시드 쓰기 — 반영 파이프라인((b) 단계) 안전장치 확정 전 노출 금지',

  // ── 설계부 삭제: 확정 제외 — 파괴적 조작은 사람이 앱에서만(spec tools.write AC-7, 테스트 핀) ──
  'designs:delete': '파괴적 쓰기 — 파괴적 조작은 사람이 앱에서만, 노출 금지',
  'versions:delete': '파괴적 쓰기 — 파괴적 조작은 사람이 앱에서만, 노출 금지',

  // ── 연결/실 DB 실행: 자격증명·파괴 가능 조작 — 별도 게이트 설계 전에는 노출 금지 ──
  'connections:list': '연결 메타에 호스트·계정 포함 — 민감정보 마스킹 설계 후 검토',
  'connections:create': '자격증명 쓰기 — 노출 금지',
  'connections:update': '자격증명 쓰기 — 노출 금지',
  'connections:delete': '파괴적 쓰기 — 노출 금지',
  'connections:reorder': 'UI 정렬 상태 — 노출 실익 없음',
  'connections:move': 'UI 정렬/분류 상태(그룹 이동) — 노출 실익 없음',
  'connectionGroups:list': '연결 목록 비노출(민감정보)과 묶인 분류 메타 — 함께 보류',
  'connectionGroups:create': '쓰기(UI 분류 상태) — 노출 실익 없음',
  'connectionGroups:rename': '쓰기(UI 분류 상태) — 노출 실익 없음',
  'connectionGroups:reorder': 'UI 정렬 상태(그룹 순서) — 노출 실익 없음',
  'connectionGroups:delete': '쓰기(UI 분류 상태) — 노출 실익 없음',
  'connections:test': '실 DB 접속 시도 — 연결 도구 설계 시 함께 검토',
  'connections:testById': '실 DB 접속 시도 — 연결 도구 설계 시 함께 검토',
  'connections:revealPassword': '저장 비밀번호 평문 반환 — 로컬 편집 화면 전용, 원격 노출 절대 금지',
  'introspection:run': '실 DB 접속 실행 — 연결 도구 설계 시 함께 검토(읽기지만 접속 부하 유발)',
  'query:run': '실 DB 쿼리 실행 — 파괴 게이트(tx) 통과 설계 후 후속 단계 검토',
  'query:runParams': '실 DB 쿼리 실행 — 파괴 게이트(tx) 통과 설계 후 후속 단계 검토',
  'query:explain': '실 DB 접속 실행 — 쿼리 도구 설계 시 함께 검토',
  'query:txBegin': '실 DB 트랜잭션 — 에이전트 원격 트랜잭션은 세션 수명 문제로 노출 금지',
  'query:txExec': '실 DB 트랜잭션 — 에이전트 원격 트랜잭션은 세션 수명 문제로 노출 금지',
  'query:txExecParams': '실 DB 트랜잭션 — 에이전트 원격 트랜잭션은 세션 수명 문제로 노출 금지',
  'query:txCommit': '실 DB 트랜잭션 — 에이전트 원격 트랜잭션은 세션 수명 문제로 노출 금지',
  'query:txRollback': '실 DB 트랜잭션 — 에이전트 원격 트랜잭션은 세션 수명 문제로 노출 금지',

  // ── 운영부 이력/바인딩: 쓰기·운영 상태 — 수요 확인 후 후속 단계에서 ──
  'environments:find': '운영 바인딩 조회 — 연결 노출과 묶여 있어 함께 보류',
  'environments:listByConnection': '운영 바인딩 조회 — 연결 노출과 묶여 있어 함께 보류',
  'environments:ensure': '쓰기(운영 바인딩) — 수요 확인 후 후속 단계 검토',
  'environments:setTarget': '쓰기(운영 바인딩) — 수요 확인 후 후속 단계 검토',
  'environments:setApplied': '쓰기(운영 바인딩) — 수요 확인 후 후속 단계 검토',
  'environments:delete': '파괴적 쓰기 — 노출 금지',
  'migration:saveSnapshot': '쓰기(운영 스냅샷) — 수요 확인 후 후속 단계 검토',
  'migration:latestSnapshot': '운영 스냅샷 조회 — 환경 노출과 묶여 있어 함께 보류',
  'migration:appendLog': '쓰기(운영 로그) — 수요 확인 후 후속 단계 검토',
  'migration:listLogs': '운영 이력 조회 — 환경 노출과 묶여 있어 함께 보류',
  'query:historyAppend': '쓰기(이력 기록) — 앱 내부 전용',
  'query:historyList': '쿼리 이력에 실 데이터 값 포함 가능 — 민감정보 검토 후',
  'query:historyClear': '파괴적 쓰기 — 노출 금지',

  // ── 저장쿼리/컬렉션: 에이전트 수요 확인 후 노출 검토 ──
  'sq:tree': '저장쿼리 열람 — 수요 확인 후 검토',
  'sq:createFolder': '쓰기 — 수요 확인 후 검토',
  'sq:createQuery': '쓰기 — 수요 확인 후 검토',
  'sq:renameFolder': '쓰기 — 수요 확인 후 검토',
  'sq:updateQuery': '쓰기 — 수요 확인 후 검토',
  'sq:deleteFolder': '파괴적 쓰기 — 노출 금지',
  'sq:deleteQuery': '파괴적 쓰기 — 노출 금지',
  'sq:reorderTree': 'UI 정렬 상태 — 노출 실익 없음',
  'col:list': '컬렉션 열람 — 수요 확인 후 검토',
  'col:folders': '컬렉션 열람 — 수요 확인 후 검토',
  'col:items': '컬렉션 열람 — 수요 확인 후 검토',
  'col:create': '쓰기 — 수요 확인 후 검토',
  'col:createFolder': '쓰기 — 수요 확인 후 검토',
  'col:rename': '쓰기 — 수요 확인 후 검토',
  'col:renameFolder': '쓰기 — 수요 확인 후 검토',
  'col:update': '쓰기 — 수요 확인 후 검토',
  'col:updateItem': '쓰기 — 수요 확인 후 검토',
  'col:addItem': '쓰기 — 수요 확인 후 검토',
  'col:addReference': '쓰기 — 수요 확인 후 검토',
  'col:delete': '파괴적 쓰기 — 노출 금지',
  'col:deleteFolder': '파괴적 쓰기 — 노출 금지',
  'col:deleteItem': '파괴적 쓰기 — 노출 금지',
  'col:reorderTree': 'UI 정렬 상태 — 노출 실익 없음',
  'col:reorderItems': 'UI 정렬 상태 — 노출 실익 없음',

  // ── ERD 레이아웃: 화면 배치 상태 — 원격 노출 실익 없음 ──
  'diagram:getLayout': 'ERD 노드 위치(UI 상태) — 노출 실익 없음',
  'diagram:saveLayout': 'ERD 노드 위치(UI 상태) — 노출 실익 없음',
  'diagram:clearLayout': 'ERD 노드 위치(UI 상태) — 노출 실익 없음',

  // ── AI 화면(에이전트 연동) 내부 채널: 자기참조 — 에이전트가 원격으로 만질 대상이 아니라 사람이 앱에서 관리 ──
  'mcp:status': 'AI 화면 내부 — 접속 키 포함 등록 명령을 다루므로 원격 노출 금지',
  'mcp:rotateToken': 'AI 화면 내부 — 접속 키 재발급은 사람 확인 하에서만(원격 노출 시 자기 차단 루프 위험)'
}
