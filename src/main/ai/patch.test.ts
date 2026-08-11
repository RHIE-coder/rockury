import { describe, expect, it } from 'vitest'
import type { TableRecord } from '../store/tables'
import {
  applyOperations,
  assertTablesConsistent,
  patchOpSchema,
  type ColumnRecord,
  type ConstraintRecord,
  type PatchOp
} from './patch'

/**
 * 부분 수정 엔진 — 순수 함수라 저장소 없이 검증한다.
 * 핵심 관심사: ① 이름으로 조준이 되는가 ② 남이 가리키는 참조를 따라 고치거나 막는가
 * ③ 실패 시 아무것도 바뀌지 않는가(원자성).
 */

const col = (id: string, name: string, extra: Partial<ColumnRecord> = {}): ColumnRecord => ({
  id,
  name,
  type: 'INT',
  nullable: true,
  defaultValue: null,
  comment: '',
  ...extra
})

const fixture = (): TableRecord[] => [
  {
    id: 't_users',
    designId: 'd1',
    name: 'users',
    comment: '회원',
    columns: [col('u1', 'id', { nullable: false }), col('u2', 'email', { type: 'VARCHAR(255)' })],
    constraints: [{ id: 'uc1', kind: 'pk', name: 'pk_users', columns: [{ columnId: 'u1' }] }]
  },
  {
    id: 't_orders',
    designId: 'd1',
    name: 'orders',
    comment: '주문',
    columns: [col('o1', 'id', { nullable: false }), col('o2', 'user_id'), col('o3', 'memo', { comment: '옛 주석' })],
    constraints: [
      { id: 'oc1', kind: 'pk', name: 'pk_orders', columns: [{ columnId: 'o1' }] },
      {
        id: 'oc2',
        kind: 'fk',
        name: 'fk_orders_user',
        columns: [{ columnId: 'o2' }],
        refTable: 'users',
        refColumns: ['id']
      }
    ]
  }
]

let seq = 0
const newId = (): string => `new${++seq}`
const apply = (ops: PatchOp[], tables = fixture(), declared: string[] = []) =>
  applyOperations('d1', tables, ops, newId, declared)

const tableOf = (tables: TableRecord[], name: string): TableRecord => tables.find((t) => t.name === name)!
const colsOf = (t: TableRecord): ColumnRecord[] => t.columns as ColumnRecord[]
const kaysOf = (t: TableRecord): ConstraintRecord[] => t.constraints as ConstraintRecord[]

