import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqlSaver } from './autosave'

/**
 * 자동저장기 회귀 — 2026-08-12 "저장한 쿼리가 사라진다" 사고.
 * 핵심은 둘: **예약 없이는 절대 안 쓴다**(= 여는 것은 쓰기가 아니다)와
 * **넘어가기 전 밀어내면 남은 편집분이 저장된다**.
 */
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createSqlSaver', () => {
  it('연달아 고치면 마지막 것 한 번만 쓴다', async () => {
    const save = vi.fn(async () => {})
    const s = createSqlSaver(save, 1000)
    s.schedule('q1', 'SELECT 1')
    s.schedule('q1', 'SELECT 12')
    s.schedule('q1', 'SELECT 123')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('q1', 'SELECT 123')
  })

  it('늦춤 시간 전에는 안 쓴다', async () => {
    const save = vi.fn(async () => {})
    const s = createSqlSaver(save, 1000)
    s.schedule('q1', 'SELECT 1')
    await vi.advanceTimersByTimeAsync(999)
    expect(save).not.toHaveBeenCalled()
  })

  it('⭐ 예약이 없으면 밀어내도 아무것도 안 쓴다 — 쿼리를 여는 것은 쓰기가 아니다', async () => {
    const save = vi.fn(async () => {})
    const s = createSqlSaver(save, 1000)
    await s.flush()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
  })

  it('⭐ 늦춤 시간 안에 밀어내면 그 편집분이 저장된다 — 넘어가며 잃지 않는다', async () => {
    const save = vi.fn(async () => {})
    const s = createSqlSaver(save, 1000)
    s.schedule('q1', '고치던 글')
    await s.flush()
    expect(save).toHaveBeenCalledWith('q1', '고치던 글')
  })

  it('밀어낸 뒤 타이머가 돌아도 두 번 쓰지 않는다', async () => {
    const save = vi.fn(async () => {})
    const s = createSqlSaver(save, 1000)
    s.schedule('q1', 'SELECT 1')
    await s.flush()
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('다른 쿼리를 예약하면 앞의 것을 먼저 쓴다 — 뒤엣것이 앞엣것을 삼키지 않는다', async () => {
    const save = vi.fn(async () => {})
    const s = createSqlSaver(save, 1000)
    s.schedule('q1', 'q1 의 글')
    s.schedule('q2', 'q2 의 글')
    expect(save).toHaveBeenCalledWith('q1', 'q1 의 글')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledWith('q2', 'q2 의 글')
    expect(save).toHaveBeenCalledTimes(2)
  })
})
