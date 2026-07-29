import { classifyFailure } from './httpSend'
import { binaryPlaceholder, openGrpcStream } from './grpcStream'
import { SseParser } from '../../shared/api/sse'
import {
  GRAPHQL_WS_PROTOCOL,
  initialState,
  onServerText,
  onSocketOpen,
  plaintextNote,
  stopMessage,
  type GqlWsAction,
  type GqlWsContext
} from '../../shared/api/graphqlWs'
import { nextReconnect, RECONNECT_TOTAL_MAX } from '../../shared/api/stream'
import type { StreamOutcome } from '../../shared/api/stream'
import type { GrpcTarget } from '../../shared/api/grpcTarget'
import type { InteractionShape, RunStatus, StreamMessage, StreamState } from '../../shared/api/types'

/**
 * 스트림 전송 — `docs/spec/api-runner.md` § stream.session.
 *
 * 왜 메인 프로세스냐: 렌더러의 `WebSocket`·`EventSource` 는 **헤더를 못 싣는다**(브라우저가
 * 금지한다). 우리 요청은 인증 헤더가 붙으므로 창구가 아예 안 맞는다. 게다가 화면을 나갔다
 * 오면 세션이 끊긴다 — 세션은 화면보다 오래 살아야 한다.
 *
 * 의존성은 안 늘린다(그건 `main` 몫). Electron 43 = Node 24 라 `WebSocket` 전역이 있고,
 * SSE 는 `fetch` 본문 스트림 + `SseParser` 로 자른다.
 *
 * 판단(패널 가시성·세션 성패·전송 선택)은 여기 없다 — `shared/api/stream.ts` 에 있고
 * 전부 테스트로 덮인다. 이 파일은 **소켓을 열고 닫고 줄을 흘려보내는 일만** 한다.
 */

interface SessionBase {
  sessionId: string
  /** 실제로 붙을 주소 — 비밀 실값이 들어 있다. 타임라인·기록에는 **절대** 안 나간다. */
  url: string
  /**
   * 화면·기록에 적을 주소. 조립기가 **가려서** 만든 것이지 `redact` 를 먹인 것이 아니다.
   *
   * 왜 갈라 받나: `redact` 는 글자 그대로 일치만 지우는데, 주소에 박히는 값은
   * `encodeURIComponent` 를 거친다 — `a+b/c=` 가 `a%2Bb%2Fc%3D` 로 바뀌어 **안 지워진다.**
   * 하필 그 자리가 WebSocket 에서 자격증명을 넣으라고 우리가 안내하는 자리다.
   */
  displayUrl: string
  headers: Record<string, string>
  /** 자동 재접속 (AC-4). 켜져 있어도 사용자가 끊으면 다시 안 붙는다. */
  autoReconnect: boolean
  /**
   * 아는 비밀을 지우는 마지막 그물. **타임라인에 들어가기 전에** 통과시킨다 —
   * 저장한 뒤 가리는 게 아니라 가린 뒤 저장한다(spec send.observe AC-3).
   *
   * 이건 **서버가 되돌려준 값**을 위한 것이다(우리가 아는 실값의 에코). 우리가 만든
   * 문자열은 이걸 믿지 말고 조립기가 가린 것을 써라 — 위 `displayUrl` 이 그 이유다.
   */
  redact: (text: string) => string
}

/**
 * 세션을 여는 데 필요한 것. **전송이 무엇이냐가 나머지를 정한다.**
 *
 * 칸을 나란히 두고 전부 선택으로 만들면 `{transport:'websocket', grpc:{…}}` 같은 **불가능한
 * 조합**이 타입상 합법이 되고, 그걸 막으려고 "gRPC 세션인데 메서드 정보가 없습니다" 같은
 * 사용자가 볼 일 없어야 할 문구를 손으로 넣게 된다. 전송 하나를 더할 때 그 짝이 또 는다.
 * 판별 합집합이면 빠뜨린 자리를 **컴파일러가 짚는다.**
 */
