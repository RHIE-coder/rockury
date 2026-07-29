import { describe, expect, it } from 'vitest'
import {
  GRAPHQL_WS_PROTOCOL,
  initialState,
  onServerText,
  onSocketOpen,
  plaintextNote,
  stopMessage,
  subscriptionEvent,
  websocketUrl,
  type GqlWsAction,
  type GqlWsContext
} from './graphqlWs'

/** TestPlan: api-runner · CASE-apirunner-047a~047f (GraphQL 구독 규약). */

const ctx = (over: Partial<GqlWsContext> = {}): GqlWsContext => ({
  query: 'subscription { messageAdded { id text } }',
  variables: '',
  connectionParams: {},
  event: 'messageAdded',
  ...over
})

/** 규약 순서를 들고 있는 상태 — 회차마다 새로 만든다. */
const st = initialState

/** 손잡기를 마친 상태에서 시작한다(대부분의 검사가 그 뒤를 본다). */
function acked(c = ctx()): ReturnType<typeof initialState> {
  const s = initialState()
  onServerText('{"type":"connection_ack"}', c, s)
  return s
}

const sent = (actions: GqlWsAction[]): unknown[] =>
  actions.filter((a) => a.kind === 'send').map((a) => JSON.parse((a as { text: string }).text))
const kinds = (actions: GqlWsAction[]): string[] => actions.map((a) => a.kind)

describe('손잡기 순서 (CASE-apirunner-047a)', () => {
  it('소켓이 열리면 **먼저 손잡기**를 보낸다 — 구독을 먼저 보내면 서버가 끊는다', () => {
    expect(sent(onSocketOpen(ctx()))).toEqual([{ type: 'connection_init' }])
  })

  it('서버가 손을 잡아 줘야 **그때** 구독을 보낸다', () => {
    const acts = onServerText('{"type":"connection_ack"}', ctx(), st())
    expect(kinds(acts)).toEqual(['open', 'send'])
    expect(sent(acts)).toEqual([
      {
        id: '1',
        type: 'subscribe',
        payload: { query: 'subscription { messageAdded { id text } }' }
      }
    ])
  })

  it('**`연결됨` 은 소켓이 열린 때가 아니라 손을 잡은 때다**', () => {
    // 소켓만 열린 상태에서 '연결됨' 이라고 하면, 손잡기가 실패해도 사용자는 붙은 줄 안다.
    expect(kinds(onSocketOpen(ctx()))).not.toContain('open')
    expect(kinds(onServerText('{"type":"connection_ack"}', ctx(), st()))).toContain('open')
  })

  it('규약 이름은 손잡기 때 합의하는 그 이름이다', () => {
    expect(GRAPHQL_WS_PROTOCOL).toBe('graphql-transport-ws')
  })
})

describe('인증 값의 자리 (CASE-apirunner-047b)', () => {
  const withAuth = ctx({ connectionParams: { authorization: 'Bearer x' } })

  it('헤더로 못 보내므로 `connection_init` 에 싣는다 — 규약이 정한 자리다', () => {
    expect(sent(onSocketOpen(withAuth))).toEqual([
      { type: 'connection_init', payload: { authorization: 'Bearer x' } }
    ])
  })

  it('**어디로 보냈는지 타임라인에 적는다** — 안 적으면 401 을 받고 이유를 못 찾는다', () => {
    const note = onSocketOpen(withAuth).find((a) => a.kind === 'system')
    expect(note && 'text' in note ? note.text : '').toContain('authorization')
  })

  it('보낼 값이 없으면 굳이 빈 payload 를 만들지 않는다', () => {
    expect(sent(onSocketOpen(ctx()))).toEqual([{ type: 'connection_init' }])
    expect(kinds(onSocketOpen(ctx()))).toEqual(['send'])
  })
})

describe('구독 변수 (CASE-apirunner-047c)', () => {
  it('변수를 함께 보낸다', () => {
    const acts = onServerText('{"type":"connection_ack"}', ctx({ variables: '{"room":"a"}' }), st())
    expect(sent(acts)[0]).toMatchObject({ payload: { variables: { room: 'a' } } })
  })

  it('**변수가 JSON 이 아니면 빼고 보내지 않는다** — 서버가 다른 결과를 주고 이유를 모른다', () => {
    const acts = onServerText('{"type":"connection_ack"}', ctx({ variables: '{{{' }), st())
    expect(kinds(acts)).toEqual(['open', 'end'])
    expect(acts.find((a) => a.kind === 'end')).toMatchObject({ reason: expect.stringContaining('변수') })
  })

  it('질의문이 비었으면 붙어 놓고 기다리지 않는다', () => {
    const acts = onServerText('{"type":"connection_ack"}', ctx({ query: '   ' }), st())
    expect(acts.find((a) => a.kind === 'end')).toMatchObject({
      reason: expect.stringContaining('질의문')
    })
  })
})

