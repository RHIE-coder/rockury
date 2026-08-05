import { describe, expect, it } from 'vitest'
import { previewState } from './previewState'

describe('previewState', () => {
  it('아무것도 안 고쳤으면 변경 없음 · 편집 종료', () => {
    expect(previewState(0, 0)).toEqual({
      idle: true,
      hasDetail: false,
      detailLabel: '이유',
      discardLabel: '편집 종료'
    })
  })

  it('낼 문이 있으면 SQL 을 펼친다', () => {
    expect(previewState(3, 0)).toMatchObject({
      idle: false,
      hasDetail: true,
      detailLabel: 'SQL',
      discardLabel: '버리기'
    })
  })

  // 회귀 — sqlite 설명 변경처럼 "고쳤는데 낼 문이 0건"인 경우.
  it('낼 문이 0건이어도 미지원 사유가 있으면 변경 없음이 아니다', () => {
    const v = previewState(0, 1)
    expect(v.idle).toBe(false)
    expect(v.hasDetail).toBe(true)
    expect(v.detailLabel).toBe('이유')
    expect(v.discardLabel).toBe('버리기')
  })

  it('문과 사유가 섞이면 문 쪽을 따른다 — 적용은 되고 못 낸 것만 사유로 남는다', () => {
    expect(previewState(2, 1)).toMatchObject({ idle: false, hasDetail: true, detailLabel: 'SQL' })
  })
})
