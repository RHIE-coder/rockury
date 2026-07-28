import { describe, it, expect } from 'vitest'
import { toStatus } from './status'

describe('toStatus — 상태 사전', () => {
  const map = { running: 'ok', pending: 'warn', stopped: 'stopped', terminated: 'gone' } as const

  it('CASE-icat-020 사전에 있는 값은 다섯 칸으로 옮겨진다', () => {
    expect(toStatus('running', map).status).toBe('ok')
    expect(toStatus('pending', map).status).toBe('warn')
    expect(toStatus('stopped', map).status).toBe('stopped')
    expect(toStatus('terminated', map).status).toBe('gone')
  })

  it('CASE-icat-021 사전에 없는 값은 정상이 아니라 모름이고, 원본이 보존된다', () => {
    const r = toStatus('rebooting', map)
    expect(r.status).toBe('unknown')
    expect(r.raw).toBe('rebooting')
  })

  it('CASE-icat-022 상태 필드가 없거나 비면 모름', () => {
    expect(toStatus(undefined, map).status).toBe('unknown')
    expect(toStatus('', map).status).toBe('unknown')
    expect(toStatus(null, map).status).toBe('unknown')
  })

  it('CASE-icat-022 사전 자체가 없으면 전부 모름 — 임의로 정상으로 치지 않는다', () => {
    expect(toStatus('running', undefined).status).toBe('unknown')
    expect(toStatus('running', undefined).raw).toBe('running')
  })

  it('문자열이 아닌 값도 원본을 문자열로 남긴다', () => {
    expect(toStatus(3, map).status).toBe('unknown')
    expect(toStatus(3, map).raw).toBe('3')
    expect(toStatus(true, map).raw).toBe('true')
  })

  it('대소문자가 달라도 맞춘다 — 공급자마다 표기가 갈린다', () => {
    expect(toStatus('RUNNING', map).status).toBe('ok')
    expect(toStatus('Running', map).status).toBe('ok')
    // 원본 표기는 그대로 남는다.
    expect(toStatus('RUNNING', map).raw).toBe('RUNNING')
  })
})