describe('받은 것 읽기 (CASE-apirunner-047d)', () => {
  it('`next` 는 타임라인 메시지가 되고 **이벤트 이름이 구독 루트**다', () => {
    // 판정이 이벤트 이름으로 선언을 고른다 — 이름이 없으면 못 맞춘 것으로 센다.
    const c = ctx()
    const acts = onServerText(
      '{"id":"1","type":"next","payload":{"data":{"messageAdded":{"id":"m1"}}}}',
      c,
      acked(c)
    )
    expect(acts).toEqual([
      { kind: 'message', event: 'messageAdded', data: '{"data":{"messageAdded":{"id":"m1"}}}' }
    ])
  })

  it('`complete` 는 정상 종료다', () => {
    const end = onServerText('{"id":"1","type":"complete"}', ctx(), st())[0]
    expect(end).toMatchObject({ kind: 'end', reason: expect.stringContaining('끝냈습니다') })
    expect(end).not.toHaveProperty('failure')
  })

  it('`error` 는 서버가 거절한 것 — 사유를 그대로 싣는다', () => {
    const end = onServerText(
      '{"id":"1","type":"error","payload":[{"message":"Unknown field"}]}',
      ctx(),
      st()
    )[0]
    expect(end).toMatchObject({ kind: 'end', failure: 'http-error' })
    expect((end as { reason: string }).reason).toContain('Unknown field')
  })

  it('`ping` 에는 답한다 — 안 하면 서버가 끊는다. 다만 타임라인은 안 어지럽힌다', () => {
    const acts = onServerText('{"type":"ping"}', ctx(), st())
    expect(sent(acts)).toEqual([{ type: 'pong' }])
    expect(kinds(acts)).toEqual(['send'])
  })

  it('`pong` 은 우리가 물은 것에 대한 답이라 할 일이 없다', () => {
    expect(onServerText('{"type":"pong"}', ctx(), st())).toEqual([])
  })
})

describe('모르는 것을 안다고 말하지 않는다 (CASE-apirunner-047e)', () => {
  it('규약에 없는 종류는 **이름을 그대로 적는다** — 아는 것으로 뭉치지 않는다', () => {
    const acts = onServerText('{"type":"data"}', ctx(), st())
    expect(acts[0]).toMatchObject({ kind: 'system' })
    expect((acts[0] as { text: string }).text).toContain("'data'")
  })

  it('JSON 이 아니면 그 사실을 적는다 — 빈 메시지로 삼키지 않는다', () => {
    const acts = onServerText('아무말', ctx(), st())
    expect((acts[0] as { text: string }).text).toContain('JSON 아님')
  })

  it('종류가 없는 메시지도 그대로 적는다', () => {
    expect((onServerText('{"id":"1"}', ctx(), st())[0] as { text: string }).text).toContain('종류가 없는')
  })

  it('**옛 규약으로 답하는 서버를 알아본다** — 손잡기가 안 맞는 것이 원인이다', () => {
    const end = onServerText('{"type":"connection_error","payload":{"message":"nope"}}', ctx(), st())[0]
    expect((end as { reason: string }).reason).toContain('subscriptions-transport-ws')
  })
})

describe('끊기', () => {
  it('소켓을 닫기 전에 구독을 접는다 — 규약이 정한 순서다', () => {
    expect(JSON.parse(stopMessage())).toEqual({ id: '1', type: 'complete' })
  })
})

describe('구독 주소 (CASE-apirunner-047f)', () => {
  it('**`https` 는 `wss` 로 간다** — `ws` 로 내리면 암호화가 조용히 벗겨진다', () => {
    expect(websocketUrl('https://api.test/graphql').url).toBe('wss://api.test/graphql')
    expect(websocketUrl('http://127.0.0.1:4000/graphql').url).toBe('ws://127.0.0.1:4000/graphql')
  })

  it('이미 소켓 주소면 그대로 둔다 — 사용자가 정한 것이다', () => {
    expect(websocketUrl('wss://api.test/subs').url).toBe('wss://api.test/subs')
    expect(websocketUrl('ws://api.test/subs').url).toBe('ws://api.test/subs')
  })

  it('방식이 없거나 다른 방식이면 짐작하지 않고 사유를 단다', () => {
    expect(websocketUrl('api.test/graphql').problem).toContain('방식이 없습니다')
    expect(websocketUrl('grpc://api.test').problem).toContain('grpc://')
    expect(websocketUrl('').problem).toContain('없습니다')
  })
})

describe('구독 루트 이름', () => {
  it('질의문에서 루트 이름을 읽는다', () => {
    expect(subscriptionEvent('subscription { messageAdded { id } }')).toBe('messageAdded')
  })

  it('못 읽으면 빈 이름이다 — 지어내지 않는다(판정이 못 맞춘 것으로 센다)', () => {
    expect(subscriptionEvent('')).toBe('')
  })
})

// ── 서버가 주는 것은 남의 데이터다 ─────────────────────────────────────────

