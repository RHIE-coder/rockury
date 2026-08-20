import { describe, expect, it } from 'vitest'
import {
  driftFromObservations,
  driftFromSchema,
  driftUnavailable,
  hasBlockingGap,
  normalizeDrift,
  summarizeDrift,
  type DriftResult
} from './drift'
import type { FieldDef, RequestDef, RunRecord, SpecDef, StreamMessage } from './types'

/**
 * 판정 엔진.
 *
 * 이 모듈이 지키는 한 문장: **모르는 것을 안다고 말하지 않는다.**
 *  · 안 쏴 본 요청은 일치가 아니라 **미관측**
 *  · 필수여부 `모름` 은 판정에서 빠지고 **몇 개 뺐는지** 남는다
 *  · JSON 이 아니어서 모양을 못 뽑은 것도 통과가 아니라 **판정 불가**
 */

const f = (name: string, type: FieldDef['type'], requiredness: FieldDef['requiredness']): FieldDef => ({
  name,
  type,
  requiredness
})

const req = (name: string, responses: RequestDef['responses'] = []): RequestDef => ({
  id: name,
  name,
  folder: '',
  shape: 'unary',
  params: [],
  request: { method: 'GET', path: `/${name}` },
  responses,
  docs: ''
})

const spec = (requests: RequestDef[], kind: SpecDef['kind'] = 'rest'): SpecDef => ({
  id: 's1',
  name: 'S',
  description: '',
  docs: '',
  kind,
  requests
})

const run = (requestName: string, body: string, over: Partial<RunRecord> = {}): RunRecord => ({
  id: `run_${requestName}_${body.length}`,
  specId: 's1',
  requestName,
  environmentId: 'e1',
  environmentName: 'DEV',
  baseVersion: null,
  shape: 'unary',
  call: {},
  status: 'ok',
  httpStatus: 200,
  durationMs: 1,
  createdAt: '2026-07-28T00:00:00.000Z',
  request: { method: 'GET', url: '/x', headers: {}, body: '' },
  response: { status: 200, headers: {}, body, size: body.length },
  messages: null,
  messageCount: null,
  error: null,
  ...over
})

const drift = (s: SpecDef, runs: RunRecord[]) =>
  driftFromObservations({ spec: s, runs, environmentName: 'DEV' })

// ── 커버리지 정직 ─────────────────────────────────────────────────────────

describe('CASE-apicontract-010~013 커버리지를 속이지 않는다', () => {
  it('안 쏴 본 요청은 미관측으로 세고 이름을 남긴다', () => {
    const d = drift(spec([req('a'), req('b'), req('c')]), [run('a', '{}')])
    expect(d.coverage).toEqual({
      total: 3,
      observed: 1,
      unobserved: ['b', 'c'],
      unparsable: [],
      unjudged: []
    })
  })

  it('미관측을 일치로 세지 않는다 — 어긋남 0 이어도 커버리지가 붙는다', () => {
    const d = drift(spec([req('a', [{ status: '200', fields: [] }]), req('b')]), [run('a', '{}')])
    expect(d.findings).toEqual([])
    expect(summarizeDrift(d)).toMatch(/1\s*\/\s*2/)
    expect(summarizeDrift(d)).not.toBe('이상 없음')
  })

  it('"전부 관측됨" 은 미관측이 0일 때만이다', () => {
    expect(drift(spec([req('a')]), [run('a', '{}')]).coverage.unobserved).toEqual([])
    expect(drift(spec([req('a'), req('b')]), [run('a', '{}')]).coverage.unobserved).toEqual(['b'])
  })

  it('JSON 이 아니면 통과가 아니라 판정 불가로 따로 센다', () => {
    const d = drift(spec([req('a')]), [run('a', '<html>오류</html>')])
    expect(d.coverage.unparsable).toEqual(['a'])
    expect(d.coverage.observed).toBe(0)
  })

  it('응답이 없는 실행(연결 실패)은 관측으로 세지 않는다', () => {
    const failed = run('a', '', { status: 'connect-failed', response: null, httpStatus: null })
    const d = drift(spec([req('a')]), [failed])
    expect(d.coverage.observed).toBe(0)
    expect(d.coverage.unobserved).toEqual(['a'])
  })
})

// ── 스트림·수신은 판정 규칙이 없다 ─────────────────────────────────────────
// 세션 하나가 Run 하나로 쌓이는데, 그 Run 의 관측 내용은 응답 본문이 아니라 메시지 목록이다.
// 여기서 조용히 넘어가면 "쏴 봤는데 이상 없음" 이라는 **없는 판정**이 만들어진다.

