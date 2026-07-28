/**
 * Infra 카탈로그 타입 — "노드 종류를 코드가 아니라 데이터로 둔다"의 형식 정본.
 * 명세: `docs/spec/infra-catalog.md`.
 *
 * 노드 타입 = **모양 + 탐침 + 액션**. 셋이 다 있어야 노드인 게 아니다 — 모양만 있어도 노드다
 * (`discover` 없는 종류 = 프리셋). 그래서 프리셋도 같은 형식·같은 검증기를 쓴다.
 */

/** 이 앱이 읽을 수 있는 카탈로그 **형식** 버전. 파일이 이보다 높으면 통째로 거부한다. */
export const APP_SCHEMA_VERSION = 1

/** 탐침이 읽어 온 원본 상태 문자열을 옮겨 담을 다섯 칸. */
export type NodeStatus = 'ok' | 'warn' | 'stopped' | 'gone' | 'unknown'

/** 화면 표기 — 코드 식별자는 영어, 사용자가 보는 말은 한국어. */
export const STATUS_LABEL: Record<NodeStatus, string> = {
  ok: '정상',
  warn: '주의',
  stopped: '멈춤',
  gone: '없어짐',
  unknown: '모름'
}

export const STATUS_VALUES: NodeStatus[] = ['ok', 'warn', 'stopped', 'gone', 'unknown']

/** 카탈로그가 어디서 왔나. 가져온 것은 계속 '가져옴'으로 보인다(신뢰 경계). */
export type CatalogSource = 'builtin' | 'mine' | 'imported'

export const SOURCE_LABEL: Record<CatalogSource, string> = {
  builtin: '내장',
  mine: '내가 만듦',
  imported: '가져옴'
}

// ---------- 호출 ----------

/** 명령 실행. `args` 는 **배열**이다 — 셸을 거치지 않으므로 치환값이 인자를 쪼개지 못한다. */
export interface CliCall {
  type: 'cli'
  cmd: string
  args: string[]
}

export interface HttpCall {
  type: 'http'
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string
  headers?: Record<string, string>
  body?: string
}

/** JSON 으로 못 적는 것(도커 소켓·Redis 접속 등)을 부르는 내장 어댑터. */
export interface BuiltinCall {
  type: 'builtin'
  adapter: string
  op: string
  params?: Record<string, string>
}

export type ProbeCall = CliCall | HttpCall | BuiltinCall

// ---------- 탐침 ----------

/** 응답에서 뽑은 값을 우리 노드 필드로 옮기는 지도. 값은 전부 표현식이다. */
export interface DiscoverMap {
  /** 실물의 고유 식별자. 비면 그 항목은 노드가 되지 못한다(버리되 이유를 남긴다). */
  externalId: string
  name?: string
  status?: string
  /** 무엇 안에 담겨 있나 — 중첩 박스가 여기서 나온다. */
  parentExternalId?: string
  /** 어느 설계 노드에 매칭되나 — 대조 1순위 근거(`rockury:node` 태그). */
  designNodeRef?: string
}

/**
 * 응답 본문의 생김새.
 * - `json`(기본) — 통짜 JSON 하나.
 * - `ndjson` — **줄마다 JSON 하나.** 도커가 이렇게 뱉는다(`docker ps --format {{json .}}`).
 *   읽을 때 줄들을 배열로 묶으므로 목록 표현식은 `[]`(루트 배열)이 된다.
 */
export type ResponseFormat = 'json' | 'ndjson'

/** 탐침 = 호출한다 → 뽑는다 → 옮긴다. */
export interface Discover {
  call: ProbeCall
  /** 응답 본문의 생김새. 없으면 `json`. */
  format?: ResponseFormat
  /** 응답에서 **목록**의 위치. */
  list: string
  map: DiscoverMap
  /** 원본 상태 문자열 → 우리 다섯 칸. 여기 없는 값은 `unknown` 이고 원본을 함께 보존한다. */
  statusMap?: Record<string, NodeStatus>
}

// ---------- 액션 ----------

/** 액션 인자 하나 — 폼은 이 선언에서 자동 생성된다(공급자를 늘려도 화면 코드가 안 는다). */
export interface ActionArg {
  id: string
  label: string
  required?: boolean
  placeholder?: string
}

