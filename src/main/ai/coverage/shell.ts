import type { ServiceCoverage } from './types'

/**
 * 앱 셸(창 제어)의 MCP 노출 지도 — 어느 서비스에도 속하지 않는 공용 크롬이다.
 * 서비스 에이전트는 이 파일을 건드리지 않는다.
 */
export const shellCoverage: ServiceCoverage = {
  service: 'shell',
  tools: {},
  excluded: {
    // ── 창 제어: 원격 조작 대상 아님 ──
    'window:minimize': 'UI 창 제어 — 원격 노출 실익 없음',
    'window:toggle-maximize': 'UI 창 제어 — 원격 노출 실익 없음',
    'window:close': 'UI 창 제어 — 원격 노출 실익 없음',
    // ── 개발용 화면 피드백: 에이전트가 부를 것이 아니라 사람이 앱에서 남기는 입력 ──
    'shell:saveDevFeedback':
      '개발 전용 도구 — 사람이 화면에 표시를 그려 남기는 입력이라 원격 호출 대상이 아니다. ' +
      '에이전트는 결과물(.harness/feedback/<시각>-<화면>/)을 파일로 읽는다.',
    // ── 프로젝트: 읽기·만들기는 UI/UX 채널이 이미 열고, 고치기·지우기는 원래 사람만 한다 ──
    // 프로젝트는 UI/UX 위계의 맨 위층이기도 해서 같은 저장소를 두 통로가 본다.
    'shell:listProjects': '중복 노출 회피 — MCP 는 list_ui_projects 로 같은 목록을 이미 연다.',
    'shell:createProject': '중복 노출 회피 — MCP 는 create_ui_node(level=project)로 이미 만든다.',
    // 아래 둘은 uiux 쪽에서도 닫혀 있다(uiux:updateNode·deleteNode) — 같은 이유를 여기서도 지킨다.
    'shell:updateProject': '주소를 흔드는 조작 — 프로젝트 키가 화면 주소의 첫 조각이라 사람이 앱에서만',
    'shell:deleteProject': '파괴적 조작 — UI/UX 위계가 연쇄로 지워지므로 사람이 앱에서만',
    'shell:listScopedItems': '소속 정리 화면 전용 — 에이전트는 각 서비스 도구로 대상을 직접 읽는다.',
    'shell:setItemProject':
      '범위를 흔드는 조작 — 옮기면 그 항목이 다른 화면에서 통째로 사라진다. 사람이 뜻을 알고 앱에서만'
  }
}