describe('applyOperations — 컬럼·테이블 편집', () => {
  it('update_column: 주석 한 줄만 고친다 — 나머지는 그대로 (실제 사고의 회귀)', () => {
    const { tables, changes } = apply([
      { op: 'update_column', table: 'orders', column: 'memo', set: { comment: '고친 주석' } }
    ])
    const memo = colsOf(tableOf(tables, 'orders')).find((c) => c.name === 'memo')!
    expect(memo.comment).toBe('고친 주석')
    expect(memo.id).toBe('o3') // id 보존 — 제약 참조가 안 끊긴다
    expect(memo.type).toBe('INT')
    expect(colsOf(tableOf(tables, 'orders'))).toHaveLength(3)
    expect(changes).toEqual(['테이블 "orders" 컬럼 "memo" 수정: comment'])
  })

  it('원본 배열·레코드를 건드리지 않는다(복제 후 수정)', () => {
    const before = fixture()
    apply([{ op: 'update_column', table: 'orders', column: 'memo', set: { comment: 'X' } }], before)
    expect(colsOf(tableOf(before, 'orders')).find((c) => c.name === 'memo')!.comment).toBe('옛 주석')
  })

  it('add_column: after 로 위치를 지정하고, 생략하면 맨 뒤', () => {
    const { tables } = apply([
      { op: 'add_column', table: 'orders', column: { name: 'status', type: 'VARCHAR(20)' }, after: 'id' },
      { op: 'add_column', table: 'orders', column: { name: 'created_at', type: 'DATETIME' } }
    ])
    expect(colsOf(tableOf(tables, 'orders')).map((c) => c.name)).toEqual([
      'id',
      'status',
      'user_id',
      'memo',
      'created_at'
    ])
  })

  it('add_column: 기본값을 채운다(nullable=true, defaultValue=null, comment="")', () => {
    const { tables } = apply([{ op: 'add_column', table: 'users', column: { name: 'nick', type: 'VARCHAR(40)' } }])
    const nick = colsOf(tableOf(tables, 'users')).find((c) => c.name === 'nick')!
    expect(nick).toMatchObject({ nullable: true, defaultValue: null, comment: '' })
    expect(nick.id).toMatch(/^new/)
  })

  it('add_table: 제약을 컬럼 이름으로 걸 수 있다(내부 id 몰라도 됨)', () => {
    const { tables } = apply([
      {
        op: 'add_table',
        table: 'payment',
        comment: '결제',
        columns: [
          { name: 'id', type: 'BIGINT', nullable: false },
          { name: 'order_id', type: 'BIGINT', nullable: false }
        ],
        constraints: [
          { kind: 'pk', name: 'pk_payment', columns: ['id'] },
          { kind: 'fk', name: 'fk_payment_order', columns: ['order_id'], refTable: 'orders', refColumns: ['id'] }
        ]
      }
    ])
    const pay = tableOf(tables, 'payment')
    expect(pay.designId).toBe('d1')
    const pk = kaysOf(pay).find((k) => k.kind === 'pk')!
    expect(pk.columns[0].columnId).toBe(colsOf(pay)[0].id) // 이름 → id 해석 성공
    expect(assertTablesConsistent(tables)).toBeUndefined()
  })

  it('add_constraint / drop_constraint 는 이름으로 조준한다', () => {
    const { tables } = apply([
      { op: 'add_constraint', table: 'users', constraint: { kind: 'uk', name: 'uq_users_email', columns: ['email'] } },
      { op: 'drop_constraint', table: 'orders', name: 'fk_orders_user' }
    ])
    expect(kaysOf(tableOf(tables, 'users')).map((k) => k.name)).toEqual(['pk_users', 'uq_users_email'])
    expect(kaysOf(tableOf(tables, 'orders')).map((k) => k.name)).toEqual(['pk_orders'])
  })

  it('set_table_comment / drop_table', () => {
    const { tables } = apply([
      { op: 'set_table_comment', table: 'users', comment: '회원 원장' },
      { op: 'drop_constraint', table: 'orders', name: 'fk_orders_user' },
      { op: 'drop_table', table: 'users' }
    ])
    expect(tables.map((t) => t.name)).toEqual(['orders'])
  })
})

