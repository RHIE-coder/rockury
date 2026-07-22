import type { Connection } from 'mysql2/promise'
import {
  toFkAction,
  type IntroDbType,
  type IntrospectedSchema,
  type RawColumn,
  type RawForeignKey,
  type RawKey,
  type RawTable
} from './types'

/**
 * MySQL/MariaDB 역설계 — 현재 DATABASE() 스코프의 information_schema 를 읽는다.
 * 타입은 COLUMN_TYPE(예: `varchar(255)`, `int unsigned`) 네이티브 그대로.
 * PK/UK/IDX 는 STATISTICS, FK 는 KEY_COLUMN_USAGE+REFERENTIAL_CONSTRAINTS.
 */
export async function introspectMysql(
  conn: Connection,
  dialect: IntroDbType
): Promise<IntrospectedSchema> {
  const q = async <T>(sql: string): Promise<T[]> => {
    const [rows] = await conn.query(sql)
    return rows as T[]
  }

  // BASE TABLE + VIEW 를 함께 읽고 종류로 가른다.
  const tableRows = await q<{ name: string; comment: string; ttype: string }>(
    `SELECT TABLE_NAME AS name, IFNULL(TABLE_COMMENT,'') AS comment, TABLE_TYPE AS ttype
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE IN ('BASE TABLE','VIEW')
     ORDER BY TABLE_NAME`
  )
  const tables: RawTable[] = tableRows.map((r) => ({ name: r.name, comment: r.comment, isView: r.ttype === 'VIEW' }))

  const colRows = await q<{
    tbl: string
    name: string
    type: string
    nullable: string
    dflt: string | null
    comment: string
    ord: number
  }>(
    `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS name, COLUMN_TYPE AS type,
            IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt,
            IFNULL(COLUMN_COMMENT,'') AS comment, ORDINAL_POSITION AS ord
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME, ORDINAL_POSITION`
  )
  const columns: RawColumn[] = colRows.map((r) => ({
    table: r.tbl,
    name: r.name,
    type: r.type,
    nullable: r.nullable === 'YES',
    default: r.dflt,
    comment: r.comment,
    ordinal: Number(r.ord)
  }))

  const keyRows = await q<{
    tbl: string
    name: string
    nonuniq: number
    col: string
    seq: number
    coll: string | null
  }>(
    `SELECT TABLE_NAME AS tbl, INDEX_NAME AS name, NON_UNIQUE AS nonuniq,
            COLUMN_NAME AS col, SEQ_IN_INDEX AS seq, COLLATION AS coll
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`
  )
  const keys: RawKey[] = keyRows.map((r) => ({
    table: r.tbl,
    name: r.name,
    kind: r.name === 'PRIMARY' ? 'pk' : Number(r.nonuniq) === 0 ? 'uk' : 'idx',
    column: r.col,
    ordinal: Number(r.seq),
    direction: r.coll === 'D' ? 'DESC' : 'ASC'
  }))

  const fkRows = await q<{
    tbl: string
    name: string
    col: string
    ref_table: string
    ref_col: string
    ord: number
    del: string
    upd: string
  }>(
    `SELECT k.TABLE_NAME AS tbl, k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS col,
            k.REFERENCED_TABLE_NAME AS ref_table, k.REFERENCED_COLUMN_NAME AS ref_col,
            k.ORDINAL_POSITION AS ord, r.DELETE_RULE AS del, r.UPDATE_RULE AS upd
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`
  )
  const foreignKeys: RawForeignKey[] = fkRows.map((r) => ({
    table: r.tbl,
    name: r.name,
    column: r.col,
    refTable: r.ref_table,
    refColumn: r.ref_col,
    ordinal: Number(r.ord),
    onDelete: toFkAction(r.del),
    onUpdate: toFkAction(r.upd)
  }))

  return { dialect, tables, columns, keys, foreignKeys }
}