export interface ActionDef {
  id: string
  label: string
  /** 실물을 바꾸는 액션. 실행 전 확인을 받고, 읽기 전용 공급자에서는 잠긴다. */
  danger?: boolean
  call: ProbeCall
  args?: ActionArg[]
}

// ---------- 노드 문서 ----------

/** 노드에 붙는 링크(런북·대시보드·티켓). */
export interface DocLink {
  label: string
  url: string
}

/**
 * 설계 노드에 붙는 설계 의도. **실물이 아니라 설계 노드에 붙는다** —
 * 실물은 재생성되면 식별자가 바뀌어, 실물에 매달면 재배포 한 번에 증발한다.
 */
export interface NodeDoc {
  /** 왜 있나 */
  role: string
  /** 죽으면 무슨 일이 나나 */
  impact: string
  /** 사람/팀 */
  owner: string
  /** 무엇을 부르고 무엇이 나를 부르나 */
  deps: string
  /** 손대기 전 알 것 */
  beforeTouch: string
  /** 자유 서술(마크다운) */
  notes: string
  links: DocLink[]
}

export const EMPTY_DOC: NodeDoc = {
  role: '',
  impact: '',
  owner: '',
  deps: '',
  beforeTouch: '',
  notes: '',
  links: []
}

/** 정해진 칸의 화면 이름과 도움말 — 화면·문서 양쪽이 이 하나를 본다. */
export const DOC_FIELDS: { key: keyof Omit<NodeDoc, 'links'>; label: string; hint: string }[] = [
  { key: 'role', label: '역할', hint: '이 노드가 왜 있나' },
  { key: 'impact', label: '영향', hint: '죽으면 무슨 일이 나나' },
  { key: 'owner', label: '담당', hint: '사람 또는 팀' },
  { key: 'deps', label: '의존', hint: '무엇을 부르고 무엇이 나를 부르나' },
  { key: 'beforeTouch', label: '손대기 전 알 것', hint: '운영 메모' },
  { key: 'notes', label: '자유 서술', hint: '마크다운' }
]

// ---------- 종류·카탈로그 ----------

/** 대조에서 무엇을 비교할지. 지정 안 하면 상태만 본다. */
export type CompareField = 'status' | 'parent' | 'type'

export interface NodeTypeDef {
  id: string
  label: string
  /** `phosphor:<이름>` · `pack:<팩>/<이름>` · `data:image/svg+xml;…` */
  icon: string
  color?: string
  /** 이 종류가 들어갈 수 있는 부모 종류들. 없거나 비면 최상위 전용. */
  canNestIn?: string[]
  /**
   * 부모 쪽 허가 — 이 종류가 담을 수 있는 자식 종류들. `"*"` 면 무엇이든.
   * 자식이 일일이 자기를 등재하게 만들 수 없는 **일반 상자**(묶음 상자·서버·쿠버네티스)를 위한 것이다.
   * 자식의 `canNestIn` 보다 먼저 본다.
   */
  canContain?: string[]
  /** 선을 그을 수 있는 상대 종류들. 비면 제한 없음. */
  canLinkTo?: string[]
  /** 새 노드를 만들 때 미리 채워지는 문서 틀 — 빈 종이 앞에 앉히지 않는다. */
  docTemplate?: Partial<NodeDoc>
  /** 없으면 프리셋(모양만). */
  discover?: Discover
  actions?: ActionDef[]
  compareFields?: CompareField[]
}

/** 카탈로그가 선언하는 자격증명 칸. **값은 여기 담기지 않는다** — 이름만. */
export interface CredSlot {
  id: string
  label: string
  hint?: string
}

export interface Catalog {
  /** 파일 **형식**의 버전. 앱이 아는 것보다 높으면 읽지 않는다. */
  schemaVersion: number
  /** 그 공급자 **목록 내용**의 버전 — 언제 기준인지. 설계 데이터에 함께 저장된다. */
  catalogVersion: string
  provider: { id: string; label: string }
  credentials?: CredSlot[]
  nodeTypes: NodeTypeDef[]
}

/** 저장된 카탈로그 한 벌(출처가 붙은 형태). */
export interface StoredCatalog {
  id: string
  source: CatalogSource
  catalog: Catalog
  importedAt?: string
  approvedAt?: string
}
