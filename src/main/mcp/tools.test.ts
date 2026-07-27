import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setDbPath } from '../store/db'
import { replaceTablesForDesign } from '../store/tables'
import { createVersion } from '../store/versions'
import { setStoreChangeNotifier, TOOL_DEFS, type StoreChangedEvent } from './tools'

/**
 * MCP 도구 핸들러 기능 검증 — 임시 SQLite(setDbPath, 시드 포함) 위에서 실제 조회 로직을 돈다.
 * stores.test.ts 와 같은 seam. 실 앱 DB 무관.
 */

const tool = (name: string) => {
  const t = TOOL_DEFS.find((x) => x.name === name)
  if (!t) throw new Error(`도구 없음: ${name}`)
  return t
}

beforeAll(() => {
  setDbPath(join(mkdtempSync(join(tmpdir(), 'rockury-mcp-')), 'test.db'))
})

describe('MCP 도구 핸들러', () => {
  it('list_designs — 시드 설계(commerce-core)와 테이블 수·최신 버전을 반환', () => {
    const rows = tool('list_designs').handler({}) as Array<{
      id: string
      dialect: string
      tableCount: number
      latestVersion: string | null
    }>
    const cc = rows.find((r) => r.id === 'commerce-core')
    expect(cc).toBeTruthy()
    expect(cc!.dialect).toBe('mysql')
    expect(cc!.tableCount).toBe(4)
    expect(cc!.latestVersion).toBe('v0.3.14') // 시드 버전 중 최신
  })

  it('get_schema — 테이블·컬럼·제약 전체를 반환', () => {
    const out = tool('get_schema').handler({ designId: 'commerce-core' }) as {
      design: { id: string }
      tables: Array<{ name: string; columns: unknown[]; constraints: unknown[] }>
    }
    expect(out.design.id).toBe('commerce-core')
    const orders = out.tables.find((t) => t.name === 'orders')
    expect(orders).toBeTruthy()
    expect(orders!.columns.length).toBeGreaterThan(5)
    expect(orders!.constraints.length).toBeGreaterThan(2)
  })

  it('get_schema — 미상 설계는 안내 메시지와 함께 throw', () => {
    expect(() => tool('get_schema').handler({ designId: 'no-such' })).toThrowError(/list_designs/)
  })

  it('list_versions — 스냅샷 본문 없이 메타만, 최신순', () => {
    const rows = tool('list_versions').handler({ designId: 'commerce-core' }) as Array<Record<string, unknown>>
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0].number).toBe('v0.3.14')
    expect(rows[0]).not.toHaveProperty('snapshot')
  })

  it('get_version — 특정 버전의 스냅샷 전체를 반환', () => {
    const v = tool('get_version').handler({ designId: 'commerce-core', number: 'v0.3.13' }) as {
      number: string
      snapshot: { tables: Array<{ name: string }> }
    }
    expect(v.number).toBe('v0.3.13')
    expect(v.snapshot.tables.some((t) => t.name === 'orders')).toBe(true)
  })

  it('get_version — 미상 버전은 안내 메시지와 함께 throw', () => {
    expect(() => tool('get_version').handler({ designId: 'commerce-core', number: 'v9.9.9' })).toThrowError(
      /list_versions/
    )
  })

  it('버전을 추가로 컷하면 list_designs 의 latestVersion 이 따라온다', () => {
    createVersion({ designId: 'commerce-core', number: 'v0.4.0', snapshot: { tables: [] } })
    const rows = tool('list_designs').handler({}) as Array<{ id: string; latestVersion: string | null }>
    expect(rows.find((r) => r.id === 'commerce-core')!.latestVersion).toBe('v0.4.0')
  })
})

