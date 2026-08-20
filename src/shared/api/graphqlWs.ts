import { rootFieldOf } from './graphql'
import type { RunStatus } from './types'

/**
 * GraphQL 구독(subscription) 규약.
 *
 * WebSocket 을 열기만 해서는 아무것도 안 온다. 그 위에 **`graphql-transport-ws`** 라는
 * 하위 프로토콜(= 소켓 위에서 다시 정한 대화 규칙)이 얹혀 있고, 순서가 정해져 있다:
 *
 *   우리 `connection_init` → 서버 `connection_ack` → 우리 `subscribe`
 *   → 서버 `next`(여러 번) → 서버 `complete` 또는 `error`
 *
 * **손잡기를 건너뛰고 `subscribe` 를 먼저 보내면 서버가 연결을 끊는다**(규약이 그렇게 정했다).
 * 그래서 "소켓이 열림"과 "구독이 시작됨"은 다른 사건이고, 화면의 `연결됨` 은 뒤엣것이어야 한다.
 *
 * 이 파일은 **판단만** 한다(소켓을 모른다) — 무엇을 보낼지, 받은 것을 어떻게 읽을지.
 * 그래야 손잡기 순서·오류 갈래가 전부 테스트로 덮인다.
 *
 * **서버가 보내는 것은 남의 데이터다.** 그래서 여기서 세 가지를 지킨다:
 *   · 우리가 연 구독의 `id` 가 아닌 것은 우리 관측이 아니다
 *   · 규약 순서를 벗어난 것(손 잡은 뒤 또 잡기)에 다시 반응하지 않는다
 *   · 인용하는 글자에 길이 상한을 둔다 — 자르기 전에 가리는 그물을 태우면 메인이 멎는다
 */

/** 규약 이름. 손잡기 때 이 이름으로 합의해야 서버가 규약을 켠다. */
export const GRAPHQL_WS_PROTOCOL = 'graphql-transport-ws'

/** 구독 하나를 가리키는 이름. 한 소켓에 여러 구독을 올릴 수 있어 규약이 요구한다. */
export const SUBSCRIPTION_ID = '1'

/**
 * 서버가 준 글자를 문구에 인용할 때의 상한.
 *
 * 자르기가 **맨 끝**에 있으면(타임라인 상한) 그 전에 가리는 그물이 원본 크기로 돈다 —
 * 64MB 프레임 하나에 비밀 표기 수만큼 전수 `split/join` 이 걸려 메인 프로세스가 멎는다.
 * 그래서 **여기서 먼저** 자른다.
 */
const MAX_QUOTE = 2_000

/**
 * 손잡기 전에 규약에 없는 글자를 이만큼 받으면 **그 서버는 이 규약을 안 쓰는 것**으로 본다.
 * 안 두면 글자를 흘리는 서버에 붙었을 때 제한시간(30초)까지 프레임마다 타임라인 행이
 * 생기고, 그 구간은 상태가 `connecting` 이라 묶어 보내기가 꺼져 있어 IPC 가 그만큼 나간다.
 */
const MAX_PRE_ACK_NOISE = 20

export type GqlWsAction =
  /** 소켓으로 내보낼 글자. */
  | { kind: 'send'; text: string }
  /** 타임라인에 받은 것으로 남길 것. `event` 는 구독 루트 이름(판정이 선언을 고르는 열쇠). */
  | { kind: 'message'; event: string; data: string }
  /** 타임라인에 시스템 문구로 남길 것. */
  | { kind: 'system'; text: string }
  /** 손잡기가 끝났다 — 이제부터 진짜 열린 것이다. */
  | { kind: 'open' }
  /**
   * 이 회차가 끝났다. **소켓은 아직 살아 있을 수 있다** — 부르는 쪽이 닫아야 한다.
   * (규약 메시지로 끝나는 전송이라 다른 전송처럼 "이미 죽었겠지"가 성립하지 않는다.)
   */
  | { kind: 'end'; reason: string; failure?: RunStatus }

export interface GqlWsContext {
  /** 구독 질의문. `subscribe` 에 실린다. `{{변수}}` 는 이미 치환된 것이 온다. */
  query: string
  /** 질의 변수(글자). 비었거나 JSON 이 아니면 안 싣는다 — 지어내지 않는다. */
  variables: string
  /**
   * 인증 값. **헤더로 못 보낸다** — 브라우저·Node 의 WebSocket 손잡기에는 헤더를 못 싣는다.
   * graphql-ws 는 그 자리를 위해 `connection_init` 의 payload 를 둔다(규약이 권하는 길이다).
   */
  connectionParams: Record<string, string>
  /**
   * 구독 루트 이름. **세션을 열 때 한 번 계산해 담는다**(`subscriptionEvent`).
   * 메시지마다 질의문을 다시 파싱하면 5.5KB 질의문·초당 1,000건에서 초당 16MB 의
   * 임시 문자열이 생긴다(실측) — 세션 동안 한 글자도 안 바뀌는 값이다.
   */
  event: string
}

