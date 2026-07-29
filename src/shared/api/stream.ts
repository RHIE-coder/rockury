import { plaintextSecretBlock, type GrpcTarget } from './grpcTarget'
import {
  SHAPE_LABEL,
  STREAM_DIRECTION_LABEL,
  type InteractionShape,
  type InterfaceKind,
  type RequestDef,
  type RunRecord,
  type RunStatus,
  type StreamDirection,
  type StreamMessage
} from './types'

/**
 * 스트림 세션의 순수 규칙 — `docs/spec/api-runner.md` § stream.session.
 *
 * 전송(소켓을 실제로 여는 일)은 메인 프로세스에 있고, **판단은 전부 여기 있다.**
 * 그래야 "보내기 패널이 있느냐"·"이 세션이 성공이냐"·"무엇을 관측으로 남기느냐"가
 * 화면·메인 양쪽에서 같은 답을 내고, 전부 테스트로 덮인다.
 *
 * 이 파일이 지키는 한 문장: **모르는 것을 안다고 말하지 않는다.**
 * 못 붙이는 인터페이스는 조용히 다른 전송으로 내려가지 않고 **사유를 단 빈 결과**를 준다.
 */

export type StreamTransport = 'websocket' | 'sse' | 'grpc' | 'graphql-ws'

/** 전송에 붙일 요청 전문의 `method` 자리 — 단발의 GET/POST 자리에 무엇을 썼는지 남긴다. */
const TRANSPORT_METHOD: Record<StreamTransport, string> = {
  websocket: 'WS',
  sse: 'SSE',
  grpc: 'GRPC',
  'graphql-ws': 'GQL-WS'
}

/** 사람이 읽는 전송 이름. */
const TRANSPORT_LABEL: Record<StreamTransport, string> = {
  websocket: 'WebSocket',
  sse: 'SSE',
  grpc: 'gRPC',
  'graphql-ws': 'GraphQL 구독'
}

/**
 * 세션 머리에 적을 한 줄 — `WebSocket · 서로 계속 주고받음`.
 *
 * 모양 이름은 반드시 `SHAPE_LABEL` 을 쓴다. 여기서만 "양방향"처럼 다르게 적으면
 * 명세를 만들 때 고른 말과 실행 화면의 말이 갈려 **같은 개념을 두 어휘로 배우게 된다**.
 */
export function transportLabel(transport: StreamTransport, shape: InteractionShape): string {
  return `${TRANSPORT_LABEL[transport]} · ${SHAPE_LABEL[shape]}`
}

// ── 보내기 패널 ───────────────────────────────────────────────────────────

/**
 * 보내기 패널이 있느냐 (AC-3).
 * **비활성이 아니라 없음**이다 — 서버 스트리밍에서 회색 입력칸을 보여 주면 "언젠가 켜지나"
 * 하고 기다리게 된다. 그 프로토콜에 없는 것은 화면에도 없어야 한다.
 */
export function sendPanelVisible(shape: InteractionShape): boolean {
  return shape === 'duplex'
}

// ── 전송 선택 ─────────────────────────────────────────────────────────────

export interface TransportPick {
  transport: StreamTransport | null
  /** 전송이 null 일 때만 채워진다 — 왜 못 하는지. 빈 화면에 이유 없이 두지 않는다. */
  unsupported: string | null
}

const no = (unsupported: string): TransportPick => ({ transport: null, unsupported })

/**
 * 이 요청을 어느 전송으로 여나.
 *
 * 스트리밍 상호작용이 있는 종류는 **저마다 다른 전송**을 쓴다 — 프레이밍도 손잡기도 다르다.
 * 있는 전송으로 흉내 내면 "붙었는데 아무것도 안 온다"가 되는데, 그건 판정으로 치면
 * 미관측을 통과로 적는 것과 같은 거짓말이다. 못 여는 종류에는 **사유를 단 빈 결과**를 준다.
 */
export function transportFor(kind: InterfaceKind, shape: InteractionShape): TransportPick {
  if (shape === 'unary') {
    return no('이 요청은 단발 요청→응답입니다 — Runner › Send 에서 보내세요.')
  }
  if (shape === 'inbound') {
    return no('웹훅은 내가 보내는 것이 아니라 받는 것입니다 — Runner › Inbox 에서 대기하세요.')
  }
  if (kind === 'websocket') return { transport: 'websocket', unsupported: null }
  if (kind === 'sse') return { transport: 'sse', unsupported: null }
  if (kind === 'grpc') return { transport: 'grpc', unsupported: null }
  if (kind === 'graphql') return { transport: 'graphql-ws', unsupported: null }
  return no(`'${kind}' 에는 스트리밍 상호작용이 없습니다.`)
}