describe('applyOperations — 남이 가리키는 참조', () => {
  it('rename_table: 가리키던 FK 의 refTable 도 따라 바뀐다', () => {
    const { tables, changes } = apply([{ op: 'rename_table', table: 'users', newName: 'member' }])
    expect(kaysOf(tableOf(tables, 'orders')).find((k) => k.kind === 'fk')!.refTable).toBe('member')
    expect(changes[0]).toContain('FK 1개 갱신')
  })

  it('update_column 개명: FK 의 refColumns 도 따라 바뀐다', () => {
    const { tables, changes } = apply([
      { op: 'update_column', table: 'users', column: 'id', set: { name: 'user_no' } }
    ])
    expect(kaysOf(tableOf(tables, 'orders')).find((k) => k.kind === 'fk')!.refColumns).toEqual(['user_no'])
    expect(changes.some((c) => c.includes('참조 컬럼 이름도 갱신'))).toBe(true)
  })

  it('update_column 개명: CHECK 식은 자동으로 못 고치므로 경고로 알린다', () => {
    const tables = fixture()
    kaysOf(tableOf(tables, 'orders')).push({
      id: 'oc3',
      kind: 'check',
      name: 'chk_memo',
      columns: [],
      expression: 'LENGTH(memo) > 0'
    })
    const { warnings } = apply([{ op: 'update_column', table: 'orders', column: 'memo', set: { name: 'note' } }], tables)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('LENGTH(memo) > 0')
  })

  it('drop_table: 가리키는 FK 가 남아 있으면 막고 무엇을 먼저 떼라고 알려준다', () => {
    expect(() => apply([{ op: 'drop_table', table: 'users' }])).toThrowError(
      /orders\.fk_orders_user.*drop_constraint/s
    )
  })

  it('drop_column: 같은 테이블 제약이 쓰는 컬럼이면 막는다', () => {
    expect(() => apply([{ op: 'drop_column', table: 'orders', column: 'id' }])).toThrowError(
      /PK pk_orders.*drop_constraint/s
    )
  })

  it('drop_column: 자기 제약을 떼어냈어도 남의 FK 가 가리키면 막는다', () => {
    expect(() =>
      apply([
        { op: 'drop_constraint', table: 'users', name: 'pk_users' },
        { op: 'drop_column', table: 'users', column: 'id' }
      ])
    ).toThrowError(/가리키는 FK 가 있습니다: orders\.fk_orders_user/)
  })

  it('제약을 먼저 떼면 컬럼·테이블을 지울 수 있다(순서대로 적용)', () => {
    const { tables } = apply([
      { op: 'drop_constraint', table: 'orders', name: 'pk_orders' },
      { op: 'drop_column', table: 'orders', column: 'id' }
    ])
    expect(colsOf(tableOf(tables, 'orders')).map((c) => c.name)).toEqual(['user_id', 'memo'])
  })
})

