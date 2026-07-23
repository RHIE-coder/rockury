import { describe, expect, it } from 'vitest'
import { countByKind, filterByKind, fkRefLabel, flattenConstraints, groupConstraintsByTable } from './constraintsView'
import type { Constraint, TableDef } from '../workspaces/definition/types'

function table(name: string, cols: string[], constraints: Constraint[]): TableDef {
  return {
    id: `t:${name}`,
    designId: 'd',
    name,
    comment: '',
    columns: cols.map((c) => ({ id: `c:${name}.${c}`, name: c, type: 'text', nullable: true, defaultValue: null, comment: '' })),
    constraints
  }
}

const users = table('users', ['id'], [{ id: 'k:users.pk', kind: 'pk', name: 'PRIMARY', columns: [{ columnId: 'c:users.id' }] }])
const apiKeys = table('api_keys', ['id', 'user_id', 'key_value'], [
  { id: 'k:api_keys.pk', kind: 'pk', name: 'PRIMARY', columns: [{ columnId: 'c:api_keys.id' }] },
  { id: 'k:api_keys.fk', kind: 'fk', name: 'fk_api_keys_user', columns: [{ columnId: 'c:api_keys.user_id' }], refTable: 'users', refColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
  { id: 'k:api_keys.uk', kind: 'uk', name: 'uq_api_keys_key_value', columns: [{ columnId: 'c:api_keys.key_value' }] },
  { id: 'k:api_keys.idx', kind: 'idx', name: 'idx_api_keys_key_value', columns: [{ columnId: 'c:api_keys.key_value' }] }
])

describe('flattenConstraints', () => {
  const list = flattenConstraints([apiKeys, users])
  it('전 테이블의 제약을 평탄화하고 컬럼명을 해석', () => {
    const fk = list.find((c) => c.name === 'fk_api_keys_user')!
    expect(fk.table).toBe('api_keys')
    expect(fk.kind).toBe('fk')
    expect(fk.columns).toEqual(['user_id'])
  })
  it('테이블→종류→이름 순 정렬', () => {
    expect(list[0].table).toBe('api_keys')
    expect(list.at(-1)!.table).toBe('users')
  })
})

describe('fkRefLabel', () => {
  it('fk 참조를 → ref.col DEL:규칙 로', () => {
    const fk = apiKeys.constraints.find((c) => c.kind === 'fk')!
    expect(fkRefLabel(fk)).toBe('→ users.id DEL:CASCADE')
  })
  it('fk 아니면 undefined', () => {
    expect(fkRefLabel(users.constraints[0])).toBeUndefined()
  })
})

describe('countByKind / filterByKind', () => {
  const list = flattenConstraints([apiKeys, users])
  it('ALL + 종류별 개수', () => {
    const c = countByKind(list)
    expect(c.ALL).toBe(5)
    expect(c.pk).toBe(2)
    expect(c.fk).toBe(1)
    expect(c.uk).toBe(1)
    expect(c.idx).toBe(1)
    expect(c.check).toBe(0)
  })
  it('종류 필터', () => {
    expect(filterByKind(list, 'ALL')).toHaveLength(5)
    expect(filterByKind(list, 'fk').every((c) => c.kind === 'fk')).toBe(true)
    expect(filterByKind(list, 'fk')).toHaveLength(1)
  })
})

describe('groupConstraintsByTable', () => {
  const list = flattenConstraints([apiKeys, users])
  it('테이블별로 묶고 정렬 순서를 유지', () => {
    const groups = groupConstraintsByTable(list)
    expect(groups.map((g) => g.table)).toEqual(['api_keys', 'users'])
    expect(groups[0].constraints).toHaveLength(4)
    expect(groups[1].constraints).toHaveLength(1)
    // 그룹 안의 제약은 모두 그 테이블 소속.
    expect(groups[0].constraints.every((c) => c.table === 'api_keys')).toBe(true)
  })
  it('빈 목록은 빈 그룹', () => {
    expect(groupConstraintsByTable([])).toEqual([])
  })
})
