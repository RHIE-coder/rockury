import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { suggestPort } from '../../shared/api/inbox'

/**
 * 로컬 웹훅 수신 서버 — `docs/spec/api-runner.md` § inbox.listener.
 *
 * 1차 범위는 **로컬 전용**이다(AC-3). `127.0.0.1` 에만 바인딩한다 — `0.0.0.0` 으로 열면
 * 같은 네트워크의 아무 기기가 이 창구에 닿고, 그 사실이 화면 문구("이 컴퓨터 안에서만
 * 닿습니다")와 어긋난다. 호스트를 바꿀 손잡이 자체를 두지 않는 것이 그 문구의 근거다.
 *
 * 앱을 켤 때 **꺼짐으로 시작한다**(AC-4) — 여기서 아무것도 자동으로 열지 않는다.
 * 모르는 새 포트가 열려 있는 상태를 만들지 않는 것이 그 규율이다.
 */

/** 본문 상한. 스트림과 같은 이유 — 남이 보내는 것이라 크기를 우리가 못 정한다. */
const MAX_BODY = 2 * 1024 * 1024
/** 화면·기록이 들고 있는 수신 건수 상한. 넘으면 오래된 것부터 버리고 **버렸다고 알린다**. */
const MAX_RECEIVED = 500

export interface InboxHandlers {
  /** 들어온 요청 하나. 대조·기록은 호출부가 한다(여기는 받아서 넘길 뿐). */
  onReceived: (raw: RawInbound) => { status: number }
}

export interface RawInbound {
  id: string
  at: string
  method: string
  path: string
  headers: Record<string, string>
  body: string
  size: number
  /** 상한을 넘겨 잘렸나 — 조용히 자르지 않는다. */
  truncated: boolean
}

export interface InboxState {
  listening: boolean
  port: number | null
}

let server: Server | null = null
let currentPort: number | null = null

export function inboxState(): InboxState {
  return { listening: server !== null, port: currentPort }
}

export class PortInUseError extends Error {
  constructor(
    public readonly port: number,
    public readonly suggestion: number | null
  ) {
    super(
      suggestion === null
        ? `포트 ${port} 를 이미 다른 프로그램이 쓰고 있습니다. 가까운 빈 포트를 못 찾았습니다.`
        : `포트 ${port} 를 이미 다른 프로그램이 쓰고 있습니다 — ${suggestion} 은 어떨까요?`
    )
  }
}

/**
 * 수신 대기를 켠다. 이미 켜져 있으면 먼저 끈다.
 * 포트가 쓰이는 중이면 **다른 포트로 몰래 옮기지 않고** 사유와 제안을 담아 던진다(AC-2) —
 * 주소를 이미 남에게 알려 줬을 수 있으므로 옮기는 판단은 사람이 한다.
 */
export async function startInbox(port: number, handlers: InboxHandlers): Promise<InboxState> {
  await stopInbox()

  const s = createServer((req, res) => {
    const chunks: Buffer[] = []
    let total = 0
    let truncated = false

    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > MAX_BODY) {
        truncated = true
        return
      }
      chunks.push(c)
    })

    req.on('end', () => {
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k] = Array.isArray(v) ? v.join(', ') : (v ?? '')
      }
      const raw: RawInbound = {
        id: `rcv_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        at: new Date().toISOString(),
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        headers,
        body: Buffer.concat(chunks).toString('utf8'),
        size: total,
        truncated
      }

      let status = 200
      try {
        status = handlers.onReceived(raw).status
      } catch {
        // 기록에 실패해도 **응답은 돌려준다** — 발신자를 우리 사정으로 재전송에 밀어 넣지 않는다
        // (단발 전송의 "기록은 부가물이지 관문이 아니다" 와 같은 규율).
        status = 200
      }
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(status >= 200 && status < 300 ? 'received by Rockury' : 'rejected by Rockury')
    })

    req.on('error', () => {
      // 끊긴 요청은 기록할 것이 없다. 응답도 못 보낸다.
    })
  })

  await new Promise<void>((resolve, reject) => {
    s.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // 우리가 쓰는 포트인지까지는 알 수 없다 — 다음 자리를 열어 보며 찾는다.
        reject(new PortInUseError(port, suggestPort(port, () => false)))
        return
      }
      reject(err)
    })
    // **로컬 전용** — 이 인자를 바꾸면 화면 문구가 거짓이 된다.
    s.listen(port, '127.0.0.1', () => resolve())
  })

  server = s
  currentPort = port
  return inboxState()
}

export async function stopInbox(): Promise<InboxState> {
  const s = server
  server = null
  currentPort = null
  if (!s) return inboxState()
  await new Promise<void>((resolve) => s.close(() => resolve()))
  return inboxState()
}

export { MAX_RECEIVED }
