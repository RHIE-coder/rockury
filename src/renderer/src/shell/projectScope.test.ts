import { describe, expect, it } from 'vitest'
import {
  SCOPE_ALL,
  SCOPE_NONE,
  filterByScope,
  inScope,
  oneProject,
  scopeFromOptionId,
  scopeToOptionId
} from './projectScope'

/**
 * 프로젝트 범위 거르기 — 이번 기능의 핵심 규칙.
 *
 * 두 갈래가 있고 **무소속(소속 칸이 빈 것)에서만 갈린다**:
 *  · 설계류(strict) — 그 프로젝트의 산출물. 무소속은 '프로젝트 없음' 에서만 보인다.
 *  · 접속류(shared) — 쓰는 도구. 무소속은 공용이라 어느 프로젝트에서나 보인다.
 * 다른 프로젝트 것은 두 갈래 모두에서 숨는다.
 */

const 쿠팡설계 = { projectId: 'p-coupang' }
const 위키설계 = { projectId: 'p-wiki' }
const 무소속 = { projectId: null }

describe('inScope — 설계류(strict)', () => {
  it('전체를 고르면 소속과 상관없이 다 보인다', () => {
    for (const item of [쿠팡설계, 위키설계, 무소속]) {
      expect(inScope(item, SCOPE_ALL, 'strict')).toBe(true)
    }
  })

  it('프로젝트를 고르면 그 프로젝트 것만 보인다', () => {
    const scope = oneProject('p-coupang')
    expect(inScope(쿠팡설계, scope, 'strict')).toBe(true)
    expect(inScope(위키설계, scope, 'strict')).toBe(false)
  })

  it('프로젝트를 고르면 무소속은 숨는다', () => {
    expect(inScope(무소속, oneProject('p-coupang'), 'strict')).toBe(false)
  })

  it("'프로젝트 없음' 을 고르면 무소속만 보인다", () => {
    expect(inScope(무소속, SCOPE_NONE, 'strict')).toBe(true)
    expect(inScope(쿠팡설계, SCOPE_NONE, 'strict')).toBe(false)
  })
})

describe('inScope — 접속류(shared)', () => {
  it('프로젝트를 골라도 무소속은 남는다 (공용 접속)', () => {
    // 로컬 테스트 DB 는 어느 프로젝트를 하든 쓴다. 여기서 숨으면 비워 두는 것 자체가 쓸모없어지고
    // 같은 접속을 프로젝트마다 다시 등록하게 된다.
    expect(inScope(무소속, oneProject('p-coupang'), 'shared')).toBe(true)
  })

  it('다른 프로젝트 것은 그래도 숨는다', () => {
    expect(inScope(위키설계, oneProject('p-coupang'), 'shared')).toBe(false)
  })

  it("'프로젝트 없음' 을 고르면 공용만 보인다", () => {
    expect(inScope(무소속, SCOPE_NONE, 'shared')).toBe(true)
    expect(inScope(쿠팡설계, SCOPE_NONE, 'shared')).toBe(false)
  })
})

describe('빈 소속의 여러 모양', () => {
  // 저장소는 NULL, 화면 폼은 빈 문자열, 옛 행은 칸 자체가 없음 — 셋 다 "안 정함"이다.
  it.each([{ projectId: null }, { projectId: undefined }, { projectId: '' }, {}])(
    '%o 는 무소속으로 다룬다',
    (item) => {
      expect(inScope(item, SCOPE_NONE, 'strict')).toBe(true)
      expect(inScope(item, oneProject('p-coupang'), 'strict')).toBe(false)
    }
  )
})

describe('filterByScope', () => {
  const 설계목록 = [
    { id: 'd1', projectId: 'p-coupang' },
    { id: 'd2', projectId: 'p-wiki' },
    { id: 'd3', projectId: null }
  ]

  it('설계류는 고른 프로젝트 것만 남긴다', () => {
    expect(filterByScope(설계목록, oneProject('p-coupang'), 'strict').map((r) => r.id)).toEqual(['d1'])
  })

  it('접속류는 고른 프로젝트 것 + 공용을 남긴다', () => {
    expect(filterByScope(설계목록, oneProject('p-coupang'), 'shared').map((r) => r.id)).toEqual([
      'd1',
      'd3'
    ])
  })

  it('전체는 순서를 바꾸지 않고 그대로 돌려준다', () => {
    expect(filterByScope(설계목록, SCOPE_ALL, 'strict')).toEqual(설계목록)
  })

  it('빈 목록도 안전하다', () => {
    expect(filterByScope([], oneProject('p-coupang'), 'strict')).toEqual([])
  })
})

describe('셀렉터 옵션 id 와의 왕복', () => {
  // 셀렉터는 문자열 id 하나만 다룬다 — 범위 값을 그 id 로 접었다 펴도 같아야 한다.
  it.each([SCOPE_ALL, SCOPE_NONE, oneProject('p-coupang')])('%o 는 왕복해도 같다', (scope) => {
    expect(scopeFromOptionId(scopeToOptionId(scope))).toEqual(scope)
  })

  it('빈 값은 전체로 떨어진다', () => {
    // 아직 아무것도 안 고른 상태(저장된 선택이 없음)는 전체다 — 켜자마자 목록이 비어 보이면 안 된다.
    expect(scopeFromOptionId('')).toEqual(SCOPE_ALL)
    expect(scopeFromOptionId(null)).toEqual(SCOPE_ALL)
  })

  it('특수 id 가 아닌 것은 프로젝트 id 로 읽는다', () => {
    // 그 프로젝트가 아직 있는지까지는 여기서 모른다 — 존재 확인은 목록을 든 스토어의 몫이다.
    expect(scopeFromOptionId('p-coupang')).toEqual(oneProject('p-coupang'))
  })
})
