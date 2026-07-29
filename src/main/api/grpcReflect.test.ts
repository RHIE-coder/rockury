import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as grpc from '@grpc/grpc-js'
// @ts-expect-error — 검사용 서버 픽스처는 순수 JS(.mjs) 다. e2e 스위트도 같은 것을 쓴다.
import { startGrpcServer } from '../../../e2e/lib/api/grpcServer.mjs'
import { reflectGrpc } from './grpcReflect'
import { openGrpcStream, type GrpcOpenOutcome } from './grpcStream'
import { parseGrpcTarget } from '../../shared/api/grpcTarget'
import { methodsOf, rootFieldsFor, shapeOfMethod } from '../../shared/api/proto'
import type { FieldDef } from '../../shared/api/types'

/**
 * TestPlan: api-contract CASE-apicontract-005e · api-runner CASE-apirunner-046a~046g.
 *
 * **진짜 서버에 붙는다.** gRPC 의 알맹이는 "서버에게 정의를 받아 온다"는 것이라,
 * 정의를 손으로 넣은 가짜에 붙이면 정작 검사하려는 부분이 통째로 빠진다.
 * 포트는 0(운영체제가 고른다) — 병렬 개발에서 고정 포트를 잡으면 옆 워크트리를 깨뜨린다.
 */

interface TestServer {
  url: string
  address: string
  stop: () => Promise<void>
}

const target = (url: string): ReturnType<typeof parseGrpcTarget> => parseGrpcTarget(url)

const schemaOf = (pkg: Parameters<typeof methodsOf>[0]) => {
  const methods = methodsOf(pkg)
  return { methods, rootFields: rootFieldsFor(pkg, methods, methods.keys()) }
}
const byName = (fields: FieldDef[], n: string): FieldDef => fields.find((f) => f.name === n)!

describe('서버에게 정의 받기 (reflection)', () => {
  let server: TestServer

  beforeAll(async () => {
    server = (await startGrpcServer()) as TestServer
  })
  afterAll(async () => await server.stop())

  it('서비스 목록과 정의를 받아 온다', async () => {
    const out = await reflectGrpc(target(server.url), {})
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.services).toEqual(['e2e.v1.Ticker'])
  })

  it('**옛 판만 켠 서버에도 붙는다** — v1 을 먼저 묻고 없으면 v1alpha 로 넘어간다', async () => {
    // 픽스처 기본값은 v1alpha 뿐이다(현장에도 그런 서버가 훨씬 많다).
    const alphaOnly = (await startGrpcServer({
      reflectionVersions: ['grpc.reflection.v1alpha']
    })) as TestServer
    const v1Only = (await startGrpcServer({
      reflectionVersions: ['grpc.reflection.v1']
    })) as TestServer
    try {
      // 두 판 어느 쪽만 켜 있어도 붙어야 넘기기가 실제로 도는 것이다.
      expect((await reflectGrpc(target(alphaOnly.url), {})).ok).toBe(true)
      expect((await reflectGrpc(target(v1Only.url), {})).ok).toBe(true)
    } finally {
      await alphaOnly.stop()
      await v1Only.stop()
    }
  })

  it('받은 정의가 우리 응답 모양으로 옮겨진다', async () => {
    const out = await reflectGrpc(target(server.url), {})
    if (!out.ok) throw new Error(out.message)
    const { rootFields } = schemaOf(out.package)

    const fields = rootFields['/e2e.v1.Ticker/Watch']
    expect(fields.map((f) => f.name).sort()).toEqual(['big', 'blob', 'kind', 'label', 'n', 'never'])
    expect(byName(fields, 'n').type).toBe('number')
    // 열거형 허용 값까지 따라온다 — 이게 있어야 값 어긋남을 잡는다.
    expect(byName(fields, 'kind').enumValues).toEqual(['PLAIN', 'LOUD'])
  })

  it('상호작용 모양을 서버 정의가 정한다', async () => {
    const out = await reflectGrpc(target(server.url), {})
    if (!out.ok) throw new Error(out.message)
    const { methods } = schemaOf(out.package)
    expect(shapeOfMethod(methods.get('/e2e.v1.Ticker/Watch')!)).toBe('server-stream')
    expect(shapeOfMethod(methods.get('/e2e.v1.Ticker/Chat')!)).toBe('duplex')
    expect(shapeOfMethod(methods.get('/e2e.v1.Ticker/Once')!)).toBe('unary')
  })

  it('주소가 gRPC 주소가 아니면 붙어 보지도 않고 사유를 준다', async () => {
    const out = await reflectGrpc(target('ws://127.0.0.1:1'), {})
    expect(out).toMatchObject({ ok: false, reason: 'connect-failed' })
  })

  it('**사용자가 끊으면 받아 오던 것도 멈춘다**', async () => {
    const ac = new AbortController()
    ac.abort()
    const out = await reflectGrpc(target(server.url), {}, { signal: ac.signal })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.message).toContain('취소')
  })
})

