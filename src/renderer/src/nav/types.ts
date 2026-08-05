import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Rockury 내비게이션 데이터 모델.
 *
 * 핵심 원칙: "깊이는 레이아웃 코드가 아니라 데이터다."
 * 각 서비스가 트리(Service → Module → View)를 선언하면 AppShell 이
 * 존재하는 계층만 골라 렌더한다.
 *
 *  - Module 에 `views` 가 있으면      → L3(뷰 탭)이 렌더되고 활성 View 가 leaf (depth 3)
 *  - Module 에 `workspace` 만 있으면  → Module 자신이 leaf (depth 2, L3 생략)
 *  - leaf(Module|View)에 `Toolbar` 가 있으면 → L4(컨텍스트 툴바) 렌더
 */

/** L4 컨텍스트 툴바 콘텐츠. 없으면 툴바 자체가 렌더되지 않는다. */
export type ToolbarComponent = ComponentType

/**
 * 모듈이 속한 구획. DB 서비스의 "설계부(design) / 운영부(ops) / 공통(common)".
 * - 상단 모듈 탭의 그룹 구분선
 * - 컨텍스트 셀렉터의 활성 여부(예: Env 는 ops 에서만)
 * 두 가지를 데이터로 구동한다. 없으면 'common' 취급.
 */
export type ModuleArea = 'design' | 'ops' | 'common'

/**
 * 모듈 탭 줄에서 이 모듈이 서는 자리. 안 적으면 `start`(왼쪽부터 차례로) —
 * **자리를 안 쓴 서비스는 예전과 똑같이 그려진다.**
 *
 * `center` 는 "왼쪽 것도 오른쪽 것도 아닌, 둘 사이를 건너는 모듈" 자리다(DB 의 Migration —
 * 설계와 실 DB 를 견줘 계획을 만든다). 한 줄에 하나만 두는 자리라 눈이 거기서 쉰다.
 */
export type ModuleSlot = 'start' | 'center' | 'end'

/** 컨텍스트 셀렉터의 옵션 하나. */
export interface ContextOption {
  id: string
  label: string
  /** 옵션 라벨 오른쪽에 흐리게 붙는 부가 정보(예: 벤더 'MySQL 8.0', 적용 버전 'v0.3.13'). */
  hint?: string
  /** 라벨 아래 두 번째 줄로 흐리게 표시되는 설명(예: 설계 설명). 드롭다운에서만 보인다. */
  subtitle?: string
  /** 옵션 아이덴티티 컬러 점(예: 벤더 컬러). CSS color 값. */
  dot?: string
}

/** 셀렉터 드롭다운 하단(구분선 아래)의 액션 — 예: Design 의 "새 설계…". */
export interface ContextAction {
  id: string
  label: string
  icon?: LucideIcon
  onSelect: () => void
}

/**
 * 서비스 전역에 떠 있는 컨텍스트 셀렉터(예: Design, Env).
 * nav 트리(모듈/뷰)와 달리 "지금 어느 대상을 기준으로 보는가"를 고르는 ambient 상태.
 *
 * 놓이는 자리는 `area` 가 가른다:
 *   - `area` 없음 → 모듈 탭 위의 **컨텍스트 바**(기존 자리)
 *   - `area` 있음 → **뷰 탭 줄 오른쪽 끝의 그 구획 손잡이** 안. 그 구획을 쓰는 화면에서만 뜬다.
 */
export interface ContextSelector {
  id: string
  label: string
  icon?: LucideIcon
  /**
   * 이 셀렉터가 붙는 구획. 지정하면 컨텍스트 바가 아니라 **뷰 탭 줄 오른쪽 끝의 손잡이**로
   * 들어가고, 그 구획을 쓰는 모듈을 보는 동안에만 뜬다(`Module.handles` · 2026-08-02 사용자 요청).
   * 같은 area 를 여러 셀렉터가 쓰면 한 손잡이 안에 세로선으로 나뉘어 나란히 선다.
   */
  area?: ModuleArea
  /**
   * 셸이 값을 들지 않고 **서비스가 직접 그리는 칸**. 지정하면 options·actions·placeholder 는 무시된다.
   * 값이 서비스 스토어에 있거나(예: DB 의 시점 렌즈) 드롭다운 모양이 일반 셀렉터와 다를 때 쓴다.
   */
  Render?: ComponentType
  /**
   * 정적 옵션. 옵션이 런타임 데이터라면 서비스 스토어가
   * `nav/contextOptions` 레지스트리로 밀어 넣는다(그 경우 이 배열은 대체됨).
   */
  options: ContextOption[]
  /** 옵션 목록 아래(구분선 뒤)에 렌더되는 액션들. */
  actions?: ContextAction[]
  /** 이 area 목록의 모듈에서만 활성. 없으면 항상 활성. */
  activeInAreas?: ModuleArea[]
  /** 초기 선택 옵션 id. 없으면 "선택 안 됨"으로 시작하고 placeholder 를 보여준다. */
  defaultOptionId?: string
  /** 선택 안 됐을 때 표시할 문구(예: '환경 선택'). */
  placeholder?: string
}