describe('applyOperations — 실패 안내와 원자성', () => {
  it('없는 테이블: 쓸 수 있는 이름 목록을 함께 준다', () => {
    expect(() => apply([{ op: 'set_table_comment', table: 'order', comment: 'x' }])).toThrowError(
      /테이블 "order" 이 없습니다.*users, orders/s
    )
  })

  it('없는 컬럼: 그 테이블의 컬럼 목록을 함께 준다', () => {
    expect(() => apply([{ op: 'update_column', table: 'orders', column: 'note', set: { comment: 'x' } }])).toThrowError(
      /컬럼 "note" 이 없습니다.*id, user_id, memo/s
    )
  })

  it('중복 생성은 막는다 — 이미 있는 테이블·컬럼·제약 이름', () => {
    expect(() => apply([{ op: 'add_table', table: 'users', columns: [{ name: 'a', type: 'INT' }] }])).toThrowError(
      /이미 있습니다/
    )
    expect(() => apply([{ op: 'add_column', table: 'users', column: { name: 'email', type: 'INT' } }])).toThrowError(
      /이미 있습니다/
    )
    expect(() =>
      apply([{ op: 'add_constraint', table: 'users', constraint: { kind: 'uk', name: 'pk_users', columns: ['email'] } }])
    ).toThrowError(/제약 이름 "pk_users" 이 이미 있습니다/)
  })

  it('몇 번째 연산에서 멈췄는지 알리고, 앞선 연산도 저장되지 않음을 명시한다', () => {
    const before = fixture()
    expect(() =>
      apply(
        [
          { op: 'set_table_comment', table: 'users', comment: '바뀜' },
          { op: 'set_table_comment', table: 'ghost', comment: 'x' }
        ],
        before
      )
    ).toThrowError(/연산 #2\(set_table_comment\) 실패.*반영 0/s)
    expect(tableOf(before, 'users').comment).toBe('회원') // 1번 연산도 원본에 남지 않는다
  })

  it('add_constraint 가 없는 컬럼을 가리키면 거부', () => {
    expect(() =>
      apply([{ op: 'add_constraint', table: 'users', constraint: { kind: 'uk', columns: ['ghost'] } }])
    ).toThrowError(/컬럼 "ghost" 이 없습니다/)
  })
})

describe('patchOpSchema — 입력 구조 검증', () => {
  it('미지의 op 는 거부', () => {
    expect(patchOpSchema.safeParse({ op: 'truncate', table: 'x' }).success).toBe(false)
  })

  it('update_column 의 set 이 비면 거부 — 무엇을 바꿀지 없는 연산', () => {
    expect(patchOpSchema.safeParse({ op: 'update_column', table: 'a', column: 'b', set: {} }).success).toBe(false)
  })

  it('add_table 에 컬럼이 없으면 거부', () => {
    expect(patchOpSchema.safeParse({ op: 'add_table', table: 'a', columns: [] }).success).toBe(false)
  })

  it('정상 연산은 통과', () => {
    expect(
      patchOpSchema.safeParse({ op: 'update_column', table: 'a', column: 'b', set: { comment: 'x' } }).success
    ).toBe(true)
  })
})

describe('assertTablesConsistent — 저장 직전 관문', () => {
  it('정상 스키마는 통과', () => {
    expect(() => assertTablesConsistent(fixture())).not.toThrow()
  })

  it('중복 테이블 이름·중복 컬럼 이름·없는 컬럼 참조를 각각 잡는다', () => {
    const dupTable = [...fixture(), { ...fixture()[0], id: 't_users2' }]
    expect(() => assertTablesConsistent(dupTable)).toThrowError(/중복 테이블 이름 "users"/)

    const dupCol = fixture()
    colsOf(dupCol[0]).push(col('u3', 'email'))
    expect(() => assertTablesConsistent(dupCol)).toThrowError(/중복 컬럼 이름 "email"/)

    const ghostRef = fixture()
    kaysOf(ghostRef[0])[0].columns = [{ columnId: 'nope' }]
    expect(() => assertTablesConsistent(ghostRef)).toThrowError(/없는 컬럼 "nope"/)
  })

  it('중복 id 를 잡는다', () => {
    const dupId = fixture()
    colsOf(dupId[1])[0].id = 'u1'
    expect(() => assertTablesConsistent(dupId)).toThrowError(/중복 id "u1"/)
  })
})

// ── 스키마 저작 (2026-08-11) — 화면으로만 되던 것을 MCP 에도 열면서 함께 들어온 규칙.
describe('add_table 의 소속 스키마', () => {
  it('선언된 첫 스키마로 채운다 — 비워 두면 그 표만 이름이 없어져 설계 전체가 한정 이름을 잃는다', () => {
    const out = apply(
      [{ op: 'add_table', table: 'logs', columns: [{ name: 'id', type: 'INT' }] }],
      fixture(),
      ['testdb', 'auth']
    )
    expect(out.tables.find((t) => t.name === 'logs')?.schema).toBe('testdb')
  })

  it('준 이름이 선언보다 이긴다', () => {
    const out = apply(
      [{ op: 'add_table', table: 'logs', schema: 'auth', columns: [{ name: 'id', type: 'INT' }] }],
      fixture(),
      ['testdb', 'auth']
    )
    expect(out.tables.find((t) => t.name === 'logs')?.schema).toBe('auth')
  })

  it('선언이 없고 쓰는 스키마가 하나면 그것 — 엉뚱한 묶음을 새로 안 만든다', () => {
    const tables = fixture().map((t) => ({ ...t, schema: 'shop' }))
    const out = apply([{ op: 'add_table', table: 'logs', columns: [{ name: 'id', type: 'INT' }] }], tables)
    expect(out.tables.find((t) => t.name === 'logs')?.schema).toBe('shop')
  })

  it('정할 근거가 없으면 안 담는다 — 이름을 지어내지 않는다', () => {
    const out = apply([{ op: 'add_table', table: 'logs', columns: [{ name: 'id', type: 'INT' }] }])
    expect(out.tables.find((t) => t.name === 'logs')?.schema).toBeUndefined()
  })

  it('바뀜 기록에 한정 이름을 적는다', () => {
    const out = apply(
      [{ op: 'add_table', table: 'logs', columns: [{ name: 'id', type: 'INT' }] }],
      fixture(),
      ['testdb']
    )
    expect(out.changes[0]).toContain('"testdb.logs"')
  })
})

describe('rename_schema', () => {
  const scoped = (schema: string): TableRecord[] => fixture().map((t) => ({ ...t, schema }))

  it('표 전부를 옮기고 선언도 함께 바꾼다 — 한쪽만 바꾸면 유령 스키마가 남는다', () => {
    const out = apply([{ op: 'rename_schema', from: 'public', to: 'testdb' }], scoped('public'), ['public'])
    expect(out.tables.every((t) => t.schema === 'testdb')).toBe(true)
    expect(out.declaredSchemas).toEqual(['testdb'])
  })

  it('선언 목록에서 자리를 지킨다 — 기본 스키마가 갑자기 딴 것이 되면 안 된다', () => {
    const out = apply([{ op: 'rename_schema', from: 'public', to: 'testdb' }], scoped('public'), [
      'public',
      'auth'
    ])
    expect(out.declaredSchemas).toEqual(['testdb', 'auth'])
  })

  it('옛 이름을 가리키던 교차 스키마 FK 도 따라 고친다 — 안 고치면 참조가 범위 밖으로 떨어진다', () => {
    const tables = scoped('public')
    const orders = tables.find((t) => t.name === 'orders')!
    orders.schema = 'auth'
    ;(orders.constraints as ConstraintRecord[]).push({
      id: 'fk_x',
      kind: 'fk',
      name: 'fk_orders_users',
      columns: [{ columnId: 'o2' }],
      refTable: 'users',
      refSchema: 'public'
    })
    const out = apply([{ op: 'rename_schema', from: 'public', to: 'testdb' }], tables, ['public', 'auth'])
    const fk = (out.tables.find((t) => t.name === 'orders')!.constraints as ConstraintRecord[]).find(
      (k) => k.id === 'fk_x'
    )
    expect(fk?.refSchema).toBe('testdb')
    expect(out.changes[0]).toContain('FK 참조 1개 갱신')
  })

  it('빈 from 은 이름 없는 표를 거둔다 — 선언 기능 이전 데이터를 옮기는 길', () => {
    const out = apply([{ op: 'rename_schema', from: '', to: 'testdb' }], fixture(), [])
    expect(out.tables.every((t) => t.schema === 'testdb')).toBe(true)
    expect(out.declaredSchemas).toEqual(['testdb'])
  })

  it('없는 스키마를 바꾸라면 거부한다 — 조용히 아무 일도 안 하면 오타를 못 잡는다', () => {
    expect(() => apply([{ op: 'rename_schema', from: 'nope', to: 'x' }], scoped('public'), ['public'])).toThrow(
      /없습니다/
    )
  })

  it('이미 있는 이름으로는 못 바꾼다', () => {
    expect(() =>
      apply([{ op: 'rename_schema', from: 'public', to: 'auth' }], scoped('public'), ['public', 'auth'])
    ).toThrow(/이미 있는 이름/)
  })

  it('엔진이 거부하는 글자를 막는다', () => {
    expect(() =>
      apply([{ op: 'rename_schema', from: 'public', to: 'a b' }], scoped('public'), ['public'])
    ).toThrow(/쓸 수 없습니다/)
  })

  it('이름을 안 바꾼 연산만 있으면 선언을 되쓰지 않는다 — 건드리지 않은 값을 덮지 않게', () => {
    const out = apply([{ op: 'drop_column', table: 'users', column: 'email' }], scoped('public'), ['public'])
    expect(out.declaredSchemas).toBeUndefined()
  })
})

describe('교차 스키마 FK 어휘', () => {
  it('add_constraint 가 refSchema 를 정식으로 받는다', () => {
    const parsed = patchOpSchema.safeParse({
      op: 'add_constraint',
      table: 'orders',
      constraint: { kind: 'fk', columns: ['user_id'], refTable: 'users', refSchema: 'auth' }
    })
    expect(parsed.success).toBe(true)
  })
})
