import type { Connection } from 'mysql2/promise'
import { describe, expect, it, vi } from 'vitest'
import { introspectMysql, parseCreateTableChecks, parseCreateTableForeignKeys } from './mysql'

/**
 * MySQL 어댑터의 제약 읽기 — information_schema 를 **부분적으로** 못 보는 계정에서
 * 제약이 통째로 사라지던 회귀를 막는다(Diagram 이 "관계 0" 으로 조용히 거짓말했다).
 */

const CREATE_CARDS = [
  'CREATE TABLE `pokemon_cards` (',
  '  `id` bigint NOT NULL AUTO_INCREMENT,',
  '  `set_id` bigint NOT NULL,',
  '  `price` int DEFAULT NULL,',
  '  PRIMARY KEY (`id`),',
  '  CONSTRAINT `pokemon_cards_set_fk` FOREIGN KEY (`set_id`) REFERENCES `pokemon_card_sets` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,',
  '  CONSTRAINT `pokemon_cards_price_chk` CHECK ((`price` > 0))',
  ') ENGINE=InnoDB'
].join('\n')

const CREATE_SETS = ['CREATE TABLE `pokemon_card_sets` (', '  `id` bigint NOT NULL', ')'].join('\n')

/** 질의문의 특징적인 조각으로 골라 답하는 가짜 연결. */
function fakeConn(answer: (sql: string) => unknown[] | Error, spy?: (sql: string) => void): Connection {
  return {
    query: async (sql: string) => {
      spy?.(sql)
      const out = answer(sql)
      if (out instanceof Error) throw out
      return [out, []]
    }
  } as unknown as Connection
}

const TABLE_ROWS = [
  { schema: 'piccard', name: 'pokemon_cards', comment: '', ttype: 'BASE TABLE' },
  { schema: 'piccard', name: 'pokemon_card_sets', comment: '', ttype: 'BASE TABLE' }
]
const PK_ROW = {
  schema: 'piccard',
  cschema: 'piccard',
  tbl: 'pokemon_cards',
  name: 'PRIMARY',
  col: 'id',
  ref_schema: null,
  ref_table: null,
  ref_col: null,
  ord: 1
}
const FK_ROW = {
  schema: 'piccard',
  cschema: 'piccard',
  tbl: 'pokemon_cards',
  name: 'pokemon_cards_set_fk',
  col: 'set_id',
  ref_schema: 'piccard',
  ref_table: 'pokemon_card_sets',
  ref_col: 'id',
  ord: 1
}
const TC_ROWS = [
  { schema: 'piccard', tbl: 'pokemon_cards', name: 'PRIMARY', ctype: 'PRIMARY KEY' },
  { schema: 'piccard', tbl: 'pokemon_cards', name: 'pokemon_cards_set_fk', ctype: 'FOREIGN KEY' },
  { schema: 'piccard', tbl: 'pokemon_cards', name: 'pokemon_cards_price_chk', ctype: 'CHECK' },
  { schema: 'piccard', tbl: 'pokemon_card_sets', name: 'PRIMARY', ctype: 'PRIMARY KEY' }
]

/** 각 information_schema 뷰가 이 계정에 보이는지. 실패는 빈 결과이거나 오류다(둘 다 겪었다). */
interface Vis {
  tc?: boolean
  kcu?: boolean
  rules?: boolean
  clauses?: boolean
  ddl?: boolean
}

function router(v: Vis) {
  const { tc = true, kcu = true, rules = true, clauses = true, ddl = true } = v
  return (sql: string): unknown[] | Error => {
    if (sql.includes('information_schema.TABLES')) return TABLE_ROWS
    if (sql.includes('information_schema.COLUMNS')) return []
    if (sql.includes('information_schema.STATISTICS')) return []
    if (sql.includes('TABLE_CONSTRAINTS')) return tc ? TC_ROWS : []
    if (sql.includes('KEY_COLUMN_USAGE')) return kcu ? [PK_ROW, FK_ROW] : new Error('보이지 않음')
    if (sql.includes('REFERENTIAL_CONSTRAINTS'))
      return rules
        ? [
            {
              schema: 'piccard',
              tbl: 'pokemon_cards',
              name: 'pokemon_cards_set_fk',
              del: 'CASCADE',
              upd: 'CASCADE'
            }
          ]
        : []
    if (sql.includes('CHECK_CONSTRAINTS'))
      return clauses
        ? [{ schema: 'piccard', name: 'pokemon_cards_price_chk', expr: '(`price` > 0)' }]
        : []
    if (sql.startsWith('SHOW CREATE TABLE')) {
      if (!ddl) return new Error('권한 없음')
      return sql.includes('`pokemon_cards`')
        ? [{ Table: 'pokemon_cards', 'Create Table': CREATE_CARDS }]
        : [{ Table: 'pokemon_card_sets', 'Create Table': CREATE_SETS }]
    }
    return []
  }
}

