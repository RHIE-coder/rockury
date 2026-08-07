import type { DatabaseSync } from 'node:sqlite'
import {
  toFkAction,
  type IntrospectedSchema,
  type RawCheck,
  type RawColumn,
  type RawForeignKey,
  type RawKey,
  type RawTable
} from './types'
import { balancedParens, stripOuterParens } from './sqlText'

/**
 * SQLite 역설계 — sqlite_master + PRAGMA 테이블값 함수(pragma_*)로 읽는다.
 * SQLite 는 테이블/컬럼 코멘트가 없어 comment 는 ''. 타입은 선언 타입 그대로.
 * PK 는 table_info.pk 로, UK/IDX 는 index_list(origin≠pk), FK 는 foreign_key_list.
 * CHECK 만은 PRAGMA 가 안 알려 준다 — sqlite_master 에 적힌 CREATE 문을 직접 읽는다.
 * 인덱스 방향은 index_info 로는 알 수 없어 ASC 고정(2a 한계, 문서화).
 *
 * 스키마는 언제나 `main` 하나다 — SQLite 는 파일 하나가 database 하나이고, 범위를 고를 것이
 * 없다(`ATTACH` 로 붙인 파일은 지금 다루지 않는다). 다른 파일은 다른 연결이다.
 */
const SQLITE_SCHEMA = 'main'

export function introspectSqlite(db: DatabaseSync): IntrospectedSchema {
  const all = <T>(sql: string, ...params: string[]): T[] =>
    db.prepare(sql).all(...params) as unknown as T[]

  const tableRows = all<{ name: string; type: string; sql: string | null }>(
    `SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`
  )
  const tables: RawTable[] = tableRows.map((r) => ({
    schema: SQLITE_SCHEMA,
    name: r.name,
    comment: '',
    isView: r.type === 'view'
  }))

  const columns: RawColumn[] = []
  const keys: RawKey[] = []
  const foreignKeys: RawForeignKey[] = []
  const checks: RawCheck[] = []

  for (const { name: table, sql } of tableRows) {
    checks.push(...parseSqliteChecks(SQLITE_SCHEMA, table, sql ?? ''))
    // 컬럼 + PK(table_info.pk = 복합키 내 1-based 위치)
    const cols = all<{
      cid: number
      name: string
      type: string
      notnull: number
      dflt_value: string | null
      pk: number
    }>(`SELECT cid, name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)`, table)

    for (const c of cols) {
      columns.push({
        schema: SQLITE_SCHEMA,
        table,
        name: c.name,
        type: c.type || '',
        nullable: c.notnull === 0,
        default: c.dflt_value,
        comment: '',
        ordinal: c.cid + 1
      })
    }
    for (const c of cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk)) {
      keys.push({
        schema: SQLITE_SCHEMA,
        table,
        name: 'PRIMARY',
        kind: 'pk',
        column: c.name,
        ordinal: c.pk,
        direction: 'ASC'
      })
    }

    // 인덱스/유니크 (origin='pk' 는 위에서 처리했으니 제외)
    const idxList = all<{ name: string; unique: number; origin: string }>(
      `SELECT name, "unique", origin FROM pragma_index_list(?)`,
      table
    )
    for (const idx of idxList) {
      if (idx.origin === 'pk') continue
      const idxCols = all<{ seqno: number; cid: number; name: string | null }>(
        `SELECT seqno, cid, name FROM pragma_index_info(?)`,
        idx.name
      )
      for (const ic of idxCols) {
        if (ic.cid < 0 || ic.name == null) continue // 식 인덱스 컬럼은 건너뜀
        keys.push({
          schema: SQLITE_SCHEMA,
          table,
          name: idx.name,
          kind: idx.unique === 1 ? 'uk' : 'idx',
          column: ic.name,
          ordinal: ic.seqno + 1,
          direction: 'ASC'
        })
      }
    }

    // 외래키
    const fkList = all<{
      id: number
      seq: number
      table: string
      from: string
      to: string | null
      on_update: string
      on_delete: string
    }>(
      `SELECT id, seq, "table", "from", "to", on_update, on_delete FROM pragma_foreign_key_list(?)`,
      table
    )
    for (const fk of fkList) {
      foreignKeys.push({
        schema: SQLITE_SCHEMA,
        table,
        name: `fk_${table}_${fk.id}`,
        column: fk.from,
        refSchema: SQLITE_SCHEMA,
        refTable: fk.table,
        refColumn: fk.to ?? '',
        ordinal: fk.seq + 1,
        onDelete: toFkAction(fk.on_delete),
        onUpdate: toFkAction(fk.on_update)
      })
    }
  }

  // 파일을 직접 읽으므로 권한으로 가려지는 것이 없다 — 경고할 구멍이 없다.
  return {
    dialect: 'sqlite',
    schemas: [SQLITE_SCHEMA],
    tables,
    columns,
    keys,
    foreignKeys,
    checks,
    warnings: []
  }
}

/** SQLite 식별자 인용(`"x"` · `` `x` `` · `[x]`)을 벗긴다. 겹쳐 쓴 인용부호는 한 글자로 되돌린다. */
function unquoteSqlite(raw: string): string {
  const q = raw[0]
  if (q === '[') return raw.slice(1, -1)
  if (q === '"' || q === '`') return raw.slice(1, -1).split(q + q).join(q)
  return raw
}

/**
 * 문자열·식별자 인용 **안쪽**을 표시한 자리표. 주석 안의 `CHECK` 를 제약으로 오독하지 않으려면
 * 어디가 글자이고 어디가 코드인지부터 갈라야 한다.
 */
function quotedMask(sql: string): boolean[] {
  const mask = new Array<boolean>(sql.length).fill(false)
  let quote: string | null = null
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]
    if (quote) {
      mask[i] = true
      const close = quote === '[' ? ']' : quote
      if (ch === close) {
        // SQLite 에는 역슬래시 이스케이프가 없다 — 인용부호를 겹쳐 쓰는 것이 규칙.
        if (quote !== '[' && sql[i + 1] === close) {
          mask[i + 1] = true
          i += 1
        } else quote = null
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      quote = ch
      mask[i] = true
    }
  }
  return mask
}

const SQLITE_CHECK = /(?:CONSTRAINT\s+("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|\w+)\s+)?CHECK\s*\(/gi

/**
 * `CREATE TABLE` 원문에서 CHECK 를 읽는 **순수 함수**. 컬럼 정의 안에 붙은 CHECK 도 잡아야 해서
 * 줄 앞에 앵커를 걸 수 없다 — 대신 인용부호 안쪽을 걸러 오독을 막는다.
 */
export function parseSqliteChecks(schema: string, table: string, sql: string): RawCheck[] {
  if (!sql) return []
  const inQuote = quotedMask(sql)
  const out: RawCheck[] = []
  const re = new RegExp(SQLITE_CHECK.source, 'gi')
  let m: RegExpExecArray | null
  let nth = 0
  while ((m = re.exec(sql)) !== null) {
    if (inQuote[m.index]) continue
    const b = balancedParens(sql, m.index + m[0].length - 1)
    if (!b) continue
    nth += 1
    out.push({
      schema,
      table,
      // SQLite 는 이름 없는 CHECK 를 허용한다 — 표시·짝맞춤을 위해 자리 번호로 이름을 만든다.
      name: m[1] ? unquoteSqlite(m[1]) : `${table}_check_${nth}`,
      expression: stripOuterParens(b.inner)
    })
    re.lastIndex = b.end
  }
  return out
}
