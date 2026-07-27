import { describe, expect, it } from 'vitest'
import { gateRequest } from './security'

/** MCP 요청 관문 판정 — 토큰·Origin·Host 3중 검증의 순수 로직. */

const TOKEN = 'a'.repeat(64)
const ok = { authorization: `Bearer ${TOKEN}`, host: '127.0.0.1:41729' }

describe('gateRequest', () => {
  it('로컬 Host + 올바른 토큰 + Origin 없음(CLI/에이전트) → 통과', () => {
    expect(gateRequest(ok, TOKEN)).toEqual({ ok: true })
  })

  it('localhost Host 도 통과', () => {
    expect(gateRequest({ ...ok, host: 'localhost:41729' }, TOKEN).ok).toBe(true)
  })

  it('토큰 불일치 → 401', () => {
    const r = gateRequest({ ...ok, authorization: 'Bearer wrong' }, TOKEN)
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  it('토큰 누락 → 401', () => {
    const r = gateRequest({ host: '127.0.0.1:41729' }, TOKEN)
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  it('Bearer 접두 없는 토큰 → 401 (정확 일치만 인정)', () => {
    const r = gateRequest({ ...ok, authorization: TOKEN }, TOKEN)
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  it('비로컬 Host(DNS 리바인딩) → 403 — 토큰이 맞아도 거부', () => {
    const r = gateRequest({ ...ok, host: 'evil.example.com:41729' }, TOKEN)
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('비로컬 Origin(브라우저 경유 공격) → 403 — 토큰이 맞아도 거부', () => {
    const r = gateRequest({ ...ok, origin: 'https://evil.example.com' }, TOKEN)
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('로컬 Origin(로컬 웹 도구) → 통과', () => {
    expect(gateRequest({ ...ok, origin: 'http://localhost:5173' }, TOKEN).ok).toBe(true)
    expect(gateRequest({ ...ok, origin: 'http://127.0.0.1:6274' }, TOKEN).ok).toBe(true)
  })

  it('파싱 불가 Origin → 403', () => {
    const r = gateRequest({ ...ok, origin: 'not-a-url' }, TOKEN)
    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it('Host 누락 → 403', () => {
    const r = gateRequest({ authorization: `Bearer ${TOKEN}` }, TOKEN)
    expect(r).toMatchObject({ ok: false, status: 403 })
  })
})