const run = async (v: Vis, spy?: (sql: string) => void) =>
  introspectMysql(fakeConn(router(v), spy), 'mysql', ['piccard'])

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    return await fn()
  } finally {
    warn.mockRestore()
  }
}

describe('introspectMysql — 제약을 못 보는 계정', () => {
  it('다 보이면 information_schema 만 읽고 SHOW CREATE TABLE 은 부르지 않는다', async () => {
    const seen: string[] = []
    const ir = await run({}, (s) => seen.push(s))

    expect(ir.foreignKeys).toHaveLength(1)
    expect(ir.foreignKeys[0].onDelete).toBe('CASCADE')
    expect(ir.checks).toEqual([
      {
        schema: 'piccard',
        table: 'pokemon_cards',
        name: 'pokemon_cards_price_chk',
        expression: '`price` > 0'
      }
    ])
    expect(ir.warnings).toEqual([])
    expect(seen.some((s) => s.startsWith('SHOW CREATE TABLE'))).toBe(false)
  })

  it('FK 규칙 뷰만 안 보이면 관계는 살고 규칙은 실물에서 되찾는다', async () => {
    const seen: string[] = []
    const ir = await run({ rules: false }, (s) => seen.push(s))

    expect(ir.foreignKeys[0]).toMatchObject({
      table: 'pokemon_cards',
      refTable: 'pokemon_card_sets',
      refColumn: 'id',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    })
    // FK 가 달린 표만 다시 읽는다 — 관계 없는 표까지 훑지 않는다.
    const ddlQueries = seen.filter((s) => s.startsWith('SHOW CREATE TABLE'))
    expect(ddlQueries).toHaveLength(1)
    expect(ddlQueries[0]).toContain('`pokemon_cards`')
  })

  it('심판(TABLE_CONSTRAINTS)이 안 보이면 FK·CHECK 를 실물에서 읽는다', async () => {
    const ir = await quiet(() => run({ tc: false, kcu: false, rules: false, clauses: false }))

    expect(ir.foreignKeys.map((f) => f.name)).toEqual(['pokemon_cards_set_fk'])
    expect(ir.checks.map((c) => c.expression)).toEqual(['`price` > 0'])
    expect(ir.warnings).toEqual([])
  })

  it('표마다 권한이 다른 계정 — 심판이 한 줄도 못 본 표만 실물로 확인한다', async () => {
    const seen: string[] = []
    // 심판은 pokemon_card_sets 만 본다. pokemon_cards 는 "제약 없는 표"가 아니라 "안 보이는 표"다.
    const partial = (sql: string): unknown[] | Error =>
      sql.includes('TABLE_CONSTRAINTS')
        ? TC_ROWS.filter((r) => r.tbl === 'pokemon_card_sets')
        : sql.includes('KEY_COLUMN_USAGE')
          ? [PK_ROW]
          : sql.includes('CHECK_CONSTRAINTS')
            ? []
            : router({})(sql)
    const ir = await introspectMysql(fakeConn(partial, (s) => seen.push(s)), 'mysql', ['piccard'])

    expect(ir.foreignKeys.map((f) => f.name)).toEqual(['pokemon_cards_set_fk'])
    expect(ir.checks.map((c) => c.name)).toEqual(['pokemon_cards_price_chk'])
    const ddlQueries = seen.filter((s) => s.startsWith('SHOW CREATE TABLE'))
    expect(ddlQueries).toHaveLength(1)
    expect(ddlQueries[0]).toContain('`pokemon_cards`')
  })

  it('심판이 보이고 FK·CHECK 가 정말 없으면 실물을 안 뒤진다', async () => {
    const seen: string[] = []
    const onlyPk = (sql: string): unknown[] | Error =>
      sql.includes('TABLE_CONSTRAINTS')
        ? TC_ROWS.filter((r) => r.ctype === 'PRIMARY KEY')
        : sql.includes('KEY_COLUMN_USAGE')
          ? [PK_ROW]
          : router({})(sql)
    const ir = await introspectMysql(fakeConn(onlyPk, (s) => seen.push(s)), 'mysql', ['piccard'])

    expect(ir.foreignKeys).toEqual([])
    expect(ir.checks).toEqual([])
    expect(seen.some((s) => s.startsWith('SHOW CREATE TABLE'))).toBe(false)
  })

  it('실물마저 막히면 관계는 지키고, 못 읽었다고 말한다', async () => {
    const ir = await quiet(() => run({ rules: false, ddl: false }))

    expect(ir.foreignKeys).toHaveLength(1) // KCU 로 세운 관계는 산다
    expect(ir.foreignKeys[0].onDelete).toBe('NO ACTION') // 규칙만 못 읽었다
    expect(ir.warnings).toEqual(['제약을 못 읽은 표 1개 — piccard.pokemon_cards'])
  })
})