describe('정의를 못 받는 서버', () => {
  let server: TestServer

  beforeAll(async () => {
    server = (await startGrpcServer({ reflection: false })) as TestServer
  })
  afterAll(async () => await server.stop())

  it('**관측으로 내려가지 않고 "안 켰다"고 말한다**', async () => {
    const out = await reflectGrpc(target(server.url), {})
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toBe('feature-off')
    expect(out.message).toContain('reflection')
  })
})

describe('권한이 없는 서버', () => {
  let server: TestServer

  beforeAll(async () => {
    server = (await startGrpcServer({ authToken: 'Bearer good' })) as TestServer
  })
  afterAll(async () => await server.stop())

  it('권한 문제를 연결 실패와 갈라서 말한다 — 봐야 할 곳이 다르다', async () => {
    const out = await reflectGrpc(target(server.url), { authorization: 'Bearer wrong' })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toBe('no-permission')
  })

  it('토큰이 맞으면 받아 온다 — 헤더가 실제로 실린다', async () => {
    const out = await reflectGrpc(target(server.url), { authorization: 'Bearer good' })
    expect(out.ok).toBe(true)
  })

  it('**못 실은 헤더를 조용히 버리지 않는다** — 맞는 값을 계속 들여다보게 된다', async () => {
    // gRPC 메타데이터는 ASCII 만 받는다. 한글 값이 빠진 채 권한 오류가 나면
    // 사용자는 **맞게 들어 있는** 환경 값을 의심하게 된다.
    const out = await reflectGrpc(target(server.url), {
      authorization: 'Bearer wrong',
      'x-tenant': '한국지사'
    })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.message).toContain('x-tenant')
  })
})

describe('개별 정의를 거절하는 서버', () => {
  let server: TestServer

  beforeAll(async () => {
    // 목록은 주는데 심볼 조회에 인가가 걸린 서버 — 현장에 있는 모양이다.
    server = (await startGrpcServer({
      symbolError: { errorCode: grpc.status.PERMISSION_DENIED, errorMessage: '심볼 조회 금지' }
    })) as TestServer
  })
  afterAll(async () => await server.stop())

  it('**서버가 준 사유를 버리지 않는다** — 봐야 할 곳이 권한인데 설정으로 보내면 안 된다', async () => {
    const out = await reflectGrpc(target(server.url), {})
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toBe('no-permission')
    expect(out.message).toContain('심볼 조회 금지')
  })
})

// ── 전송 ──────────────────────────────────────────────────────────────────

interface Collector {
  cb: Parameters<typeof openGrpcStream>[1]
  opened: number
  notes: string[]
  messages: string[]
}
function collector(): Collector & { waitForEnd: (h: GrpcOpenOutcome) => Promise<string> } {
  const c: Collector = {
    opened: 0,
    notes: [],
    messages: [],
    cb: {
      onOpen: () => (c.opened += 1),
      onNote: (t) => c.notes.push(t),
      onMessage: (t) => c.messages.push(t)
    }
  }
  return {
    ...c,
    get opened() {
      return c.opened
    },
    notes: c.notes,
    messages: c.messages,
    cb: c.cb,
    waitForEnd: (out) =>
      new Promise<string>((resolve) => {
        if (!out.ok) return resolve(out.reason)
        out.handle.onEnd((reason) => resolve(reason))
      })
  }
}

