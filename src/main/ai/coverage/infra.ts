import type { ServiceCoverage } from './types'

/**
 * Infra 서비스의 MCP 노출 지도.
 *
 * **여는 것**: 설계본과 노드 문서 읽기. "Rockury 는 인프라를 구축하지 않는다"의 반대편 짝이다 —
 * 구축은 밖에서 하되, 에이전트가 **왜 이 노드가 있고 죽으면 무슨 일이 나는지**를 알아야 한다.
 *
 * **안 여는 것**: 쓰기·실행·자격증명. Infra 채널은 사용자의 자격증명과 임의 명령 실행에 닿아
 * DB 서비스와 위험의 급이 다르다. 특히 `infra:runProbe` 는 **영구 제외**다 — 열면 앱이 곧 원격 셸이 된다.
 *
 * 도구 정의는 `src/main/ai/tools/infra.ts`(내 파일)에 있고, 공용 `tools.ts` 는 그 배열을
 * 이어 붙이기만 한다 — 다섯 서비스가 같은 줄을 놓고 부딪히지 않게.
 *
 * "아직 결정 안 함"은 사유가 아니다 — 아래는 전부 **왜 닫혀 있는지**를 적는다.
 */
export const infraCoverage: ServiceCoverage = {
  service: 'infra',
  // 노출 — 설계본과 노드 문서를 읽기 전용으로 연다.
  // "Rockury 는 구축하지 않는다"의 반대편 짝이다: 구축은 밖에서 하되, 에이전트가 **왜 이 노드가 있고
  // 죽으면 무슨 일이 나는지**를 알아야 한다. 이름·종류만 주면 에이전트도 "그래서 어쩌라고"가 된다.
  tools: {
    infra_list_designs: ['infra:listDesigns'],
    infra_get_design: ['infra:getGraph'],
    infra_get_node_doc: []
  },
  excluded: {
    'infra:listCatalogs': '읽기. 에이전트가 알아야 할 것은 설계본이지 카탈로그 형식이 아니다.',
    'infra:listRuns': '읽기. 실행 이력은 사람이 감사하는 기록 — 에이전트에게 줄 이유가 없다.',
    'infra:latestSnapshot':
      '읽기. 대조 결과 노출(spec node-doc.mcp 의 infra:getReconcile)과 함께 열 후보 — 지금은 보류.',
    'infra:saveSnapshot':
      '쓰기. 스냅샷은 탐침이 실제로 읽어 온 것만 담아야 한다 — 밖에서 지어낸 값이 들어오면 대조가 거짓말을 한다.',
    'infra:listProviders':
      '읽기지만 인프라 연결 목록 자체가 정찰 정보다. 설계본만으로 충분해 열지 않는다.',

    // 쓰기 — 설계본은 사람이 그리는 정본이다.
    'infra:createDesign': '쓰기. 설계본은 사람이 그리는 정본이다.',
    'infra:updateDesign': '쓰기. 위와 같음.',
    'infra:deleteDesign': '쓰기·파괴적. 설계본 통째 삭제는 에이전트에게 열지 않는다.',
    'infra:saveGraph': '쓰기. 그림 전체를 덮어쓰는 채널이라 사고 반경이 크다.',
    'infra:saveCatalog':
      '쓰기. 카탈로그는 실행할 명령을 담는다 — 에이전트가 쓰게 하면 명령 주입 통로가 된다.',
    'infra:deleteCatalog': '쓰기·파괴적.',

    // 실행·비밀 — 앞으로도 열지 않는다.
    'infra:runProbe': '임의 명령 실행. 에이전트에게 이 문을 열면 앱이 곧 원격 셸이 된다 — 영구 제외.',
    'infra:saveProvider': '자격증명 취급 경로 — 영구 제외.',
    'infra:deleteProvider': '자격증명 취급 경로 — 영구 제외.'
  }
}