/** 규약 순서를 지키기 위해 들고 있어야 하는 것. 세션 한 회차에 하나. */
export interface GqlWsState {
  acked: boolean
  subscribed: boolean
  /** 손잡기 전에 받은, 규약에 없는 글자 수. */
  noise: number
}

export function initialState(): GqlWsState {
  return { acked: false, subscribed: false, noise: 0 }
}

/** 소켓이 열렸다. 규약이 정한 첫 걸음은 **손잡기**다 — 여기서 구독을 보내면 끊긴다. */
export function onSocketOpen(ctx: GqlWsContext): GqlWsAction[] {
  const names = Object.keys(ctx.connectionParams)
  const params = names.length > 0 ? ctx.connectionParams : undefined
  const actions: GqlWsAction[] = [
    { kind: 'send', text: JSON.stringify({ type: 'connection_init', payload: params }) }
  ]
  if (params) {
    // **이름만** 담는다 — 값은 소켓으로만 나간다. 헤더 자리 값이 다른 곳으로 갔다는 사실을
    // 적는 이유: 안 적으면 서버가 401 을 줬을 때 "헤더를 넣었는데 왜"가 된다.
    actions.push({
      kind: 'system',
      text:
        `WebSocket 손잡기에는 헤더를 실을 수 없어 ${names.join(', ')} 을(를) 접속 인사(connection_init) 에 실어 보냅니다 — ` +
        'GraphQL 구독 규약이 그 자리를 따로 뒀습니다.'
    })
  }
  return actions
}

/** 구독 질의의 루트 이름. 타임라인 이벤트 이름이자 판정이 선언을 고르는 열쇠다. */
export function subscriptionEvent(query: string): string {
  return rootFieldOf(query) ?? ''
}

/**
 * 서버가 보낸 글자 하나를 읽는다. `state` 는 **이 함수가 고친다**(규약 순서를 들고 있어야 한다).
 *
 * **모르는 것을 안다고 말하지 않는다:** 규약에 없는 `type` 은 아는 것으로 뭉치지 않고
 * 이름을 그대로 적는다. JSON 이 아니면 그 사실을 적는다(빈 메시지로 삼키지 않는다).
 */
export function onServerText(
  text: string,
  ctx: GqlWsContext,
  state: GqlWsState
): GqlWsAction[] {
  let msg: { type?: unknown; id?: unknown; payload?: unknown }
  try {
    msg = JSON.parse(text) as typeof msg
  } catch {
    return noise(state, `규약에 없는 글자를 받았습니다(JSON 아님) — ${quote(text)}`)
  }
  if (typeof msg?.type !== 'string') {
    return noise(state, `종류가 없는 메시지를 받았습니다 — ${quote(text)}`)
  }

  // **우리가 연 구독의 답인가.** `id` 가 붙는 종류에서 다른 이름이 오면 그건 남의 구독이다 —
  // 게이트웨이가 소켓 하나를 여럿이 나눠 쓰는 구성에서 실제로 온다. 그걸 우리 관측으로
  // 적으면 남의 데이터가 우리 요청의 판정에 들어간다.
  if (ID_TYPES.has(msg.type) && typeof msg.id === 'string' && msg.id !== SUBSCRIPTION_ID) {
    return [
      { kind: 'system', text: `우리가 연 구독이 아닌 '${quote(msg.id, 64)}' 의 ${msg.type} 를 받았습니다 — 세지 않습니다.` }
    ]
  }

  switch (msg.type) {
    case 'connection_ack': {
      // 손을 이미 잡았는데 또 잡아 주는 서버에 **구독을 다시 보내지 않는다** —
      // 30바이트 인바운드가 수 KB 아웃바운드를 끌어내고 타임라인이 같은 줄로 채워진다.
      if (state.acked) return []
      state.acked = true
      const sub = subscribeActions(ctx)
      if (sub.some((a) => a.kind === 'send')) state.subscribed = true
      return [{ kind: 'open' }, ...sub]
    }

    case 'ping':
      // 살아 있냐고 묻는다. 답을 안 하면 서버가 끊는다 — 타임라인을 어지럽히지는 않는다.
      return [{ kind: 'send', text: JSON.stringify({ type: 'pong' }) }]

    case 'pong':
      return []

    case 'next':
      if (!state.subscribed) {
        return [{ kind: 'system', text: '구독을 보내기도 전에 결과가 왔습니다 — 세지 않습니다.' }]
      }
      return [{ kind: 'message', event: ctx.event, data: payloadText(text, msg.payload) }]

    case 'error':
      // 구독 자체가 거절됐다(질의문이 틀렸거나 권한이 없다). 규약상 여기서 끝난다.
      return [
        {
          kind: 'end',
          reason: `서버가 구독을 거절했습니다 — ${errorText(msg.payload)}`,
          failure: 'http-error'
        }
      ]

    case 'complete':
      return [{ kind: 'end', reason: '서버가 구독을 끝냈습니다.' }]

    case 'connection_error':
      // 규약 옛 판(`subscriptions-transport-ws`)의 이름이다. 서버가 옛 판이면 손잡기가 안 맞는다.
      return [
        {
          kind: 'end',
          reason:
            `서버가 옛 규약(subscriptions-transport-ws)으로 답했습니다 — ${errorText(msg.payload)}. ` +
            '이 앱은 지금 규약(graphql-transport-ws)만 씁니다.',
          failure: 'http-error'
        }
      ]

    default:
      return noise(state, `규약에 없는 종류 '${quote(msg.type, 64)}' 를 받았습니다.`)
  }
}

