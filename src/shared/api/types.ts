/**
 * API 서비스 도메인 정본 — 렌더러(화면)와 메인(저장·MCP)이 같은 모양을 쓴다.
 * 프로세스별 사본을 두면 한쪽만 고쳐지는 드리프트가 생기므로 shared 에 둔다
 * (`shared/dialects.ts` 와 같은 이유).
 *
 * 명세: `docs/spec/api-service.md` §2·§3.
 */

// ── 인터페이스 종류와 상호작용 모양 ────────────────────────────────────────

export const INTERFACE_KINDS = [
  'rest',
  'graphql',
  'grpc',
  'jsonrpc',
  'websocket',
  'sse',
  'webhook'
] as const
export type InterfaceKind = (typeof INTERFACE_KINDS)[number]

/**
 * 화면을 가르는 것은 프로토콜 개수가 아니라 **상호작용 모양**이다(spec §3).
 * 이 4개만 만들면 프로토콜이 늘어도 화면이 안 는다.
 */
export const INTERACTION_SHAPES = ['unary', 'server-stream', 'duplex', 'inbound'] as const
export type InteractionShape = (typeof INTERACTION_SHAPES)[number]

export interface InterfaceMeta {
  id: InterfaceKind
  label: string
  /** 이 종류가 가질 수 있는 상호작용 모양. 목록 밖 모양은 그 종류에 존재하지 않는다. */
  shapes: InteractionShape[]
  /**
   * 서버가 자기 스키마를 **표준으로** 뱉는가.
   * 스키마에서 서버를 만드는 방식이면 도로 뱉을 수 있고, 손으로 라우트를 짜면 뱉을 게 없다 —
   * 이 한 칸이 판정 2등급(완전 / 관측)을 가른다(spec §4-①).
   */
  selfDescribing: boolean
  /** 요청 편집 표면에 나오는 칸. 여기 없는 칸은 **보이지 않는다**(비활성이 아니라 없음 — shape AC-7). */
  fields: RequestField[]
}

/** 요청 편집 표면의 칸 종류. */
export const REQUEST_FIELDS = [
  'method',
  'path',
  'query',
  'headers',
  'body',
  'graphqlQuery',
  'graphqlVariables',
  'grpcMethod',
  'rpcMethod',
  'rpcParams',
  'connectUrl',
  'expectedBody'
] as const
export type RequestField = (typeof REQUEST_FIELDS)[number]

export const INTERFACE_META: InterfaceMeta[] = [
  {
    id: 'rest',
    label: 'REST',
    shapes: ['unary'],
    selfDescribing: false,
    fields: ['method', 'path', 'query', 'headers', 'body']
  },
  {
    id: 'graphql',
    label: 'GraphQL',
    // subscription 은 서버 스트리밍. introspection 이 표준이라 완전 판정 대상.
    shapes: ['unary', 'server-stream'],
    selfDescribing: true,
    fields: ['path', 'headers', 'graphqlQuery', 'graphqlVariables']
  },
  {
    id: 'grpc',
    label: 'gRPC',
    // 스트리밍 종류는 proto 메서드 정의가 정한다 — 사람이 고르지 않는다(shape AC-3).
    shapes: ['unary', 'server-stream', 'duplex'],
    selfDescribing: true,
    fields: ['connectUrl', 'headers', 'grpcMethod', 'body']
  },
  {
    id: 'jsonrpc',
    label: 'JSON-RPC',
    shapes: ['unary'],
    selfDescribing: false,
    fields: ['path', 'headers', 'rpcMethod', 'rpcParams']
  },
  {
    id: 'websocket',
    label: 'WebSocket',
    // 보낼 메시지는 요청 정의가 아니라 실행 화면 몫이라 body 칸이 없다(shape AC-5).
    shapes: ['duplex'],
    selfDescribing: false,
    fields: ['connectUrl', 'headers']
  },
  {
    id: 'sse',
    label: 'SSE',
    shapes: ['server-stream'],
    selfDescribing: false,
    fields: ['connectUrl', 'headers']
  },
  {
    id: 'webhook',
    label: 'Webhook',
    // 보내는 모양이 없다 — 받을 모양만 선언한다(shape AC-6).
    shapes: ['inbound'],
    selfDescribing: false,
    fields: ['expectedBody']
  }
]

