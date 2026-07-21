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
 */
export interface ContextSelector {
  id: string
  label: string
  icon?: LucideIcon
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
}

/** L2 — 서비스 내부의 모듈. views 유무로 depth 2/3가 갈린다. */
export interface Module {
  id: string
  label: string
  icon: LucideIcon
  /** 속한 구획(설계/운영/공통). 그룹 구분선·컨텍스트 활성에 쓰인다. 없으면 'common'. */
  area?: ModuleArea
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
  /** 상단 컨텍스트 바에 렌더되는 ambient 셀렉터들(예: Design, Env). 없으면 바 자체가 생략된다. */
  context?: ContextSelector[]
  /** 서비스 전역 오버레이(모달 등) — 서비스가 활성인 동안 항상 마운트된다. */
  Overlay?: ComponentType
}
