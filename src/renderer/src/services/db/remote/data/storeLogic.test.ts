import { beforeEach, describe, expect, it } from 'vitest'
import type { TableDef } from '../../workspaces/definition/types'
import { rowKey, useDataStore, viewKey } from './store'

/**
 * Data 스토어 커밋문 생성 순서(pending 버퍼 → SQL) 검증 — window/IPC 불필요(순수 상태→출력).
 * 순서 불변: 삭제 → 수정(삭제행 제외) → 삽입. PK 로 rowKey 매칭.
 */
const tableDef: TableDef = {
  id: 't:u',
  designId: 'd',
  name: 'u',
  comment: '',
  columns: [
    { id: 'c:u.id', name: 'id', type: 'int', nullable: false, defaultValue: null, comment: '' },
    { id: 'c:u.name', name: 'name', type: 'text', nullable: true, defaultValue: null, comment: '' }
  ],
  constraints: [{ id: 'k', kind: 'pk', name: 'pk', columns: [{ columnId: 'c:u.id' }] }]
}
const pk = ['id']
const rows = [
  { id: 1, name: 'a' },
  { id: 2, name: 'b' }
]

beforeEach(() => {
  useDataStore.setState({ table: { name: 'u' }, columns: ['id', 'name'], rows, edits: {}, deletes: {}, inserts: [] })
})

describe('buildStatements 순서/규칙', () => {
  it('삭제→수정→삽입 순, 파라미터 바인드', () => {
    useDataStore.setState({
      edits: { [rowKey(pk, rows[0])]: { name: 'A' } },
      deletes: { [rowKey(pk, rows[1])]: true },
      inserts: [{ tempId: 'n0', values: { name: 'c' } }]
    })
    const stmts = useDataStore.getState().buildStatements('postgresql', tableDef)
    expect(stmts.map((s) => s.sql.split(' ')[0])).toEqual(['DELETE', 'UPDATE', 'INSERT'])
    expect(stmts[0].sql).toBe('DELETE FROM "u" WHERE "id" = $1')
    expect(stmts[0].params).toEqual([2])
    expect(stmts[1].sql).toBe('UPDATE "u" SET "name" = $1 WHERE "id" = $2')
    expect(stmts[1].params).toEqual(['A', 1])
  })

  it('삭제된 행은 수정문을 만들지 않는다', () => {
    const key = rowKey(pk, rows[0])
    useDataStore.setState({ edits: { [key]: { name: 'A' } }, deletes: { [key]: true } })
    const stmts = useDataStore.getState().buildStatements('postgresql', tableDef)
    expect(stmts.map((s) => s.sql.split(' ')[0])).toEqual(['DELETE'])
  })

  it('빈 pending → 문 없음', () => {
    expect(useDataStore.getState().buildStatements('mysql', tableDef)).toEqual([])
  })

  // 회귀(2026-08-01 화면 피드백): 범위를 켜서 보는 표는 그 스키마에 있다. 커밋문이 이름만
  // 쓰면 연결의 기본 스키마로 나가 없는 테이블을 고치려 들거나 남의 표를 고친다.
  it('테이블에 스키마가 있으면 커밋문도 한정 이름을 쓴다', () => {
    const scoped: TableDef = { ...tableDef, schema: 'service1' }
    const key = rowKey(pk, rows[0])
    useDataStore.setState({
      edits: { [key]: { name: 'A' } },
      deletes: { [rowKey(pk, rows[1])]: true },
      inserts: [{ tempId: 'n0', values: { name: 'c' } }]
    })
    const stmts = useDataStore.getState().buildStatements('mysql', scoped)
    expect(stmts.map((s) => s.sql)).toEqual([
      'DELETE FROM `service1`.`u` WHERE `id` = ?',
      'UPDATE `service1`.`u` SET `name` = ? WHERE `id` = ?',
      'INSERT INTO `service1`.`u` (`name`) VALUES (?)'
    ])
  })
})

/**
 * CASE-remote-063 · 064 — 표별 보기 상태와 조건 켬/끔(§db-remote.data.filter AC-2/AC-3).
 * IPC 없이 판정되는 부분만 본다: `patchView` 로 쓰고 `views` 로 되살리는 왕복.
 */