describe('CASE-apicontract-011c 스트림 관측은 통과도 미관측도 아니다', () => {
  const stream = (name: string): RequestDef => ({ ...req(name), shape: 'server-stream' })
  const session = (name: string): RunRecord =>
    run(name, '', {
      shape: 'server-stream',
      response: null,
      httpStatus: null,
      messages: [{ seq: 1, at: '2026-07-28T00:00:00.000Z', direction: 'in', event: '', data: 'a' }]
    })

  it('세션을 쌓은 요청은 미관측이 아니라 **판정 규칙 없음**으로 따로 센다', () => {
    const d = drift(spec([stream('ticker')]), [session('ticker')])
    expect(d.coverage.unjudged).toEqual(['ticker'])
    expect(d.coverage.unobserved).toEqual([])
    // 관측했다고 세지도 않는다 — 대조한 것이 없다.
    expect(d.coverage.observed).toBe(0)
  })

  it('한 번도 안 붙어 본 스트림 요청은 그냥 미관측이다 — 두 사실을 뭉치지 않는다', () => {
    const d = drift(spec([stream('ticker')]), [])
    expect(d.coverage.unobserved).toEqual(['ticker'])
    expect(d.coverage.unjudged).toEqual([])
  })

  it('메시지 목록을 응답 본문으로 오독해 어긋남을 만들지 않는다', () => {
    const d = drift(spec([stream('ticker')]), [session('ticker')])
    expect(d.findings).toEqual([])
  })

  it('요약에 맞출 선언 없음 건수가 드러난다 — "이상 없음" 으로 끝나지 않는다', () => {
    const d = drift(spec([stream('ticker')]), [session('ticker')])
    expect(summarizeDrift(d)).toContain('맞출 선언 없음 1개')
    expect(summarizeDrift(d)).not.toBe('이상 없음')
  })

  it('**이름 없는 메시지는 하나뿐인 선언에 갖다 붙이지 않는다** — 못 맞춘 건수로 센다', () => {
    // 한 소켓에 여러 종류가 흐르는 것이 WebSocket 의 보통 모습이라, 그 추측은 조용히 틀린다.
    const declared: RequestDef = {
      ...stream('ticker'),
      responses: [{ status: 'tick', fields: [f('n', 'number', 'required')] }]
    }
    const d = drift(spec([declared]), [session('ticker')])
    expect(d.unroutedMessages).toBe(1)
    expect(d.coverage.unjudged).toEqual(['ticker'])
    expect(d.findings).toEqual([])
    expect(summarizeDrift(d)).toContain('못 맞춘 메시지 1건')
  })

  it('**붙지 못한 세션은 관측이 아니다** — 미관측으로 센다', () => {
    // 접속 실패도 Run 으로 남는다. "행이 있나"로 세면 한 번도 못 붙은 요청이
    // "세션은 쌓였지만 대조 규칙이 없다"로 뜬다 — 그건 미관측이다.
    const failed = run('ticker', '', {
      shape: 'server-stream',
      response: null,
      status: 'connect-failed',
      httpStatus: null,
      // 목록 조회는 본문을 안 읽으므로 판정도 본문에 의존하지 않는다 — 상태로 가린다.
      messages: null,
      messageCount: 1
    })
    const d = drift(spec([stream('ticker')]), [failed])
    expect(d.coverage.unobserved).toEqual(['ticker'])
    expect(d.coverage.unjudged).toEqual([])
  })

  it('기준 버전이 다른 세션은 이 버전의 관측이 아니다', () => {
    const d = driftFromObservations({
      spec: spec([stream('ticker')]),
      runs: [{ ...session('ticker'), baseVersion: 'v0.1.0' }],
      environmentName: 'DEV',
      baseVersion: 'v0.2.0'
    })
    expect(d.coverage.unobserved).toEqual(['ticker'])
    expect(d.coverage.unjudged).toEqual([])
  })

  it('**모양이 아니라 실행이 무엇이었는지로 가른다** — duplex 선언 요청을 단발로 쏜 관측은 계속 판정된다', () => {
    // 선언 모양으로 가르면 그 findings 가 통째로 사라지고 "판정 규칙 없음" 만 남는다.
    const declaredDuplex: RequestDef = {
      ...req('probe', [{ status: '200', fields: [f('id', 'string', 'required')] }]),
      shape: 'duplex'
    }
    const d = drift(spec([declaredDuplex]), [run('probe', '{"id":"x","extra":1}')])
    expect(d.coverage.observed).toBe(1)
    expect(d.findings.map((x) => x.path)).toEqual(['probe.200.extra'])
  })
})

