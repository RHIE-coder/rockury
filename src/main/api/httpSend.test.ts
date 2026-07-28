import { describe, expect, it } from 'vitest'
import { classifyFailure, sendHttp } from './httpSend'

/** 실패 갈래 나누기 — `docs/qa/api-runner.md` CASE-apirunner-023 (execute AC-4). */

const errWith = (code: string, name = 'TypeError'): unknown =>
  Object.assign(new Error('fetch failed'), { name, cause: { code } })

describe('CASE-apirunner-023 오류 분류 — "실패" 로 뭉뚱그리지 않는다', () => {
  it('연결 실패', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTUNREACH']) {
      expect(classifyFailure(errWith(code)).status, code).toBe('connect-failed')
    }
  })

  it('시간 초과', () => {
    expect(classifyFailure(errWith('ETIMEDOUT')).status).toBe('timeout')
    expect(classifyFailure(errWith('UND_ERR_CONNECT_TIMEOUT')).status).toBe('timeout')
  })

  it('인증서 오류는 연결 실패와 따로 센다 — 고치는 방법이 다르다', () => {
    for (const code of [
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    ]) {
      expect(classifyFailure(errWith(code)).status, code).toBe('tls-error')
    }
  })

  it('취소와 시간 초과는 같은 AbortError 로 오지만 갈래가 다르다', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(classifyFailure(abort, 'user').status).toBe('cancelled')
    expect(classifyFailure(abort, 'timeout').status).toBe('timeout')
  })

  it('코드가 없는 실패도 "붙지 못함" 으로 본다 — 응답을 못 받은 건 같다', () => {
    expect(classifyFailure(new Error('무언가 잘못됨')).status).toBe('connect-failed')
    expect(classifyFailure(undefined).status).toBe('connect-failed')
  })

  it('모든 갈래에 사람이 읽을 이유가 붙는다', () => {
    expect(classifyFailure(errWith('ECONNREFUSED')).message).toMatch(/붙지 못/)
    expect(classifyFailure(errWith('CERT_HAS_EXPIRED')).message).toMatch(/인증서/)
  })
})

describe('전송 — 붙었는데 4xx 인 것은 실패가 아니다', () => {
  it('못 붙으면 connect-failed 이고 응답이 없다', async () => {
    // 예약된 테스트용 주소(RFC 6761 `.invalid`) — 실제로 나가지 않는다.
    const r = await sendHttp({
      method: 'GET',
      url: 'http://rockury-e2e.invalid/none',
      headers: {},
      body: '',
      timeoutMs: 2_000
    })
    expect(['connect-failed', 'timeout']).toContain(r.status)
    expect(r.response).toBeNull()
    expect(r.error).toBeTruthy()
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('사용자 취소는 cancelled 로 남는다', async () => {
    const ac = new AbortController()
    const p = sendHttp({
      method: 'GET',
      url: 'http://rockury-e2e.invalid/none',
      headers: {},
      body: '',
      timeoutMs: 5_000,
      signal: ac.signal
    })
    ac.abort()
    expect((await p).status).toBe('cancelled')
  })
})