export function interfaceMeta(kind: InterfaceKind): InterfaceMeta {
  const m = INTERFACE_META.find((x) => x.id === kind)
  if (!m) throw new Error(`알 수 없는 인터페이스 종류 '${kind}' — 허용: ${INTERFACE_KINDS.join(', ')}`)
  return m
}

/** 이 종류가 완전 판정(서버 스키마 전량 대조) 대상인가. */
export function supportsCompleteDrift(kind: InterfaceKind): boolean {
  return interfaceMeta(kind).selfDescribing
}

// ── 파라미터 시그니처 ─────────────────────────────────────────────────────

export const PARAM_TYPES = ['string', 'number', 'boolean', 'enum', 'object', 'array'] as const
export type ParamType = (typeof PARAM_TYPES)[number]

/** 요청은 함수다 — 이 목록이 그 시그니처이고, 그대로 AI 용 구현 문서가 된다(spec §6-J). */
export interface ParamDef {
  name: string
  type: ParamType
  required: boolean
  /** 값이 안 오면 쓰이는 값. 해석 순서에서 가장 약하다(spec §2). */
  defaultValue?: string
  description?: string
  /** `type: 'enum'` 일 때 허용 값. 빈 목록은 정의 오류다. */
  enumValues?: string[]
}

// ── 응답 모양 ─────────────────────────────────────────────────────────────

/**
 * 필수여부. `unknown`(모름)은 **판정에서 제외**되고 제외 사실이 결과에 남는다 —
 * 모르는 것을 안전으로 치지 않기 위해서다(spec requests.response AC-2).
 */
export const REQUIREDNESS = ['required', 'nullable', 'unknown'] as const
export type Requiredness = (typeof REQUIREDNESS)[number]

