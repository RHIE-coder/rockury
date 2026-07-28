import type { ServiceCoverage } from './types'

/**
 * UI/UX 서비스의 MCP 노출 지도.
 *
 * 이 서비스의 IPC 채널은 전부 여기에 **노출(도구 대응) 또는 제외(사유)** 로 등재돼야 한다 —
 * 빠지면 `npm test` 가 실패한다(AGENTS.md 절대 불변식 4, 스테일 방지 핀).
 * 다른 서비스 파일은 건드리지 않는다(병렬 개발 파일 소유권).
 *
 * **읽기와 쓰기를 함께 열었다.** 읽기만 열면 에이전트가 본 것이 대화창에서 휘발되고, 그러면
 * 이 서비스가 풀려던 문제("설계가 어디까지 됐는지 아무도 모른다")가 그대로 남는다.
 * 도구 정의는 `src/main/ai/uiuxTools.ts`.
 */
export const uiuxCoverage: ServiceCoverage = {
  service: 'uiux',
  tools: {
    // ── 읽기 ──
    list_ui_projects: ['uiux:listProjects'],
    get_ui_tree: ['uiux:getTree'],
    // 화면 한 장 읽기는 트리와 같은 저장 경로를 탄다(별도 채널을 새로 뚫지 않았다).
    get_ui_surface: ['uiux:getTree'],
    // ── 쓰기 ──
    create_ui_node: ['uiux:createNode'],
    set_ui_surface: ['uiux:saveSurface'],
    // 이 서비스의 핵심 — 판정은 에이전트가 하고 앱은 받아 적는다(§8).
    set_ui_surface_status: ['uiux:setSurfaceStatus'],
    // ── 의견(핀) — 사람이 화면에 남긴 요청을 에이전트가 읽고, 반영한 뒤 해결로 넘긴다 ──
    list_ui_notes: ['uiux:listNotes'],
    resolve_ui_note: ['uiux:setNoteResolved']
  },
  excluded: {
    // 이름·주소 고치기는 주소를 흔든다 — 흐름·규칙·의견이 전부 그 주소에 걸려 있어, 에이전트가
    // 무심코 바꾸면 가리키던 것들이 조용히 끊긴다. 사람이 앱에서 뜻을 알고 바꾼다.
    'uiux:updateNode': '주소를 흔드는 조작 — 흐름·규칙·의견이 그 주소에 걸려 있어 사람이 앱에서만',
    // 파괴적 조작은 DB 서비스와 같은 규율로 사람이 앱에서만 한다(연쇄 삭제라 되돌릴 수 없다).
    'uiux:deleteNode': '연쇄 삭제 — 파괴적 조작은 사람이 앱에서만',
    // 의견은 사람이 에이전트에게 보내는 요청이다 — 에이전트가 스스로 만들면 방향이 뒤집힌다.
    // (반영 결과는 상태 칸(set_ui_surface_status)의 근거로 적는다.)
    'uiux:createNote': '의견은 사람 → 에이전트 방향의 요청 — 에이전트가 스스로 만들지 않는다',
    'uiux:deleteNote': '지우기 — 무엇을 왜 고쳤는지가 이력으로 남아야 해서 사람이 앱에서만'
  }
}