/**
 * gRPC 세션을 열기 전에 막아야 하는 것 — **붙어 본 뒤가 아니라 누르기 전에** 안다.
 *
 * 화면(`canOpen`)과 창구(`api:openStream`) 둘 다 이 함수를 쓴다. 화면에만 두면 다른 경로가
 * 우회하고, 창구에만 두면 사용자가 정의 받아 오는 왕복(최대 20초)을 기다렸다 실패를 본다.
 *
 * null 이면 막을 것이 없다.
 */
export function grpcStreamBlocker(
  request: Pick<RequestDef, 'request'>,
  target: GrpcTarget,
  headers: Record<string, string>,
  secrets: readonly string[]
): string | null {
  if (target.problem) return target.problem
  if (!(request.request.grpcMethod ?? '').trim()) {
    return '어느 메서드인지가 비어 있습니다 — 요청의 gRPC 메서드 칸을 채우세요.'
  }
  return plaintextSecretBlock(target, headers, secrets)
}

/**
 * GraphQL 구독을 열기 전에 막아야 하는 것 — **붙어 본 뒤가 아니라 누르기 전에** 안다.
 *
 * 이 둘은 요청 정의에 적힌 **정적인 값**이라 소켓을 열기 전에 판정할 수 있다. 안 막으면
 * 손잡기까지 마친 뒤에야 실패하는데, 그때는 화면이 이미 '연결됨' 을 적은 뒤고
 * 자동 재접속까지 돌아 서버를 헛되이 두드린다(gRPC 의 `grpcStreamBlocker` 와 같은 자리).
 *
 * 화면(`canOpen`)과 창구(`api:openStream`) 둘 다 이 함수를 쓴다.
 * **가린 값으로 부른다** — 문구에 실값이 실리면 안 된다.
 */
export function graphqlSubscribeBlocker(query: string, variables: string): string | null {
  if (!query.trim()) return '구독 질의문이 비어 있습니다 — 요청의 질의문 칸을 채우세요.'
  const raw = variables.trim()
  if (raw) {
    try {
      JSON.parse(raw)
    } catch (err) {
      return `질의 변수가 JSON 이 아닙니다 — ${err instanceof Error ? err.message : String(err)}`
    }
  }
  return null
}

/**
 * 보낼 본문을 JSON 으로 읽는다 — **두 벌을 받는다**(소켓에 나갈 실값 / 사람에게 보일 가림).
 *
 * 실패 문구를 실값에서 만들면 안 되는 이유: `JSON.parse` 의 오류는 **입력 조각을 그대로
 * 싣는다**(`…"{"token": sk_live_AB"… is not valid JSON`). 잘린 비밀은 글자 그대로 일치가
 * 아니라서 지우는 그물에 안 걸리고, 그대로 화면·기록에 굳는다.
 * 그래서 사유는 **가린 쪽**을 파싱해 만든다(spec stream.session AC-8).
 */
export function parseJsonBody(
  real: string,
  display: string
): { value: unknown } | { reason: string } {
  try {
    return { value: real.trim() ? JSON.parse(real) : {} }
  } catch {
    let why = ''
    try {
      if (display.trim()) JSON.parse(display)
    } catch (err) {
      why = err instanceof Error ? err.message : String(err)
    }
    // 가린 쪽이 (드물게) 잘 읽히면 이유를 지어내지 않는다 — 자리를 못 짚을 뿐이다.
    return { reason: why ? `보낼 본문이 JSON 이 아닙니다 — ${why}` : '보낼 본문이 JSON 이 아닙니다.' }
  }
}

// ── 타임라인 ──────────────────────────────────────────────────────────────

export interface TimelineFilter {
  /** 본문·이벤트 이름을 함께 훑는다. 빈 값이면 안 거른다. */
  query?: string
  /** 방향 필터. 없으면 전부. */
  direction?: StreamDirection | ''
}

/** 검색·필터 (AC-5). **순서는 절대 안 바꾼다** — 시간순이 곧 인과다. */
export function filterTimeline(
  messages: readonly StreamMessage[],
  filter: TimelineFilter
): StreamMessage[] {
  const needle = (filter.query ?? '').trim().toLowerCase()
  return messages.filter((m) => {
    if (filter.direction && m.direction !== filter.direction) return false
    if (!needle) return true
    return m.data.toLowerCase().includes(needle) || m.event.toLowerCase().includes(needle)
  })
}

/**
 * 전체 내보내기 (AC-5). **원문을 보존한다** — 내보낸 파일이 관측의 사본이라,
 * 여기서 잘리거나 다듬어지면 나중에 근거로 못 쓴다.
 */
export function exportTimeline(messages: readonly StreamMessage[]): string {
  return messages
    .map((m) => {
      const ev = m.event ? ` ${m.event}` : ''
      return `[${m.at}] ${STREAM_DIRECTION_LABEL[m.direction]}${ev}\t${m.data}`
    })
    .join('\n')
}

