import { describe, expect, it } from 'vitest'
import { resolveRef } from '../schemaRef'
import {
  columnKeyKinds,
  normalizeSchema,
  splitTablesAndViews,
  type IntrospectedSchema,
  type RawColumn,
  type RawForeignKey,
  type RawKey,
  type RawTable
} from './introspection'

// 픽스처를 짧게 유지하는 도우미 — 스키마를 안 적으면 `app`(단일 스키마 연결의 모양).
const S = 'app'
const t = (name: string, comment = '', isView = false, schema = S): RawTable => ({ schema, name, comment, isView })
const c = (
  table: string,
  name: string,
  type: string,
  ordinal: number,
  extra: Partial<RawColumn> = {}
): RawColumn => ({ schema: S, table, name, type, nullable: false, default: null, comment: '', ordinal, ...extra })
const k = (
  table: string,
  name: string,
  kind: RawKey['kind'],
  column: string,
  ordinal = 1,
  schema = S
): RawKey => ({ schema, table, name, kind, column, ordinal, direction: 'ASC' })
const f = (
  table: string,
  name: string,
  column: string,
  refTable: string,
  refColumn: string,
  extra: Partial<RawForeignKey> = {}
): RawForeignKey => ({
  schema: S,
  table,
  name,
  column,
  refSchema: S,
  refTable,
  refColumn,
  ordinal: 1,
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
  ...extra
})

/** test-db 의 users/roles/user_roles 를 축약한 IR — 복합 PK·FK·UK·idx 를 모두 포함. */
const ir: IntrospectedSchema = {
  dialect: 'mysql',
  schemas: [S],
  tables: [t('users', 'Core user accounts table'), t('user_roles'), t('roles')],
  columns: [
    c('users', 'id', 'char(36)', 1),
    c('users', 'email', 'varchar(255)', 2),
    c('users', 'is_active', 'tinyint(1)', 3, { default: '1' }),
    c('roles', 'id', 'char(36)', 1),
    c('roles', 'name', 'varchar(50)', 2),
    // 일부러 역순으로 넣어 정렬을 검증
    c('user_roles', 'role_id', 'char(36)', 2),
    c('user_roles', 'user_id', 'char(36)', 1)
  ],
  keys: [
    k('users', 'PRIMARY', 'pk', 'id'),
    k('users', 'uq_users_email', 'uk', 'email'),
    k('users', 'idx_users_active', 'idx', 'is_active'),
    // 복합 PK — 역순 입력
    k('user_roles', 'PRIMARY', 'pk', 'role_id', 2),
    k('user_roles', 'PRIMARY', 'pk', 'user_id', 1),
    k('roles', 'PRIMARY', 'pk', 'id')
  ],
  foreignKeys: [
    f('user_roles', 'fk_user_roles_user', 'user_id', 'users', 'id'),
    f('user_roles', 'fk_user_roles_role', 'role_id', 'roles', 'id')
  ]
}

describe('normalizeSchema', () => {
  const tables = normalizeSchema(ir, 'design-x')

  it('테이블을 이름순으로 정렬한다', () => {
    expect(tables.map((t) => t.name)).toEqual(['roles', 'user_roles', 'users'])
  })

  it('designId·스키마를 모든 테이블에 부여하고 id 를 (스키마, 이름) 기반으로 만든다', () => {
    const users = tables.find((t) => t.name === 'users')!
    expect(users.designId).toBe('design-x')
    expect(users.schema).toBe('app')
    expect(users.id).toBe('t:app.users')
    expect(users.comment).toBe('Core user accounts table')
    expect(users.columns[0].id).toBe('c:app.users.id')
  })

  it('컬럼을 ordinal 순으로 채운다', () => {
    const ur = tables.find((t) => t.name === 'user_roles')!
    expect(ur.columns.map((c) => c.name)).toEqual(['user_id', 'role_id'])
  })

  it('복합 PK 를 ordinal 순 컬럼 참조로 조립한다', () => {
    const ur = tables.find((t) => t.name === 'user_roles')!
    const pk = ur.constraints.find((c) => c.kind === 'pk')!
    expect(pk.columns.map((r) => r.columnId)).toEqual(['c:app.user_roles.user_id', 'c:app.user_roles.role_id'])
  })

  it('제약을 kind 순(pk→uk→fk→idx)으로 정렬한다', () => {
    const users = tables.find((t) => t.name === 'users')!
    expect(users.constraints.map((c) => c.kind)).toEqual(['pk', 'uk', 'idx'])
  })

  it('FK 를 refSchema/refTable/refColumns/onDelete 와 함께 조립한다', () => {
    const ur = tables.find((t) => t.name === 'user_roles')!
    const fks = ur.constraints.filter((c) => c.kind === 'fk')
    expect(fks).toHaveLength(2)
    const userFk = fks.find((f) => f.name === 'fk_user_roles_user')!
    expect(userFk.refSchema).toBe('app')
    expect(userFk.refTable).toBe('users')
    expect(userFk.refColumns).toEqual(['id'])
    expect(userFk.onDelete).toBe('CASCADE')
    expect(userFk.columns[0].columnId).toBe('c:app.user_roles.user_id')
  })

  it('빈 스키마도 안전하게 처리한다', () => {
    const empty = normalizeSchema(
      { dialect: 'sqlite', schemas: [], tables: [], columns: [], keys: [], foreignKeys: [] },
      'd'
    )
    expect(empty).toEqual([])
  })
})

