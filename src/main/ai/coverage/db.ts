import type { ServiceCoverage } from './types'

/**
 * DB 서비스의 MCP 노출 지도.
 *
 * 이 서비스의 IPC 채널은 전부 여기에 **노출(도구 대응) 또는 제외(사유)** 로 등재돼야 한다 —
 * 빠지면 `npm test` 가 실패한다(AGENTS.md 절대 불변식 4, 스테일 방지 핀).
 * 다른 서비스 파일은 건드리지 않는다(병렬 개발 파일 소유권).
 */
export const dbCoverage: ServiceCoverage = {
  service: 'db',
  tools: {
    list_designs: ['designs:list'],
    get_schema: ['tables:list'],
    list_versions: ['versions:list'],
    get_version: ['versions:list'],
    // ── 쓰기 5종 — 삭제류는 여기 못 들어온다(파괴적 조작은 사람이 앱에서만, 테스트 핀). ──
    create_design: ['designs:create'],
    update_design: ['designs:update'],
    set_schema: ['tables:replaceForDesign'],
    // 부분 수정도 저장은 같은 설계 스코프 교체 경로다 — 조준만 도구가 하고 저장 계층은 그대로.
    patch_schema: ['tables:replaceForDesign'],
    create_version: ['versions:create']
  },
  excluded: {
    // ── Design › Seed(시드 세트): 지금은 앱 화면 전용 ──
    //   시드는 실 DB 에 심어질 기준 데이터이고, 그 값에 환경 변수 자리표시자가 섞인다.
    //   에이전트가 시드를 쓰는 것은 반영 파이프라인((b) 설계→운영 UPSERT)의 안전장치가 선 뒤에
    //   함께 설계한다 — 읽기도 그때 같은 도구로 노출한다(반쪽 노출로 의미가 왜곡되는 것을 피함).
    'envVars:list': '환경 변수 메타 — 시드 반영 값(비밀값 포함 가능) 계열로 함께 보류',
    'envVars:set': '비밀값 쓰기 — 원격 노출 금지',
    'envVars:delete': '파괴적 쓰기 — 노출 금지',
    'envVars:resolve': '비밀값 평문 반환 — 반영 직전 앱 내부 전용, 원격 노출 절대 금지',

    'seedSets:list': '시드 저작은 앱 화면 전용 — 반영 파이프라인((b) 단계)과 함께 도구 설계 예정',
    'seedSets:replaceForDesign': '시드 쓰기 — 반영 파이프라인((b) 단계) 안전장치 확정 전 노출 금지',

    // ── 설계부 삭제: 확정 제외 — 파괴적 조작은 사람이 앱에서만(spec tools.write AC-7, 테스트 핀) ──
    'designs:delete': '파괴적 쓰기 — 파괴적 조작은 사람이 앱에서만, 노출 금지',
    'versions:delete': '파괴적 쓰기 — 파괴적 조작은 사람이 앱에서만, 노출 금지',
    // 메모는 파괴적이지 않지만(스냅샷·번호는 못 건드린다) 지금 노출할 이유가 없다 —
    // 버전에 이름을 붙이는 일은 컷한 사람이 왜 컷했는지를 적는 자리라 사람 몫이다.
    // 에이전트가 버전을 다루는 도구는 `create_version` 하나로 충분하다(2026-08-05).
    'versions:updateNote': '버전 메모는 컷한 사람이 적는 것 — 지금 노출 이유 없음',

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
    'connections:sampleStatus': '샘플 DB 파일 유무 — 사람이 버튼을 누를지 정하는 화면 상태',
    'connections:createSample': '사용자 디스크에 파일 생성 — 사람이 앱에서 누를 때만',
    'connections:resetSample': '사용자 디스크의 파일 삭제·재생성(파괴적) — 사람이 앱에서 누를 때만',
    'introspection:run': '실 DB 접속 실행 — 연결 도구 설계 시 함께 검토(읽기지만 접속 부하 유발)',
    'introspection:schemas': '실 DB 접속 실행 — 범위 선택기가 고를 목록을 채우는 조회(사람 조작 전용)',
    'introspection:catalogs': '실 DB 접속 실행 — 범위 선택기의 database 층 목록(사람 조작 전용)',
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
    'migration:listSnapshots': '운영 스냅샷 이력 조회 — 환경 노출과 묶여 있어 함께 보류',
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

    // ── Data 저장 필터: 사람이 화면에서 만든 조회 편의 설정(UI 상태 계열) ──
    //   에이전트는 조건을 SQL 로 직접 쓰면 되므로 남의 저장 필터를 읽거나 고칠 실익이 없다.
    'dataFilters:list': 'Data 화면 조회 편의 설정(UI 상태) — 노출 실익 없음',
    'dataFilters:listByConnection': 'Data 화면 조회 편의 설정(UI 상태) — 노출 실익 없음',
    'dataFilters:save': 'Data 화면 조회 편의 설정(UI 상태) — 노출 실익 없음',
    'dataFilters:delete': '파괴적 쓰기 — 파괴적 조작은 사람이 앱에서만, 노출 금지',
    'dataFilters:deleteMany': '파괴적 쓰기 — 파괴적 조작은 사람이 앱에서만, 노출 금지',
    'grants:run': '실 DB 접속 실행 — 연결 도구 설계 시 함께 검토(읽기지만 접속 부하 유발)',
    'grants:plan': '권한 문장 미리보기 — 사람의 승인 흐름(미리보기→승인→실행)의 한 도막, 단독 노출 실익 없음',
    'grants:apply': '파괴적 쓰기(GRANT/REVOKE 실행) — 파괴적 조작은 사람이 앱에서만, 노출 금지',
    'grantSets:list': '권한 세트(앱 로컬 설정) — 노출 실익 없음',
    'grantSets:create': '권한 세트(앱 로컬 설정) — 노출 실익 없음',
    'grantSets:update': '권한 세트(앱 로컬 설정) — 노출 실익 없음',
    'grantSets:delete': '파괴적 쓰기 — 파괴적 조작은 사람이 앱에서만, 노출 금지',
  }
}
