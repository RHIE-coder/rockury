import { describe, it, expect } from 'vitest'
import { buildColumnCopy, rowSummary, type ColumnCopyInput } from './copyColumns'
import type { Column, Constraint, TableDef } from './types'

const col = (id: string, name: string, over: Partial<Column> = {}): Column => ({
  id,
  name,
  type: 'VARCHAR(50)',
  nullable: true,
  defaultValue: null,
  comment: '',
  ...over
})

const tbl = (name: string, columns: Column[], constraints: Constraint[] = []): TableDef => ({
  id: `t-${name}`,
  designId: 'A',
  schema: 'public',
  name,
  comment: '',
  columns,
  constraints
})

let n = 0
const run = (over: Partial<ColumnCopyInput> & Pick<ColumnCopyInput, 'columns' | 'targets'>) => {
  n = 0
  return buildColumnCopy({ onCollision: 'skip', mintId: () => `new-${++n}`, ...over })
}

const createdAt = col('src-1', 'created_at', { type: 'DATETIME', nullable: false, defaultValue: 'now()' })
const updatedAt = col('src-2', 'updated_at', { type: 'DATETIME' })

describe('buildColumnCopy — 여러 테이블에 한 번에', () => {
  it('대상마다 뒤에 붙인다', () => {
    const r = run({ columns: [createdAt], targets: [tbl('orders', [col('o1', 'id')]), tbl('users', [col('u1', 'id')])] })
    expect(r.tables.map((t) => t.columns.map((c) => c.name))).toEqual([
      ['id', 'created_at'],
      ['id', 'created_at']
    ])
    expect(r.rows.map((x) => x.added)).toEqual([['created_at'], ['created_at']])
  })

  it('컬럼 id 는 **대상마다 새로** 발급한다 — 같은 id 가 둘이면 제약이 남의 컬럼을 가리킨다', () => {
    const r = run({ columns: [createdAt], targets: [tbl('orders', []), tbl('users', [])] })
    const ids = r.tables.flatMap((t) => t.columns.map((c) => c.id))
    expect(ids).toEqual(['new-1', 'new-2'])
    expect(new Set(ids).size).toBe(2)
  })

  it('값은 그대로 옮긴다(타입·NULL·기본값·설명)', () => {
    const r = run({ columns: [createdAt], targets: [tbl('orders', [])] })
    const got = r.tables[0].columns[0]
    expect([got.type, got.nullable, got.defaultValue]).toEqual(['DATETIME', false, 'now()'])
  })

  it('운영 드리프트 표식은 안 옮긴다 — 복제본에 붙으면 거짓말이 된다', () => {
    const drifted = col('src-9', 'memo', { drift: { version: 'v0.2.0' } })
    const r = run({ columns: [drifted], targets: [tbl('orders', [])] })
    expect(r.tables[0].columns[0].drift).toBeUndefined()
  })
})

describe('buildColumnCopy — 이름이 겹칠 때', () => {
  const targets = () => [
    tbl('orders', [col('o1', 'id'), col('o2', 'created_at', { type: 'TIMESTAMP' })]),
    tbl('users', [col('u1', 'id')])
  ]

  it('건너뛰기: 이미 있으면 손 안 댄다', () => {
    const r = run({ columns: [createdAt], targets: targets(), onCollision: 'skip' })
    expect(r.rows.map((x) => [x.added, x.skipped])).toEqual([
      [[], ['created_at']],
      [['created_at'], []]
    ])
    // orders 는 아무것도 안 바뀌었으니 저장 대상에서 빠진다.
    expect(r.tables.map((t) => t.name)).toEqual(['users'])
  })

  it('덮어쓰기: 값만 갈고 **컬럼 id 는 그대로** — 걸린 제약이 id 로 매달려 있다', () => {
    const r = run({ columns: [createdAt], targets: targets(), onCollision: 'overwrite' })
    const orders = r.tables.find((t) => t.name === 'orders')!
    const hit = orders.columns.find((c) => c.name === 'created_at')!
    expect(hit.id).toBe('o2')
    expect([hit.type, hit.nullable, hit.defaultValue]).toEqual(['DATETIME', false, 'now()'])
    expect(r.rows[0].overwritten).toEqual(['created_at'])
  })

  it('덮어써도 자리는 안 옮긴다 — 뒤로 밀리면 표 순서가 흔들린다', () => {
    const r = run({ columns: [createdAt], targets: targets(), onCollision: 'overwrite' })
    expect(r.tables[0].columns.map((c) => c.name)).toEqual(['id', 'created_at'])
  })

  it('아무 대상도 안 바뀌면 저장할 표가 없다', () => {
    const r = run({ columns: [createdAt], targets: [targets()[0]], onCollision: 'skip' })
    expect(r.tables).toEqual([])
  })
})