/** 워크스페이스 본문. WorkspacePanels 등으로 내부 레이아웃을 자유롭게 구성. */
export type WorkspaceComponent = ComponentType

/** L3 — 모듈 내부의 뷰 (depth 3의 leaf) */
export interface View {
  id: string
  label: string
  icon: LucideIcon
  workspace: WorkspaceComponent
  Toolbar?: ToolbarComponent
  /**
   * 뷰 탭 줄에서 이 뷰가 속한 **묶음의 이름표**. 이름표가 같은 이웃끼리 한 묶음으로 그려지고
   * 묶음 사이에 구분선이 선다. 안 적으면 이름표 없는 묶음이다(구분선만).
   *
   * 쓰는 곳: DB 의 Migration — 뷰 여섯이 실은 두 방향 일인데(설계→실제 반영 · 실제→설계
   * 되먹임) 한 줄에 섞여 있어서 어느 것이 어느 방향인지 줄만 봐서는 안 읽혔다
   * (2026-08-04 사용자 요청).
   */
  group?: string
  /** 묶음 이름표의 색조 — 그 흐름이 **출발하는** 부서. 안 적으면 중립. */
  groupTone?: ModuleArea
}

/** L2 — 서비스 내부의 모듈. views 유무로 depth 2/3가 갈린다. */
export interface Module {
  id: string
  label: string
  icon: LucideIcon
  /** 속한 구획(설계/운영/공통). 그룹 구분선·컨텍스트 활성에 쓰인다. 없으면 'common'. */
  area?: ModuleArea
  /** 탭 줄에서 서는 자리. 없으면 'start'. */
  slot?: ModuleSlot
  /**
   * 이 모듈의 뷰 탭 줄에 세울 **구획 손잡이**(= 그 구획의 대상 셀렉터 묶음). 안 적으면 자기 구획
   * 하나(`common` 이면 없음)라, 대부분의 모듈은 적을 일이 없다.
   *
   * 적는 것은 **두 부서의 대상을 함께 쥐는 모듈**뿐이다 — DB 의 Migration 은 설계와 연결을
   * 견줘 계획을 만들어서, 자기 구획(`common`)만 따르면 정작 필요한 손잡이가 둘 다 사라진다.
   */
  handles?: ModuleArea[]
  /**
   * 손잡이가 뷰 탭 줄에서 **어떤 모양으로 서는가.** 안 적으면 `'end'` — 줄 오른쪽 끝에 한 줄로
   * (2026-08-02 이후의 모양). `'sides'` 는 설계 손잡이가 줄 맨 왼쪽·운영 손잡이가 오른쪽 끝에
   * 서고, 각각 두 단으로 접힌 부서색 카드가 된다.
   *
   * **모듈마다 정한다**(2026-08-04 사용자 요청). 손잡이 컴포넌트 하나가 모든 화면을 그리므로
   * 모양을 컴포넌트에 박으면 한 화면을 고친 것이 다섯 서비스 전 화면으로 번진다 — 실제로 한 번
   * 번뜨렸다. 지금 `'sides'` 는 DB 의 Migration 하나뿐이다: 설계와 운영 손잡이가 **둘 다** 떠서
   * 한 줄로는 탭이 설 자리가 없는 유일한 화면이라 여기서만 접을 값어치가 있다.
   */
  handleLayout?: 'end' | 'sides'
  /** 있으면 depth 3 (뷰 탭 렌더). 이 경우 workspace 는 무시된다. */
  views?: View[]
  /** views 가 없을 때 렌더되는 depth-2 leaf 워크스페이스. */
  workspace?: WorkspaceComponent
  /** depth-2 leaf 자체의 컨텍스트 툴바. */
  Toolbar?: ToolbarComponent
}

/** L1 — 좌측 레일의 서비스 */
export interface Service {
  id: string
  label: string
  icon: LucideIcon
  modules: Module[]
  /**
   * ambient 셀렉터들(예: Design, Env). `area` 가 없는 것만 상단 컨텍스트 바로 가고,
   * `area` 가 붙은 것은 뷰 탭 줄의 구획 손잡이로 간다. 바로 갈 것이 하나도 없으면
   * 바 자체가 생략된다(DB 가 그 경우 — 넷 다 구획 손잡이로 갔다).
   */
  context?: ContextSelector[]
  /** 서비스 전역 오버레이(모달 등) — 서비스가 활성인 동안 항상 마운트된다. */
  Overlay?: ComponentType
}