// ── 완전 판정도 같은 규칙을 쓴다 ───────────────────────────────────────────

describe('CASE-apicontract-011c 완전 판정에서도 스트리밍은 대조하지 않는다', () => {
  const subscription: RequestDef = { ...req('messageAdded'), shape: 'server-stream' }

  it('GraphQL subscription 을 "명세에만 있음" 으로 잘못 잡지 않는다', () => {
    // introspection 에는 subscription 루트가 없다 — 없다고 "내 요청이 깨진다"로 적으면
    // 멀쩡한 서버를 두고 코드를 고치라고 말하는 셈이다.
    const d = driftFromSchema({
      spec: spec([subscription], 'graphql'),
      schema: { rootFields: {} },
      environmentName: 'DEV',
      rootOf: { messageAdded: 'messageAdded' },
      runs: []
    })
    expect(d.findings).toEqual([])
    expect(d.coverage.unobserved).toEqual(['messageAdded'])
  })

  it('세션 관측이 있으면 판정 규칙 없음으로 센다', () => {
    const d = driftFromSchema({
      spec: spec([subscription], 'graphql'),
      schema: { rootFields: {} },
      environmentName: 'DEV',
      rootOf: { messageAdded: 'messageAdded' },
      runs: [
        run('messageAdded', '', {
          shape: 'server-stream',
          response: null,
          messages: [
            { seq: 1, at: '2026-07-28T00:00:00.000Z', direction: 'in', event: '', data: 'a' }
          ]
        })
      ]
    })
    expect(d.coverage.unjudged).toEqual(['messageAdded'])
    expect(d.findings).toEqual([])
  })

  it('**스키마가 스트리밍까지 설명하면 대조한다** — gRPC reflection 이 그렇다', () => {
    // 덮는지 여부는 호출처가 넘기지 않는다 — `INTERFACE_META` 가 종류별로 든다.
    // 서버가 스트리밍 메서드의 응답 메시지까지 말해 줬는데 빼 두면, 다 말해 준 것을
    // 우리가 안 본 것이 되어 판정이 헐거워진다.
    const declared: RequestDef = {
      ...req('messageAdded', [{ status: 'OK', fields: [f('id', 'string', 'required')] }]),
      shape: 'server-stream',
      request: { grpcMethod: '/pkg.Svc/Watch' }
    }
    const d = driftFromSchema({
      spec: spec([declared], 'grpc'),
      schema: {
        rootFields: {
          '/pkg.Svc/Watch': [f('id', 'string', 'required'), f('extra', 'number', 'unknown')]
        }
      },
      environmentName: 'DEV',
      rootOf: { messageAdded: '/pkg.Svc/Watch' },
      runs: []
    })
    expect(d.coverage.observed).toBe(1)
    expect(d.findings.map((x) => x.path)).toEqual(['messageAdded./pkg.Svc/Watch.extra'])
  })

  it('덮는 스키마여도 수신(웹훅)은 대조 대상이 아니다 — 서버가 부르는 쪽이다', () => {
    const inbound: RequestDef = { ...req('hook'), shape: 'inbound' }
    const d = driftFromSchema({
      spec: spec([inbound], 'grpc'),
      schema: { rootFields: {} },
      environmentName: 'DEV',
      rootOf: { hook: null },
      runs: []
    })
    expect(d.findings).toEqual([])
    expect(d.coverage.unobserved).toEqual(['hook'])
  })
})

// ── 저장돼 있던 옛 판정 기록 ───────────────────────────────────────────────