describe('표마다 조건을 기억한다', () => {
  const A = { schema: 'public', name: 'users' }
  const B = { schema: 'public', name: 'orders' }
  const cond = [{ column: 'email', op: 'LIKE' as const, value: '%a%' }]

  beforeEach(() => {
    useDataStore.setState({ table: null, views: {}, filters: [], filtersEnabled: true, page: 0, orderBy: null })
  })

  it('patchView 는 지금 보는 값과 표별 기억을 함께 쓴다', () => {
    useDataStore.setState({ table: A })
    useDataStore.getState().patchView({ filters: cond, page: 3 })
    const s = useDataStore.getState()
    expect(s.filters).toEqual(cond)
    expect(s.page).toBe(3)
    expect(s.views[viewKey(A)]).toEqual({ filters: cond, filtersEnabled: true, page: 3, orderBy: null })
  })

  it('다른 표로 옮기면 그 표의 조건이 따라오지 않는다', () => {
    useDataStore.setState({ table: A })
    useDataStore.getState().patchView({ filters: cond })
    // 표 B 를 처음 여는 것과 같은 상태 — 저장된 것이 없으니 빈 조건.
    expect(useDataStore.getState().views[viewKey(B)]).toBeUndefined()
  })

  it('돌아오면 그 표의 조건·정렬·쪽·켬끔이 되살아난다', () => {
    useDataStore.setState({ table: A })
    useDataStore.getState().patchView({
      filters: cond,
      filtersEnabled: false,
      page: 2,
      orderBy: { column: 'id', direction: 'DESC' }
    })
    const saved = useDataStore.getState().views[viewKey(A)]
    expect(saved).toEqual({
      filters: cond,
      filtersEnabled: false,
      page: 2,
      orderBy: { column: 'id', direction: 'DESC' }
    })
  })

  it('스키마가 다른 같은 이름 표는 서로 다른 표다', () => {
    // 범위(scope)에 스키마가 둘 이상 켜지면 `service1.users` 와 `service2.users` 가 함께 뜬다.
    expect(viewKey({ schema: 'service1', name: 'users' })).not.toBe(viewKey({ schema: 'service2', name: 'users' }))
  })

  it('고른 표가 없으면 기억에 아무것도 안 쌓는다', () => {
    useDataStore.setState({ table: null })
    useDataStore.getState().patchView({ filters: cond })
    expect(useDataStore.getState().views).toEqual({})
    expect(useDataStore.getState().filters).toEqual(cond)
  })

  it('끔은 조건을 지우지 않는다 — 조건 목록은 그대로 남는다', () => {
    useDataStore.setState({ table: A })
    useDataStore.getState().patchView({ filters: cond })
    useDataStore.getState().patchView({ filtersEnabled: false })
    const s = useDataStore.getState()
    expect(s.filtersEnabled).toBe(false)
    expect(s.filters).toEqual(cond) // 배지가 세는 개수도 그대로 1
  })
})

/** CASE-remote-062 — 늦게 온 셈은 버린다(§db-remote.data.paging AC-5). */
describe('applyCount — 늦은 셈 무시', () => {
  beforeEach(() => {
    useDataStore.setState({ countSeq: 5, total: null, counting: true })
  })

  it('최신 일련번호면 반영한다', () => {
    useDataStore.getState().applyCount(5, 1200)
    expect(useDataStore.getState().total).toBe(1200)
    expect(useDataStore.getState().counting).toBe(false)
  })

  it('낡은 일련번호면 버린다 — 셈 중 표시도 그대로 둔다', () => {
    useDataStore.getState().applyCount(4, 999)
    expect(useDataStore.getState().total).toBeNull()
    expect(useDataStore.getState().counting).toBe(true)
  })

  it('셈이 실패해 null 이 와도 최신이면 반영한다(총 쪽수 "모름")', () => {
    useDataStore.setState({ total: 10 })
    useDataStore.getState().applyCount(5, null)
    expect(useDataStore.getState().total).toBeNull()
    expect(useDataStore.getState().counting).toBe(false)
  })
})
