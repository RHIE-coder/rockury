import { describe, expect, it } from 'vitest'
import { designLayoutScope, designLayoutFallbackScope } from './layoutScope'
import { DRAFT_LENS } from '../../versions/store'

describe('designLayoutScope — 렌즈별 배치 저장 키', () => {
  it('Draft 는 설계 키 하나', () => {
    expect(designLayoutScope('d1', DRAFT_LENS)).toBe('design:d1')
  })

  it('커밋 버전은 버전 번호까지 붙여 가른다', () => {
    expect(designLayoutScope('d1', '1.0.0')).toBe('design:d1@1.0.0')
  })

  it('버전이 다르면 키도 다르다 — 한 버전을 만져도 다른 버전은 안 바뀐다', () => {
    expect(designLayoutScope('d1', '1.0.0')).not.toBe(designLayoutScope('d1', '1.1.0'))
  })

  it('설계가 없으면 키도 없다', () => {
    expect(designLayoutScope(null, '1.0.0')).toBeNull()
    expect(designLayoutScope(undefined, DRAFT_LENS)).toBeNull()
  })
})

describe('designLayoutFallbackScope — 물려받을 키', () => {
  it('커밋 버전은 Draft 배치를 물려받는다', () => {
    expect(designLayoutFallbackScope('d1', '1.0.0')).toBe('design:d1')
  })

  it('Draft 는 물려받을 윗대가 없다', () => {
    expect(designLayoutFallbackScope('d1', DRAFT_LENS)).toBeNull()
  })

  it('설계가 없으면 물려받을 것도 없다', () => {
    expect(designLayoutFallbackScope(null, '1.0.0')).toBeNull()
  })

  it('물려받을 키는 그 설계의 Draft 키와 정확히 같다 — 어긋나면 빈 그림을 물려받는다', () => {
    expect(designLayoutFallbackScope('d1', '2.3.4')).toBe(designLayoutScope('d1', DRAFT_LENS))
  })
})
