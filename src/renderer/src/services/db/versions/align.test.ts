import { describe, it, expect } from 'vitest'
import type { TableDef } from '../workspaces/definition/types'
import { alignSnapshotToActual } from './align'
import { diffSnapshots, isEmptyDiff } from './diff'

/** Design 에서 저작한 스타일(순번 id) orders 테이블. */
const authoredOrders = (): TableDef => ({
  id: 'o1',
  designId: 'd1',
  name: 'orders',
  comment: '',
  columns: [
    { id: 'o2', name: 'id', type: 'BIGINT', nullable: false, defaultValue: null, comment: '' },
    { id: 'o3', name: 'total', type: 'DECIMAL(12,2)', nullable: false, defaultValue: '0.00', comment: '' }
  ],
  constraints: [
    { id: 'oc1', kind: 'pk', name: 'pk_orders', columns: [{ columnId: 'o2' }] }
  ]
})

/** 역설계 스타일(이름 기반 id) orders 테이블 — 위와 구조 동일, 제약 이름만 DB 정규화(PRIMARY). */
const introspectedOrders = (): TableDef => ({
  id: 't:orders',
  designId: '',
  name: 'orders',
  comment: '',
  columns: [
    { id: 'c:orders.id', name: 'id', type: 'BIGINT', nullable: false, defaultValue: null, comment: '' },
    { id: 'c:orders.total', name: 'total', type: 'DECIMAL(12,2)', nullable: false, defaultValue: '0.00', comment: '' }
  ],
  constraints: [
    { id: 'k:orders.PRIMARY', kind: 'pk', name: 'PRIMARY', columns: [{ columnId: 'c:orders.id' }] }
  ]
})

describe('alignSnapshotToActual — 설계↔실DB 경계 정렬', () => {
  it('구조가 같으면 정렬 후 diff 가 비어야 한다(핵심 회귀: +전부/−전부 오판 제거)', () => {
    const design = { tables: [authoredOrders()] }
    const actual = { tables: [introspectedOrders()] }
    // 정렬 없이 비교하면 삭제+추가로 오판된다 — 문제 재현.
    expect(isEmptyDiff(diffSnapshots(design, actual))).toBe(false)
    // 정렬 후엔 같은 테이블로 인식 → 차이 없음.
    const aligned = alignSnapshotToActual(design, actual)
    expect(isEmptyDiff(diffSnapshots(aligned, actual))).toBe(true)
  })

  it('테이블·컬럼 id 를 이름 기반 스킴으로 재계산한다', () => {
    const aligned = alignSnapshotToActual({ tables: [authoredOrders()] }, { tables: [] })
    const t = aligned.tables[0]
    expect(t.id).toBe('t:orders')
    expect(t.columns.map((c) => c.id)).toEqual(['c:orders.id', 'c:orders.total'])
    // 제약의 컬럼 참조도 같은 매핑으로 갱신
    expect(t.constraints[0].columns[0].columnId).toBe('c:orders.id')
  })

  it('구조가 같은 제약은 actual 의 id·이름을 입양한다(PRIMARY vs pk_orders 라벨 소음 제거)', () => {
    const aligned = alignSnapshotToActual({ tables: [authoredOrders()] }, { tables: [introspectedOrders()] })
    const pk = aligned.tables[0].constraints[0]
    expect(pk.id).toBe('k:orders.PRIMARY')
    expect(pk.name).toBe('PRIMARY')
  })

  it('진짜 변경(컬럼 추가)은 그 변경만 남는다', () => {
    const actualT = introspectedOrders()
    actualT.columns.push({ id: 'c:orders.memo', name: 'memo', type: 'VARCHAR(255)', nullable: true, defaultValue: null, comment: '' })
    const aligned = alignSnapshotToActual({ tables: [authoredOrders()] }, { tables: [actualT] })
    const diff = diffSnapshots(aligned, { tables: [actualT] })
    expect(diff.summary.tablesAdded).toBe(0)
    expect(diff.summary.tablesRemoved).toBe(0)
    expect(diff.summary.tablesModified).toBe(1)
    expect(diff.summary.columnsAdded).toBe(1)
    expect(diff.summary.columnsRemoved).toBe(0)
  })

  it('이름이 다른 테이블은 정직하게 추가/삭제로 남는다(경계 rename 은 원리상 미추적 — 합의)', () => {
    const design = { tables: [authoredOrders()] }
    const other = introspectedOrders()
    other.id = 't:order_v2'
    other.name = 'order_v2'
    const aligned = alignSnapshotToActual(design, { tables: [other] })
    const diff = diffSnapshots(aligned, { tables: [other] })
    expect(diff.summary.tablesRemoved).toBe(1) // orders
    expect(diff.summary.tablesAdded).toBe(1) // order_v2
  })

  it('구조 같은 제약이 여럿이면 하나씩만 입양한다(이중 입양 방지)', () => {
    const design = authoredOrders()
    design.constraints = [
      { id: 'x1', kind: 'idx', name: 'idx_a', columns: [{ columnId: 'o3' }] },
      { id: 'x2', kind: 'idx', name: 'idx_b', columns: [{ columnId: 'o3' }] }
    ]
    const actual = introspectedOrders()
    actual.constraints = [
      { id: 'k:orders.idx_1', kind: 'idx', name: 'idx_1', columns: [{ columnId: 'c:orders.total' }] }
    ]
    const aligned = alignSnapshotToActual({ tables: [design] }, { tables: [actual] })
    const ids = aligned.tables[0].constraints.map((k) => k.id)
    expect(ids.filter((i) => i === 'k:orders.idx_1')).toHaveLength(1) // 하나만 입양
  })

  it('원본을 변형하지 않는다(순수)', () => {
    const design = { tables: [authoredOrders()] }
    const actual = { tables: [introspectedOrders()] }
    alignSnapshotToActual(design, actual)
    expect(design.tables[0].id).toBe('o1')
    expect(design.tables[0].columns[0].id).toBe('o2')
    expect(design.tables[0].constraints[0].name).toBe('pk_orders')
    expect(actual.tables[0].constraints).toHaveLength(1)
  })
})
