/**
 * UI/UX 서비스 도메인 타입 — 명세 정본 `docs/spec/uiux-ia.md` §2(위계) · §7(데이터 모델).
 *
 * 위계는 6층이다: Project > Application > Service > Surface > Section > Component.
 * 타입 이름에 `Spec` 을 붙인 이유는 이름 충돌 때문이다 — 여기의 "Service" 는 좌측 레일의
 * rockury 서비스(`nav/types.ts` 의 `Service`)가 아니라 **설계 대상의 3층**(로그인 서비스·
 * 상품 관리 서비스…)이다. 한 파일에서 둘을 같이 다룰 때 접두어가 없으면 조용히 헷갈린다.
 */

/** 뷰포트 — 화면을 세 벌 만드는 게 아니라 같은 화면의 렌즈다(§4). `pc` 가 바탕이고 나머지가 덮어쓴다. */
export type Viewport = 'pc' | 'tablet' | 'mobile'

/** 화면 종류. v1 은 GUI 만 채운다 — 명령줄(`command`)·정기 작업(`job`)은 값만 늘리면 된다(§2). */
export type SurfaceKind = 'page' | 'modal' | 'dialog' | 'drawer' | 'toast'

/**
 * 설계가 어디까지 왔나. 판정은 에이전트가 하고 여기는 받아 적는다(§8).
 * `designed` 설계만 됨 · `implemented` 코드가 있다 · `verified` 설계대로임을 확인했다.
 */
export type SurfaceStatus = 'designed' | 'implemented' | 'verified'

// ─── 위계 (저장 단위) ───────────────────────────────────────────────

/** 모든 층이 공유하는 것: 기계용 id + 주소 조각 key + 사람이 읽는 이름. */
interface SpecNode {
  id: string
  /** 주소 조각. 소문자 영숫자·하이픈·밑줄만(INV-2). 이름과 별개라 한글 이름을 써도 주소가 안전하다. */
  key: string
  name: string
  description: string
}

export interface SpecProject extends SpecNode {
  createdAt: string
}

export interface SpecApplication extends SpecNode {
  projectId: string
  position: number
}

/** 설계 대상의 3층(로그인·상품 관리·CS…). rockury 서비스가 아니다 — 파일 머리 주석 참고. */
export interface SpecService extends SpecNode {
  applicationId: string
  position: number
}

export interface SpecSurface extends SpecNode {
  serviceId: string
  kind: SurfaceKind
  position: number
  /** 섹션·컴포넌트·이벤트 트리. 저장소에는 JSON 한 칸으로 들어간다(§7). */
  content: SurfaceContent
  status: SurfaceStatus
  /** 상태를 마지막으로 갱신한 시각·주체·근거. 에이전트가 확인을 마치면 채운다(§8). */
  checkedAt?: string
  checkedBy?: string
  checkedNote?: string
  updatedAt: string
}

/** 설계 스냅샷. 프로젝트 단위로 뜬다. */
export interface SpecVersion {
  id: string
  projectId: string
  number: string
  note: string
  /** 뜰 당시의 위계 전체. 읽기 전용이라 구조를 고정하지 않는다(버전마다 모델이 달라질 수 있다). */
  snapshot: unknown
  locked: boolean
  createdAt: string
}

// ─── 화면 내용 ─────────────────────────────────────────────────────

/**
 * 배치 — **좌표가 아니라 구조**다(§6). 자유 배치를 저장하지 않는 이유는 두 가지다:
 * 되짚기가 필요한 산출물은 에이전트가 정확히 못 읽고, 뷰포트마다 좌표를 세 벌 찍어야 한다.
 */
export interface Layout {
  /** 기본은 세로 스택. */
  type?: 'stack' | 'row' | 'grid'
  /** 간격 — 디자인 토큰 경로를 권장한다(raw 길이도 허용). */
  gap?: string
  align?: 'start' | 'center' | 'end' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'between'
  /** row 전용. 기본 줄바꿈 — 안 하면 좁은 곳에서 옆 항목을 침범한다. */
  wrap?: boolean
  /** grid 전용. 기본 2. */
  columns?: number
}