export type OpenSessionInput = SessionBase &
  (
    | { transport: 'websocket' | 'sse' }
    | {
        transport: 'graphql-ws'
        /**
         * 소켓을 열기만 해서는 아무것도 안 온다 — 규약 손잡기에 쓸 질의문·변수·인증 값.
         * `real` 은 소켓으로 나갈 것, `display` 는 타임라인 문구를 만들 때 쓰는 가린 것이다.
         */
        graphqlWs: { real: GqlWsContext; display: GqlWsContext }
      }
    | {
        transport: 'grpc'
        /**
         * 이 전송은 주소만으로 못 연다 — **어느 메서드인지**와 **암호화 여부**가 따로 필요하고,
         * 메시지 정의는 서버에게 받아 온다(`grpcStream.ts`).
         */
        grpc: {
          target: GrpcTarget
          method: string
          /** 요청에 **선언된** 모양. 서버 정의와 다르면 안 연다(무피드백 교착 방지). */
          declaredShape: InteractionShape
          /** 서버 스트리밍의 첫 본문 — 실값 / 기록·문구용 가림 두 벌. */
          body: string
          displayBody: string
        }
      }
  )

/**
 * 지금 살아 있는 통로 하나. **전송마다 다른 것을 이 한 칸으로 모은다.**
 *
 * 전에는 `socket`·`grpc`·`abort` 세 칸이 나란히 있었고 "살아 있는 것을 닫는다"가 세 자리에
 * 흩어져 있었다 — 네 번째 전송(GraphQL 구독)을 얹을 때 그중 한 자리가 빠져 **닫을 수 없는
 * 연결이 남았다**(실측 30회 → 핸들 60개). 칸이 하나면 빠뜨릴 자리가 없다.
 */
interface StreamConnection {
  /** 보낼 수 있으면 보낸다. 못 보내는 전송이면 **이유를 달아 던진다**(조용히 삼키지 않는다). */
  send: (real: string, display: string) => void
  /** 이 통로를 닫는다. 두 번 불려도 안 터진다. */
  close: () => void
}

/** 보내기가 없는 전송의 통로 — 왜 없는지를 던진다. */
function receiveOnly(why: string, close: () => void): StreamConnection {
  return {
    send: () => {
      throw new Error(why)
    },
    close
  }
}

export interface SessionEvent {
  sessionId: string
  state: StreamState
  /** 이번 이벤트로 새로 생긴 타임라인 항목. 상태만 바뀌었으면 빈 배열. */
  messages: StreamMessage[]
  /** 끊긴 이유 (AC-1). 상태가 closed·error 일 때만 채워진다. */
  reason: string | null
  /** 여기까지 상한으로 버린 건수 — 화면과 기록이 다른 수를 말하지 않게 함께 보낸다. */
  droppedCount: number
}

export interface SessionHandle {
  id: string
  startedAt: string
  messages: StreamMessage[]
  /** 상한을 넘겨 타임라인에서 버린 건수 — 조용한 소실 금지. */
  droppedCount: number
  state: StreamState
  /** 왜 끝났나. **아직 안 끝났으면 null** — 안 끝난 세션의 결과를 지어내지 않는다. */
  outcome: StreamOutcome | null
  closeReason: string | null
}

/** 끝맺음 콜백이 받는 것 — 여기서는 결과가 반드시 있다. */
export interface EndedSessionHandle extends SessionHandle {
  outcome: StreamOutcome
}

/** 세션이 **끝났을 때 정확히 한 번** 불린다 — 서버가 끊었든 사용자가 껐든 같은 자리로 모인다. */
export type OnSessionEnd = (handle: EndedSessionHandle) => void

/** 한 세션이 들고 있는 메시지 상한. 넘으면 오래된 것부터 버리고 **버렸다고 알린다**. */
const MAX_MESSAGES = 5_000
/** 메시지 하나의 글자 상한 — 거대한 프레임 하나가 IPC·저장소를 통째로 채우지 않게. */
const MAX_MESSAGE_CHARS = 256 * 1024
/**
 * 접속 시도 제한시간. 단발 전송은 30초 타임아웃이 있는데(`httpSend.ts`) 스트림에 없으면,
 * TCP 만 받고 응답을 안 주는 서버에 붙었을 때 open·close·error 어느 이벤트도 안 와서
 * **영원히 '접속 중'** 이고 기록도 안 남는다. 붙은 뒤에는 상한을 걸지 않는다(그게 스트림이다).
 */
