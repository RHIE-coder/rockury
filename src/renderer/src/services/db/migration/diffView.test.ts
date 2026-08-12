import { describe, expect, it } from 'vitest'
import {
  buildDiffView,
  columnShape,
  constraintShape,
  filterView,
  isEmptyView,
  resolveConstraintColumns,
  schemasOf
} from './diffView'
import { columnId, constraintId, tableId } from '../ids'
import type { Column, Constraint, TableDef } from '../workspaces/definition/types'
import type { VersionSnapshot } from '../versions/store'

const col = (name: string, over: Partial<Column> = {}): Column =>
  ({
    id: columnId(undefined, 't', name),
    name,
    type: 'int',
    nullable: true,
    defaultValue: null,
    comment: '',
    ...over
  }) as Column

const table = (name: string, columns: Column[], constraints: Constraint[] = []): TableDef => ({
  id: tableId(undefined, name),
  designId: 'd1',
  name,
  comment: '',
  columns,
  constraints
})

const snap = (tables: TableDef[]): VersionSnapshot => ({ tables })

describe('columnShape', () => {
  it('타입과 NULL 여부를 적는다', () => {
    expect(columnShape(col('id', { type: 'bigint', nullable: false }))).toBe('bigint NOT NULL')
  })

  it('기본값이 있으면 붙이고, 없으면 빼둔다 — 빈 DEFAULT 를 적으면 소음이다', () => {
    expect(columnShape(col('n', { type: 'int', nullable: true, defaultValue: '0' }))).toBe('int NULL DEFAULT 0')
    expect(columnShape(col('n', { type: 'int', nullable: true }))).toBe('int NULL')
  })
})

describe('constraintShape', () => {
  const cols = [col('user_id'), col('code')]

  it('FK 는 참조처까지 적는다 — 그게 FK 를 읽는 이유다', () => {
    const fk: Constraint = {
      id: constraintId(undefined, 't', 'fk', 'fk_u'),
      name: 'fk_u',
      kind: 'fk',
      columns: [{ columnId: cols[0].id }],
      refSchema: 'app',
      refTable: 'users',
      refColumns: ['id']
    }

    expect(constraintShape(fk, cols)).toBe('(user_id) → app.users(id)')
  })

  it('FK 는 정책까지 적는다 — 안 적으면 정책만 바뀐 FK 가 "안 바뀜"이 된다', () => {
    const fk: Constraint = {
      id: constraintId(undefined, 't', 'fk', 'fk_u'),
      name: 'fk_u',
      kind: 'fk',
      columns: [{ columnId: cols[0].id }],
      refTable: 'users',
      refColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'RESTRICT'
    }

    expect(constraintShape(fk, cols)).toBe('(user_id) → users(id) ON DELETE CASCADE ON UPDATE RESTRICT')
  })

  it('안 정한 정책은 빼둔다 — "안 씀"과 "NO ACTION 이라 씀"은 다른 상태다', () => {
    const fk: Constraint = {
      id: constraintId(undefined, 't', 'fk', 'fk_u'),
      name: 'fk_u',
      kind: 'fk',
      columns: [{ columnId: cols[0].id }],
      refTable: 'users',
      refColumns: ['id'],
      onDelete: 'CASCADE'
    }

    expect(constraintShape(fk, cols)).toBe('(user_id) → users(id) ON DELETE CASCADE')
  })

  it('CHECK 은 조건식이 본체다', () => {
    const ck: Constraint = {
      id: constraintId(undefined, 't', 'check', 'ck'),
      name: 'ck',
      kind: 'check',
      columns: [],
      expression: "code <> ''"
    }

    expect(constraintShape(ck, cols)).toBe("code <> ''")
  })
})

describe('resolveConstraintColumns', () => {
  const cols = [col('user_id'), col('code')]

  it('제약이 적어 둔 순서를 그대로 지킨다 — 그 순서가 곧 복합 키 순번이다', () => {
    const idx: Constraint = {
      id: constraintId(undefined, 't', 'idx', 'ix'),
      name: 'ix',
      kind: 'idx',
      columns: [{ columnId: cols[1].id }, { columnId: cols[0].id, direction: 'DESC' }]
    }

    expect(resolveConstraintColumns(idx, cols)).toEqual([
      { name: 'code', direction: undefined },
      { name: 'user_id', direction: 'DESC' }
    ])
  })

  it('테이블에 없는 컬럼은 물음표로 남긴다 — 조용히 빼면 순번이 밀린다', () => {
    const idx: Constraint = {
      id: constraintId(undefined, 't', 'idx', 'ix'),
      name: 'ix',
      kind: 'idx',
      columns: [{ columnId: 'c:t.gone' }, { columnId: cols[0].id }]
    }

    expect(resolveConstraintColumns(idx, cols).map((c) => c.name)).toEqual(['?', 'user_id'])
  })
})

