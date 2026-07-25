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

  it('CASE-mcp-041/051: create_design 불량 입력(이름 누락·미상 방언) → 안내 throw + 이벤트 없음', () => {
    expect(() => tool('create_design').handler({ dialect: 'mysql' })).toThrowError(/create_design 입력/)
    expect(() => tool('create_design').handler({ name: 'x', dialect: 'oracle' })).toThrowError(/create_design 입력/)
    expect(events).toEqual([]) // 실패한 쓰기는 화면 재조회를 유발하지 않는다
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
