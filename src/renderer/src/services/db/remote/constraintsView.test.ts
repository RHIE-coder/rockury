import { describe, expect, it } from 'vitest'
import {
  countByKind,
  filterByKind,
  filterIncoming,
  flattenConstraints,
  groupConstraintsByTable
} from './constraintsView'
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

describe('fk 참조 표기(Definition 과 같은 정본을 쓴다)', () => {
  const list = flattenConstraints([apiKeys, users])
  it('짧은 표기는 참조만, 상세 표기는 두 정책까지', () => {
    const fk = list.find((c) => c.name === 'fk_api_keys_user')!
    expect(fk.refLabel).toBe('→ users (id)')
    expect(fk.refDetail).toBe('→ users (id) · ON DELETE CASCADE · ON UPDATE NO ACTION')
  })
  it('fk 가 아니면 표기가 없다', () => {
    const pk = list.find((c) => c.kind === 'pk')!
    expect(pk.refLabel).toBeUndefined()
    expect(pk.refDetail).toBeUndefined()
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

describe('filterIncoming — 들어오는 참조만', () => {
  const list = flattenConstraints([apiKeys, users])

  it('그 표를 가리키는 FK 만 남는다 — 그 표가 가진 제약이 아니라', () => {
    const got = filterIncoming(list, users)
    expect(got.map((c) => c.name)).toEqual(['fk_api_keys_user'])
    // users 자신의 PK 는 "가리키는 것"이 아니다.
    expect(got.some((c) => c.table === 'users')).toBe(false)
  })

  it('가리키는 것이 없으면 빈 목록', () => {
    expect(filterIncoming(list, apiKeys)).toEqual([])
  })

  it('기준이 없으면(고른 표 없음) 그대로 통과시킨다', () => {
    expect(filterIncoming(list, null)).toHaveLength(list.length)
  })

  it('스키마가 다르면 이름이 같아도 안 걸린다', () => {
    const pubUsers = { ...users, id: 't:pub.users', schema: 'public' }
    const authUsers = { ...users, id: 't:auth.users', schema: 'auth' }
    // refSchema 가 비었으니 이 FK 는 **같은 스키마**(auth.users)를 가리킨다.
    const authKeys = { ...apiKeys, id: 't:auth.api_keys', schema: 'auth' }
    const scoped = flattenConstraints([pubUsers, authUsers, authKeys])
    expect(filterIncoming(scoped, authUsers).map((c) => c.name)).toEqual(['fk_api_keys_user'])
    expect(filterIncoming(scoped, pubUsers)).toEqual([])
  })
})