// 범위(scope)를 켜면 실제로 벌어지는 모양 — 이름이 같은 테이블이 두 스키마에서 함께 들어온다.
// 예전 코드는 id·버킷을 이름만으로 만들어 **뒤엣것이 앞엣것을 덮어써 테이블 하나가 사라졌다.**
describe('normalizeSchema — 여러 스키마를 함께 읽을 때', () => {
  const multi: IntrospectedSchema = {
    dialect: 'postgresql',
    schemas: ['public', 'auth'],
    tables: [t('users', '', false, 'public'), t('users', '', false, 'auth'), t('posts', '', false, 'public')],
    columns: [
      { ...c('users', 'id', 'bigint', 1), schema: 'public' },
      { ...c('users', 'id', 'uuid', 1), schema: 'auth' },
      { ...c('posts', 'id', 'bigint', 1), schema: 'public' },
      { ...c('posts', 'author_id', 'uuid', 2), schema: 'public' }
    ],
    keys: [
      k('users', 'users_pkey', 'pk', 'id', 1, 'public'),
      k('users', 'users_pkey', 'pk', 'id', 1, 'auth'),
      k('posts', 'posts_pkey', 'pk', 'id', 1, 'public')
    ],
    foreignKeys: [
      // public.posts → auth.users (교차 스키마 FK — PostgreSQL 에서 흔하다)
      f('posts', 'posts_author_fkey', 'author_id', 'users', 'id', {
        schema: 'public',
        refSchema: 'auth'
      })
    ]
  }
  const tables = normalizeSchema(multi, 'd')

  it('같은 이름 테이블이 스키마별로 둘 다 살아남는다', () => {
    expect(tables.map((t) => `${t.schema}.${t.name}`)).toEqual(['auth.users', 'public.posts', 'public.users'])
  })

  it('컬럼이 자기 스키마의 테이블에만 붙는다', () => {
    const authUsers = tables.find((t) => t.schema === 'auth')!
    const publicUsers = tables.find((t) => t.schema === 'public' && t.name === 'users')!
    expect(authUsers.columns.map((c) => c.type)).toEqual(['uuid'])
    expect(publicUsers.columns.map((c) => c.type)).toEqual(['bigint'])
  })

  it('교차 스키마 FK 가 refSchema 를 달고 나오고, 그 스키마의 테이블로 이어진다', () => {
    const posts = tables.find((t) => t.name === 'posts')!
    const fk = posts.constraints.find((c) => c.kind === 'fk')!
    expect(fk.refSchema).toBe('auth')
    // 이름만으로 찾으면 public.users 에 붙는다 — 스키마까지 봐야 auth.users 로 간다.
    expect(resolveRef(tables, posts, fk)?.schema).toBe('auth')
  })

  it('같은 이름 PK 제약이 서로를 덮어쓰지 않는다', () => {
    for (const schema of ['public', 'auth']) {
      const users = tables.find((t) => t.schema === schema && t.name === 'users')!
      // id 에 종류가 들어간다 — MySQL 은 FK 와 그 백업 인덱스가 같은 이름이라, 종류가 없으면
      // 둘이 같은 id 가 되어 화면이 하나를 삼킨다(2026-07-30 실측 콘솔 오류).
      expect(users.constraints.map((c) => c.id)).toEqual([`k:${schema}.users.pk.users_pkey`])
    }
  })
})

