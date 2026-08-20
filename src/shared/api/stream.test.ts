import { describe, expect, it } from 'vitest'
import {
  copyMessageText,
  exportTimeline,
  filterTimeline,
  nextReconnect,
  RECONNECT_DELAYS_MS,
  RECONNECT_TOTAL_MAX,
  sendPanelVisible,
  sessionToRun,
  streamRunStatus,
  graphqlSubscribeBlocker,
  transportFor,
  transportLabel,
  type StreamSessionSnapshot
} from './stream'
import type { StreamMessage } from './types'

/**
 * TestPlan: api-runner · Scenario S5
 *   CASE-apirunner-040 보내기 패널 가시성 · 041 타임라인 조립 · 042 세션→Run · 045 타임라인 도구
 */

const msg = (o: Partial<StreamMessage> & { seq: number }): StreamMessage => ({
  at: `2026-07-29T00:00:${String(o.seq).padStart(2, '0')}.000Z`,
  direction: 'in',
  event: '',
  data: '',
  ...o
})

// ── CASE-apirunner-040 ────────────────────────────────────────────────────

describe('보내기 패널 가시성 (CASE-apirunner-040)', () => {
  it('양방향은 패널이 있다', () => {
    expect(sendPanelVisible('duplex')).toBe(true)
  })

  it('서버 스트리밍은 패널이 **없다** — 비활성이 아니라 없음', () => {
    expect(sendPanelVisible('server-stream')).toBe(false)
  })

  it('단발·수신 모양도 이 화면의 보내기 패널 대상이 아니다', () => {
    expect(sendPanelVisible('unary')).toBe(false)
    expect(sendPanelVisible('inbound')).toBe(false)
  })
})

// ── 전송 선택: 못 하는 것을 한다고 말하지 않는다 ───────────────────────────

describe('전송 선택', () => {
  it('WebSocket · SSE · gRPC 는 각자의 전송으로 연다', () => {
    expect(transportFor('websocket', 'duplex')).toEqual({ transport: 'websocket', unsupported: null })
    expect(transportFor('sse', 'server-stream')).toEqual({ transport: 'sse', unsupported: null })
    expect(transportFor('grpc', 'duplex')).toEqual({ transport: 'grpc', unsupported: null })
    expect(transportFor('grpc', 'server-stream').transport).toBe('grpc')
    expect(transportFor('graphql', 'server-stream').transport).toBe('graphql-ws')
  })

  it('스트리밍 상호작용이 없는 종류는 사유를 준다', () => {
    // REST·JSON-RPC 는 단발뿐이라 이 화면에 올 일이 없다 — 빈 화면 대신 이유를 준다.
    const p = transportFor('rest', 'duplex')
    expect(p.transport).toBeNull()
    expect(p.unsupported).toContain('스트리밍')
  })

  it('전송 이름 옆의 모양은 **명세에서 고른 말 그대로** 쓴다', () => {
    // 여기서만 "양방향"처럼 다르게 적으면 같은 개념을 두 어휘로 배우게 된다.
    expect(transportLabel('websocket', 'duplex')).toBe('WebSocket · 서로 계속 주고받음')
    expect(transportLabel('sse', 'server-stream')).toBe('SSE · 계속 받기만 함')
    expect(transportLabel('grpc', 'duplex')).toBe('gRPC · 서로 계속 주고받음')
    expect(transportLabel('graphql-ws', 'server-stream')).toBe('GraphQL 구독 · 계속 받기만 함')
  })

  it('단발 요청은 이 화면이 아니라 Send 로 안내한다', () => {
    expect(transportFor('rest', 'unary').unsupported).toContain('Send')
  })

  it('웹훅은 받는 쪽이라 Inbox 로 안내한다', () => {
    expect(transportFor('webhook', 'inbound').unsupported).toContain('Inbox')
  })
})

// ── CASE-apirunner-041 · 045 ──────────────────────────────────────────────

