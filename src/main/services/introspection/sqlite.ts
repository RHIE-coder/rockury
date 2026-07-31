import type { DatabaseSync } from 'node:sqlite'
import {
  toFkAction,
  type IntrospectedSchema,
  type RawColumn,
  type RawForeignKey,
  type RawKey,
  type RawTable
} from './types'

/**
 * SQLite 역설계 — sqlite_master + PRAGMA 테이블값 함수(pragma_*)로 읽는다.
 * SQLite 는 테이블/컬럼 코멘트가 없어 comment 는 ''. 타입은 선언 타입 그대로.
 * PK 는 table_info.pk 로, UK/IDX 는 index_list(origin≠pk), FK 는 foreign_key_list.
 * 인덱스 방향은 index_info 로는 알 수 없어 ASC 고정(2a 한계, 문서화).
 *
 * 스키마는 언제나 `main` 하나다 — SQLite 는 파일 하나가 database 하나이고, 범위를 고를 것이
 * 없다(`ATTACH` 로 붙인 파일은 지금 다루지 않는다). 다른 파일은 다른 연결이다.
 */
const SQLITE_SCHEMA = 'main'

export function introspectSqlite(db: DatabaseSync): IntrospectedSchema {
  const all = <T>(sql: string, ...params: string[]): T[] =>
    db.prepare(sql).all(...params) as unknown as T[]

  const tableRows = all<{ name: string; type: string }>(
    `SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`
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

  for (const { name: table } of tableRows) {
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

  return { dialect: 'sqlite', schemas: [SQLITE_SCHEMA], tables, columns, keys, foreignKeys }
}
