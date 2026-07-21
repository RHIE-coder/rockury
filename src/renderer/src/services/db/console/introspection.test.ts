import { describe, expect, it } from 'vitest'
import {
  columnKeyKinds,
  normalizeSchema,
  type IntrospectedSchema
} from './introspection'

/** test-db 의 users/roles/user_roles 를 축약한 IR — 복합 PK·FK·UK·idx 를 모두 포함. */
const ir: IntrospectedSchema = {
  dialect: 'mysql',
  tables: [
    { name: 'users', comment: 'Core user accounts table' },
    { name: 'user_roles', comment: '' },
    { name: 'roles', comment: '' }
  ],
  columns: [
    { table: 'users', name: 'id', type: 'char(36)', nullable: false, default: null, comment: '', ordinal: 1 },
    { table: 'users', name: 'email', type: 'varchar(255)', nullable: false, default: null, comment: '', ordinal: 2 },
    { table: 'users', name: 'is_active', type: 'tinyint(1)', nullable: false, default: '1', comment: '', ordinal: 3 },
    { table: 'roles', name: 'id', type: 'char(36)', nullable: false, default: null, comment: '', ordinal: 1 },
    { table: 'roles', name: 'name', type: 'varchar(50)', nullable: false, default: null, comment: '', ordinal: 2 },
    // 일부러 역순으로 넣어 정렬을 검증
    { table: 'user_roles', name: 'role_id', type: 'char(36)', nullable: false, default: null, comment: '', ordinal: 2 },
    { table: 'user_roles', name: 'user_id', type: 'char(36)', nullable: false, default: null, comment: '', ordinal: 1 }
  ],
  keys: [
    { table: 'users', name: 'PRIMARY', kind: 'pk', column: 'id', ordinal: 1, direction: 'ASC' },
    { table: 'users', name: 'uq_users_email', kind: 'uk', column: 'email', ordinal: 1, direction: 'ASC' },
    { table: 'users', name: 'idx_users_active', kind: 'idx', column: 'is_active', ordinal: 1, direction: 'ASC' },
    // 복합 PK — 역순 입력
    { table: 'user_roles', name: 'PRIMARY', kind: 'pk', column: 'role_id', ordinal: 2, direction: 'ASC' },
    { table: 'user_roles', name: 'PRIMARY', kind: 'pk', column: 'user_id', ordinal: 1, direction: 'ASC' },
    { table: 'roles', name: 'PRIMARY', kind: 'pk', column: 'id', ordinal: 1, direction: 'ASC' }
  ],
  foreignKeys: [
    { table: 'user_roles', name: 'fk_user_roles_user', column: 'user_id', refTable: 'users', refColumn: 'id', ordinal: 1, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    { table: 'user_roles', name: 'fk_user_roles_role', column: 'role_id', refTable: 'roles', refColumn: 'id', ordinal: 1, onDelete: 'CASCADE', onUpdate: 'CASCADE' }
  ]
}

describe('normalizeSchema', () => {
  const tables = normalizeSchema(ir, 'design-x')

  it('테이블을 이름순으로 정렬한다', () => {
    expect(tables.map((t) => t.name)).toEqual(['roles', 'user_roles', 'users'])
  })

  it('designId 를 모든 테이블에 부여하고 id 를 이름 기반으로 만든다', () => {
    const users = tables.find((t) => t.name === 'users')!
    expect(users.designId).toBe('design-x')
    expect(users.id).toBe('t:users')
    expect(users.comment).toBe('Core user accounts table')
    expect(users.columns[0].id).toBe('c:users.id')
  })

  it('컬럼을 ordinal 순으로 채운다', () => {
    const ur = tables.find((t) => t.name === 'user_roles')!
    expect(ur.columns.map((c) => c.name)).toEqual(['user_id', 'role_id'])
  })

  it('복합 PK 를 ordinal 순 컬럼 참조로 조립한다', () => {
    const ur = tables.find((t) => t.name === 'user_roles')!
    const pk = ur.constraints.find((c) => c.kind === 'pk')!
    expect(pk.columns.map((r) => r.columnId)).toEqual(['c:user_roles.user_id', 'c:user_roles.role_id'])
  })

  it('제약을 kind 순(pk→uk→fk→idx)으로 정렬한다', () => {
    const users = tables.find((t) => t.name === 'users')!
    expect(users.constraints.map((c) => c.kind)).toEqual(['pk', 'uk', 'idx'])
  })

  it('FK 를 refTable/refColumns/onDelete 와 함께 조립한다', () => {
    const ur = tables.find((t) => t.name === 'user_roles')!
    const fks = ur.constraints.filter((c) => c.kind === 'fk')
    expect(fks).toHaveLength(2)
    const userFk = fks.find((f) => f.name === 'fk_user_roles_user')!
    expect(userFk.refTable).toBe('users')
    expect(userFk.refColumns).toEqual(['id'])
    expect(userFk.onDelete).toBe('CASCADE')
    expect(userFk.columns[0].columnId).toBe('c:user_roles.user_id')
  })

  it('빈 스키마도 안전하게 처리한다', () => {
    const empty = normalizeSchema(
      { dialect: 'sqlite', tables: [], columns: [], keys: [], foreignKeys: [] },
      'd'
    )
    expect(empty).toEqual([])
  })
})

describe('columnKeyKinds', () => {
  it('컬럼이 참여하는 키 종류를 모은다(user_id 는 pk+fk)', () => {
    const tables = normalizeSchema(ir, 'd')
    const ur = tables.find((t) => t.name === 'user_roles')!
    const kinds = columnKeyKinds(ur)
    expect([...kinds.get('c:user_roles.user_id')!].sort()).toEqual(['fk', 'pk'])
    expect([...kinds.get('c:user_roles.role_id')!].sort()).toEqual(['fk', 'pk'])
  })
})
