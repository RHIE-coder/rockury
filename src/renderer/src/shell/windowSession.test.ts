import { describe, expect, it, vi } from 'vitest'
import { readOnlyStorage } from './windowSession'

describe('readOnlyStorage — 떼어낸 창은 읽기만 한다', () => {
  it('읽기는 그대로 지나가고 쓰기·지우기는 삼킨다', () => {
    const inner = {
      getItem: vi.fn(() => '{"a":1}'),
      setItem: vi.fn(),
      removeItem: vi.fn()
    }
    const ro = readOnlyStorage(inner)

    expect(ro.getItem('rockury.nav')).toBe('{"a":1}')
    ro.setItem('rockury.nav', '{"a":2}')
    ro.removeItem('rockury.nav')

    expect(inner.getItem).toHaveBeenCalledWith('rockury.nav')
    // 첫 창의 대상 선택(설계·프로젝트 범위)을 덮어쓰지 않는다는 것이 이 껍데기의 존재 이유다.
    expect(inner.setItem).not.toHaveBeenCalled()
    expect(inner.removeItem).not.toHaveBeenCalled()
  })
})