/** `id` 가 붙는 종류 — 이것만 "우리 구독의 답인가"를 따진다. */
const ID_TYPES = new Set(['next', 'error', 'complete'])

/**
 * 손잡기 전에 규약에 없는 글자가 계속 오면 **그 서버는 이 규약을 안 쓴다**고 결론 낸다.
 * 손을 잡은 뒤라면 그냥 모르는 메시지 하나이므로 세지 않는다.
 */
function noise(state: GqlWsState, text: string): GqlWsAction[] {
  if (state.acked) return [{ kind: 'system', text }]
  state.noise += 1
  if (state.noise < MAX_PRE_ACK_NOISE) return [{ kind: 'system', text }]
  return [
    {
      kind: 'end',
      reason:
        `손잡기 전에 규약에 없는 글자를 ${state.noise}건 받았습니다 — ` +
        `이 서버는 '${GRAPHQL_WS_PROTOCOL}' 규약을 쓰지 않는 것으로 보고 멈춥니다.`,
      failure: 'connect-failed'
    }
  ]
}

/** 사용자가 끊는다. 규약은 소켓을 닫기 전에 구독을 접으라고 정한다. */
export function stopMessage(): string {
  return JSON.stringify({ id: SUBSCRIPTION_ID, type: 'complete' })
}

function subscribeActions(ctx: GqlWsContext): GqlWsAction[] {
  const query = ctx.query.trim()
  if (!query) {
    return [{ kind: 'end', reason: '구독 질의문이 비어 있습니다.', failure: 'connect-failed' }]
  }
  const payload: { query: string; variables?: unknown } = { query }

  const raw = ctx.variables.trim()
  if (raw) {
    try {
      payload.variables = JSON.parse(raw)
    } catch {
      // 변수를 못 읽었으면 **없는 셈 치지 않는다** — 서버가 다른 결과를 주고 그 이유를 모른다.
      return [
        {
          kind: 'end',
          reason: '질의 변수가 JSON 이 아닙니다 — 변수를 빼고 보내지 않습니다.',
          failure: 'connect-failed'
        }
      ]
    }
  }
  return [
    { kind: 'send', text: JSON.stringify({ id: SUBSCRIPTION_ID, type: 'subscribe', payload }) }
  ]
}

/**
 * `next` 의 본문을 타임라인 글자로.
 *
 * 보통은 규약 봉투를 벗겨 payload 만 남긴다. 다만 프레임이 크면 **다시 굽지 않는다** —
 * 3.5MB 프레임 하나에 파싱+재직렬화로 힙이 14.7MB 늘고 12ms 를 멎는데(실측), 어차피
 * 타임라인 상한에서 잘려 나갈 부분이다. 그럴 땐 원문을 잘라 쓰고 **그 사실을 적는다.**
 */
function payloadText(raw: string, payload: unknown): string {
  if (raw.length > MAX_MESSAGE_INLINE) {
    return `${raw.slice(0, MAX_MESSAGE_INLINE)}\n…(${raw.length}글자 중 앞부분만 남겼습니다 — 규약 봉투를 포함한 원문입니다)`
  }
  return JSON.stringify(payload ?? null)
}