const CONNECT_TIMEOUT_MS = 30_000
/**
 * 화면에 밀어 주는 주기. 프레임 하나마다 IPC 를 쏘면 렌더러 메인 스레드에 태스크가
 * 그만큼 쌓이고, 태스크마다 React 렌더가 한 번 돈다 — 초당 1,000건짜리 스트림에서
 * 화면이 굳고 끊기 버튼조차 큐 뒤로 밀린다(실측). 60fps 한 칸 정도로 묶어 보낸다.
 */
const FLUSH_MS = 16

class Session {
  readonly id: string
  readonly messages: StreamMessage[] = []
  readonly startedAt = new Date().toISOString()
  droppedCount = 0
  opened = false
  state: StreamState = 'connecting'
  closeReason: string | null = null

  private seq = 0
  /** 지금 살아 있는 통로. 전송이 무엇이든 **이 한 칸**이다. */
  private conn: StreamConnection | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  /** 연속 실패 수 — 붙으면 0으로 돌아간다(간격을 다시 짧게). */
  private streak = 0
  /** 누적 시도 수 — **절대 안 줄어든다.** 붙었다 끊기를 반복하는 서버를 결국 멈추는 빗장. */
  private totalAttempts = 0
  /** 사용자가 끊었나 — 켜지면 자동 재접속을 하지 않는다. */
  private closedByUser = false
  /** 끝났나. 종료 경로가 여럿이라(close 이벤트·오류·사용자) 두 번 끝나는 것을 막는다. */
  private ended = false
  private outcome: StreamOutcome = { opened: false, endedBy: 'server' }
  private lastEventId: string | null = null

  constructor(
    private readonly input: OpenSessionInput,
    private readonly emit: (e: SessionEvent) => void,
    private readonly onEnd: OnSessionEnd
  ) {
    this.id = input.sessionId
  }

  // ── 타임라인 ────────────────────────────────────────────────────────────