describe('buildDiffView — 안 바뀐 줄도 남긴다', () => {
  it('바뀐 컬럼만이 아니라 테이블의 컬럼 전부를 늘어놓는다', () => {
    const before = snap([table('orders', [col('id'), col('total')])])
    const after = snap([table('orders', [col('id'), col('total', { type: 'bigint' })])])

    const v = buildDiffView(before, after)
    const orders = v.tables.find((t) => t.name === 'orders')!

    expect(orders.columns).toHaveLength(2)
    expect(orders.columns.find((c) => c.name === 'id')!.status).toBe('same')
    expect(orders.columns.find((c) => c.name === 'total')!.status).toBe('modified')
  })

  it('바뀐 줄은 before 와 after 를 둘 다 든다 — 무엇에서 무엇으로인지가 판단 근거다', () => {
    const before = snap([table('orders', [col('total', { type: 'int' })])])
    const after = snap([table('orders', [col('total', { type: 'bigint' })])])

    const row = buildDiffView(before, after).tables[0].columns[0]

    expect(row.before).toBe('int NULL')
    expect(row.after).toBe('bigint NULL')
  })

  it('새 컬럼은 before 가 없고, 사라진 컬럼은 after 가 없다', () => {
    const before = snap([table('orders', [col('old')])])
    const after = snap([table('orders', [col('new')])])

    const cols = buildDiffView(before, after).tables[0].columns
    expect(cols.find((c) => c.name === 'new')).toMatchObject({ status: 'added', before: null })
    expect(cols.find((c) => c.name === 'old')).toMatchObject({ status: 'removed', after: null })
  })

  it('컬럼 순서는 결과(after) 기준 — 반영 뒤 모양이 읽는 사람의 관심사다', () => {
    const before = snap([table('t', [col('b'), col('a')])])
    const after = snap([table('t', [col('a'), col('b'), col('c')])])

    expect(buildDiffView(before, after).tables[0].columns.map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('사라진 컬럼은 맨 뒤에 모인다 — 결과에 자리가 없는 줄이다', () => {
    const before = snap([table('t', [col('gone'), col('kept')])])
    const after = snap([table('t', [col('kept')])])

    expect(buildDiffView(before, after).tables[0].columns.map((c) => c.name)).toEqual(['kept', 'gone'])
  })

  it('안 바뀐 테이블도 목록에 남는다 — 맥락이 있어야 바뀐 것이 읽힌다', () => {
    const same = table('untouched', [col('id')])
    const v = buildDiffView(snap([same]), snap([same]))

    expect(v.tables).toHaveLength(1)
    expect(v.tables[0].status).toBe('same')
    expect(v.tables[0].changed).toBe(false)
    expect(isEmptyView(v)).toBe(true)
  })

  it('바뀐 테이블이 위로 온다 — 스크롤하지 않고도 할 일이 보여야 한다', () => {
    const before = snap([table('aaa_same', [col('id')]), table('zzz_gone', [col('id')])])
    const after = snap([table('aaa_same', [col('id')]), table('bbb_new', [col('id')])])

    const names = buildDiffView(before, after).tables.map((t) => t.name)
    expect(names[0]).toBe('bbb_new') // added
    expect(names[1]).toBe('zzz_gone') // removed
    expect(names[2]).toBe('aaa_same') // same — 맨 뒤
  })

  it('원본 테이블을 함께 들고 있다 — 목록이 컬럼 수를 세고 컬럼명으로 검색한다', () => {
    const before = snap([table('orders', [col('id'), col('total')])])
    const after = snap([table('orders', [col('id'), col('total'), col('memo')])])

    const v = buildDiffView(before, after)
    expect(v.tables[0].def.columns.map((c) => c.name)).toEqual(['id', 'total', 'memo'])
  })

  it('사라지는 테이블은 before 쪽 원본을 든다 — after 에는 존재하지 않는다', () => {
    const before = snap([table('gone', [col('id')])])
    const after = snap([])

    expect(buildDiffView(before, after).tables[0].def.columns).toHaveLength(1)
  })

  it('changedCount 는 바뀐 테이블만 센다', () => {
    const before = snap([table('a', [col('id')]), table('b', [col('id')])])
    const after = snap([table('a', [col('id')]), table('b', [col('id'), col('x')])])

    expect(buildDiffView(before, after).changedCount).toBe(1)
  })

  it('같은 이름이라도 스키마가 다르면 다른 테이블이다', () => {
    const before = snap([{ ...table('orders', [col('id')]), schema: 'a' }])
    const after = snap([{ ...table('orders', [col('id')]), schema: 'b' }])

    const v = buildDiffView(before, after)
    expect(v.tables).toHaveLength(2)
    expect(v.tables.map((t) => t.status).sort()).toEqual(['added', 'removed'])
  })

  it('제약 변경도 테이블을 "바뀜"으로 만든다', () => {
    const pk = (name: string): Constraint => ({
      id: constraintId(undefined, 't', 'pk', name),
      name,
      kind: 'pk',
      columns: [{ columnId: columnId(undefined, 't', 'id') }]
    })

    const before = snap([table('t', [col('id')], [pk('pk_old')])])
    const after = snap([table('t', [col('id')], [pk('pk_new')])])

    const v = buildDiffView(before, after)
    expect(v.tables[0].changed).toBe(true)
    expect(v.tables[0].constraints.map((k) => k.status).sort()).toEqual(['added', 'removed'])
  })

  it('FK 정책만 바뀌어도 "바뀜"이다 — SQL 은 나가는데 대조표만 조용하면 안 된다', () => {
    const fk = (over: Partial<Constraint>): Constraint => ({
      id: constraintId(undefined, 't', 'fk', 'fk_u'),
      name: 'fk_u',
      kind: 'fk',
      columns: [{ columnId: columnId(undefined, 't', 'user_id') }],
      refTable: 'users',
      refColumns: ['id'],
      ...over
    })

    const before = snap([table('t', [col('user_id')], [fk({ onDelete: 'RESTRICT' })])])
    const after = snap([table('t', [col('user_id')], [fk({ onDelete: 'CASCADE' })])])

    const v = buildDiffView(before, after)
    expect(v.tables[0].changed).toBe(true)
    expect(v.tables[0].constraints[0].status).toBe('modified')
  })

  it('사라지는 제약의 컬럼은 before 쪽으로 푼다 — after 에는 그 컬럼이 없다', () => {
    const idx: Constraint = {
      id: constraintId(undefined, 't', 'idx', 'ix_gone'),
      name: 'ix_gone',
      kind: 'idx',
      columns: [{ columnId: columnId(undefined, 't', 'gone') }]
    }

    const before = snap([table('t', [col('id'), col('gone')], [idx])])
    const after = snap([table('t', [col('id')])])

    const row = buildDiffView(before, after).tables[0].constraints[0]
    expect(row.status).toBe('removed')
    expect(row.cols.map((c) => c.name)).toEqual(['gone'])
  })
})

describe('schemasOf · filterView', () => {
  const at = (schema: string | undefined, name: string, columns: Column[]): TableDef => ({
    ...table(name, columns),
    id: tableId(schema, name),
    schema
  })

  /** service1 은 안 바뀌고, service2 는 컬럼이 하나 늘고, service3 은 테이블째 생긴다. */
  const before = snap([at('service1', 'a', [col('id')]), at('service2', 'b', [col('id')])])
  const after = snap([
    at('service1', 'a', [col('id')]),
    at('service2', 'b', [col('id'), col('memo')]),
    at('service3', 'c', [col('id')])
  ])

  it('스키마마다 전체 수와 바뀌는 수를 센다', () => {
    expect(schemasOf(buildDiffView(before, after))).toEqual([
      { name: 'service1', total: 1, changed: 0 },
      { name: 'service2', total: 1, changed: 1 },
      { name: 'service3', total: 1, changed: 1 }
    ])
  })

  it('스키마가 없는 테이블은 빈 이름 한 칸으로 모인다', () => {
    const v = buildDiffView(snap([]), snap([at(undefined, 'solo', [col('id')])]))
    expect(schemasOf(v)).toEqual([{ name: '', total: 1, changed: 1 }])
  })

  it('켠 스키마만 남기고, 바뀜 수도 그 안에서 다시 센다', () => {
    const v = filterView(buildDiffView(before, after), new Set(['service1']))
    expect(v.tables.map((t) => t.name)).toEqual(['a'])
    expect(v.changedCount).toBe(0)
  })

  it('전부 끄면 빈 대조표다 — 화면이 토글을 계속 그려야 되돌릴 수 있다', () => {
    const v = filterView(buildDiffView(before, after), new Set())
    expect(v.tables).toEqual([])
    expect(v.changedCount).toBe(0)
  })
})