describe('타임라인 (CASE-apirunner-041)', () => {
  const timeline: StreamMessage[] = [
    msg({ seq: 1, direction: 'system', event: 'connect', data: '연결됨' }),
    msg({ seq: 2, direction: 'out', data: 'ping' }),
    msg({ seq: 3, direction: 'in', event: 'pong', data: '{"t":1}' }),
    msg({ seq: 4, direction: 'system', event: 'reconnect', data: '1번째 재접속 시도' }),
    msg({ seq: 5, direction: 'in', event: 'tick', data: '{"t":2}' })
  ]

  it('보낸 것과 받은 것이 방향 표식으로 갈린다', () => {
    expect(filterTimeline(timeline, { direction: 'out' }).map((m) => m.seq)).toEqual([2])
    expect(filterTimeline(timeline, { direction: 'in' }).map((m) => m.seq)).toEqual([3, 5])
  })

  it('재접속 시도도 타임라인 항목이다 (AC-4)', () => {
    const sys = filterTimeline(timeline, { direction: 'system' })
    expect(sys.some((m) => m.event === 'reconnect')).toBe(true)
  })

  it('검색은 본문과 이벤트 이름 둘 다 훑는다 (CASE-apirunner-045)', () => {
    expect(filterTimeline(timeline, { query: 'tick' }).map((m) => m.seq)).toEqual([5])
    expect(filterTimeline(timeline, { query: '"t"' }).map((m) => m.seq)).toEqual([3, 5])
  })

  it('검색과 방향 필터는 함께 걸린다', () => {
    expect(filterTimeline(timeline, { query: 't', direction: 'in' }).map((m) => m.seq)).toEqual([3, 5])
  })

  it('필터가 순서를 바꾸지 않는다 — 시간순이 곧 인과다', () => {
    expect(filterTimeline(timeline, {}).map((m) => m.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('메시지 하나 복사는 본문 원문을 그대로 준다 (CASE-apirunner-045)', () => {
    expect(copyMessageText(msg({ seq: 1, data: '{"n":1}\n둘째 줄' }))).toBe('{"n":1}\n둘째 줄')
  })

  it('전체 내보내기는 **원문을 보존한다** (CASE-apirunner-045)', () => {
    const text = exportTimeline(timeline)
    // 잘리거나 예쁘게 다듬어지면 안 된다 — 내보낸 파일이 관측의 사본이다.
    expect(text).toContain('{"t":1}')
    expect(text).toContain('{"t":2}')
    expect(text.split('\n').length).toBe(timeline.length)
    // 방향과 시각도 함께 나가야 나중에 읽을 수 있다.
    expect(text).toContain('보냄')
    expect(text).toContain('2026-07-29T00:00:03.000Z')
  })

  it('내보내기가 줄바꿈 든 본문을 한 줄로 뭉개지 않는다', () => {
    const text = exportTimeline([msg({ seq: 1, data: 'a\nb' })])
    expect(text).toContain('a\nb')
  })
})

// ── CASE-apirunner-042 ────────────────────────────────────────────────────

const snap = (over: Partial<StreamSessionSnapshot> = {}): StreamSessionSnapshot => ({
  specId: 's1',
  requestName: 'ticker',
  environmentId: 'e1',
  environmentName: 'DEV',
  baseVersion: 'v1',
  shape: 'server-stream',
  call: {},
  transport: 'sse',
  url: 'https://x.test/stream',
  headers: { Authorization: '••••' },
  messages: [msg({ seq: 1, direction: 'in', data: 'a' }), msg({ seq: 2, direction: 'in', data: 'b' })],
  startedAt: '2026-07-29T00:00:00.000Z',
  endedAt: '2026-07-29T00:00:05.000Z',
  outcome: { opened: true, endedBy: 'user' },
  closeReason: '사용자가 끊었습니다.',
  ...over
})

describe('세션 → Run (CASE-apirunner-042)', () => {
  it('세션 하나가 Run 하나가 되고 메시지 목록이 그 관측 내용이다', () => {
    const run = sessionToRun(snap())
    expect(run.requestName).toBe('ticker')
    expect(run.messages?.map((m) => m.data)).toEqual(['a', 'b'])
    expect(run.durationMs).toBe(5_000)
  })

  it('상호작용 모양이 Run 에 실린다 — 판정이 이걸 보고 단발과 가른다', () => {
    expect(sessionToRun(snap()).shape).toBe('server-stream')
  })

  it('스트림 Run 의 `response` 는 null 이다 — 단발 응답 본문 자리에 메시지를 밀어 넣지 않는다', () => {
    // 여기에 메시지를 JSON 으로 밀어 넣으면 판정이 그걸 응답 모양으로 오독한다.
    expect(sessionToRun(snap()).response).toBeNull()
  })

  it('끊긴 이유가 기록에 남는다', () => {
    expect(sessionToRun(snap()).error).toBe('사용자가 끊었습니다.')
  })

  it('기준 버전이 실린다 — 어느 버전 기준의 관측인지 판정이 가른다', () => {
    expect(sessionToRun(snap({ baseVersion: 'v2' })).baseVersion).toBe('v2')
  })

  it('요청 전문에 접속 주소와 헤더가 남는다 (헤더는 이미 가려진 채로 들어온다)', () => {
    const run = sessionToRun(snap())
    expect(run.request.url).toBe('https://x.test/stream')
    expect(run.request.headers.Authorization).toBe('••••')
    expect(run.request.method).toBe('SSE')
  })

  it('메시지가 0건이어도 빈 배열이지 null 이 아니다 — 세션은 있었다', () => {
    expect(sessionToRun(snap({ messages: [] })).messages).toEqual([])
  })
})

// ── 재접속 정책 (CASE-apirunner-041 의 AC-4 쪽) ────────────────────────────

describe('자동 재접속 정책 (stream.session AC-4)', () => {
  it('꺼져 있으면 다시 안 붙는다', () => {
    expect(nextReconnect({ autoReconnect: false, streak: 0, total: 0 })).toBeNull()
  })

  it('연속 실패마다 간격이 늘어난다 — 서버를 빨리 두드리지 않는다', () => {
    const delays = RECONNECT_DELAYS_MS.map(
      (_, i) => nextReconnect({ autoReconnect: true, streak: i, total: i })?.delayMs
    )
    expect(delays).toEqual(RECONNECT_DELAYS_MS)
    // 목록을 소진하면 끝낸다.
    expect(
      nextReconnect({ autoReconnect: true, streak: RECONNECT_DELAYS_MS.length, total: 4 })
    ).toBeNull()
  })

  it('**붙었다 끊기를 반복하는 서버에서도 결국 멈춘다** — 총 시도 상한', () => {
    // 붙을 때마다 연속 카운터가 0으로 돌아가므로, 연속 상한만으로는 영원히 재접속한다.
    // 그러면 세션이 끝나지 않아 관측 기록도 안 남는다.
    expect(nextReconnect({ autoReconnect: true, streak: 0, total: RECONNECT_TOTAL_MAX })).toBeNull()
    expect(
      nextReconnect({ autoReconnect: true, streak: 0, total: RECONNECT_TOTAL_MAX - 1 })
    ).not.toBeNull()
  })

  it('사람에게 보일 시도 번호는 1부터다', () => {
    expect(nextReconnect({ autoReconnect: true, streak: 0, total: 0 })?.attempt).toBe(1)
    expect(nextReconnect({ autoReconnect: true, streak: 2, total: 2 })?.attempt).toBe(3)
  })
})

describe('세션 결과 갈래 (CASE-apirunner-042 · execute AC-4 규율)', () => {
  it('붙었다가 사용자가 끊으면 성공 — 관측은 이뤄졌다', () => {
    expect(streamRunStatus({ opened: true, endedBy: 'user' })).toBe('ok')
  })

  it('서버가 정상 종료해도 성공이다', () => {
    expect(streamRunStatus({ opened: true, endedBy: 'server' })).toBe('ok')
  })

  it('붙기 전에 사용자가 껐으면 **취소**다 — 실패가 아니다', () => {
    expect(streamRunStatus({ opened: false, endedBy: 'user' })).toBe('cancelled')
  })

  it('오류로 끝나면 전송 계층이 나눈 갈래를 그대로 쓴다 — "실패"로 뭉뚱그리지 않는다', () => {
    expect(streamRunStatus({ opened: false, endedBy: 'error', failure: 'tls-error' })).toBe('tls-error')
    expect(streamRunStatus({ opened: true, endedBy: 'error', failure: 'timeout' })).toBe('timeout')
  })

  it('갈래를 못 받았으면 연결 실패로 둔다 — 성공으로 넘기지 않는다', () => {
    expect(streamRunStatus({ opened: false, endedBy: 'error' })).toBe('connect-failed')
  })
})

// ── 붙기 전에 아는 것은 붙기 전에 막는다 ───────────────────────────────────

describe('GraphQL 구독 사전 차단 (CASE-apirunner-047i)', () => {
  const q = 'subscription { messageAdded { id } }'

  it('질의문이 비었으면 **누르기 전에** 막는다', () => {
    // 안 막으면 손잡기까지 마친 뒤 실패해 화면이 '연결됨' 을 먼저 적고, 자동 재접속까지 돈다.
    expect(graphqlSubscribeBlocker('', '')).toContain('질의문')
    expect(graphqlSubscribeBlocker('   ', '')).toContain('질의문')
  })

  it('변수가 JSON 이 아니면 막고 이유를 준다', () => {
    expect(graphqlSubscribeBlocker(q, '{room:"a"}')).toContain('JSON')
  })

  it('멀쩡하면 막지 않는다 — 변수는 없어도 된다', () => {
    expect(graphqlSubscribeBlocker(q, '')).toBeNull()
    expect(graphqlSubscribeBlocker(q, '{"room":"a"}')).toBeNull()
  })
})