describe('buildColumnCopy — 여러 컬럼', () => {
  it('고른 순서대로 붙는다', () => {
    const r = run({ columns: [createdAt, updatedAt], targets: [tbl('orders', [col('o1', 'id')])] })
    expect(r.tables[0].columns.map((c) => c.name)).toEqual(['id', 'created_at', 'updated_at'])
  })

  it('대상이 없으면 아무 일도 안 일어난다', () => {
    expect(run({ columns: [createdAt], targets: [] })).toEqual({ rows: [], tables: [] })
  })
})

describe('rowSummary — 미리보기 한 줄', () => {
  it('한 일만 적는다', () => {
    expect(rowSummary({ tableId: 't', tableName: 'orders', added: ['a', 'b'], overwritten: [], skipped: [], renamed: [] })).toBe('+a, b')
    expect(rowSummary({ tableId: 't', tableName: 'orders', added: [], overwritten: ['a'], skipped: ['b'], renamed: [] })).toBe(
      '덮어씀 a · 이미 있음 b'
    )
  })

  it('아무것도 안 하면 빈 줄', () => {
    expect(rowSummary({ tableId: 't', tableName: 'orders', added: [], overwritten: [], skipped: [], renamed: [] })).toBe('')
  })
})

/*
 * ── 사본 만들기 — 겹칠 때의 세 번째 갈래 (2026-08-20 사용자 요청) ──
 * 표 가져오기가 쓰는 이름 규칙(`copyName`)을 그대로 쓴다. 두 창이 "이름이 겹칠 때"를
 * 다르게 굴리면 같은 낱말이 자리마다 다른 뜻이 된다.
 */
describe('buildColumnCopy — 사본 만들기', () => {
  const targets = () => [tbl('orders', [col('o1', 'id'), col('o2', 'created_at', { type: 'TIMESTAMP' })])]

  it('겹치면 `_copy` 를 붙여 새로 넣는다 — 있던 컬럼은 손 안 댄다', () => {
    const r = run({ columns: [createdAt], targets: targets(), onCollision: 'rename' })
    expect(r.tables[0].columns.map((c) => c.name)).toEqual(['id', 'created_at', 'created_at_copy'])
    const kept = r.tables[0].columns.find((c) => c.name === 'created_at')!
    expect([kept.id, kept.type]).toEqual(['o2', 'TIMESTAMP']) // 원래 것 그대로
    expect(r.rows[0].renamed).toEqual(['created_at_copy'])
  })

  it('사본에도 새 id 를 준다', () => {
    const r = run({ columns: [createdAt], targets: targets(), onCollision: 'rename' })
    expect(r.tables[0].columns.find((c) => c.name === 'created_at_copy')?.id).toBe('new-1')
  })

  it('사본 이름까지 겹치면 `_copy2` 로 간다', () => {
    const t = tbl('orders', [col('o1', 'created_at'), col('o2', 'created_at_copy')])
    const r = run({ columns: [createdAt], targets: [t], onCollision: 'rename' })
    expect(r.rows[0].renamed).toEqual(['created_at_copy2'])
  })

  it('안 겹치는 컬럼은 그냥 들어간다 — 사본 갈래여도 이름을 안 바꾼다', () => {
    const r = run({ columns: [updatedAt], targets: targets(), onCollision: 'rename' })
    expect(r.rows[0]).toMatchObject({ added: ['updated_at'], renamed: [] })
  })

  it('요약에 사본이 적힌다', () => {
    const r = run({ columns: [createdAt, updatedAt], targets: targets(), onCollision: 'rename' })
    expect(rowSummary(r.rows[0])).toBe('+updated_at · 사본 created_at_copy')
  })
})