/** 조건 — "보이나 안 보이나"(§3 넷째 축). 값 규칙(Rule)과 직교한다. */
export interface Condition {
  state?: string
  equals?: string | number | boolean
  by?: string
  expr?: string
  /** 자연어 한 줄. 화면에는 이쪽을 우선 보인다 — 구조 필드는 검증용이다. */
  description?: string
}

/**
 * 컴포넌트 행동 규칙 — 값 제약·검증 피드백·활성 조건(§3).
 * 어휘를 닫지 않는다(`format` 등은 열린 문자열) — 모르는 값은 그대로 표시한다.
 * 상세는 Rules 화면을 지을 때 채운다.
 */
export interface Rule {
  constraints?: {
    minLength?: number
    maxLength?: number
    format?: string
    pattern?: string
  }
  validation?: {
    on?: 'change' | 'blur' | 'submit'
    message?: string
  }
  enabled?: {
    default?: 'enabled' | 'disabled'
    /** `all-required` 필수 칸이 다 찼을 때 · `valid` 폼이 유효할 때 · 특정 컴포넌트 id 들. */
    requires?: 'all-required' | 'valid' | string[]
    when?: Condition
  }
  note?: string
}

export interface SpecComponent {
  id: string
  /** 어휘(button·input·select…). 열린 문자열이라 새 종류를 더해도 모델이 안 깨진다. */
  type: string
  label?: string
  /** 종류별 데이터(placeholder·variant·options…). 모르는 키는 무시한다. */
  props?: Record<string, unknown>
  when?: Condition
  rule?: Rule
}

export interface SpecSection {
  id: string
  name: string
  layout?: Layout
  when?: Condition
  /** 섹션 이름을 화면에 보일지. 기본은 안 보인다 — 관리용 그룹이기 때문이다(§2). */
  showLabel?: boolean
  components: SpecComponent[]
}

export type NavKind = 'navigate' | 'open' | 'close'
export type DataOp = 'create' | 'update' | 'delete'

/**
 * 이벤트 — **트리거 하나 + 효과 여럿**(§3). 화면 전이와 데이터 변이를 갈래로 나누지 않는다.
 * 삭제 버튼 한 번이 모달을 닫고 + 상품을 지우는데, 갈래를 나누면 같은 클릭이 두 군데로 찢어진다.
 * 출발 화면은 암묵(자기 자신)이라 적지 않는다.
 */
export interface SurfaceEvent {
  id?: string
  /** 사용자면 `{component, event}`, 자동이면 `{schedule}`. */
  trigger: { component?: string; event?: string; schedule?: string }
  /** 화면 전이 효과. `to` 는 안정 주소. */
  nav?: { kind?: NavKind; to: string; label?: string }
  /** 데이터 변이 효과. `contract` 를 소비하는 화면으로 퍼진다. */
  data?: { contract: string; op: DataOp; label?: string }
  when?: Condition
  label?: string
}

/** 뷰포트별 덮어쓰기. 어느 조각까지 덮을지는 Screens 를 지을 때 정한다 — 지금은 배치만. */
export interface ViewportOverride {
  layout?: Layout
  /** 섹션 id → 그 섹션의 덮어쓸 배치. */
  sections?: Record<string, { layout?: Layout }>
}

/** 화면 한 장의 내용. 저장소에는 JSON 한 칸(§7). */
export interface SurfaceContent {
  layout?: Layout
  sections: SpecSection[]
  events?: SurfaceEvent[]
  /** `pc` 는 바탕이라 여기 없다 — 나머지가 그 위를 덮는다. */
  viewports?: Partial<Record<Exclude<Viewport, 'pc'>, ViewportOverride>>
}

/** 화면이 반영하는 데이터 계약 — 데이터 효과의 도착점. */
export interface Consumes {
  contract: string
  label?: string
}
