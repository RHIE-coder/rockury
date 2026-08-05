import { describe, expect, it } from 'vitest'
import { ownerFor, visibleOwners } from './libraryOwner'

describe('ownerFor — 새로 만든 것이 어디 붙나', () => {
  it('설계로 물어보면 그 설계 것 — Design 화면', () => {
    expect(ownerFor({ designId: 'd1' })).toEqual({ kind: 'design', designId: 'd1' })
  })

  it('연결에 물린 설계가 하나면 그 설계 것 — DEV·STG·PROD 가 한 벌을 함께 본다', () => {
    expect(ownerFor({ connectionId: 'c1', boundDesignIds: ['d1'] })).toEqual({
      kind: 'design',
      designId: 'd1'
    })
  })

  it('물린 설계가 없으면 연결 것 — 설계를 안 쓰는 연결도 그대로 쓴다', () => {
    expect(ownerFor({ connectionId: 'c1', boundDesignIds: [] })).toEqual({
      kind: 'connection',
      connectionId: 'c1'
    })
  })

  it('물린 설계가 둘 이상이면 연결 것 — 조용히 한쪽을 고르면 남의 설계에 쿼리가 샌다', () => {
    expect(ownerFor({ connectionId: 'c1', boundDesignIds: ['d1', 'd2'] })).toEqual({
      kind: 'connection',
      connectionId: 'c1'
    })
  })

  it('설계를 직접 준 쪽이 이긴다 — 설계 화면에서 만든 것이 연결로 새면 안 된다', () => {
    expect(ownerFor({ connectionId: 'c1', designId: 'd9', boundDesignIds: ['d1'] })).toEqual({
      kind: 'design',
      designId: 'd9'
    })
  })

  it('아무것도 안 주면 붙일 자리가 없다', () => {
    expect(ownerFor({})).toBeNull()
  })
})

describe('visibleOwners — 화면에 보일 것들', () => {
  it('설계 화면은 그 설계 것만', () => {
    expect(visibleOwners({ designId: 'd1' })).toEqual([{ kind: 'design', designId: 'd1' }])
  })

  it('연결 화면은 물린 설계 것 + 그 연결만의 것 — 설계를 물려도 예전 쿼리가 안 사라진다', () => {
    expect(visibleOwners({ connectionId: 'c1', boundDesignIds: ['d1'] })).toEqual([
      { kind: 'design', designId: 'd1' },
      { kind: 'connection', connectionId: 'c1' }
    ])
  })

  it('설계를 여럿 물린 연결은 그 전부와 자기 것을 본다 — 만들 자리만 못 고를 뿐 보이기는 한다', () => {
    expect(visibleOwners({ connectionId: 'c1', boundDesignIds: ['d1', 'd2'] })).toHaveLength(3)
  })

  it('아무것도 안 주면 볼 것도 없다', () => {
    expect(visibleOwners({})).toEqual([])
  })
})