describe('MCP 쓰기 도구 핸들러 (2단계) + 리하이드레이션 알림', () => {
  // 알림 spy — 성공 시에만 발행되는지(spec tools.rehydration AC-1)를 도구 경유로 검증.
  const events: StoreChangedEvent[] = []
  beforeAll(() => setStoreChangeNotifier((e) => events.push(e)))
  beforeEach(() => {
    events.length = 0
  })

  const listIds = (): string[] => (tool('list_designs').handler({}) as Array<{ id: string }>).map((r) => r.id)
  const schemaOf = (designId: string) =>
    tool('get_schema').handler({ designId }) as {
      tables: Array<{
        id: string
        name: string
        isView?: boolean
        viewSql?: string
        columns: Array<Record<string, unknown>>
        constraints: Array<{ columns: Array<{ columnId: string }> }>
      }>
    }

  it('CASE-mcp-040/050: create_design — 슬러그 id 생성 + list_designs 등장 + designs 이벤트', () => {
    const rec = tool('create_design').handler({ name: 'Wms Core', dialect: 'postgresql', description: '창고' }) as {
      id: string
      dialect: string
    }
    expect(rec.id).toBe('wms-core')
    expect(rec.dialect).toBe('postgresql')
    expect(listIds()).toContain('wms-core')
    expect(events).toEqual([{ domain: 'designs', designId: 'wms-core' }])
  })

  it('CASE-mcp-041/051: create_design 이름 누락 → 안내 throw + 이벤트 없음', () => {
    expect(() => tool('create_design').handler({ dialect: 'mysql' })).toThrowError(/create_design 입력/)
    expect(events).toEqual([]) // 실패한 쓰기는 화면 재조회를 유발하지 않는다
  })

  // CASE-mcp-080 — 방언은 생성 후 못 바꾸는 값이라 에이전트가 지어내면 안 된다.
  it('CASE-mcp-080: create_design 방언 누락 → "사용자에게 물어보라" + 선택지 4종, 생성 안 함', () => {
    const before = listIds()
    expect(() => tool('create_design').handler({ name: 'Guess Me' })).toThrowError(
      /임의로 고르지 마세요.*사용자에게.*postgresql.*mysql.*mariadb.*sqlite/s
    )
    expect(listIds()).toEqual(before)
    expect(events).toEqual([])
  })

  it('CASE-mcp-081: create_design 미지원 방언(oracle) → 같은 선택 안내(그럴듯한 값으로 재시도 유도 금지)', () => {
    expect(() => tool('create_design').handler({ name: 'x', dialect: 'oracle' })).toThrowError(
      /지원하지 않는 방언.*임의로 고르지 마세요/s
    )
    expect(events).toEqual([])
  })

  it('CASE-mcp-082: 방언 표기 흔들림(대문자·공백)은 받아 준다 — 물어볼 일이 아니다', () => {
    const rec = tool('create_design').handler({ name: 'Case Test', dialect: '  MySQL  ' }) as { dialect: string }
    expect(rec.dialect).toBe('mysql')
  })

  it('CASE-mcp-042: update_design — 부분 수정(생략 필드 유지) + 미상 designId 안내', () => {
    tool('update_design').handler({ designId: 'wms-core', description: '창고 관리 코어' })
    const rows = tool('list_designs').handler({}) as Array<{ id: string; name: string; description: string }>
    const d = rows.find((r) => r.id === 'wms-core')!
    expect(d.name).toBe('Wms Core') // 생략한 이름은 유지
    expect(d.description).toBe('창고 관리 코어')
    expect(events).toEqual([{ domain: 'designs', designId: 'wms-core' }])
    expect(() => tool('update_design').handler({ designId: 'no-such', name: 'x' })).toThrowError(/list_designs/)
  })

  it('CASE-mcp-043/050: set_schema — 왕복 정합(get_schema 일치) + tables 이벤트', () => {
    const tables = [
      {
        name: 'stock',
        comment: '재고',
        columns: [
          { name: 'id', type: 'bigint', nullable: false },
          { name: 'sku', type: 'varchar(64)' }
        ],
        constraints: [{ kind: 'pk', columns: [] }]
      }
    ]
    const out = tool('set_schema').handler({ designId: 'wms-core', tables }) as { tableCount: number }
    expect(out.tableCount).toBe(1)
    const schema = schemaOf('wms-core')
    expect(schema.tables.map((t) => t.name)).toEqual(['stock'])
    expect(schema.tables[0].columns.map((c) => c.name)).toEqual(['id', 'sku'])
    expect(schema.tables[0].columns[1].nullable).toBe(true) // 기본값 채움
    expect(schema.tables[0].id).toMatch(/^mcp_/) // 생성 id 는 렌더러 시퀀스와 안 겹치는 형태
    expect(events).toEqual([{ domain: 'tables', designId: 'wms-core' }])
  })

  it('set_schema — 뷰 표식·본문(isView/viewSql)이 왕복에서 살아남는다', () => {
    tool('set_schema').handler({
      designId: 'wms-core',
      tables: [
        { name: 'stock', columns: [{ name: 'id', type: 'bigint' }] },
        {
          name: 'v_stock_low',
          isView: true,
          viewSql: 'SELECT id FROM stock WHERE qty < 10',
          columns: [{ name: 'id', type: 'bigint' }]
        }
      ]
    })
    const view = schemaOf('wms-core').tables.find((t) => t.name === 'v_stock_low')!
    expect(view.isView).toBe(true)
    expect(view.viewSql).toBe('SELECT id FROM stock WHERE qty < 10')
  })

  it('CASE-mcp-044: set_schema 미상 designId → 안내 throw', () => {
    expect(() => tool('set_schema').handler({ designId: 'no-such', tables: [] })).toThrowError(/list_designs/)
  })

  it('R2: set_schema — 제약이 명시 컬럼 id 를 가리키면 PK-on-new-table 이 성립', () => {
    const out = tool('set_schema').handler({
      designId: 'wms-core',
      tables: [
        {
          name: 'bin',
          columns: [{ id: 'bin_id', name: 'id', type: 'int', nullable: false }],
          constraints: [{ kind: 'pk', columns: [{ columnId: 'bin_id' }] }]
        }
      ]
    }) as { tableCount: number }
    expect(out.tableCount).toBe(1)
    const s = schemaOf('wms-core')
    expect(s.tables[0].constraints[0].columns[0].columnId).toBe('bin_id')
  })

  it('R2: set_schema — 없는 컬럼을 참조하는 제약은 안내 throw(조용한 깨진 스키마 저장 안 함)', () => {
    const before = schemaOf('wms-core')
    expect(() =>
      tool('set_schema').handler({
        designId: 'wms-core',
        tables: [
          {
            name: 'bin',
            columns: [{ name: 'id', type: 'int' }], // id 생략 → 자동 생성, 아래 columnId 와 불일치
            constraints: [{ kind: 'pk', columns: [{ columnId: 'ghost' }] }]
          }
        ]
      })
    ).toThrowError(/없는 컬럼|get_schema/)
    expect(schemaOf('wms-core')).toEqual(before) // 반영 0
  })

  it('R2: set_schema — 중복 테이블명·중복 컬럼명은 안내 throw', () => {
    expect(() =>
      tool('set_schema').handler({
        designId: 'wms-core',
        tables: [
          { name: 'dup', columns: [{ name: 'a', type: 'int' }] },
          { name: 'dup', columns: [{ name: 'a', type: 'int' }] }
        ]
      })
    ).toThrowError(/중복 테이블 이름/)
    expect(() =>
      tool('set_schema').handler({
        designId: 'wms-core',
        tables: [{ name: 't', columns: [{ name: 'a', type: 'int' }, { name: 'a', type: 'int' }] }]
      })
    ).toThrowError(/중복 컬럼 이름/)
  })

  it('CASE-mcp-045/051: set_schema 구조 위반 → 안내 throw + 기존 스키마 원상 + 이벤트 없음', () => {
    const before = schemaOf('wms-core')
    expect(() =>
      tool('set_schema').handler({
        designId: 'wms-core',
        tables: [{ name: 'bad', columns: [{ name: '', type: 'int' }] }] // 빈 컬럼명 = 구조 위반
      })
    ).toThrowError(/스키마 구조/)
    expect(schemaOf('wms-core')).toEqual(before) // 부분 반영 없음
    expect(events).toEqual([])
  })

  it('CASE-mcp-046: set_schema 설계 격리 — 다른 설계(commerce-core)의 스키마 불변', () => {
    const ccBefore = schemaOf('commerce-core')
    tool('set_schema').handler({ designId: 'wms-core', tables: [] }) // wms 비우기
    expect(schemaOf('commerce-core')).toEqual(ccBefore)
    expect(schemaOf('wms-core').tables).toEqual([])
  })

  it('CASE-mcp-047/050: create_version — 스냅샷=컷 시점 draft, number 생략 시 patch 증가, versions 이벤트', () => {
    replaceTablesForDesign('wms-core', [
      { id: 'w1', designId: 'wms-core', name: 'stock', comment: '', columns: [], constraints: [] }
    ])
    const v1 = tool('create_version').handler({ designId: 'wms-core', note: '첫 컷' }) as {
      number: string
      tableCount: number
    }
    expect(v1.number).toBe('v0.1.0') // 버전 없던 설계의 첫 컷
    expect(v1.tableCount).toBe(1)
    expect(events).toEqual([{ domain: 'versions', designId: 'wms-core' }])
    const got = tool('get_version').handler({ designId: 'wms-core', number: 'v0.1.0' }) as {
      snapshot: { tables: Array<{ name: string }> }
    }
    expect(got.snapshot.tables.map((t) => t.name)).toEqual(['stock'])

    const v2 = tool('create_version').handler({ designId: 'wms-core' }) as { number: string }
    expect(v2.number).toBe('v0.1.1') // 생략 시 최신에서 patch 증가
  })

  it('CASE-mcp-048: create_version 번호 중복 → 안내 throw(프로토콜 오류로 안 샘)', () => {
    expect(() => tool('create_version').handler({ designId: 'wms-core', number: 'v0.1.0' })).toThrowError(
      /list_versions/
    )
    expect(events).toEqual([])
  })

  it('CASE-mcp-049: create_version 형식 위반 → 안내 throw + 미기록', () => {
    expect(() => tool('create_version').handler({ designId: 'wms-core', number: 'draft-1' })).toThrowError(/형식/)
    const rows = tool('list_versions').handler({ designId: 'wms-core' }) as Array<{ number: string }>
    expect(rows.map((r) => r.number)).toEqual(['v0.1.1', 'v0.1.0'])
  })

  it('CASE-mcp-052: 렌더러발 저장(store 직접 호출)은 store:changed 를 유발하지 않는다', () => {
    replaceTablesForDesign('wms-core', [])
    expect(events).toEqual([]) // 알림은 MCP 도구 성공 경로에서만
  })
})