describe('splitTablesAndViews — 테이블/뷰 분리(#4)', () => {
  it('isView 기준으로 가른다', () => {
    const withView = normalizeSchema(
      {
        ...ir,
        tables: [t('users'), t('v_user_summary', '', true)],
        columns: [c('users', 'id', 'char(36)', 1), c('v_user_summary', 'total', 'int', 1, { nullable: true })],
        keys: [k('users', 'PRIMARY', 'pk', 'id')],
        foreignKeys: []
      },
      'd'
    )
    const { tables, views } = splitTablesAndViews(withView)
    expect(tables.map((t) => t.name)).toEqual(['users'])
    expect(views.map((t) => t.name)).toEqual(['v_user_summary'])
    expect(views[0].isView).toBe(true)
  })

  it('뷰가 없으면 views 는 빈 배열', () => {
    const { views } = splitTablesAndViews(normalizeSchema(ir, 'd'))
    expect(views).toEqual([])
  })
})

describe('columnKeyKinds', () => {
  it('컬럼이 참여하는 키 종류를 모은다(user_id 는 pk+fk)', () => {
    const tables = normalizeSchema(ir, 'd')
    const ur = tables.find((t) => t.name === 'user_roles')!
    const kinds = columnKeyKinds(ur)
    expect([...kinds.get('c:app.user_roles.user_id')!].sort()).toEqual(['fk', 'pk'])
    expect([...kinds.get('c:app.user_roles.role_id')!].sort()).toEqual(['fk', 'pk'])
  })
})

// 2026-07-30 실측 콘솔 오류: `k:testdb.api_keys.fk_api_keys_user` 가 두 번 나와 React 가
// "두 자식이 같은 key" 로 경고했다. MySQL 이 FK 를 만들 때 **같은 이름의 인덱스**를 함께 만들어,
// 이름만으로 id 를 만들면 FK 와 인덱스가 같은 id 가 된다.
describe('normalizeSchema — CHECK', () => {
  const ir = {
    dialect: 'mysql' as const,
    schemas: ['app'],
    tables: [{ schema: 'app', name: 'items', comment: '' }],
    columns: [
      {
        schema: 'app',
        table: 'items',
        name: 'price',
        type: 'int',
        nullable: false,
        default: null,
        comment: '',
        ordinal: 1
      }
    ],
    keys: [],
    foreignKeys: [],
    checks: [{ schema: 'app', table: 'items', name: 'chk_price', expression: '`price` > 0' }]
  }

  it('식을 단 제약으로 접힌다 — 컬럼에 안 매인다', () => {
    const [t] = normalizeSchema(ir, 'd')
    const con = t.constraints.find((c) => c.kind === 'check')!
    expect([con.name, con.expression, con.columns.length]).toEqual(['chk_price', '`price` > 0', 0])
  })

  it('checks 가 없는 옛 응답도 그대로 읽힌다', () => {
    const [t] = normalizeSchema({ ...ir, checks: undefined }, 'd')
    expect(t.constraints.filter((c) => c.kind === 'check')).toEqual([])
  })
})

describe('normalizeSchema — MySQL 의 FK 와 동명 인덱스', () => {
  it('같은 이름이어도 종류가 달라 id 가 안 겹친다', () => {
    const tables = normalizeSchema(
      {
        dialect: 'mysql',
        schemas: [S],
        tables: [t('api_keys'), t('users')],
        columns: [c('api_keys', 'user_id', 'char(36)', 1), c('users', 'id', 'char(36)', 1)],
        // MySQL 은 FK 이름과 같은 인덱스를 자동으로 만든다 — 실제로 둘 다 올라온다.
        keys: [k('api_keys', 'fk_api_keys_user', 'idx', 'user_id')],
        foreignKeys: [f('api_keys', 'fk_api_keys_user', 'user_id', 'users', 'id')]
      },
      'd'
    )
    const ids = tables.find((x) => x.name === 'api_keys')!.constraints.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(['k:app.api_keys.fk.fk_api_keys_user', 'k:app.api_keys.idx.fk_api_keys_user'])
  })
})
