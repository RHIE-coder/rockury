import { createServer, type Server } from 'node:http'
import { suggestPort } from '../../shared/api/inbox'

/**
 * 모의(가짜) 서버 — `docs/spec/api-studio.md` § mocking.server.
 *
 * Inbox 수신 서버와 같은 규율을 그대로 쓴다:
 *   · **`127.0.0.1` 에만 바인딩**한다(호스트를 바꿀 손잡이가 없다)
 *   · 앱을 켤 때 **꺼짐으로 시작**한다 — 모르는 새 포트가 열려 있지 않게
 *   · 포트가 쓰이면 **몰래 옮겨 붙지 않고** 사유와 제안을 준다
 *
 * 다른 점 하나: Inbox 는 남이 보낸 것을 **받아 적고**, 여기는 우리가 선언한 것을 **되돌려준다.**
 * 그래서 여기는 관측 기록을 안 만든다 — 우리가 만든 가짜를 관측으로 쌓으면 판정이 거짓이 된다.
 */

export interface MockReply {
  status: number
  headers: Record<string, string>
  body: string
}

export interface MockHandlers {
  /** 들어온 요청 하나 → 무엇으로 답하나. 판단은 전부 호출부(순수 규칙)가 한다. */
  onRequest: (req: { method: string; path: string }) => MockReply
}

export interface MockState {
  listening: boolean
  port: number | null
}

let server: Server | null = null
let currentPort: number | null = null

export function mockState(): MockState {
  return { listening: server !== null, port: currentPort }
}

export class MockPortInUseError extends Error {
  constructor(port: number, suggestion: number | null) {
    super(
      suggestion === null
        ? `포트 ${port} 를 이미 다른 프로그램이 쓰고 있습니다. 가까운 빈 포트를 못 찾았습니다.`
        : `포트 ${port} 를 이미 다른 프로그램이 쓰고 있습니다 — ${suggestion} 은 어떨까요?`
    )
  }
}

export async function startMock(port: number, handlers: MockHandlers): Promise<MockState> {
  await stopMock()

  const s = createServer((req, res) => {
    // 본문은 안 읽는다 — 가짜 응답은 **선언한 모양**에서만 나오므로 들어온 본문이 결과를
    // 바꾸지 않는다. 읽는 척하면 "본문에 따라 달라지나" 하고 기대하게 된다.
    req.resume()
    req.on('end', () => {
      const reply = handlers.onRequest({ method: req.method ?? 'GET', path: req.url ?? '/' })
      res.writeHead(reply.status, reply.headers)
      res.end(reply.body)
    })
  })

  await new Promise<void>((resolve, reject) => {
    s.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new MockPortInUseError(port, suggestPort(port, () => false)))
        return
      }
      reject(err)
    })
    // **로컬 전용** — 이 인자를 바꾸면 화면 문구가 거짓이 된다.
    s.listen(port, '127.0.0.1', () => resolve())
  })

  server = s
  currentPort = port
  return mockState()
}

export async function stopMock(): Promise<MockState> {
  const s = server
  server = null
  currentPort = null
  if (!s) return mockState()
  await new Promise<void>((resolve) => s.close(() => resolve()))
  return mockState()
}
