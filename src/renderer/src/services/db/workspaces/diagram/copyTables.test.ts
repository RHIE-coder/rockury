import { describe, it, expect } from 'vitest'
import type { Column, Constraint, TableDef } from '../definition/types'
import { buildCopy, copyName, relatedClosure, type CopyInput } from './copyTables'

const col = (t: string, n: string): Column => ({
  id: `${t}.${n}`,
  name: n,
  type: 'int',
  nullable: false,
  defaultValue: null,
  comment: ''
})

const tbl = (
  name: string,
  cols: string[],
  constraints: Constraint[] = [],
  extra: Partial<TableDef> = {}
): TableDef => ({
  id: `src-${name}`,
  designId: 'A',
  schema: 'public',
  name,
  comment: '',
  columns: cols.map((c) => col(name, c)),
  constraints,
  ...extra
})

const pk = (t: string, c: string): Constraint => ({
  id: `con-${t}-pk`,
  kind: 'pk',
  name: `pk_${t}`,
  columns: [{ columnId: `${t}.${c}` }]
})

const fk = (t: string, c: string, refTable: string, refSchema?: string): Constraint => ({
  id: `con-${t}-fk-${refTable}`,
  kind: 'fk',
  name: `fk_${t}_${refTable}`,
  columns: [{ columnId: `${t}.${c}` }],
  refTable,
  refSchema,
  refColumns: ['id'],
  onDelete: 'RESTRICT',
  onUpdate: 'RESTRICT'
})

/** 결정적 발급기 — 실제 스토어의 `tbl-3` 꼴과 같은 모양이되 번호가 예측 가능하다. */
function counter(): (prefix: 'tbl' | 'col' | 'con') => string {
  let n = 0
  return (prefix) => `${prefix}-${++n}`
}

const run = (over: Partial<CopyInput> & Pick<CopyInput, 'source' | 'picked'>) =>
  buildCopy({
    existing: [],
    withRelated: true,
    onCollision: 'rename',
    designId: 'B',
    mintId: counter(),
    ...over
  })

// 출처 설계 A: orders → users → tenants (전이 참조)
const tenants = tbl('tenants', ['id'], [pk('tenants', 'id')])
const users = tbl('users', ['id', 'tenant_id'], [pk('users', 'id'), fk('users', 'tenant_id', 'tenants')])
const orders = tbl('orders', ['id', 'user_id'], [pk('orders', 'id'), fk('orders', 'user_id', 'users')])
const SOURCE = [tenants, users, orders]

describe('relatedClosure — FK 로 엮인 테이블까지 넓힌다', () => {
  it('전이 참조까지 따라간다 (orders → users → tenants)', () => {
    expect(relatedClosure(SOURCE, ['src-orders'])).toEqual(['src-tenants', 'src-users', 'src-orders'])
  })

  it('출처 목록 순서를 지킨다 — 고른 순서로 뒤섞지 않는다', () => {
    expect(relatedClosure(SOURCE, ['src-orders', 'src-tenants'])).toEqual([
      'src-tenants',
      'src-users',
      'src-orders'
    ])
  })

  it('출처에 없는 id 는 무시한다', () => {
    expect(relatedClosure(SOURCE, ['없는-id'])).toEqual([])
  })
})

describe('copyName — 겹치지 않는 복사본 이름', () => {
  it('처음엔 _copy, 그것도 겹치면 _copy2, _copy3', () => {
    expect(copyName('users', () => false)).toBe('users_copy')
    expect(copyName('users', (n) => n === 'users_copy')).toBe('users_copy2')
    expect(copyName('users', (n) => n === 'users_copy' || n === 'users_copy2')).toBe('users_copy3')
  })
})