describe('옛 판정 기록을 읽어도 화면이 죽지 않는다', () => {
  it('커버리지 칸이 없던 기록에 빈 목록을 채워 준다', () => {
    // `DriftResult` 는 `api_contract_logs.payload` 에 JSON 통째로 저장된다 — 칸을 더하면
    // 그 전 기록에는 없고, 화면이 `.length` 를 부르는 순간 터져 판정 화면이 백지가 된다
    // (error boundary 가 없어 재판정 버튼까지 사라진다).
    const old = {
      grade: 'observed',
      unavailable: null,
      environmentName: 'DEV',
      baseVersion: null,
      coverage: { total: 2, observed: 1, unobserved: ['b'], unparsable: [] },
      findings: [],
      skippedUnknown: 0,
      unstable: []
    } as unknown as DriftResult

    const fixed = normalizeDrift(old)
    expect(fixed.coverage.unjudged).toEqual([])
    expect(() => summarizeDrift(fixed)).not.toThrow()
    // 있던 값은 그대로 둔다.
    expect(fixed.coverage.unobserved).toEqual(['b'])
  })

  it('커버리지가 통째로 없어도 터지지 않는다', () => {
    const fixed = normalizeDrift({ grade: 'observed' } as unknown as DriftResult)
    expect(fixed.coverage).toEqual({
      total: 0,
      observed: 0,
      unobserved: [],
      unparsable: [],
      unjudged: []
    })
    expect(() => summarizeDrift(fixed)).not.toThrow()
  })
})

// ── 스트림·수신 대조 규칙 ──────────────────────────────────────────────────

describe('CASE-apicontract-017 스트림 관측을 이벤트 이름으로 대조한다', () => {
  const msg = (event: string, data: string) => ({
    seq: 1,
    at: '2026-07-28T00:00:00.000Z',
    direction: 'in' as const,
    event,
    data
  })
  const streamRun = (name: string, messages: StreamMessage[]): RunRecord =>
    run(name, '', { shape: 'server-stream', response: null, httpStatus: null, messages })

  const declared = (fields: FieldDef[]): RequestDef => ({
    ...req('ticker'),
    shape: 'server-stream',
    responses: [{ status: 'tick', fields }]
  })

  it('**이벤트 이름이 선언을 고른다** — `status` 가 스트림에선 이벤트 종류다', () => {
    const d = drift(spec([declared([f('n', 'number', 'required')])]), [
      streamRun('ticker', [msg('tick', '{"n":1}')])
    ])
    expect(d.coverage.observed).toBe(1)
    expect(d.coverage.unjudged).toEqual([])
    expect(d.findings).toEqual([])
  })

  it('선언과 어긋난 필드를 이벤트 경로와 함께 잡는다', () => {
    const d = drift(spec([declared([f('n', 'number', 'required')])]), [
      streamRun('ticker', [msg('tick', '{"n":"열"}')])
    ])
    expect(d.findings[0]).toMatchObject({ kind: 'different', path: 'ticker.tick.n' })
  })

  it('선언에 없는 이벤트를 받으면 잡는다 — 단발의 "상태 X 선언 없음" 과 같은 자리', () => {
    const d = drift(spec([declared([])]), [streamRun('ticker', [msg('boom', '{}')])])
    expect(d.findings[0]).toMatchObject({ kind: 'server-only', path: 'ticker.boom' })
  })

  it('JSON 이 아닌 메시지는 통과가 아니라 **못 맞춘 것**으로 센다', () => {
    const d = drift(spec([declared([])]), [streamRun('ticker', [msg('tick', '<xml/>')])])
    expect(d.unroutedMessages).toBe(1)
    expect(d.coverage.unjudged).toEqual(['ticker'])
  })

  it('일부만 맞춘 요청은 관측으로 세되 **못 맞춘 건수가 남는다**', () => {
    const d = drift(spec([declared([f('n', 'number', 'required')])]), [
      streamRun('ticker', [msg('tick', '{"n":1}'), msg('', '{"n":2}')])
    ])
    expect(d.coverage.observed).toBe(1)
    expect(d.unroutedMessages).toBe(1)
    // "전부 봤다" 로 읽히지 않는다.
    expect(summarizeDrift(d)).toContain('못 맞춘 메시지 1건')
  })

  it('보낸 메시지는 관측이 아니다 — 서버가 준 것만 본다', () => {
    const out: StreamMessage = { ...msg('tick', '{"n":"열"}'), direction: 'out' }
    const d = drift(spec([declared([f('n', 'number', 'required')])]), [streamRun('ticker', [out])])
    expect(d.findings).toEqual([])
    expect(d.coverage.unjudged).toEqual(['ticker'])
  })
})