/** 이보다 큰 프레임은 봉투를 벗기지 않는다(벗기는 값보다 비용이 크다). */
const MAX_MESSAGE_INLINE = 256 * 1024

/** 서버가 준 글자를 문구에 넣을 때는 반드시 이걸 지난다 — 길이를 우리가 못 정하기 때문이다. */
function quote(text: string, limit = MAX_QUOTE): string {
  const s = String(text)
  return s.length <= limit ? s : `${s.slice(0, limit)}…(${s.length}글자 중 앞부분)`
}

/** GraphQL 오류는 배열로 온다(규약). 사람이 읽을 한 줄로 만든다. */
function errorText(payload: unknown): string {
  if (Array.isArray(payload)) {
    const msgs = payload
      .map((e) => (typeof e === 'object' && e !== null ? String((e as { message?: unknown }).message ?? '') : ''))
      .filter(Boolean)
    if (msgs.length > 0) return quote(msgs.join(' · '))
  }
  if (typeof payload === 'string' && payload) return quote(payload)
  if (payload && typeof payload === 'object') {
    const m = (payload as { message?: unknown }).message
    if (typeof m === 'string' && m) return quote(m)
  }
  return '(사유 없음)'
}

/**
 * HTTP 주소 → WebSocket 주소.
 *
 * 환경의 서버 주소는 보통 `https://…` 다. 구독은 같은 자리에 소켓으로 붙으므로 방식만 바꾼다 —
 * **`https` 는 `wss` 로** 간다(그냥 `ws` 로 내리면 암호화가 조용히 벗겨진다).
 * 이미 `ws://`·`wss://` 면 그대로 둔다(사용자가 정한 것이다).
 *
 * 실패는 **한 갈래로만** 말한다(`url: null`) — 빈 문자열로 말하면 `??` 를 그냥 통과해
 * 주소 칸이 조용히 비어 버린다.
 */
export function websocketUrl(url: string): { url: string | null; problem: string | null } {
  const raw = (url ?? '').trim()
  if (!raw) return { url: null, problem: '환경에 서버 주소가 없습니다.' }

  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(raw)
  if (!m) {
    return {
      url: null,
      problem: `주소에 방식이 없습니다 — '${quote(raw, 200)}'. http:// · https:// · ws:// · wss:// 중 하나로 시작하세요.`
    }
  }
  const scheme = m[1].toLowerCase()
  // `사용자:비번@` 를 잘라 낸다 — 남기면 접속 주소로 기록·내보내기에 굳는데, 그 값은
  // 환경의 비밀이 아니라 주소에 박힌 것이라 **가리는 그물에 안 걸린다**(gRPC 와 같은 규율).
  const rest = m[2].replace(/^[^@/]*@/, '')
  const mapped =
    scheme === 'https' || scheme === 'wss'
      ? 'wss'
      : scheme === 'http' || scheme === 'ws'
        ? 'ws'
        : null
  if (!mapped) {
    return { url: null, problem: `'${scheme}://' 로는 구독에 붙을 수 없습니다.` }
  }
  return { url: `${mapped}://${rest}`, problem: null }
}

/**
 * 평문 소켓으로 자격증명을 보내는가 — 그렇다면 **그 사실을 적는다.**
 *
 * 막지는 않는다(gRPC 와 다르다): 여기서는 `ws://` 를 사용자가 **명시적으로 적은** 것이고,
 * 방식이 없는 주소는 애초에 열지 않는다(위 `websocketUrl` 이 사유를 준다). 그래도 이 전송은
 * 이 앱에서 **처음으로 소켓 채널에 인증 실값을 실어 보낸다** — 평문 WebSocket 전송은 헤더를
 * 아예 안 싣고, gRPC 는 평문일 때 그 사실을 적는다. 여기만 조용하면 규율이 갈린다.
 */
export function plaintextNote(socketUrl: string, connectionParams: Record<string, string>): string | null {
  if (!socketUrl.startsWith('ws://')) return null
  const names = Object.keys(connectionParams)
  if (names.length === 0) return null
  return (
    `암호화 없는 주소(ws://)라 ${names.join(', ')} 값이 평문으로 나갑니다 — ` +
    '중간에 있는 프록시·네트워크에서 읽힙니다. 암호화하려면 환경 주소를 https:// 또는 wss:// 로 바꾸세요.'
  )
}