  private add(direction: StreamMessage['direction'], event: string, data: string): StreamMessage {
    this.seq += 1
    // 여기가 유일한 관문이다 — 들어온 것도, 내가 보낸 것도, 시스템 문구(주소가 실린다)도
    // 전부 이 줄을 지나야 화면·기록에 닿는다.
    const body = this.input.redact(data)
    const m: StreamMessage = {
      seq: this.seq,
      at: new Date().toISOString(),
      direction,
      event,
      data:
        body.length > MAX_MESSAGE_CHARS
          ? `${body.slice(0, MAX_MESSAGE_CHARS)}\n…(${body.length}글자 중 앞부분만 남겼습니다)`
          : body
    }
    this.messages.push(m)
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.shift()
      this.droppedCount += 1
    }
    return m
  }

  // ── 화면으로 밀기 (묶어 보낸다) ──────────────────────────────────────────

  /** 아직 안 보낸 것. 프레임마다 IPC 를 쏘면 렌더러가 태스크에 잠긴다. */
  private outbox: StreamMessage[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  private push(state: StreamState, made: StreamMessage[], reason: string | null = null): void {
    this.state = state
    this.outbox.push(...made)
    // 상태가 바뀌거나 끝났으면 기다리지 않는다 — 사용자가 누른 것에 대한 반응은 즉시여야 한다.
    if (state !== 'open' || reason !== null || this.ended) {
      this.flush(reason)
      return
    }
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush(null)
    }, FLUSH_MS)
  }

  private flush(reason: string | null): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    const messages = this.outbox
    this.outbox = []
    if (messages.length === 0 && reason === null && this.emittedState === this.state) return
    this.emittedState = this.state
    this.emit({
      sessionId: this.id,
      state: this.state,
      messages,
      reason,
      // 메인이 상한으로 버린 건수를 함께 알린다 — 렌더러도 같은 수를 알아야 화면과 기록이
      // 다른 수를 말하지 않는다.
      droppedCount: this.droppedCount
    })
  }

  private emittedState: StreamState | null = null

  private system(event: string, text: string, state: StreamState): StreamMessage {
    const m = this.add('system', event, text)
    // 이유도 `m.data`(가려진 것)를 쓴다 — 원문 `text` 에는 접속 주소의 토큰이 실릴 수 있다.
    this.push(state, [m], state === 'closed' || state === 'error' ? m.data : null)
    return m
  }

  // ── 열기 ────────────────────────────────────────────────────────────────

  /**
   * 몇 번째 접속 회차인가. gRPC 는 붙기 전에 정의를 받아 오느라 **비동기로 열린다** —
   * 그 사이 제한시간이 지나 다음 회차가 시작되면, 뒤늦게 열린 통로가 지금 회차의 것을
   * 덮어써 끊을 수 없는 통로가 남는다. 회차 번호로 자기 것인지 가린다.
   */
  private round = 0
  /** 이 회차가 이미 끝났나. `roundEnded` 를 한 번만 지나게 하는 빗장. */
  private roundOver = false

  start(): void {
    this.round += 1
    this.roundOver = false
    this.state = 'connecting'
    // 붙는 데까지만 제한시간을 건다. 붙은 뒤에 오래 조용한 것은 정상이다(그게 스트림이다).
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null
      if (this.opened || this.ended) return
      // **살아 있는 통로를 전부** 닫는다 — 하나라도 빠뜨리면 끊을 수 없는 통로가 남는다.
      this.dropConnection()
      this.roundEnded(`${CONNECT_TIMEOUT_MS / 1000}초 안에 연결되지 않았습니다.`, 'timeout')
    }, CONNECT_TIMEOUT_MS)

    // 좁혀서 넘긴다 — 여는 함수가 자기에게 필요한 것을 **인자로** 받으므로
    // "있어야 할 게 없다"를 런타임에 확인할 자리가 사라진다.
    const input = this.input
    if (input.transport === 'websocket') this.openWebSocket()
    else if (input.transport === 'graphql-ws') this.openGraphqlWs(input.graphqlWs)
    else if (input.transport === 'grpc') void this.openGrpc(input.grpc)
    else void this.openSse()
  }

  /** 붙었다 — 제한시간을 풀고 연속 실패 수를 되돌린다. */
  private markOpen(): void {
    this.opened = true
    this.streak = 0
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }

  private openWebSocket(): void {
    // Node 의 WebSocket 은 생성자에서 헤더를 못 받는다 — 하위 프로토콜만 받는다. 조용히
    // 빼면 401 을 받고 이유를 못 찾으므로, **뺐다는 사실을 타임라인에 적는다.**
    const dropped = Object.keys(this.input.headers)
    let ws: WebSocket
    try {
      ws = new WebSocket(this.input.url)
    } catch (err) {
      const { status, message } = classifyFailure(err)
      this.terminate(message, 'error', status)
      return
    }
    this.conn = {
      send: (real) => {
        if (ws.readyState !== 1) throw new Error('연결돼 있지 않습니다 — 먼저 접속하세요.')
        ws.send(real)
      },
      close: () => ws.close()
    }

    if (dropped.length > 0) {
      const m = this.add(
        'system',
        'note',
        `WebSocket 손잡기에는 헤더를 실을 수 없어 ${dropped.join(', ')} 을(를) 빼고 붙습니다 — ` +
          '인증이 필요하면 접속 주소의 쿼리에 넣으세요(그 값은 서버·프록시 접속 로그에 남습니다).'
      )
      this.push('connecting', [m])
    }

    ws.addEventListener('open', () => {
      this.markOpen()
      this.system('connect', `연결됨 — ${this.input.displayUrl}`, 'open')
    })
    ws.addEventListener('message', (e: MessageEvent) => {
      const raw: unknown = e.data
      // 바이너리 프레임은 글자로 지어내지 않는다 — 크기만 적는다(단발 응답과 같은 규율).
      const text =
        typeof raw === 'string'
          ? raw
          : binaryPlaceholder(raw instanceof ArrayBuffer ? raw.byteLength : 0)
      const m = this.add('in', '', text)
      this.push('open', [m])
    })
    ws.addEventListener('error', () => {
      // WebSocket 의 error 이벤트는 이유를 안 준다(규약이 그렇게 정했다). 지어내지 않고
      // 바로 뒤에 오는 close 가 코드를 주기를 기다린다.
    })
    ws.addEventListener('close', (e: CloseEvent) => {
      const why = e.reason ? `${e.code} ${e.reason}` : String(e.code)
      // 한 번도 못 붙었으면 "서버가 닫았다"가 아니라 붙지 못한 것이다.
      if (!this.opened) this.roundEnded('서버에 붙지 못했습니다.', 'connect-failed')
      else this.roundEnded(`서버가 연결을 닫았습니다 (${why}).`)
    })
  }

  /**
   * GraphQL 구독. 소켓은 여기서 잡고 **판단은 전부 `graphqlWs.ts`** 가 한다 —
   * 손잡기 순서·오류 갈래가 판단이라 테스트로 덮여야 하고, 그러려면 소켓을 몰라야 한다.
   */
  private openGraphqlWs(cfg: { real: GqlWsContext; display: GqlWsContext }): void {
    // **이 회차의 것만 받는다.** 안 두면 앞 회차 소켓이 늦게 닫히면서 지금 회차를
    // "서버가 연결을 닫았습니다"로 끝내고, 그 뒤로는 끊기 버튼이 아무것도 못 닫는다.
    const myRound = this.round
    const mine = (): boolean => this.round === myRound && !this.roundOver
    const state = initialState()

    let ws: WebSocket
    try {
      // 하위 프로토콜 이름으로 합의해야 서버가 규약을 켠다 — 안 주면 그냥 소켓이고 아무것도 안 온다.
      ws = new WebSocket(this.input.url, [GRAPHQL_WS_PROTOCOL])
    } catch (err) {
      const { status, message } = classifyFailure(err)
      this.terminate(message, 'error', status)
      return
    }
    this.conn = receiveOnly('구독은 계속 받기만 합니다 — 보내는 자리가 없습니다.', () => {
      // **소켓을 닫기 전에 구독을 접는다** — 규약이 정한 순서다(안 접으면 서버에 구독이 남는다).
      // 끊는 자리가 하나이므로 그 순서도 여기 한 곳에만 적힌다.
      try {
        if (ws.readyState === 1) ws.send(stopMessage())
      } catch {
        /* 이미 닫히는 중이면 그만이다 */
      }
      ws.close()
    })

    // 평문 소켓으로 자격증명이 나가면 **그 사실을 적는다.** 막지는 않는다 —
    // `ws://` 는 사용자가 명시적으로 적은 것이고, 방식이 없는 주소는 애초에 안 열린다.
    const plain = plaintextNote(this.input.url, cfg.real.connectionParams)
    if (plain) this.push('connecting', [this.add('system', 'note', plain)])

    ws.addEventListener('open', () => {
      // **소켓에 나가는 것은 실값이다.** 안내 문구는 값이 아니라 **이름만** 담으므로
      // 여기서 가린 쪽을 쓸 이유가 없다 — 쓰면 서버가 가린 글자를 토큰으로 받는다.
      if (mine()) this.applyGqlWs(ws, onSocketOpen(cfg.real))
    })
    ws.addEventListener('message', (e: MessageEvent) => {
      if (!mine()) return
      const raw: unknown = e.data
      if (typeof raw !== 'string') {
        this.push(this.state, [
          this.add('in', '', binaryPlaceholder(raw instanceof ArrayBuffer ? raw.byteLength : 0))
        ])
        return
      }
      this.applyGqlWs(ws, onServerText(raw, cfg.real, state))
    })
    ws.addEventListener('error', () => {
      // WebSocket 의 error 는 이유를 안 준다 — 뒤따르는 close 가 코드를 주기를 기다린다.
    })
    ws.addEventListener('close', (e: CloseEvent) => {
      if (!mine()) return
      const why = e.reason ? `${e.code} ${e.reason}` : String(e.code)
      if (!this.opened) {
        // **소켓은 열렸는데 손을 안 잡아 준** 경우가 여기 온다 — 규약 이름이 안 맞는 서버다.
        this.roundEnded(
          `구독 규약 손잡기가 끝나기 전에 연결이 닫혔습니다 (${why}) — ` +
            `서버가 '${GRAPHQL_WS_PROTOCOL}' 를 켰는지 확인하세요(GraphQL 서버 설정에서 구독 전송을 켜야 합니다).`,
          'connect-failed'
        )
        return
      }
      this.roundEnded(`서버가 연결을 닫았습니다 (${why}).`)
    })
  }

  /**
   * 규약 판단이 낸 지시를 실제로 수행한다. 소켓에 나가는 글자만 실값이다.
   *
   * **문구는 순수 모듈이 만든 것을 그대로 쓴다** — 그 모듈은 인증 값의 **이름만** 담고
   * 서버가 준 글자는 이미 잘라서 준다. 나머지 가림은 `add()` 의 그물 한 자리에서 한다
   * (전에는 여기서 한 번 더 되돌렸는데, 그건 "내가 만든 문자열을 내가 못 믿는" 구조였다).
   */
  private applyGqlWs(ws: WebSocket, actions: GqlWsAction[]): void {
    for (const a of actions) {
      switch (a.kind) {
        case 'send':
          // 규약 프레임은 사용자가 보내는 것이 아니라 **우리가 규약을 지키는 것**이라
          // 통로의 `send`(사람이 보내는 자리)가 아니라 소켓으로 곧장 나간다.
          if (ws.readyState === 1) ws.send(a.text)
          break
        case 'open':
          this.markOpen()
          // **`연결됨` 은 소켓이 열린 때가 아니라 손을 잡은 때다.** 소켓만 열린 상태를
          // 연결됨이라고 하면, 손잡기가 실패해도 사용자는 붙은 줄 안다.
          // 문구는 다른 전송과 **같은 말**을 쓴다 — 타임라인 검색이 갈리지 않게.
          this.system('connect', `연결됨 — ${this.input.displayUrl}`, 'open')
          break
        case 'system':
          this.push(this.state, [this.add('system', 'note', a.text)])
          break
        case 'message':
          this.push('open', [this.add('in', a.event, a.data)])
          break
        case 'end':
          this.roundEnded(a.reason, a.failure)
          // 이 회차는 끝났다 — 뒤에 남은 지시를 더 수행하지 않는다.
          return
      }
    }
  }

  private async openGrpc(cfg: NonNullable<Extract<OpenSessionInput, { transport: 'grpc' }>['grpc']>): Promise<void> {
    const myRound = this.round
    const stale = (): boolean => this.round !== myRound || this.ended || this.closedByUser
    // 정의 받아 오는 왕복을 사용자가 끊을 수 있게 — **붙기 전에도 닫을 것이 있어야 한다.**
    // 여기 안 걸면 사용자가 끊어도 그 왕복이 끝까지 돌고, 심지어 그 뒤에 스트림을 한 번
    // 열었다 닫는다(실측).
    const ac = new AbortController()
    this.conn = receiveOnly('아직 서버 정의를 받는 중입니다.', () => ac.abort())

    const outcome = await openGrpcStream(
      {
        target: cfg.target,
        method: cfg.method,
        declaredShape: cfg.declaredShape,
        headers: this.input.headers,
        body: cfg.body,
        displayBody: cfg.displayBody,
        signal: ac.signal
      },
      {
        // 붙기 전 안내(가정한 암호화 방식·못 실은 헤더)는 타임라인에 남긴다 —
        // 조용히 넘기면 나중에 "왜 안 붙지"의 원인 후보가 기록에서 통째로 빠진다.
        onNote: (text) => {
          if (stale()) return
          this.push('connecting', [this.add('system', 'note', text)])
        },
        onOpen: () => {
          if (stale()) return
          this.markOpen()
          this.system('connect', `연결됨 — ${this.input.displayUrl}`, 'open')
        },
        onMessage: (text) => {
          if (stale()) return
          this.push('open', [this.add('in', '', text)])
        }
      }
    )

    if (!outcome.ok) {
      if (stale()) return
      this.roundEnded(outcome.reason, outcome.failure)
      return
    }
    // 늦게 열린 통로가 지금 회차의 것을 덮어쓰지 않게 한다 — 덮어쓰면 끊을 수 없는 통로가 남는다.
    if (stale()) {
      outcome.handle.close()
      return
    }
    outcome.handle.onEnd((reason, failure) => {
      if (stale()) return
      this.conn = null
      this.roundEnded(reason, failure)
    })
    this.conn = {
      send: (real, display) => outcome.handle.send(real, display),
      close: () => outcome.handle.close()
    }
  }

  /** 살아 있는 통로를 닫는다. **끊는 자리가 하나여야** 빠뜨리지 않는다. */
  private dropConnection(): void {
    this.conn?.close()
    this.conn = null
  }

  private async openSse(): Promise<void> {
    const ac = new AbortController()
    this.conn = receiveOnly('이 전송은 한 방향입니다 — 받기만 합니다.', () => ac.abort())
    const parser = new SseParser()

    try {
      const headers: Record<string, string> = {
        ...this.input.headers,
        accept: 'text/event-stream',
        'cache-control': 'no-cache'
      }
      // 재접속이면 어디까지 받았는지 알린다 — 규약이 정한 이어받기 창구다.
      if (this.lastEventId) headers['last-event-id'] = this.lastEventId

      const res = await fetch(this.input.url, { headers, signal: ac.signal })
      if (!res.ok) {
        // 본문을 버리고 나가면 undici 연결이 남는다 — 재접속마다 하나씩 쌓인다.
        await res.body?.cancel()
        // 붙긴 했는데 스트림을 안 준다 — 이건 연결 실패가 아니라 오류 응답이다.
        this.roundEnded(`서버가 ${res.status} 로 답했습니다 — 스트림이 열리지 않았습니다.`, 'http-error')
        return
      }
      if (!res.body) {
        this.roundEnded('서버가 본문 없이 답했습니다 — 스트림이 아닙니다.', 'connect-failed')
        return
      }

      this.markOpen()
      this.system('connect', `연결됨 — ${this.input.displayUrl}`, 'open')

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const made = parser.feed(value).map((ev) => {
          if (ev.id) this.lastEventId = ev.id
          return this.add('in', ev.event, ev.data)
        })
        if (made.length > 0) this.push('open', made)
      }
      // 서버가 끊기 직전에 보낸 마지막 프레임을 잃지 않는다.
      const tail = parser.flush().map((ev) => this.add('in', ev.event, ev.data))
      if (tail.length > 0) this.push('open', tail)
      this.roundEnded('서버가 스트림을 닫았습니다.')
    } catch (err) {
      if (this.closedByUser) return // 우리가 끊은 abort — 오류가 아니다.
      // 끊기기 직전까지 받아 둔 파편도 꺼낸다 — 정상 종료에서만 꺼내면 조용한 소실이 된다.
      const tail = parser.flush().map((ev) => this.add('in', ev.event, ev.data))
      if (tail.length > 0) this.push('open', tail)
      const { status, message } = classifyFailure(err)
      this.roundEnded(message, status)
    }
  }

  // ── 끝내기 · 재접속 ─────────────────────────────────────────────────────

  /**
   * 한 회 접속이 끝났다. 자동 재접속이 켜져 있고 사용자가 안 껐으면 다시 붙는다.
   *
   * **통로를 실제로 닫는다.** 전에는 참조만 버렸는데, 그건 세 전송에서 우연히 안전했을 뿐이다 —
   * WebSocket 은 `close` 이벤트 안에서만, SSE 는 본문을 다 읽은 뒤에만 여기 왔기 때문이다.
   * GraphQL 구독은 **서버가 보낸 규약 메시지**(`complete`·`error`)로 회차를 끝내므로
   * 소켓이 멀쩡히 살아 있는 채로 여기 온다. 참조만 버리면 그 소켓은 등록부에서도 지워져
   * **어떤 창구로도 못 닫는다** — 리스너가 살아 있어 죽은 세션 id 로 IPC 를 계속 쏜다
   * (실측: 30회 붙었다 끊으면 TCP 핸들 60개가 열린 채 남았다).
   *
   * **한 회차에 한 번만 지나간다.** 여기서 소켓을 닫으면 그 `close` 이벤트가 뒤늦게 와서
   * 다시 들어오는데, 빗장이 없으면 재접속이 두 번 걸리고 타이머가 겹친다.
   */
  private roundEnded(reason: string, failure?: RunStatus): void {
    if (this.roundOver) return
    this.roundOver = true
    this.dropConnection()

    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    if (this.ended) return
    if (this.closedByUser) return // close() 가 이미 끝맺었다.

    const again = nextReconnect({
      autoReconnect: this.input.autoReconnect,
      streak: this.streak,
      total: this.totalAttempts
    })
    if (again) {
      this.streak += 1
      this.totalAttempts += 1
      // 재접속 시도도 타임라인에 남는다 (AC-4) — 안 남기면 "왜 중간이 비었지"가 된다.
      this.system(
        'reconnect',
        `${reason} ${again.attempt}번째 재접속을 ${again.delayMs / 1000}초 뒤 시도합니다.`,
        'connecting'
      )
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        if (!this.closedByUser && !this.ended) this.start()
      }, again.delayMs)
      return
    }

    const exhausted =
      this.totalAttempts === 0
        ? ''
        : this.totalAttempts >= RECONNECT_TOTAL_MAX
          ? ` 재접속을 ${this.totalAttempts}회 시도해 상한에 닿았습니다 — 여기서 멈춥니다.`
          : ` 재접속 ${this.totalAttempts}회가 모두 실패했습니다.`
    this.terminate(reason + exhausted, failure ? 'error' : 'closed', failure)
  }

  /** 세션이 끝났다. **정확히 한 번만** 지나간다 — 종료 경로가 여럿이라 빗장을 건다. */
  private terminate(reason: string, state: 'closed' | 'error', failure?: RunStatus): void {
    if (this.ended) return
    this.ended = true
    const m = this.system(failure ? 'error' : 'close', reason, state)
    this.closeReason = m.data
    this.outcome = {
      opened: this.opened,
      endedBy: this.closedByUser ? 'user' : failure ? 'error' : 'server',
      ...(failure ? { failure } : {})
    }
    this.onEnd({ ...this.snapshot(), outcome: this.outcome })
  }

  /**
   * 보내기 — 단발 전송과 같이 **두 벌**을 받는다: 소켓에 나갈 것(실값) / 남길 것(가림).
   *
   * 한 벌만 받아 `redact` 로 때우면 새는 자리가 있다. 가림은 조립기에서
   * `{{...}}` **조각 통째로** 걸리는데, `redact` 는 글자 그대로 일치만 지운다 —
   * `{{base64(apiKey)}}` 처럼 **가공된 비밀**은 원문과 안 맞아 그대로 남는다.
   */
  send(real: string, display: string): StreamMessage {
    if (!this.conn || this.state !== 'open') {
      throw new Error('연결돼 있지 않습니다 — 먼저 접속하세요.')
    }
    // 소켓에 나갈 실값 / 사람에게 보일 가림 — 오류 문구를 만드는 데도 가린 쪽이 필요하다.
    // **전송별 분기가 없다** — 무엇을 보내는지는 통로가 안다.
    this.conn.send(real, display)
    const m = this.add('out', '', display)
    this.push('open', [m])
    return m
  }

  close(): void {
    this.closedByUser = true
    for (const t of [this.reconnectTimer, this.connectTimer]) if (t) clearTimeout(t)
    this.reconnectTimer = null
    this.connectTimer = null
    // 통로를 먼저 닫되, 끝맺음은 여기서 한다 — WebSocket 의 close 이벤트를 기다리면
    // "끊기를 눌렀는데 화면이 그대로"인 구간이 생긴다.
    this.dropConnection()
    this.terminate('사용자가 끊었습니다.', 'closed')
  }

  snapshot(): SessionHandle {
    return {
      id: this.id,
      startedAt: this.startedAt,
      messages: this.messages.slice(),
      droppedCount: this.droppedCount,
      state: this.state,
      // 안 끝난 세션의 결과를 지어내지 않는다 — 끝맺음만이 왜 끝났는지 안다.
      outcome: this.ended ? this.outcome : null,
      closeReason: this.closeReason
    }
  }
}