/** 메시지 하나 복사 (AC-5) — 본문만 나간다(붙여넣을 곳은 대개 편집기·터미널이다). */
export function copyMessageText(m: StreamMessage): string {
  return m.data
}

// ── 재접속 정책 ───────────────────────────────────────────────────────────

/** 재접속 간격. 무한정 빨리 두드리면 서버를 때리고 타임라인이 재접속으로 뒤덮인다. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000]

/**
 * **총** 재접속 시도 상한. 연속 실패 상한(위 목록 길이)만으로는 안 막힌다 —
 * 붙자마자 끊는 서버(포트는 열렸는데 앱이 죽은 상태, 인증 실패 시 즉시 닫는 게이트웨이,
 * 200 을 주고 본문을 바로 닫는 SSE)에서는 매번 "붙었다"로 세어 연속 카운터가 0으로 돌아가
 * **영원히 재접속한다.** 그러면 세션이 끝나지 않아 기록도 안 남는다.
 */
export const RECONNECT_TOTAL_MAX = 20

export interface ReconnectDecision {
  delayMs: number
  /** 이번이 몇 번째 연속 시도인가(사람에게 보일 숫자). */
  attempt: number
}

/**
 * 다시 붙을까, 여기서 끝낼까. `null` 이면 끝낸다.
 * `streak` 는 성공하면 0으로 돌아가는 연속 실패 수, `total` 은 **절대 안 줄어드는** 누적 수다.
 */
export function nextReconnect(input: {
  autoReconnect: boolean
  streak: number
  total: number
}): ReconnectDecision | null {
  if (!input.autoReconnect) return null
  if (input.total >= RECONNECT_TOTAL_MAX) return null
  if (input.streak >= RECONNECT_DELAYS_MS.length) return null
  return { delayMs: RECONNECT_DELAYS_MS[input.streak], attempt: input.streak + 1 }
}

// ── 세션 → Run ────────────────────────────────────────────────────────────

export interface StreamOutcome {
  /** 한 번이라도 붙었나. 안 붙었으면 관측이 0 이다. */
  opened: boolean
  endedBy: 'user' | 'server' | 'error'
  /** 오류로 끝났을 때 전송 계층이 나눈 갈래(`classifyFailure` 와 같은 갈래를 쓴다). */
  failure?: RunStatus
}

/**
 * 세션 결과 → 실행 상태.
 * 단발과 같은 규율이다 — **"실패"로 뭉뚱그리지 않는다**(spec send.execute AC-4).
 */
export function streamRunStatus(o: StreamOutcome): RunStatus {
  if (o.endedBy === 'error') return o.failure ?? 'connect-failed'
  // 붙기 전에 사용자가 껐다 → 취소. 붙었다가 끊은 것은 관측이 이뤄졌으므로 성공이다.
  if (o.endedBy === 'user' && !o.opened) return 'cancelled'
  return 'ok'
}

export interface StreamSessionSnapshot {
  specId: string
  requestName: string
  environmentId: string
  environmentName: string
  baseVersion: string | null
  shape: InteractionShape
  /** 세션을 열 때 넣은 호출 파라미터. **이미 가려진 채로** 들어온다. */
  call: Record<string, string>
  transport: StreamTransport
  url: string
  /** **이미 가려진 채로** 들어온다 — 이 함수가 가리는 게 아니라, 가린 것만 받는다. */
  headers: Record<string, string>
  messages: StreamMessage[]
  startedAt: string
  endedAt: string
  outcome: StreamOutcome
  closeReason: string | null
}

/**
 * 세션 하나 = Run 하나 (AC-6). 메시지 목록이 그 Run 의 관측 내용이다.
 *
 * **`response` 는 null 로 둔다.** 메시지 목록을 JSON 으로 뭉쳐 응답 본문 자리에 넣으면
 * 판정기가 그걸 "이 요청의 응답 모양"으로 읽어 없는 어긋남을 만들어 낸다. 스트림은
 * 판정 규칙이 아직 없으므로, 있는 자리에 억지로 끼워 넣는 대신 **비워 두고 모양으로 가른다**.
 */
export function sessionToRun(s: StreamSessionSnapshot): Omit<RunRecord, 'id' | 'createdAt'> {
  const started = Date.parse(s.startedAt)
  const ended = Date.parse(s.endedAt)
  return {
    specId: s.specId,
    requestName: s.requestName,
    environmentId: s.environmentId,
    environmentName: s.environmentName,
    baseVersion: s.baseVersion,
    shape: s.shape,
    call: s.call,
    status: streamRunStatus(s.outcome),
    httpStatus: null,
    durationMs: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0,
    request: {
      method: TRANSPORT_METHOD[s.transport],
      url: s.url,
      headers: s.headers,
      body: ''
    },
    response: null,
    messages: s.messages,
    messageCount: s.messages.length,
    error: s.closeReason
  }
}
