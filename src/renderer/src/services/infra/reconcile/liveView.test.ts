import { describe, it, expect } from 'vitest'
import { agoLabel } from './LiveView'
import { checkedTypesOf, type SnapshotSummary } from '../store'

describe('agoLabel — "○분 전 기준"', () => {
  const now = Date.parse('2026-07-28T12:00:00.000Z')
  const at = (msAgo: number): string => new Date(now - msAgo).toISOString()

  it('CASE-iarch-081 방금·분·시간·일 단위로 나눠 말한다', () => {
    expect(agoLabel(at(5_000), now)).toBe('방금 기준')
    expect(agoLabel(at(3 * 60_000), now)).toBe('3분 전 기준')
    expect(agoLabel(at(2 * 3600_000), now)).toBe('2시간 전 기준')
    expect(agoLabel(at(3 * 86_400_000), now)).toBe('3일 전 기준')
  })

  it('CASE-iarch-081 언제나 "기준"이라고 말한다 — 실시간처럼 보이지 않게', () => {
    for (const ms of [0, 60_000, 3600_000, 86_400_000]) {
      expect(agoLabel(at(ms), now)).toContain('기준')
    }
  })

  it('시각이 깨졌거나 미래면 모른다고 말한다 — 그럴듯한 값을 지어내지 않는다', () => {
    expect(agoLabel('말도 안 되는 값', now)).toBe('기준 시각 알 수 없음')
    expect(agoLabel(new Date(now + 60_000).toISOString(), now)).toBe('기준 시각 알 수 없음')
  })
})

describe('checkedTypesOf — 무엇을 실제로 읽었나', () => {
  const snap = (probes: SnapshotSummary['probes']): SnapshotSummary => ({
    providerId: 'p',
    takenAt: '2026-07-28T12:00:00.000Z',
    ok: probes.every((p) => p.ok),
    probes,
    resources: []
  })

  it('CASE-iarch-034 성공한 탐침의 종류만 "읽었다"로 친다', () => {
    const s = checkedTypesOf(
      snap([
        { typeId: 'a', ok: true, count: 0, error: '' },
        { typeId: 'b', ok: false, count: 0, error: '권한 없음' }
      ])
    )
    // 0건이어도 읽은 것은 읽은 것이다(→ 미구축 판정 가능).
    expect(s.has('a')).toBe(true)
    // 못 읽은 것은 판정 근거가 없다(→ 대조 안 함).
    expect(s.has('b')).toBe(false)
  })

  it('스냅샷이 없으면 아무것도 안 읽은 것이다', () => {
    expect(checkedTypesOf(null).size).toBe(0)
  })
})
