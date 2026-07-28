import type { ServiceCoverage } from './types'

/**
 * API 서비스의 MCP 노출 지도 — 정본은 `docs/spec/api-mcp.md` § coverage.map.
 *
 * 이 서비스가 그은 선: **설계면만 연다.** 만들기·고치기 ○ / 지우기·실행 ×
 * (spec api-service §4-③). DB 서비스가 삭제 도구를 안 연 것과 같은 선이고,
 * 버전 컷은 DB 와 달리 **여기서는 막는다** — 깨지는 변경 승인 게이트가 컷에 붙어 있다.
 */
export const apiCoverage: ServiceCoverage = {
  service: 'api',
  tools: {
    api_list_specs: ['api:listSpecs'],
    api_get_spec: ['api:getSpec'],
    api_list_versions: ['api:listVersions'],
    api_create_spec: ['api:createSpec'],
    api_update_spec: ['api:updateSpec'],
    api_set_spec: ['api:setSpec'],
    api_patch_spec: ['api:patchSpec'],
    api_get_runs: ['api:listRuns', 'api:getRun'],
    api_get_drift: ['api:getDrift', 'api:listContractLogs']
  },
  excluded: {
    'api:runDrift':
      '판정 실행은 서버에 실제로 붙는 조작이다(introspection 요청). 결과를 읽는 것은 ' +
      'api_get_drift 로 열려 있고, 돌리는 것은 사람이 앱에서 한다 — 실행을 안 여는 선과 같다.',
    'api:previewAbsorb':
      '미리보기는 화면이 수락 버튼을 그리기 위한 것이다. AI 는 api_get_drift 로 어긋남을 ' +
      '읽고 코드를 고치면 된다 — 명세 쪽 반영은 사람이 판단한다.',
    'api:previewImport':
      '파일 시스템 조작 — AI 는 OpenAPI·proto 파일을 직접 읽고 쓸 수 있으므로 우리를 거칠 이유가 없다 ' +
      '(spec api-mcp coverage.map).',
    'api:import':
      '위와 같음. 게다가 가져오기는 명세를 통째로 바꾸는 조작이라 사람이 미리보기를 보고 수락한다.',
    'api:export': '파일 시스템 조작. AI 가 필요하면 api_get_spec 으로 읽어 스스로 만들면 된다.',
    'api:acceptAbsorb':
      '실제가 옳다고 단정할 근거가 없다(서버가 버그일 수도 있다) — 명세로 받아들이는 판단은 ' +
      '사람 몫이다(spec api-contract accept.absorb AC-3).',
    'api:send':
      '실행은 사람이 앱에서만 — AI 는 터미널에서 더 잘 쏘고, 실행을 안 주면 자격증명 문제 자체가 ' +
      '생기지 않는다(spec api-mcp tools.absent AC-1).',
    'api:listEnvironments':
      '환경은 서버 주소·자격증명을 든다. 실행 도구가 없으므로 AI 가 이 값을 알 이유가 없다.',
    'api:saveEnvironment': '위와 같음 — 값을 쓰는 경로도 열지 않는다.',
    'api:duplicateEnvironment': '위와 같음. 복제는 구조만 옮기지만 환경 표면 자체를 안 연다.',
    'api:deleteEnvironment': '파괴적 조작은 사람이 앱에서만.',
    'api:deleteSpec':
      '파괴적 조작은 사람이 앱에서만 — 명세라는 그릇을 통째로 없애는 도구는 두지 않는다. ' +
      '그 안의 요청 삭제는 api_patch_spec 의 remove_request 로 이미 가능하다(spec api-mcp tools.write AC-7).',
    'api:createVersion':
      '버전 컷은 사람 몫 — 깨지는 변경 사람 승인 게이트가 컷에 붙어 있다(spec api-service §4-⑦·⑧). ' +
      'DB 서비스는 create_version 을 열었지만 API 는 여기서 갈린다(spec api-mcp tools.write AC-5).'
  }
}
