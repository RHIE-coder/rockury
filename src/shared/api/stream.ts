import {
  STREAM_DIRECTION_LABEL,
  type InteractionShape,
  type InterfaceKind,
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

export type StreamTransport = 'websocket' | 'sse'

/** 전송에 붙일 요청 전문의 `method` 자리 — 단발의 GET/POST 자리에 무엇을 썼는지 남긴다. */
const TRANSPORT_METHOD: Record<StreamTransport, string> = {
  websocket: 'WS',
  sse: 'SSE'
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
 * 1차 범위는 **WebSocket · SSE** 다. gRPC 스트리밍과 GraphQL subscription 은 프레이밍·
 * 하위 프로토콜이 아예 달라서, 있는 전송으로 흉내 내면 "붙었는데 아무것도 안 온다"가 된다 —
 * 그건 판정으로 치면 미관측을 통과로 적는 것과 같은 거짓말이다.
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
  if (kind === 'grpc') {
    return no(
      'gRPC 스트리밍은 아직 만들지 않았습니다 — HTTP/2 프레이밍이 필요해 전송 라이브러리 도입이 ' +
        '선행됩니다. 다른 전송으로 흉내 내지 않습니다.'
    )
  }
  if (kind === 'graphql') {
    return no(
      'GraphQL subscription 은 아직 만들지 않았습니다 — WebSocket 위에 graphql-ws 하위 프로토콜이 ' +
        '얹히는데, 그 손잡기를 안 하면 서버가 아무것도 안 보냅니다.'
    )
  }
  return no(`'${kind}' 에는 스트리밍 상호작용이 없습니다.`)
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