describe('MCP 부분 수정·위생 검사·응답 요약 (3단계)', () => {
  const events: StoreChangedEvent[] = []
  beforeAll(() => {
    setStoreChangeNotifier((e) => events.push(e))
    tool('create_design').handler({ name: 'Patch Lab', dialect: 'mysql' })
  })
  beforeEach(() => {
    events.length = 0
    // 매 케이스가 같은 출발점에서 시작하도록 초기 스키마를 다시 깐다.
    tool('set_schema').handler({
      designId: 'patch-lab',
      tables: [
        {
          name: 'users',
          comment: '회원',
          columns: [
            { id: 'u1', name: 'id', type: 'BIGINT', nullable: false },
            { id: 'u2', name: 'email', type: 'VARCHAR(255)' }
          ],
          constraints: [{ kind: 'pk', name: 'pk_users', columns: [{ columnId: 'u1' }] }]
        },
        {
          name: 'orders',
          comment: '주문',
          columns: [
            { id: 'o1', name: 'id', type: 'BIGINT', nullable: false },
            { id: 'o2', name: 'user_id', type: 'BIGINT' },
            { id: 'o3', name: 'memo', type: 'TEXT', comment: '옛 주석' }
          ],
          constraints: [
            { kind: 'fk', name: 'fk_orders_user', columns: [{ columnId: 'o2' }], refTable: 'users', refColumns: ['id'] }
          ]
        }
      ]
    })
    events.length = 0
  })

  const schemaOf = (designId: string, tables?: string[]) =>
    tool('get_schema').handler(tables ? { designId, tables } : { designId }) as {
      tables: Array<{ name: string; columns: Array<Record<string, unknown>>; constraints: Array<Record<string, unknown>> }>
    }
  const colOf = (designId: string, table: string, column: string) =>
    schemaOf(designId).tables.find((t) => t.name === table)!.columns.find((c) => c.name === column)!

  // CASE-mcp-083 — 사고 재현: 33개 테이블 반영 응답이 127KB 라 호출자 문맥을 잡아먹었다.
  it('CASE-mcp-083: set_schema 응답은 요약 — 스키마 본문을 되돌려주지 않는다', () => {
    const out = tool('set_schema').handler({
      designId: 'patch-lab',
      tables: [{ name: 't', columns: [{ name: 'a', type: 'INT' }] }]
    }) as Record<string, unknown>
    expect(out).not.toHaveProperty('tables.0.columns.0.type')
    expect(out.tableCount).toBe(1)
    expect(out.tables).toEqual([{ name: 't', columns: 1, constraints: 0 }])
    expect(JSON.stringify(out).length).toBeLessThan(400)
  })

  it('CASE-mcp-084: get_schema tables 필터 — 필요한 테이블만 읽는다', () => {
    expect(schemaOf('patch-lab').tables).toHaveLength(2)
    expect(schemaOf('patch-lab', ['orders']).tables.map((t) => t.name)).toEqual(['orders'])
  })

  it('CASE-mcp-085: get_schema 필터에 없는 이름 → 조용한 빈 결과 대신 안내 throw', () => {
    expect(() => schemaOf('patch-lab', ['order'])).toThrowError(/없는 테이블: order.*users, orders/s)
  })

  // ── 위생 검사(저장 전 깨진 글자 차단) ──
  it('CASE-mcp-086: set_schema 에 깨진 글자 → 위치와 함께 거부, 저장소 불변', () => {
    const before = schemaOf('patch-lab')
    expect(() =>
      tool('set_schema').handler({
        designId: 'patch-lab',
        tables: [{ name: 'x', columns: [{ name: 'a', type: 'INT', comment: '요율이 바\uFFFD뀌어도' }] }]
      })
    ).toThrowError(/저장을 멈췄습니다.*tables\[0\]\.columns\[0\]\.comment.*U\+FFFD/s)
    expect(schemaOf('patch-lab')).toEqual(before)
    expect(events).toEqual([])
  })

  it('CASE-mcp-087: patch_schema·create_design·create_version 도 같은 위생 검사를 지난다', () => {
    expect(() =>
      tool('patch_schema').handler({
        designId: 'patch-lab',
        operations: [{ op: 'update_column', table: 'orders', column: 'memo', set: { comment: '깨\uFFFD짐' } }]
      })
    ).toThrowError(/저장을 멈췄습니다/)
    expect(() => tool('create_design').handler({ name: '깨\uFFFD진 이름', dialect: 'mysql' })).toThrowError(
      /저장을 멈췄습니다/
    )
    expect(() => tool('create_version').handler({ designId: 'patch-lab', note: '메\uFFFD모' })).toThrowError(
      /저장을 멈췄습니다/
    )
    expect(events).toEqual([])
  })

  // ── 부분 수정 ──
  it('CASE-mcp-088: patch_schema — 주석 한 줄만 고쳐도 나머지 스키마가 그대로 남는다', () => {
    const before = schemaOf('patch-lab')
    const out = tool('patch_schema').handler({
      designId: 'patch-lab',
      operations: [{ op: 'update_column', table: 'orders', column: 'memo', set: { comment: '고친 주석' } }]
    }) as { applied: number; changes: string[]; tableCount: number }

    expect(out.applied).toBe(1)
    expect(out.changes).toEqual(['테이블 "orders" 컬럼 "memo" 수정: comment'])
    expect(colOf('patch-lab', 'orders', 'memo').comment).toBe('고친 주석')
    expect(colOf('patch-lab', 'orders', 'memo').id).toBe('o3') // id 보존
    // 나머지는 손대지 않았다 — 통째 재전송이 아니라 부분 수정임을 증명
    expect(schemaOf('patch-lab').tables.find((t) => t.name === 'users')).toEqual(
      before.tables.find((t) => t.name === 'users')
    )
    expect(events).toEqual([{ domain: 'tables', designId: 'patch-lab' }])
  })

  it('CASE-mcp-089: patch_schema — 여러 연산을 한 번에, 응답은 바뀐 것 목록만', () => {
    const out = tool('patch_schema').handler({
      designId: 'patch-lab',
      operations: [
        { op: 'add_column', table: 'users', column: { name: 'nick', type: 'VARCHAR(40)' }, after: 'id' },
        { op: 'add_constraint', table: 'users', constraint: { kind: 'uk', name: 'uq_users_email', columns: ['email'] } },
        { op: 'set_table_comment', table: 'orders', comment: '주문 원장' }
      ]
    }) as { applied: number; changes: string[] }

    expect(out.applied).toBe(3)
    expect(out.changes).toHaveLength(3)
    const users = schemaOf('patch-lab').tables.find((t) => t.name === 'users')!
    expect(users.columns.map((c) => c.name)).toEqual(['id', 'nick', 'email'])
    expect(users.constraints.map((k) => k.name)).toEqual(['pk_users', 'uq_users_email'])
  })

  it('CASE-mcp-090: patch_schema — 컬럼 개명 시 남의 FK 참조도 따라 바뀐다', () => {
    tool('patch_schema').handler({
      designId: 'patch-lab',
      operations: [{ op: 'update_column', table: 'users', column: 'id', set: { name: 'user_no' } }]
    })
    const fk = schemaOf('patch-lab').tables.find((t) => t.name === 'orders')!.constraints[0]
    expect(fk.refColumns).toEqual(['user_no'])
  })

  it('CASE-mcp-091: patch_schema — 연산 하나가 실패하면 앞선 연산도 반영 0', () => {
    const before = schemaOf('patch-lab')
    expect(() =>
      tool('patch_schema').handler({
        designId: 'patch-lab',
        operations: [
          { op: 'set_table_comment', table: 'users', comment: '먼저 성공하는 연산' },
          { op: 'update_column', table: 'orders', column: 'ghost', set: { comment: 'x' } }
        ]
      })
    ).toThrowError(/연산 #2.*컬럼 "ghost" 이 없습니다.*반영 0/s)
    expect(schemaOf('patch-lab')).toEqual(before)
    expect(events).toEqual([])
  })

  it('CASE-mcp-092: patch_schema — 미상 designId·빈 연산 목록·미지의 op 는 안내 throw', () => {
    expect(() => tool('patch_schema').handler({ designId: 'no-such', operations: [] })).toThrowError(/list_designs/)
    expect(() => tool('patch_schema').handler({ designId: 'patch-lab', operations: [] })).toThrowError(/최소 1개/)
    expect(() =>
      tool('patch_schema').handler({ designId: 'patch-lab', operations: [{ op: 'truncate', table: 'users' }] })
    ).toThrowError(/op 는 add_table/)
    expect(events).toEqual([])
  })

  it('CASE-mcp-093: patch_schema 설계 격리 — 다른 설계는 불변', () => {
    const ccBefore = schemaOf('commerce-core')
    tool('patch_schema').handler({
      designId: 'patch-lab',
      operations: [{ op: 'set_table_comment', table: 'users', comment: '바꿈' }]
    })
    expect(schemaOf('commerce-core')).toEqual(ccBefore)
  })
})