describe('buildCopy — id 는 전부 새로 발급한다', () => {
  const r = run({ source: SOURCE, picked: ['src-users'] })

  it('테이블·컬럼·제약 id 에 원본 id 가 하나도 안 남는다', () => {
    const ids = r.tables.flatMap((t) => [t.id, ...t.columns.map((c) => c.id), ...t.constraints.map((k) => k.id)])
    expect(ids.some((id) => id.startsWith('src-') || id.includes('.'))).toBe(false)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('제약의 컬럼 참조도 새 컬럼 id 를 가리킨다', () => {
    const t = r.tables.find((x) => x.name === 'users')!
    const colIds = new Set(t.columns.map((c) => c.id))
    for (const k of t.constraints) {
      for (const ref of k.columns) expect(colIds.has(ref.columnId)).toBe(true)
    }
  })

  it('받는 설계 소속으로 바꿔 단다', () => {
    expect(r.tables.every((t) => t.designId === 'B')).toBe(true)
  })
})

describe('buildCopy — 이름이 겹칠 때', () => {
  it('rename: 복사본 이름을 주고, 그걸 가리키던 FK 도 새 이름으로 고친다', () => {
    // 받는 설계 B 에 이미 users 가 있다 — 안 고치면 복제 orders 의 FK 가 B 의 원래 users 를 가리킨다.
    const existing = [tbl('users', ['id'], [], { id: 'b-users', designId: 'B' })]
    const r = run({ source: SOURCE, picked: ['src-orders'], existing })

    expect(r.tables.map((t) => t.name)).toEqual(['tenants', 'users_copy', 'orders'])
    const ordersFk = r.tables.find((t) => t.name === 'orders')!.constraints.find((k) => k.kind === 'fk')!
    expect(ordersFk.refTable).toBe('users_copy')
    expect(r.linkedFks).toEqual([])
  })

  it('rename: 제약 이름 안의 테이블 이름도 따라 바뀐다 — 같은 인덱스 이름이 둘 생기지 않게', () => {
    const existing = [tbl('users', ['id'], [], { id: 'b-users', designId: 'B' })]
    const r = run({ source: [users, tenants], picked: ['src-users'], existing })
    const copied = r.tables.find((t) => t.name === 'users_copy')!
    expect(copied.constraints.map((k) => k.name)).toEqual(['pk_users_copy', 'fk_users_copy_tenants'])
  })

  it('rename: 복사본 이름도 겹치면 _copy2 로 민다', () => {
    const existing = [
      tbl('users', ['id'], [], { id: 'b-users', designId: 'B' }),
      tbl('users_copy', ['id'], [], { id: 'b-users-copy', designId: 'B' })
    ]
    const r = run({ source: [users, tenants], picked: ['src-users'], existing })
    expect(r.tables.map((t) => t.name)).toContain('users_copy2')
  })

  it('skip: 겹치는 것은 안 들어오고, 그걸 가리키던 FK 는 받는 설계의 같은 이름으로 이어진다', () => {
    const existing = [tbl('users', ['id'], [], { id: 'b-users', designId: 'B' })]
    const r = run({ source: SOURCE, picked: ['src-orders'], existing, onCollision: 'skip' })

    expect(r.tables.map((t) => t.name)).toEqual(['tenants', 'orders'])
    expect(r.entries.find((e) => e.name === 'users')!.skipped).toBe(true)
    const ordersFk = r.tables.find((t) => t.name === 'orders')!.constraints.find((k) => k.kind === 'fk')!
    expect(ordersFk.refTable).toBe('users')
    // 조용히 이어붙이지 않는다 — 화면이 말할 수 있게 남긴다.
    expect(r.linkedFks).toEqual([
      { table: 'orders', constraint: 'fk_orders_users', target: 'public.users' }
    ])
  })

  it('스키마가 다르면 같은 이름이라도 안 겹친다', () => {
    const existing = [tbl('users', ['id'], [], { id: 'b-users', designId: 'B', schema: 'auth' })]
    const r = run({ source: [users, tenants], picked: ['src-users'], existing })
    expect(r.tables.map((t) => t.name)).toContain('users')
  })
})

describe('buildCopy — 딸려오지 않은 FK 대상', () => {
  it('엮인 것을 안 가져오면 그 FK 는 빼고 넣는다 — 허공 참조를 남기지 않는다', () => {
    const r = run({ source: SOURCE, picked: ['src-orders'], withRelated: false })

    expect(r.tables.map((t) => t.name)).toEqual(['orders'])
    expect(r.tables[0].constraints.map((k) => k.kind)).toEqual(['pk'])
    expect(r.droppedFks).toEqual([
      { table: 'orders', constraint: 'fk_orders_users', target: 'public.users' }
    ])
  })

  it('출처에서도 이미 허공이던 FK 는 그대로 옮긴다 — 원본에 없던 손질을 하지 않는다', () => {
    const lone = tbl('orders', ['id', 'user_id'], [fk('orders', 'user_id', 'ghost')])
    const r = run({ source: [lone], picked: ['src-orders'], withRelated: false })

    const copied = r.tables[0].constraints.find((k) => k.kind === 'fk')
    expect(copied?.refTable).toBe('ghost')
    expect(r.droppedFks).toEqual([])
  })
})

describe('buildCopy — 목록 표시용 entries', () => {
  it('사람이 고른 것과 FK 로 딸려온 것을 가른다', () => {
    const r = run({ source: SOURCE, picked: ['src-orders'] })
    expect(r.entries.map((e) => [e.name, e.related])).toEqual([
      ['tenants', true],
      ['users', true],
      ['orders', false]
    ])
  })
})

/*
 * ── 받는 칸(intoSchema) — "어느 칸에 넣을지" (2026-08-20 사용자 화면) ──
 * 받는 설계가 칸으로 나뉘어 있는데 출처가 다른 칸(또는 칸 없음)이면, 그대로 옮긴 표가
 * 어느 칸에도 안 들어가 따로 앉고 **겹침으로도 안 세어** 같은 이름 표가 둘 생겼다.
 * 여기서 못 박는 것: 겹침은 **떨어질 자리에서** 보고, FK 도 그 자리를 가리킨다.
 */
describe('buildCopy — 받는 칸(intoSchema)', () => {
  const bare = (name: string, cols: string[], constraints: Constraint[] = []): TableDef =>
    tbl(name, cols, constraints, { schema: undefined, id: `src-${name}` })

  it('안 주면 출처의 칸을 그대로 쓴다', () => {
    const r = run({ source: SOURCE, picked: ['src-users'], withRelated: false })
    expect(r.tables.map((t) => t.schema)).toEqual(['public'])
  })

  it('주면 그 칸으로 옮겨 담는다', () => {
    const r = run({ source: SOURCE, picked: ['src-users'], withRelated: false, intoSchema: 'service2' })
    expect(r.tables.map((t) => `${t.schema}.${t.name}`)).toEqual(['service2.users'])
  })

  it('빈 문자열은 "칸 없음" — undefined(출처 그대로)와 다르다', () => {
    const r = run({ source: SOURCE, picked: ['src-users'], withRelated: false, intoSchema: '' })
    expect(r.tables[0].schema).toBeUndefined()
  })

  it('겹침은 **떨어질 자리**에서 본다 — 옮겨 넣은 칸에 같은 이름이 있으면 복사본 이름', () => {
    const existing = [tbl('users', ['id'], [], { schema: 'service2', id: 'dst-users' })]
    const r = run({
      source: [bare('users', ['id'])],
      picked: ['src-users'],
      withRelated: false,
      existing,
      intoSchema: 'service2'
    })
    expect(r.entries.map((e) => e.finalName)).toEqual(['users_copy'])
  })

  it('칸이 다르면 이름이 같아도 안 겹친다 — 옮기지 않으면 그대로 들어온다', () => {
    const existing = [tbl('users', ['id'], [], { schema: 'service2', id: 'dst-users' })]
    const r = run({ source: [bare('users', ['id'])], picked: ['src-users'], withRelated: false, existing })
    expect(r.entries.map((e) => e.finalName)).toEqual(['users'])
    expect(r.tables[0].schema).toBeUndefined()
  })

  it('함께 옮긴 표끼리의 FK 는 **옮긴 칸**을 가리킨다 — 안 그러면 출처 칸을 계속 가리켜 끊긴다', () => {
    const r = run({ source: SOURCE, picked: ['src-orders'], intoSchema: 'service2' })
    const ordersCopy = r.tables.find((t) => t.name === 'orders')!
    const con = ordersCopy.constraints.find((c) => c.kind === 'fk')!
    expect([con.refSchema, con.refTable]).toEqual(['service2', 'users'])
  })

  it('건너뛴 자리는 **옮긴 칸의** 기존 표로 이어진다', () => {
    const existing = [tbl('users', ['id'], [], { schema: 'service2', id: 'dst-users' })]
    const r = run({
      source: SOURCE,
      picked: ['src-orders'],
      existing,
      onCollision: 'skip',
      intoSchema: 'service2'
    })
    expect(r.entries.find((e) => e.name === 'users')?.skipped).toBe(true)
    expect(r.linkedFks.map((f) => f.target)).toEqual(['service2.users'])
    const ordersCopy = r.tables.find((t) => t.name === 'orders')!
    expect(ordersCopy.constraints.find((c) => c.kind === 'fk')?.refSchema).toBe('service2')
  })
})

/*
 * ── 자기 자신을 출처로 (= 복붙 · 2026-08-20 사용자 요청) ──
 * 출처와 받는 곳이 같은 설계다. 그러면 이름이 **전부** 겹치므로 다 `_copy` 를 받는다.
 * 여기서 못 박는 것: 복제본의 FK 가 **복제본끼리** 붙는다는 것. 원본을 가리키면 복붙이 아니라
 * "원본에 매달린 껍데기"가 되어, 하나를 고치면 다른 하나가 딸려 움직이는 것처럼 보인다.
 */
describe('buildCopy — 자기 자신 복제', () => {
  it('이름이 전부 겹쳐 모두 복사본 이름을 받는다', () => {
    const r = run({ source: SOURCE, picked: ['src-orders'], existing: SOURCE, designId: 'A' })
    expect(r.entries.map((e) => e.finalName)).toEqual(['tenants_copy', 'users_copy', 'orders_copy'])
  })

  it('복제본의 FK 는 **복제본**을 가리킨다 — 원본을 가리키면 복붙이 아니다', () => {
    const r = run({ source: SOURCE, picked: ['src-orders'], existing: SOURCE, designId: 'A' })
    const ordersCopy = r.tables.find((t) => t.name === 'orders_copy')!
    expect(ordersCopy.constraints.find((c) => c.kind === 'fk')?.refTable).toBe('users_copy')
    expect(r.linkedFks).toEqual([])
  })

  it('한 표만 골라 복붙하면 그 표를 가리키던 관계는 **원래 표**로 이어진다', () => {
    // orders 만(딸린 것 없이) 복제 → users 는 안 복제되므로 users 를 그대로 가리킨다.
    const r = run({ source: SOURCE, picked: ['src-orders'], withRelated: false, existing: SOURCE, designId: 'A' })
    expect(r.entries.map((e) => e.finalName)).toEqual(['orders_copy'])
    expect(r.linkedFks.map((f) => f.target)).toEqual(['public.users'])
  })
})