describe('parseCreateTableForeignKeys', () => {
  it('복합 FK 를 컬럼 순서대로 편다', () => {
    const ddl = [
      'CREATE TABLE `user_roles` (',
      '  CONSTRAINT `ur_fk` FOREIGN KEY (`user_id`,`role_id`) REFERENCES `pairs` (`u`,`r`) ON DELETE SET NULL',
      ')'
    ].join('\n')
    expect(parseCreateTableForeignKeys('app', 'user_roles', ddl)).toEqual([
      {
        schema: 'app',
        table: 'user_roles',
        name: 'ur_fk',
        column: 'user_id',
        refSchema: 'app',
        refTable: 'pairs',
        refColumn: 'u',
        ordinal: 1,
        onDelete: 'SET NULL',
        onUpdate: 'NO ACTION'
      },
      {
        schema: 'app',
        table: 'user_roles',
        name: 'ur_fk',
        column: 'role_id',
        refSchema: 'app',
        refTable: 'pairs',
        refColumn: 'r',
        ordinal: 2,
        onDelete: 'SET NULL',
        onUpdate: 'NO ACTION'
      }
    ])
  })

  it('다른 database 를 가리키는 FK 는 그 database 를 refSchema 로 단다', () => {
    const ddl = '  CONSTRAINT `x` FOREIGN KEY (`a`) REFERENCES `other_db`.`t` (`id`)'
    const [fk] = parseCreateTableForeignKeys('app', 'items', ddl)
    expect([fk.refSchema, fk.refTable]).toEqual(['other_db', 't'])
    // 규칙 절이 없으면 REFERENTIAL_CONSTRAINTS 와 같은 답(NO ACTION)이어야 짝이 어긋나지 않는다.
    expect([fk.onDelete, fk.onUpdate]).toEqual(['NO ACTION', 'NO ACTION'])
  })

  it('이름 안의 백틱(``)을 되돌린다', () => {
    const ddl = '  CONSTRAINT `w``eird` FOREIGN KEY (`a``b`) REFERENCES `t``t` (`c`)'
    const [fk] = parseCreateTableForeignKeys('app', 'items', ddl)
    expect([fk.name, fk.column, fk.refTable]).toEqual(['w`eird', 'a`b', 't`t'])
  })

  it('MariaDB 가 인덱스 이름을 끼워 넣어도 읽는다', () => {
    const ddl =
      '  CONSTRAINT `c1` FOREIGN KEY `idx_owner` (`owner_id`) REFERENCES `owners` (`id`) ON UPDATE CASCADE'
    const [fk] = parseCreateTableForeignKeys('app', 'items', ddl)
    expect([fk.column, fk.refTable, fk.onUpdate]).toEqual(['owner_id', 'owners', 'CASCADE'])
  })

  it('FK 가 없는 DDL 에서는 아무것도 만들지 않는다 — 컬럼 주석에 같은 글자가 있어도', () => {
    const ddl = [
      'CREATE TABLE `t` (',
      "  `a` int COMMENT 'FOREIGN KEY (`a`) REFERENCES `x` (`y`) 처럼 보이는 주석',",
      '  PRIMARY KEY (`a`)',
      ')'
    ].join('\n')
    expect(parseCreateTableForeignKeys('app', 't', ddl)).toEqual([])
  })
})

describe('parseCreateTableChecks', () => {
  it('MySQL 이 한 겹 더 씌운 괄호를 벗긴다', () => {
    const [c] = parseCreateTableChecks('app', 't', '  CONSTRAINT `c1` CHECK ((`price` > 0))')
    expect([c.name, c.expression]).toEqual(['c1', '`price` > 0'])
  })

  it('식 안의 괄호·따옴표에서 끊기지 않는다', () => {
    const ddl = "  CONSTRAINT `c2` CHECK ((`kind` in ('a)','b')) and (length(`s`) > 1))"
    const [c] = parseCreateTableChecks('app', 't', ddl)
    expect(c.expression).toBe("(`kind` in ('a)','b')) and (length(`s`) > 1)")
  })

  it('여러 줄에 걸친 식도 끝까지 읽는다', () => {
    const ddl = ['  CONSTRAINT `c3` CHECK ((`a` > 0', '     and `b` < 10))'].join('\n')
    const [c] = parseCreateTableChecks('app', 't', ddl)
    expect(c.expression).toBe('`a` > 0\n     and `b` < 10')
  })

  it('이름이 없으면 자리 번호로 채운다', () => {
    const [c] = parseCreateTableChecks('app', 'items', '  CHECK (`a` > 0)')
    expect(c.name).toBe('items_chk_1')
  })

  it('CHECK 가 없으면 아무것도 만들지 않는다 — 주석에 같은 글자가 있어도', () => {
    const ddl = ["  `a` int COMMENT 'CHECK (`a` > 0) 처럼 보이는 주석',", '  PRIMARY KEY (`a`)'].join('\n')
    expect(parseCreateTableChecks('app', 't', ddl)).toEqual([])
  })
})
