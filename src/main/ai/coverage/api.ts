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
    'api:cancelSend':
      '실행의 짝이다 — 열 수 없는 것을 끊게 할 이유가 없고, 사람이 보고 있는 전송을 남이 ' +
      '끊는 도구는 두지 않는다.',
    'api:openStream':
      '실행이다 — `api:send` 와 같은 선. 게다가 세션은 오래 살아서, 도구로 열면 누가 언제 ' +
      '닫는지가 흐려진다(앱을 닫아도 남는 소켓이 생긴다). 쌓인 세션 기록은 api_get_runs 로 읽힌다.',
    'api:sendStream': '위와 같음 — 열린 세션에 글자를 밀어 넣는 것도 실행이다.',
    'api:closeStream': '위와 같음. 열지 못하므로 닫을 것도 없다.',
    'api:startMock':
      '포트를 여는 조작이다 — 모르는 새 열려 있으면 안 되는 창구를 도구로 열게 하지 않는다. ' +
      '게다가 가짜 응답은 관측이 아니라서 AI 가 여기서 얻을 것이 없다(선언은 api_get_spec 에 있다).',
    'api:stopMock': '위와 같음 — 열지 못하므로 닫을 것도 없다.',
    'api:getMock': '대기 상태는 화면이 자기 배지를 그리기 위한 것이다.',
    'api:setMockStatus':
      '어느 상태로 답할지는 사람이 화면에서 고르는 실험 손잡이다. 선언 자체는 ' +
      'api_patch_spec 으로 고친다.',
    'api:startInbox':
      '실행이다 — 포트를 열어 남의 요청을 받는 조작이라 `api:send` 보다 더 사람 몫이다. ' +
      '모르는 새 열려 있으면 안 되는 창구를 도구로 열게 하지 않는다. 받은 것은 api_get_runs 로 읽힌다.',
    'api:stopInbox': '위와 같음 — 열지 못하므로 닫을 것도 없다.',
    'api:getInbox': '대기 상태는 화면이 자기 배지를 그리기 위한 것이다. 관측 내용은 api_get_runs 로 온다.',
    'api:setInboxResponse':
      '되돌려줄 코드를 바꾸는 것은 발신자의 재전송을 유도하는 조작이다 — 남의 시스템 동작을 ' +
      '바꾸는 자리라 사람이 앱에서 한다.',
    'api:closeAllStreams':
      '화면이 새로 뜰 때 주인 없는 소켓을 정리하는 내부 청소 창구다 — 에이전트가 부를 일이 ' +
      '없고, 열 수 없는 것을 남이 닫게 하는 도구를 두면 사람이 보던 세션을 끊을 수 있다.',
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