// ── 세션 등록부 ───────────────────────────────────────────────────────────

const sessions = new Map<string, Session>()

export function openSession(
  input: OpenSessionInput,
  emit: (e: SessionEvent) => void,
  onEnd: OnSessionEnd
): SessionHandle {
  closeSession(input.sessionId) // 같은 id 로 다시 열면 앞엣것을 정리한다.
  const s = new Session(input, emit, (h) => {
    sessions.delete(s.id)
    onEnd(h)
  })
  sessions.set(s.id, s)
  s.start()
  return s.snapshot()
}

export function sendToSession(sessionId: string, real: string, display: string): StreamMessage {
  const s = sessions.get(sessionId)
  if (!s) throw new Error('세션이 없습니다 — 이미 끊겼거나 열린 적이 없습니다.')
  return s.send(real, display)
}

/** 세션을 닫는다. 없는 세션이면 아무 일도 안 한다(두 번 닫아도 안 터진다). */
export function closeSession(sessionId: string): void {
  sessions.get(sessionId)?.close()
  sessions.delete(sessionId)
}

export function getSession(sessionId: string): SessionHandle | null {
  return sessions.get(sessionId)?.snapshot() ?? null
}

/** 앱이 꺼질 때 열린 소켓을 남기지 않는다. */
export function closeAllSessions(): void {
  for (const id of [...sessions.keys()]) closeSession(id)
}
