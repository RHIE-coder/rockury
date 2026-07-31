import { describe, expect, it } from 'vitest'
import { badgeLabels, typeLabel } from './columnMeta'
import type { ConstraintKind } from '../../workspaces/definition/types'

const set = (...k: ConstraintKind[]): Set<ConstraintKind> => new Set(k)

describe('badgeLabels — 키 배지 텍스트(PK/FK/UK/IDX/CHECK)', () => {
  it('종류별 올바른 라벨을 돌려준다', () => {
    expect(badgeLabels(set('pk'))).toEqual(['PK'])
    expect(badgeLabels(set('fk'))).toEqual(['FK'])
    expect(badgeLabels(set('uk'))).toEqual(['UK'])
    expect(badgeLabels(set('idx'))).toEqual(['IDX'])
    expect(badgeLabels(set('check'))).toEqual(['CHECK'])
  })

  it('여러 종류는 고정 순서(pk→fk→uk→idx→check)로 정렬한다', () => {
    expect(badgeLabels(set('idx', 'pk', 'fk'))).toEqual(['PK', 'FK', 'IDX'])
    expect(badgeLabels(set('check', 'uk', 'pk'))).toEqual(['PK', 'UK', 'CHECK'])
  })

  it('빈 집합/undefined 는 빈 배열', () => {
    expect(badgeLabels(set())).toEqual([])
    expect(badgeLabels(undefined)).toEqual([])
  })

  it('열쇠 이모지 등 기호를 쓰지 않는다(텍스트만)', () => {
    for (const label of badgeLabels(set('pk', 'fk', 'uk', 'idx', 'check'))) {
      expect(label).toMatch(/^[A-Z]+$/)
    }
  })
})

describe('typeLabel — 컬럼 타입 라벨', () => {
  it('공백 정리 + 소문자화', () => {
    expect(typeLabel('char(36)')).toBe('char(36)')
    expect(typeLabel('  INT ')).toBe('int')
    expect(typeLabel('character   varying(255)')).toBe('character varying(255)')
    expect(typeLabel('DATETIME')).toBe('datetime')
  })
})
