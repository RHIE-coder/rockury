import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { decodeFrame, encodeFrame, WS_GUID } from './wsFrames.mjs'

/**
 * 검사용 GraphQL 구독 서버 — **규약 손잡기를 진짜로 하는** 서버다.
 *
 * 왜 진짜로 세우나: 이 기능의 알맹이가 "손잡기를 해야 서버가 보내기 시작한다"는 것이라,
 * 손잡기를 안 보는 가짜에 붙이면 정작 검사하려는 부분이 통째로 빠진다.
 * 그래서 이 서버는 규약대로만 답한다 — `connection_init` 을 받아야 `connection_ack` 을 주고,
 * `subscribe` 를 받아야 `next` 를 흘린다. **순서를 어기면 끊는다**(진짜 서버가 그렇게 한다).
 *
 * 포트는 언제나 0(운영체제가 골라 준다) — 고정 포트를 잡으면 옆 워크트리의 검사를 깨뜨린다.
 *
 * @param {{ protocol?: string, rejectSubscribe?: string,
 *           requireToken?: string, ping?: boolean }} [options]
 *   `protocol` 을 다른 이름으로 두면 **하위 프로토콜이 안 맞는 서버**가 된다(옛 판 흉내).
 */
export async function startGraphqlWsServer(options = {}) {
  const {
    protocol = 'graphql-transport-ws',
    rejectSubscribe = null,
    /** 참이면 `complete` 를 안 보낸다 — **사용자가 끊어야** 끝나는 구독을 흉내 낸다. */
    endless = false,
    /** 손잡기 뒤 곧바로 끊는다 — 자동 재접속이 실제로 도는지 보는 데 쓴다. */
    dropAfterAck = false,
    /** 우리가 안 연 구독의 결과를 섞어 보낸다 — 남의 데이터를 우리 관측으로 세는지 본다. */
    foreignId = false,
    /** 손잡기 전에 규약에 없는 글자를 흘린다 — 소음 상한에 닿는지 본다. */
    preAckNoise = 0,
    requireToken = null,
    ping = false
  } = options

  /** 서버가 받은 것 — 검사가 "우리가 진짜 무엇을 보냈나"를 볼 수 있게 남긴다. */
  const received = []
  /**
   * 업그레이드된 소켓을 **우리가 들고 있는다.**
   *
   * `upgrade` 로 넘겨받은 소켓은 http 서버의 관리 밖이라 `server.close()` 가 안 닫는다 —
   * 그런데 살아 있는 동안 이벤트 루프를 붙들어서 **검사 프로세스가 안 끝난다**(실측:
   * 체크는 전부 통과했는데 러너가 18분을 매달려 있었다). 우리가 닫는다.
   */
  const sockets = new Set()

  const server = createServer((_req, res) => {
    res.writeHead(426)
    res.end('upgrade required')
  })

  server.on('upgrade', (req, socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    // 소켓 오류를 안 받으면 프로세스가 통째로 죽는다(unhandled 'error').
    socket.on('error', () => sockets.delete(socket))
    const key = req.headers['sec-websocket-key']
    const asked = String(req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((s) => s.trim())
    received.push({ kind: 'upgrade', protocols: asked })

    const accept = createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64')
    // 우리가 아는 이름을 요청했을 때만 그 이름으로 합의한다 — 안 맞으면 규약을 안 켠다.
    const agreed = asked.includes(protocol) ? protocol : null
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        (agreed ? `Sec-WebSocket-Protocol: ${agreed}\r\n` : '') +
        '\r\n'
    )

    const send = (obj) => socket.write(encodeFrame(JSON.stringify(obj)))
    // 손잡기 전에 규약에 없는 글자를 흘린다.
    for (let i = 0; i < preAckNoise; i += 1) socket.write(encodeFrame(`쓰레기-${i}`))
    let acked = false
    let timer = null

    // **규약 이름이 안 맞으면 규약을 안 켠다.** 소켓은 열리지만 아무 말도 안 하고 곧 닫는다 —
    // 구독을 안 켠 GraphQL 서버가 실제로 그렇게 보인다(그래서 "붙었는데 아무것도 안 옴"이 된다).
    if (!agreed) {
      setTimeout(() => socket.end(), 200)
      return
    }

    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }

    let buf = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        const frame = decodeFrame(buf)
        if (!frame) break
        buf = buf.subarray(frame.size)
        if (frame.opcode === 0x8) {
          stop()
          socket.end()
          return
        }
        if (frame.opcode !== 0x1) continue

        let msg
        try {
          msg = JSON.parse(frame.text)
        } catch {
          continue
        }
        received.push(msg)

        if (msg.type === 'connection_init') {
          if (requireToken && msg.payload?.authorization !== requireToken) {
            // 손잡기를 안 해 주고 끊는다(진짜 서버는 4401 close 코드를 쓰지만,
            // 검사에 필요한 것은 "손을 안 잡아 준다"는 사실뿐이다).
            stop()
            socket.end()
            return
          }
          acked = true
          send({ type: 'connection_ack' })
          if (dropAfterAck) {
            stop()
            setTimeout(() => socket.end(), 30)
            continue
          }
          // 이미 걸린 것을 안 지우면 소켓이 죽은 뒤에도 계속 write 를 시도해 프로세스가 안 끝난다.
          stop()
          if (ping) timer = setInterval(() => send({ type: 'ping' }), 120)
          continue
        }

        if (msg.type === 'subscribe') {
          // **손잡기 전에 구독을 보내면 끊는다** — 진짜 서버가 그렇게 한다.
          if (!acked) {
            stop()
            socket.end()
            return
          }
          if (rejectSubscribe) {
            send({ id: msg.id, type: 'error', payload: [{ message: rejectSubscribe }] })
            continue
          }
          // 우리가 안 연 이름으로 먼저 하나 보낸다 — 세면 안 되는 것이다.
          if (foreignId) send({ id: '99', type: 'next', payload: { data: { other: '남의것' } } })
          const room = msg.payload?.variables?.room ?? 'general'
          for (let i = 1; i <= 2; i += 1) {
            send({
              id: msg.id,
              type: 'next',
              payload: { data: { messageAdded: { id: `m${i}`, text: `안녕-${room}-${i}` } } }
            })
          }
          if (!endless) send({ id: msg.id, type: 'complete' })
          continue
        }

        if (msg.type === 'complete') {
          stop()
          continue
        }
      }
    })
    socket.on('error', () => stop())
    socket.on('close', () => stop())
  })

  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    received,
    stop: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy()
        sockets.clear()
        server.closeAllConnections?.()
        // 콜백을 기다리지 않는다 — 소켓을 이미 다 끊었고, 기다리면 안 끝나는 자리가 남는다.
        server.close()
        resolve()
      })
  }
}