describe('규약 순서를 어기는 서버 (CASE-apirunner-047g)', () => {
  it('**손을 두 번 잡아 줘도 구독을 다시 보내지 않는다**', () => {
    // 30바이트 인바운드가 수 KB 아웃바운드를 끌어내고, 같은 id 로 다시 보내면
    // 규약을 지키는 서버는 4409 로 끊는다 — 원인이 우리 쪽이라는 단서가 안 남는다.
    const c = ctx()
    const s = st()
    expect(kinds(onServerText('{"type":"connection_ack"}', c, s))).toEqual(['open', 'send'])
    expect(onServerText('{"type":"connection_ack"}', c, s)).toEqual([])
  })

  it('**구독을 보내기도 전에 온 결과는 세지 않는다**', () => {
    const acts = onServerText('{"id":"1","type":"next","payload":{"data":{}}}', ctx(), st())
    expect(kinds(acts)).toEqual(['system'])
    expect((acts[0] as { text: string }).text).toContain('보내기도 전에')
  })

  it('**우리가 연 구독이 아닌 것은 우리 관측이 아니다**', () => {
    // 게이트웨이가 소켓 하나를 여럿이 나눠 쓰는 구성에서 실제로 온다. 그걸 우리 이름표를
    // 붙여 적으면 남의 데이터가 우리 요청의 판정에 들어간다.
    const c = ctx()
    const s = acked(c)
    for (const t of ['next', 'complete', 'error']) {
      const acts = onServerText(`{"id":"99","type":"${t}","payload":{}}`, c, s)
      expect(kinds(acts), t).toEqual(['system'])
      expect((acts[0] as { text: string }).text).toContain('우리가 연 구독이 아닌')
    }
  })

  it('손잡기 전에 규약에 없는 글자가 계속 오면 **그 서버는 이 규약을 안 쓴다**고 결론 낸다', () => {
    // 안 두면 제한시간(30초)까지 프레임마다 타임라인 행 + IPC 가 나간다.
    const c = ctx()
    const s = st()
    let last: GqlWsAction[] = []
    for (let i = 0; i < 20; i += 1) last = onServerText('쓰레기', c, s)
    expect(kinds(last)).toEqual(['end'])
    expect((last[0] as { reason: string }).reason).toContain(GRAPHQL_WS_PROTOCOL)
  })

  it('손을 잡은 뒤의 모르는 메시지는 그냥 한 줄로 적는다 — 세지 않는다', () => {
    const c = ctx()
    const s = acked(c)
    for (let i = 0; i < 30; i += 1) {
      expect(kinds(onServerText('{"type":"data"}', c, s))).toEqual(['system'])
    }
  })
})

describe('서버가 준 글자에 상한을 둔다 (CASE-apirunner-047h)', () => {
  it('**인용은 자른다** — 자르기 전에 가리는 그물을 태우면 메인이 멎는다', () => {
    const huge = 'x'.repeat(5_000_000)
    const acts = onServerText(huge, ctx(), st())
    const text = (acts[0] as { text: string }).text
    expect(text.length).toBeLessThan(4_000)
    expect(text).toContain('5000000글자 중 앞부분')
  })

  it('오류 목록도 자른다 — GraphQL 은 검증 오류를 배열로 한꺼번에 준다', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ message: `필드 ${i} 를 모릅니다` }))
    const end = onServerText(
      JSON.stringify({ id: '1', type: 'error', payload: many }),
      ctx(),
      st()
    )[0]
    expect((end as { reason: string }).reason.length).toBeLessThan(2_500)
  })

  it('큰 결과는 봉투를 벗기지 않고 원문을 잘라 쓰되 **그 사실을 적는다**', () => {
    const big = JSON.stringify({ id: '1', type: 'next', payload: { data: 'y'.repeat(400_000) } })
    const c = ctx()
    const acts = onServerText(big, c, acked(c))
    const data = (acts[0] as { data: string }).data
    expect(data).toContain('앞부분만 남겼습니다')
    expect(data.length).toBeLessThan(300_000)
  })
})

describe('평문 소켓 고지', () => {
  it('**암호화 없는 주소로 자격증명이 나가면 그 사실을 적는다**', () => {
    const note = plaintextNote('ws://h/graphql', { authorization: 'Bearer x' })
    expect(note).toContain('평문')
    expect(note).toContain('authorization')
    // 값이 아니라 이름만 담는다.
    expect(note).not.toContain('Bearer x')
  })

  it('암호화됐거나 보낼 값이 없으면 굳이 말하지 않는다', () => {
    expect(plaintextNote('wss://h/graphql', { authorization: 'x' })).toBeNull()
    expect(plaintextNote('ws://h/graphql', {})).toBeNull()
  })
})

describe('주소의 사용자:비번', () => {
  it('**잘라 낸다** — 남기면 기록에 굳는데 가리는 그물에 안 걸린다', () => {
    const out = websocketUrl('https://svc:p4ssw0rd@api.test/graphql')
    expect(out.url).toBe('wss://api.test/graphql')
    expect(out.problem).toBeNull()
  })

  it('경로 안의 @ 는 건드리지 않는다', () => {
    expect(websocketUrl('https://api.test/gql@v2').url).toBe('wss://api.test/gql@v2')
  })

  it('실패는 한 갈래로만 말한다 — 빈 문자열이면 `??` 를 그냥 통과한다', () => {
    expect(websocketUrl('nope').url).toBeNull()
  })
})
