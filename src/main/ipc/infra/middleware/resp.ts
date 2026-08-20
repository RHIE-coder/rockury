/**
 * RESP(Redis 통신 규약) 부호화·해독 — **순수 로직**.
 *
 * 왜 클라이언트 라이브러리를 안 쓰나: 프로젝트 규칙이 네이티브 모듈을 금지하고, 의존성 추가는
 * `main` 브랜치에서 한 사람만 한다. RESP2 는 접두 바이트 다섯 개짜리 규약이라 직접 읽는 편이
 * 의존성 하나를 늘리는 것보다 싸고, **무엇보다 이 부분이 전부 테스트 가능해진다.**
 *
 * 명령을 **길이 붙은 벌크 문자열**로 보내므로 값에 줄바꿈이 있어도 명령이 쪼개지지 않는다 —
 * CLI 쪽의 "셸을 거치지 않는다"와 같은 성질을 여기서도 지킨다.
 */

/** 해독된 응답 하나. 오류는 값과 섞이지 않게 따로 감싼다. */
export type RespValue = string | number | null | RespError | RespValue[]

export interface RespError {
  error: string
}

export const isRespError = (v: unknown): v is RespError =>
  typeof v === 'object' && v !== null && typeof (v as RespError).error === 'string'

const CRLF = '\r\n'

/** 명령 하나를 RESP 배열로. 인자는 전부 벌크 문자열이라 내용이 규약을 흔들지 못한다. */
export function encodeCommand(args: string[]): Buffer {
  const parts = [Buffer.from(`*${args.length}${CRLF}`, 'utf8')]
  for (const a of args) {
    const body = Buffer.from(a, 'utf8')
    // 길이는 **바이트 수**다 — 글자 수로 세면 한글·이모지에서 서버가 못 읽는다.
    parts.push(Buffer.from(`$${body.length}${CRLF}`, 'utf8'), body, Buffer.from(CRLF, 'utf8'))
  }
  return Buffer.concat(parts)
}

export interface Decoded {
  value: RespValue
  /** 이 응답 뒤에 남은 바이트 — 한 조각에 응답이 여럿 붙어 올 수 있다. */
  rest: Buffer
}

/** 줄 하나(CRLF 까지)의 끝 위치. 없으면 -1. */
function lineEnd(buf: Buffer, from: number): number {
  for (let i = from; i + 1 < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) return i
  }
  return -1
}

/**
 * 앞에서 응답 **하나**를 읽는다. 아직 덜 왔으면 `null` — 다음 조각을 기다려야 한다.
 * 모르는 접두 바이트는 던진다: 조용히 넘기면 그다음부터 응답 경계가 전부 어긋난다.
 */
export function decodeResp(buf: Buffer): Decoded | null {
  const r = decodeAt(buf, 0)
  if (!r) return null
  return { value: r.value, rest: buf.subarray(r.next) }
}

function decodeAt(buf: Buffer, at: number): { value: RespValue; next: number } | null {
  if (at >= buf.length) return null
  const kind = String.fromCharCode(buf[at])
  const end = lineEnd(buf, at + 1)
  if (end < 0) return null
  const head = buf.subarray(at + 1, end).toString('utf8')
  const afterHead = end + 2

  if (kind === '+') return { value: head, next: afterHead }
  if (kind === '-') return { value: { error: head }, next: afterHead }
  if (kind === ':') return { value: Number(head), next: afterHead }

  if (kind === '$') {
    const len = Number(head)
    if (len === -1) return { value: null, next: afterHead }
    const stop = afterHead + len
    // 본문 + 끝 CRLF 까지 다 와야 한다. 본문만 왔으면 아직 이르다.
    if (buf.length < stop + 2) return null
    return { value: buf.subarray(afterHead, stop).toString('utf8'), next: stop + 2 }
  }

  if (kind === '*') {
    const count = Number(head)
    if (count === -1) return { value: null, next: afterHead }
    const items: RespValue[] = []
    let cursor = afterHead
    for (let i = 0; i < count; i++) {
      const item = decodeAt(buf, cursor)
      if (!item) return null // 배열 원소가 덜 왔다 — 통째로 다시 기다린다
      items.push(item.value)
      cursor = item.next
    }
    return { value: items, next: cursor }
  }

  throw new Error(`알 수 없는 RESP 접두 바이트 '${kind}' — 응답을 읽을 수 없습니다.`)
}

/**
 * 화면 콘솔에 뿌릴 한 덩어리로 편다.
 * **없음(nil)과 빈 문자열을 구분한다** — 둘을 같게 보이면 "키가 없다"와 "값이 비었다"를 못 가른다.
 */
export function flattenReply(value: RespValue, depth = 0): string {
  const pad = '  '.repeat(depth)
  if (value === null) return `${pad}(nil)`
  if (isRespError(value)) return `${pad}(error) ${value.error}`
  if (Array.isArray(value)) {
    // 목록의 원소는 **그 목록과 같은 깊이**로 적는다. 깊이는 목록이 목록을 담을 때만 늘린다 —
    // 안 그러면 평범한 `KEYS` 결과가 통째로 한 칸 밀려 들여쓰기가 뜻을 잃는다.
    return value.map((v) => flattenReply(v, Array.isArray(v) ? depth + 1 : depth)).join('\n')
  }
  return `${pad}${String(value)}`
}

/**
 * `INFO` 응답(`# 절` + `키:값` 줄)을 절별 지도로.
 * 절 밖에 나온 칸은 **버리지 않고 `기타` 로 담는다** — 조용히 빼면 화면이 거짓말을 한다.
 */
export function parseInfo(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  let section = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      section = line.replace(/^#\s*/, '')
      out[section] ??= {}
      continue
    }
    const at = line.indexOf(':')
    if (at < 0) continue
    const key = line.slice(0, at)
    const value = line.slice(at + 1) // 첫 콜론만 나눈다 — 값에 콜론이 있을 수 있다(주소)
    const bucket = section || '기타'
    out[bucket] ??= {}
    out[bucket][key] = value
  }
  return out
}