const open = (
  server: TestServer,
  method: string,
  declaredShape: 'server-stream' | 'duplex',
  body = '{}',
  cb?: Parameters<typeof openGrpcStream>[1]
): Promise<GrpcOpenOutcome> =>
  openGrpcStream(
    { target: target(server.url), method, declaredShape, headers: {}, body, displayBody: body },
    cb ?? collector().cb
  )

describe('gRPC 스트리밍 전송', () => {
  let server: TestServer

  beforeAll(async () => {
    server = (await startGrpcServer()) as TestServer
  })
  afterAll(async () => await server.stop())

  it('계속 받기만 하는 메서드에서 메시지가 흘러온다', async () => {
    const c = collector()
    const out = await open(server, 'Ticker/Watch', 'server-stream', '{"count":3}', c.cb)
    expect(out.ok).toBe(true)
    const reason = await c.waitForEnd(out)
    expect(c.messages.length).toBe(3)
    expect(c.messages[0]).toContain('tick-1')
    expect(reason).toContain('닫았습니다')
  })

  it('열거형은 번호가 아니라 **이름**으로 온다 — 선언의 허용 값과 같은 말이어야 한다', async () => {
    const c = collector()
    const out = await open(server, 'Ticker/Watch', 'server-stream', '{"count":1}', c.cb)
    await c.waitForEnd(out)
    expect(c.messages[0]).toContain('LOUD')
  })

  it('**64비트 정수는 글자로 온다** — 수로 바꾸면 큰 값에서 조용히 자릿수를 잃는다', async () => {
    const c = collector()
    const out = await open(server, 'Ticker/Watch', 'server-stream', '{"count":1}', c.cb)
    await c.waitForEnd(out)
    // 2^53 + 1. 수로 옮기면 …992 로 바뀐다.
    expect(c.messages[0]).toContain('"9007199254740993"')
  })

  it('**바이트 칸은 글자로 지어내지 않고 크기만 적는다**', async () => {
    const c = collector()
    const out = await open(server, 'Ticker/Watch', 'server-stream', '{"count":1}', c.cb)
    await c.waitForEnd(out)
    // `Buffer` 는 replacer 보다 먼저 `toJSON()` 을 지나 `{type:'Buffer',data:[…]}` 가 된다 —
    // 그 길을 안 막으면 64KB 조각이 6만 개짜리 숫자 배열로 타임라인에 들어간다.
    expect(c.messages[0]).toContain('(바이너리 5 바이트)')
    expect(c.messages[0]).not.toContain('"data"')
  })

  it('**서버가 안 보낸 칸을 기본값으로 채우지 않는다** — 채우면 "받았다"가 되어 버린다', async () => {
    const c = collector()
    const out = await open(server, 'Ticker/Watch', 'server-stream', '{"count":1}', c.cb)
    await c.waitForEnd(out)
    expect(c.messages[0]).not.toContain('never')
  })

  it('**보내기 전에도 붙었다고 알린다** — 조용한 양방향에서 교착되지 않는다', async () => {
    // 서버 머리말만 기다리면, 우리가 먼저 보내야 답하는 메서드에서 영원히 '접속 중' 이다.
    // 그런데 '접속 중' 에서는 보내기가 막혀 있어 사용자가 그 교착을 풀 방법이 없다.
    const c = collector()
    const out = await open(server, 'Ticker/Chat', 'duplex', '', c.cb)
    if (!out.ok) throw new Error(out.reason)
    await new Promise((r) => setTimeout(r, 500))
    expect(c.opened).toBeGreaterThan(0)
    expect(c.messages.length).toBe(0)
    out.handle.close()
  })

  it('서로 주고받는 메서드에서 보낸 것이 되돌아온다', async () => {
    const c = collector()
    const out = await open(server, 'Ticker/Chat', 'duplex', '', c.cb)
    if (!out.ok) throw new Error(out.reason)
    out.handle.send('{"count":7,"text":"안녕"}', '{"count":7,"text":"안녕"}')
    await new Promise((r) => setTimeout(r, 300))
    expect(c.messages.join('')).toContain('echo:안녕')
    out.handle.close()
  })

  it('**서버가 단발이라고 하면 스트림으로 열지 않는다** — 한 건 받고 끝나면 오해한다', async () => {
    const out = await open(server, 'Ticker/Once', 'server-stream')
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toContain('한 번 묻고 한 번 받는')
    // Send 로 안내하지 않는다 — 이 앱은 gRPC 단발 실행을 아직 안 만들었다(막다른 길).
    expect(out.reason).not.toContain('Send')
  })

  it('**선언한 모양이 서버와 다르면 열지 않는다** — 화면이 선언대로 그려져 교착된다', async () => {
    // 보내야 답하는 메서드인데 보내기 패널이 없는 상태가 정확히 그 교착이다.
    const out = await open(server, 'Ticker/Chat', 'server-stream')
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toContain('서로 계속 주고받음')
  })

  it('없는 메서드는 **서버가 아는 것을 함께** 알려 준다', async () => {
    const out = await open(server, 'Ticker/Nope', 'server-stream')
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toContain('/e2e.v1.Ticker/Watch')
  })

  it('보낼 본문이 JSON 이 아니면 붙기 전에 막는다', async () => {
    const out = await open(server, 'Ticker/Watch', 'server-stream', '{{{')
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toContain('JSON')
  })

  it('**사유를 실값이 아니라 가린 쪽에서 만든다** — 파서 오류는 입력 조각을 싣는다', async () => {
    const out = await openGrpcStream(
      {
        target: target(server.url),
        method: 'Ticker/Watch',
        declaredShape: 'server-stream',
        headers: {},
        body: '{"t": sk_live_SECRET}',
        displayBody: '{"t": ••••}'
      },
      collector().cb
    )
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).not.toContain('sk_live_SECRET')
  })

  it('**선언에 없는 칸은 보내지 않고 이름을 짚는다** — protobuf 는 그걸 조용히 버린다', async () => {
    // 그대로 보내면 빈 메시지가 나가고 기록에는 보낸 것으로 남아, 원인을 되짚을 수 없다.
    const out = await open(server, 'Ticker/Watch', 'server-stream', '{"cont":3}')
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toContain('cont')
  })

  it('양방향 보내기에서도 모르는 칸을 짚는다', async () => {
    const out = await open(server, 'Ticker/Chat', 'duplex', '')
    if (!out.ok) throw new Error(out.reason)
    expect(() => out.handle.send('{"junk":1}', '{"junk":1}')).toThrow(/junk/)
    out.handle.close()
  })

  it('**인코딩 실패를 서버 탓으로 적지 않는다** — 바이트가 한 번도 안 나갔다', async () => {
    // gRPC-js 는 직렬화 실패도 콜 오류(INTERNAL)로 돌려준다. 서버가 끊었다고 적으면
    // 사용자가 엉뚱한 곳을 보고, 자동 재접속까지 돌아 오타 한 번에 연결이 죽는다.
    const c = collector()
    const out = await open(server, 'Ticker/Chat', 'duplex', '', c.cb)
    if (!out.ok) throw new Error(out.reason)
    const ended = c.waitForEnd(out)
    // 선언에 있는 칸(`who` 는 메시지)에 글자를 넣는다 → 우리 쪽 인코딩 실패.
    out.handle.send('{"who":"bob"}', '{"who":"bob"}')
    const reason = await ended
    expect(reason).toContain('서버 정의대로 만들 수 없어')
    expect(reason).not.toContain('서버가 스트림을 끊었습니다')
  })
})

describe('정의를 못 받으면 전송도 안 연다', () => {
  let server: TestServer

  beforeAll(async () => {
    server = (await startGrpcServer({ reflection: false })) as TestServer
  })
  afterAll(async () => await server.stop())

  it('**붙어 놓고 아무것도 못 읽는 상태를 만들지 않는다**', async () => {
    const c = collector()
    const out = await open(server, 'Ticker/Watch', 'server-stream', '{}', c.cb)
    expect(out.ok).toBe(false)
    if (out.ok) return
    // "연결됨인데 아무것도 안 옴"이 되면 사용자는 서버를 의심한다.
    expect(c.opened).toBe(0)
    expect(out.reason).toContain('붙지 않습니다')
  })
})
