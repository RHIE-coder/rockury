import { describe, expect, it } from 'vitest'
import { columnKind } from './cellKind'
import { toCsv, toJson, toSqlInsert } from './exportRows'

describe('columnKind', () => {
  it('타입별 분류', () => {
    expect(columnKind('jsonb')).toBe('json')
    expect(columnKind('json')).toBe('json')
    expect(columnKind('tinyint(1)')).toBe('boolean')
    expect(columnKind('boolean')).toBe('boolean')
    expect(columnKind('uuid')).toBe('uuid')
    expect(columnKind('timestamptz')).toBe('date')
    expect(columnKind('datetime')).toBe('date')
    expect(columnKind('int unsigned')).toBe('number')
    expect(columnKind('decimal(12,2)')).toBe('number')
    expect(columnKind('varchar(255)')).toBe('text')
    expect(columnKind('char(36)')).toBe('text')
  })
})

describe('export', () => {
  const cols = ['id', 'name', 'meta']
  const rows = [
    { id: 1, name: 'a,b', meta: { x: 1 } },
    { id: 2, name: "q'q", meta: null }
  ]
  it('CSV — 콤마/따옴표/객체 이스케이프', () => {
    expect(toCsv(cols, rows)).toBe("id,name,meta\n1,\"a,b\",\"{\"\"x\"\":1}\"\n2,q'q,")
  })
  it('JSON', () => {
    expect(JSON.parse(toJson(rows))).toEqual(rows)
  })
  it('SQL INSERT — 방언 인용 + 값 리터럴', () => {
    const out = toSqlInsert('postgresql', 'users', cols, rows)
    expect(out.split('\n')[0]).toBe(`INSERT INTO "users" ("id", "name", "meta") VALUES (1, 'a,b', '{"x":1}');`)
    expect(out).toContain(`VALUES (2, 'q''q', NULL);`)
  })
})