describe('CASE-apicontract-018 웹훅 수신을 기대 본문과 대조한다', () => {
  const hook = (expectedBody?: string): RequestDef => ({
    ...req('onPaid'),
    shape: 'inbound',
    request: { expectedBody }
  })
  const hookRun = (body: string): RunRecord =>
    run('onPaid', '', {
      shape: 'inbound',
      response: null,
      httpStatus: null,
      messages: [{ seq: 1, at: '2026-07-28T00:00:00.000Z', direction: 'in', event: 'POST /h', data: body }]
    })

  const expected = JSON.stringify([{ name: 'id', type: 'string', requiredness: 'required' }])

  it('받는 쪽 선언은 **기대 본문**이다 — 응답 모양이 아니다', () => {
    const d = drift(spec([hook(expected)]), [hookRun('{"id":"x"}')])
    expect(d.coverage.observed).toBe(1)
    expect(d.findings).toEqual([])
  })

  it('어긋난 필드를 잡는다', () => {
    const d = drift(spec([hook(expected)]), [hookRun('{}')])
    expect(d.findings[0]).toMatchObject({ kind: 'different', path: 'onPaid.id' })
  })

  it('**선언이 없으면 통과가 아니라 못 맞춘 것**이다', () => {
    const d = drift(spec([hook()]), [hookRun('{"id":"x"}')])
    expect(d.coverage.unjudged).toEqual(['onPaid'])
    expect(d.unroutedMessages).toBe(1)
    expect(d.findings).toEqual([])
  })
})

describe('CASE-apicontract-014~015 어떤 관측을 기준으로 삼나', () => {
  // 상태 200 을 선언해 둔다 — 선언이 없으면 필드가 아니라 **상태 단위**로 잡히는 게 맞다.
  const withStatus = (): RequestDef => req('a', [{ status: '200', fields: [] }])

  it('가장 최근 성공 실행을 기준으로 한다', () => {
    const older = run('a', '{"old":1}', { createdAt: '2026-07-01T00:00:00.000Z' })
    const newer = run('a', '{"fresh":1}', { createdAt: '2026-07-28T00:00:00.000Z' })
    const d = drift(spec([withStatus()]), [older, newer])
    expect(d.findings.map((x) => x.path)).toEqual(['a.200.fresh'])
  })

  it('과거 관측과 응답 모양이 달랐으면 그 사실을 알린다', () => {
    const d = drift(spec([req('a')]), [
      run('a', '{"x":1}', { createdAt: '2026-07-01T00:00:00.000Z' }),
      run('a', '{"y":1}', { createdAt: '2026-07-28T00:00:00.000Z' })
    ])
    expect(d.unstable).toEqual(['a'])
  })

  it('기준 버전이 다른 관측은 섞지 않는다', () => {
    const d = driftFromObservations({
      spec: spec([withStatus()]),
      runs: [run('a', '{"x":1}', { baseVersion: 'v0.1.0' }), run('a', '{"y":1}', { baseVersion: 'v0.2.0' })],
      environmentName: 'DEV',
      baseVersion: 'v0.2.0'
    })
    expect(d.baseVersion).toBe('v0.2.0')
    expect(d.findings.map((x) => x.path)).toEqual(['a.200.y'])
  })
})

// ── 결과 3종 ─────────────────────────────────────────────────────────────

describe('CASE-apicontract-020~021 결과 3종 분류', () => {
  const declared = (fields: FieldDef[]): RequestDef => req('a', [{ status: '200', fields }])

  it('서버에만 있음 — 명세가 뒤처졌다', () => {
    const d = drift(spec([declared([f('id', 'string', 'required')])]), [run('a', '{"id":"x","extra":1}')])
    expect(d.findings).toEqual([
      expect.objectContaining({ kind: 'server-only', path: 'a.200.extra' })
    ])
  })

  it('명세에만 있음 — 필수라고 선언했는데 응답에 없다', () => {
    const d = drift(spec([declared([f('id', 'string', 'required')])]), [run('a', '{}')])
    expect(d.findings[0]).toMatchObject({ kind: 'spec-only', path: 'a.200.id' })
  })

  it('nullable 로 선언한 필드가 이번 응답에 없는 것은 어긋남이 아니다', () => {
    const d = drift(spec([declared([f('memo', 'string', 'nullable')])]), [run('a', '{}')])
    expect(d.findings).toEqual([])
  })

  it('양쪽 있는데 타입이 다르다', () => {
    const d = drift(spec([declared([f('n', 'number', 'required')])]), [run('a', '{"n":"열"}')])
    expect(d.findings[0]).toMatchObject({
      kind: 'different',
      path: 'a.200.n',
      declared: 'number',
      actual: 'string'
    })
  })

  it('선언에 없는 상태를 받으면 상태 단위로 잡는다', () => {
    const d = drift(spec([declared([])]), [run('a', '{}', { httpStatus: 404, response: { status: 404, headers: {}, body: '{}', size: 2 } })])
    expect(d.findings[0]).toMatchObject({ kind: 'server-only', path: 'a.404' })
  })

  it('중첩 필드도 경로와 함께 잡는다', () => {
    const nested: FieldDef = {
      name: 'user',
      type: 'object',
      requiredness: 'required',
      fields: [f('email', 'string', 'required')]
    }
    const d = drift(spec([declared([nested])]), [run('a', '{"user":{"email":1}}')])
    expect(d.findings[0]).toMatchObject({ kind: 'different', path: 'a.200.user.email' })
  })

  it('넷째 갈래를 만들지 않는다', () => {
    const d = drift(spec([declared([f('id', 'string', 'required')])]), [run('a', '{"other":true}')])
    for (const x of d.findings) expect(['server-only', 'spec-only', 'different']).toContain(x.kind)
  })
})