export const FIELD_TYPES = ['string', 'number', 'boolean', 'object', 'array', 'null'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export interface FieldDef {
  name: string
  type: FieldType
  requiredness: Requiredness
  /** 중첩 객체·배열 원소의 필드. */
  fields?: FieldDef[]
  /** 허용 값 목록(열거형 응답). */
  enumValues?: string[]
}

export interface ResponseDef {
  /** HTTP 상태코드 · gRPC 코드 · 스트림 이벤트 종류. 문자열로 통일한다. */
  status: string
  fields: FieldDef[]
}

// ── 요청 · 명세 ───────────────────────────────────────────────────────────

export interface RequestFields {
  method?: string
  path?: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: string
  graphqlQuery?: string
  graphqlVariables?: string
  grpcMethod?: string
  rpcMethod?: string
  rpcParams?: string
  connectUrl?: string
  expectedBody?: string
}

export interface RequestDef {
  id: string
  name: string
  /** 트리에서의 자리. 빈 문자열이면 최상위. */
  folder: string
  shape: InteractionShape
  params: ParamDef[]
  request: RequestFields
  responses: ResponseDef[]
  /** 사람이 쓰는 문서(markdown). 정의에서 나올 수 없는 것만 담는다. */
  docs: string
}

export interface SpecDef {
  id: string
  name: string
  description: string
  /** 생성 시 결정되는 고정 속성 — 편집으로 바꾸지 않는다(spec §2). */
  kind: InterfaceKind
  requests: RequestDef[]
}

// ── 환경 · 값 ─────────────────────────────────────────────────────────────

export interface EnvValue {
  name: string
  value: string
  /** 켜지면 화면·기록·내보내기·MCP 어디서도 실값이 안 나간다(spec §4-⑥). */
  secret: boolean
}

export interface EnvironmentDef {
  id: string
  specId: string
  name: string
  baseUrl: string
  /** 켜지면 상시 경고 띠 + 실행 확인 게이트(spec environments.guard AC-2/AC-3). */
  production: boolean
  values: EnvValue[]
}

// ── 실행 기록 ─────────────────────────────────────────────────────────────

/**
 * 실행 결과의 갈래. **"실패" 로 뭉뚱그리지 않는다** — 못 붙은 것과 붙었는데 4xx 를 받은 것은
 * 완전히 다른 문제이고, 뭉치면 원인을 한참 찾게 된다(spec send.execute AC-4).
 */
export const RUN_STATUSES = [
  'ok',
  'http-error',
  'connect-failed',
  'timeout',
  'tls-error',
  'cancelled'
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  ok: '성공',
  'http-error': '오류 응답',
  'connect-failed': '연결 실패',
  timeout: '시간 초과',
  'tls-error': '인증서 오류',
  cancelled: '취소'
}

// ── 스트림 세션 ───────────────────────────────────────────────────────────

/** 세션 상태. `error` 는 끊긴 것과 다르다 — 왜 끊겼는지가 화면에 남아야 한다(stream.session AC-1). */
export const STREAM_STATES = ['idle', 'connecting', 'open', 'closed', 'error'] as const
export type StreamState = (typeof STREAM_STATES)[number]

export const STREAM_STATE_LABEL: Record<StreamState, string> = {
  idle: '대기',
  connecting: '접속 중',
  open: '연결됨',
  closed: '끊김',
  error: '오류'
}

/**
 * 타임라인 항목의 방향. `system` 은 우리가 만든 항목(접속·끊김·재접속 시도)이다 —
 * 주고받은 메시지와 **같은 줄에 섞되 방향으로 갈라 보인다**(stream.session AC-2/AC-4).
 */
export const STREAM_DIRECTIONS = ['out', 'in', 'system'] as const
export type StreamDirection = (typeof STREAM_DIRECTIONS)[number]

export const STREAM_DIRECTION_LABEL: Record<StreamDirection, string> = {
  out: '보냄',
  in: '받음',
  system: '기록'
}

/** 세션에서 오간 한 줄. `seq` 는 같은 밀리초에 여러 개가 와도 순서를 잃지 않게 한다. */
export interface StreamMessage {
  seq: number
  at: string
  direction: StreamDirection
  /** SSE `event:` 이름 · 시스템 항목 종류(`connect`·`close`·`reconnect`·`error`). 없으면 ''. */
  event: string
  /** 원문 그대로. 화면이 접어 보여도 여기 값은 안 바뀐다(내보내기가 원문을 보존해야 한다). */
  data: string
}

// ── 실행 기록 ─────────────────────────────────────────────────────────────

/**
 * 한 번 쏜 것. **불변**이다 — 나중에 명세가 바뀌어도 지나간 관측은 안 바뀐다.
 * 비밀 표식 값은 여기 들어올 때 이미 가려져 있다(spec send.observe AC-3).
 */
export interface RunRecord {
  id: string
  specId: string
  requestName: string
  environmentId: string
  environmentName: string
  /** 어느 버전 기준의 관측인가. Draft 상태면 null — 판정이 버전을 가르는 데 쓴다. */
  baseVersion: string | null
  /**
   * 어떤 상호작용을 관측한 기록인가. **선택 필드가 아니다** — 단발 응답과 스트림 세션은
   * 관측 내용의 모양 자체가 달라서, 이 칸이 없으면 판정이 메시지 목록을 응답 본문으로
   * 오독한다(spec api-contract drift.observed AC-6).
   */
  shape: InteractionShape
  status: RunStatus
  httpStatus: number | null
  durationMs: number
  createdAt: string
  request: { method: string; url: string; headers: Record<string, string>; body: string }
  response: { status: number; headers: Record<string, string>; body: string; size: number } | null
  /**
   * 스트림 세션의 관측 내용. 단발 실행이면 null(빈 배열이 아니다 — "없음"과 "0건"은 다르다).
   * **목록 조회에서는 안 실린다**(본문이 커서 메인 프로세스가 멈춘다) — 그때는 `messageCount`
   * 만 보고, 본문이 필요하면 `getRun` 으로 하나만 읽는다.
   */
  messages: StreamMessage[] | null
  /** 메시지 몇 건이었나. 단발 실행이면 null — 본문을 안 읽고도 "몇 건"을 말할 수 있게. */
  messageCount: number | null
  error: string | null
}

/** 값이 어디서 왔는지. 오른쪽으로 갈수록 세다(spec §2 해석 순서). */
export const VALUE_ORIGINS = ['default', 'environment', 'call'] as const
export type ValueOrigin = (typeof VALUE_ORIGINS)[number]

export const ORIGIN_LABEL: Record<ValueOrigin, string> = {
  default: '기본값',
  environment: '환경',
  call: '호출'
}
