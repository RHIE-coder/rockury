import { describe, expect, it } from 'vitest'
import { shouldFollowFocus, useRemoteFocusStore } from './focus'

const base = { focusId: 't:public.orders', currentId: 't:public.users', pendingCount: 0, hasOpenTx: false }

describe('shouldFollowFocus', () => {
  it('다른 표가 골라졌으면 따라간다', () => {
    expect(shouldFollowFocus(base)).toBe(true)
  })

  it('이미 그 표를 열고 있으면 다시 안 읽는다', () => {
    expect(shouldFollowFocus({ ...base, currentId: base.focusId })).toBe(false)
  })

  it('고른 것이 없으면 지금 보던 표를 그대로 둔다', () => {
    expect(shouldFollowFocus({ ...base, focusId: null })).toBe(false)
  })

  it('저장 안 한 변경이 있으면 안 따라간다 — 남의 편집을 조용히 버리지 않는다', () => {
    expect(shouldFollowFocus({ ...base, pendingCount: 2 })).toBe(false)
  })

  it('커밋 대기 트랜잭션이 열려 있으면 안 따라간다', () => {
    expect(shouldFollowFocus({ ...base, hasOpenTx: true })).toBe(false)
  })
})

describe('useRemoteFocusStore', () => {
  it('연결마다 따로 기억한다 — 같은 이름이어도 다른 DB 의 다른 표다', () => {
    const { setFocus } = useRemoteFocusStore.getState()
    setFocus('conn-a', 't:public.users')
    setFocus('conn-b', 't:public.orders')
    expect(useRemoteFocusStore.getState().byConn).toEqual({
      'conn-a': 't:public.users',
      'conn-b': 't:public.orders'
    })
  })

  it('연결이 없으면 아무 데도 안 적는다 — 어느 DB 의 표인지 모르는 값이 남으면 안 된다', () => {
    const before = { ...useRemoteFocusStore.getState().byConn }
    useRemoteFocusStore.getState().setFocus(null, 't:public.users')
    expect(useRemoteFocusStore.getState().byConn).toEqual(before)
  })

  it('고름을 풀면 빈 값으로 남는다', () => {
    useRemoteFocusStore.getState().setFocus('conn-a', null)
    expect(useRemoteFocusStore.getState().byConn['conn-a']).toBe('')
  })
})
