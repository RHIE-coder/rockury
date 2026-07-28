import { describe, it, expect } from 'vitest'
import { decodeResp, encodeCommand, flattenReply, parseInfo } from './resp'

const buf = (s: string): Buffer => Buffer.from(s, 'utf8')

describe('encodeCommand — 명령을 RESP 배열로', () => {
  it('CASE-imw-001 명령과 인자를 벌크 문자열 배열로 감싼다', () => {
    expect(encodeCommand(['PING']).toString()).toBe('*1\r\n$4\r\nPING\r\n')
  })

  it('CASE-imw-001 인자 여러 개도 각각 길이가 붙는다', () => {
    expect(encodeCommand(['GET', 'a']).toString()).toBe('*2\r\n$3\r\nGET\r\n$1\r\na\r\n')
  })

  it('공백·줄바꿈이 든 인자도 길이로 감싸므로 명령이 쪼개지지 않는다 — 명령 주입이 성립하지 않는다', () => {
    // 'a b\r\nQUIT' 는 9바이트 — 길이가 앞에 붙으므로 안의 CRLF 가 구분자로 읽히지 않는다.
    const out = encodeCommand(['SET', 'k', 'a b\r\nQUIT']).toString()
    expect(out).toBe('*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$9\r\na b\r\nQUIT\r\n')
  })

  it('한글은 바이트 길이로 센다 — 글자 수로 세면 서버가 못 읽는다', () => {
    // '가' 는 UTF-8 3바이트.
    expect(encodeCommand(['SET', 'k', '가']).toString()).toContain('$3\r\n가\r\n')
  })

  it('빈 인자도 길이 0 으로 보낸다(값이 빈 문자열인 경우)', () => {
    expect(encodeCommand(['SET', 'k', '']).toString()).toContain('$0\r\n\r\n')
  })
})

describe('decodeResp — 한 응답을 읽고 남은 바이트를 돌려준다', () => {
  it('CASE-imw-002 단순 문자열', () => {
    expect(decodeResp(buf('+PONG\r\n'))).toEqual({ value: 'PONG', rest: Buffer.alloc(0) })
  })

  it('CASE-imw-002 오류는 값이 아니라 오류로 표시된다 — 성공으로 섞이면 안 된다', () => {
    const r = decodeResp(buf('-ERR unknown command\r\n'))
    expect(r?.value).toEqual({ error: 'ERR unknown command' })
  })

  it('CASE-imw-002 정수', () => {
    expect(decodeResp(buf(':42\r\n'))?.value).toBe(42)
  })

  it('CASE-imw-002 벌크 문자열', () => {
    expect(decodeResp(buf('$5\r\nhello\r\n'))?.value).toBe('hello')
  })

  it('CASE-imw-002 빈 벌크 문자열과 없음(null)을 구분한다', () => {
    expect(decodeResp(buf('$0\r\n\r\n'))?.value).toBe('')
    expect(decodeResp(buf('$-1\r\n'))?.value).toBeNull()
  })

  it('CASE-imw-002 벌크 안의 CRLF 를 길이로 읽는다 — 구분자로 읽으면 값이 잘린다', () => {
    // 본문 'a\r\nb' 는 4바이트다. 구분자로 읽으면 'a' 에서 끊긴다.
    expect(decodeResp(buf('$4\r\na\r\nb\r\n'))?.value).toBe('a\r\nb')
  })

  it('CASE-imw-002 배열', () => {
    expect(decodeResp(buf('*2\r\n$1\r\na\r\n:7\r\n'))?.value).toEqual(['a', 7])
  })

  it('중첩 배열도 읽는다(CONFIG·XINFO 응답 모양)', () => {
    expect(decodeResp(buf('*1\r\n*2\r\n$1\r\na\r\n$1\r\nb\r\n'))?.value).toEqual([['a', 'b']])
  })

  it('빈 배열과 없음(null 배열)을 구분한다', () => {
    expect(decodeResp(buf('*0\r\n'))?.value).toEqual([])
    expect(decodeResp(buf('*-1\r\n'))?.value).toBeNull()
  })

  it('CASE-imw-003 덜 온 데이터에는 null 을 돌려준다 — 다음 조각을 기다려야 한다', () => {
    expect(decodeResp(buf('+PON'))).toBeNull()
    expect(decodeResp(buf('$5\r\nhel'))).toBeNull()
    expect(decodeResp(buf('*2\r\n$1\r\na\r\n'))).toBeNull()
    expect(decodeResp(buf('$5\r\nhello'))).toBeNull() // 끝 CRLF 가 아직 안 왔다
  })

  it('CASE-imw-003 응답 둘이 한 조각에 붙어 와도 첫 하나만 읽고 나머지를 남긴다', () => {
    const r = decodeResp(buf('+A\r\n+B\r\n'))
    expect(r?.value).toBe('A')
    expect(r?.rest.toString()).toBe('+B\r\n')
  })

  it('모르는 첫 바이트는 오류로 세운다 — 조용히 넘기면 그다음 응답 경계가 다 어긋난다', () => {
    expect(() => decodeResp(buf('?x\r\n'))).toThrow()
  })
})

describe('flattenReply — 화면에 보일 한 덩어리로', () => {
  it('CASE-imw-004 배열은 줄로 펴고, 없음은 (nil) 로 적는다 — 빈 문자열과 구분된다', () => {
    expect(flattenReply(['a', null, 3])).toBe('a\n(nil)\n3')
    expect(flattenReply('')).toBe('')
  })

  it('CASE-imw-004 오류는 오류라고 적는다', () => {
    expect(flattenReply({ error: 'ERR nope' })).toBe('(error) ERR nope')
  })

  it('중첩 배열은 들여쓴다', () => {
    expect(flattenReply([['a', 'b']])).toBe('  a\n  b')
  })

  it('숫자·null 단독도 문자열이 된다', () => {
    expect(flattenReply(7)).toBe('7')
    expect(flattenReply(null)).toBe('(nil)')
  })
})

describe('parseInfo — INFO 응답을 칸으로', () => {
  const INFO = [
    '# Server',
    'redis_version:7.2.5',
    'uptime_in_seconds:120',
    '',
    '# Clients',
    'connected_clients:3',
    '# Memory',
    'used_memory_human:1.02M'
  ].join('\r\n')

  it('CASE-imw-005 절과 칸을 갈라 읽는다', () => {
    const r = parseInfo(INFO)
    expect(r.Server.redis_version).toBe('7.2.5')
    expect(r.Clients.connected_clients).toBe('3')
    expect(r.Memory.used_memory_human).toBe('1.02M')
  })

  it('빈 줄·주석만 있는 입력에도 죽지 않는다', () => {
    expect(parseInfo('')).toEqual({})
    expect(parseInfo('# Only\r\n')).toEqual({ Only: {} })
  })

  it('절 밖에 나온 칸은 버리지 않고 기타로 담는다 — 조용한 누락 금지', () => {
    expect(parseInfo('lonely:1')).toEqual({ 기타: { lonely: '1' } })
  })

  it('값에 콜론이 있어도 첫 콜론만 나눈다(주소 값 등)', () => {
    expect(parseInfo('# S\r\naddr:127.0.0.1:6379')).toEqual({ S: { addr: '127.0.0.1:6379' } })
  })
})
