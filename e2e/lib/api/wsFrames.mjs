/**
 * 최소 WebSocket 프레임 코덱(RFC 6455) — 검사용 서버가 함께 쓴다.
 *
 * 라이브러리를 안 쓰는 이유: **의존성 추가 금지**(`AGENTS.md` — `package.json` 은 `main` 에서
 * 한 명만 건드린다). 텍스트 프레임만 다루면 이 정도로 끝난다.
 *
 * 두 검사용 서버(WebSocket 에코 · GraphQL 구독)가 같은 코덱을 쓴다 — 각자 손으로 쓰면
 * 한쪽만 고치는 자리가 생기고, 프레이밍은 눈으로 틀린 걸 못 본다.
 *
 * 폴더가 `lib/api/` 인 이유는 `AGENTS.md` 의 서비스 접두어 규칙이다(공용 폴더에 서비스
 * 전용 파일을 접두어 없이 두면 남이 자기 것으로 여긴다).
 */

/** 손잡기 응답의 `Sec-WebSocket-Accept` 를 만드는 고정 문자열(규약이 정한 값). */
export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/**
 * 서버→클라이언트 텍스트 프레임(마스크 없음).
 * 길이가 125 를 넘으면 규약이 정한 확장 길이 칸을 쓴다 — 구독 응답은 쉽게 그보다 길다.
 */
export function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8')
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
  }
  if (payload.length < 65_536) {
    const head = Buffer.alloc(4)
    head[0] = 0x81
    head[1] = 126
    head.writeUInt16BE(payload.length, 2)
    return Buffer.concat([head, payload])
  }
  const head = Buffer.alloc(10)
  head[0] = 0x81
  head[1] = 127
  head.writeBigUInt64BE(BigInt(payload.length), 2)
  return Buffer.concat([head, payload])
}

/** 클라이언트→서버 프레임 해석. 클라이언트 프레임은 규약상 **항상 마스크**돼 있다. */
export function decodeFrame(buf) {
  if (buf.length < 2) return null
  const opcode = buf[0] & 0x0f
  const masked = (buf[1] & 0x80) !== 0
  let len = buf[1] & 0x7f
  let offset = 2
  if (len === 126) {
    if (buf.length < 4) return null
    len = buf.readUInt16BE(2)
    offset = 4
  } else if (len === 127) {
    if (buf.length < 10) return null
    len = Number(buf.readBigUInt64BE(2))
    offset = 10
  }
  const maskKey = masked ? buf.subarray(offset, offset + 4) : null
  if (masked) offset += 4
  if (buf.length < offset + len) return null
  const payload = Buffer.from(buf.subarray(offset, offset + len))
  if (maskKey) for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i % 4]
  return { opcode, text: payload.toString('utf8'), size: offset + len }
}