// ── 모름 제외 ────────────────────────────────────────────────────────────

describe('CASE-apicontract-022 모름은 빼고, 뺐다는 사실을 남긴다', () => {
  it('필수여부 모름인 필드가 응답에 없어도 어긋남이 아니고 제외로 센다', () => {
    const d = drift(spec([req('a', [{ status: '200', fields: [f('x', 'string', 'unknown')] }])]), [run('a', '{}')])
    expect(d.findings).toEqual([])
    expect(d.skippedUnknown).toBe(1)
  })

  it('모름이어도 타입이 다른 건 여전히 어긋남이다', () => {
    const d = drift(spec([req('a', [{ status: '200', fields: [f('x', 'string', 'unknown')] }])]), [
      run('a', '{"x":1}')
    ])
    expect(d.findings[0]).toMatchObject({ kind: 'different' })
  })

  it('모름을 안전으로 세면 제외 개수가 0이 된다 — 그러면 이 케이스가 실패한다', () => {
    const two = [f('a', 'string', 'unknown'), f('b', 'string', 'unknown')]
    const d = drift(spec([req('a', [{ status: '200', fields: two }])]), [run('a', '{}')])
    expect(d.skippedUnknown).toBe(2)
  })
})

// ── 등급 ─────────────────────────────────────────────────────────────────

describe('CASE-apicontract-001~004 판정 등급', () => {
  it('관측 판정은 등급이 observed 다', () => {
    expect(drift(spec([req('a')]), []).grade).toBe('observed')
  })

  it('등급 없는 결과를 만들 수 없다 — 모든 결과에 등급과 커버리지가 있다', () => {
    const d = drift(spec([]), [])
    expect(d.grade).toBeTruthy()
    expect(d.coverage).toBeTruthy()
  })

  it('완전 판정 불가는 사유를 갈라 담고, 관측 결과로 조용히 내려가지 않는다', () => {
    const d = driftUnavailable('feature-off', 'introspection 이 꺼져 있습니다.', 'DEV')
    expect(d.grade).toBe('complete')
    expect(d.unavailable?.reason).toBe('feature-off')
    expect(d.findings).toEqual([])
    expect(d.coverage.observed).toBe(0)
    expect(summarizeDrift(d)).toMatch(/판정 불가/)
  })

  it('불가 사유 갈래가 서로 구분된다', () => {
    for (const r of ['feature-off', 'no-permission', 'connect-failed', 'not-implemented'] as const) {
      expect(driftUnavailable(r, 'x', 'DEV').unavailable?.reason).toBe(r)
    }
  })
})

// ── 요약 문구 ────────────────────────────────────────────────────────────

describe('CASE-apicontract-013 요약에는 늘 커버리지가 붙는다', () => {
  it('어긋남이 있으면 건수와 커버리지를 함께 말한다', () => {
    const d = drift(spec([req('a', [{ status: '200', fields: [f('id', 'string', 'required')] }]), req('b')]), [
      run('a', '{}')
    ])
    const s = summarizeDrift(d)
    expect(s).toMatch(/1건/)
    expect(s).toMatch(/1\s*\/\s*2/)
  })

  it('고칠 것이 있는지 한 줄로 판정한다 (흡수만 남았으면 막지 않는다)', () => {
    const serverOnly = drift(spec([req('a', [{ status: '200', fields: [] }])]), [run('a', '{"new":1}')])
    const specOnly = drift(spec([req('a', [{ status: '200', fields: [f('id', 'string', 'required')] }])]), [
      run('a', '{}')
    ])
    expect(hasBlockingGap(serverOnly)).toBe(false)
    expect(hasBlockingGap(specOnly)).toBe(true)
  })
})
