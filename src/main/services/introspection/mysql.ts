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
 * MySQL/MariaDB 역설계 — **넘겨받은 database 목록**의 information_schema 를 읽는다.
 * 목록이 비면 예전처럼 `DATABASE()` 하나만 — 범위를 안 고른 연결의 동작이 안 바뀐다.
 *
 * MySQL 은 database 와 schema 가 **같은 말**이고 연결 하나로 여러 database 를 넘나든다
 * (`db1.t JOIN db2.t`, InnoDB 는 교차 database FK 도 건다). 그래서 PostgreSQL 의 schema 와
 * 같은 자리에 놓고 `schema` 필드에 database 이름을 담는다(§db-remote.scope).
 *
 * 타입은 COLUMN_TYPE(예: `varchar(255)`, `int unsigned`) 네이티브 그대로.
 * PK/UK/IDX 는 STATISTICS, FK 는 KEY_COLUMN_USAGE+REFERENTIAL_CONSTRAINTS.
 */
export async function introspectMysql(
  conn: Connection,
  dialect: IntroDbType,
  schemas: string[] = []
): Promise<IntrospectedSchema> {
  const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const [rows] = await conn.query(sql, params)
    return rows as T[]
  }

  const scope =
    schemas.length > 0 ? schemas : [(await q<{ s: string }>('SELECT DATABASE() AS s'))[0]?.s ?? '']
  // mysql2 는 `IN (?)` 자리에 배열을 넣으면 목록으로 편다 — 이름을 문자열로 이어 붙이지 않는다(주입 방어).
  const inScope = 'IN (?)'

  // BASE TABLE + VIEW 를 함께 읽고 종류로 가른다.
  const tableRows = await q<{ schema: string; name: string; comment: string; ttype: string }>(
    `SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS name, IFNULL(TABLE_COMMENT,'') AS comment, TABLE_TYPE AS ttype
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA ${inScope} AND TABLE_TYPE IN ('BASE TABLE','VIEW')
     ORDER BY TABLE_SCHEMA, TABLE_NAME`,
    [scope]
  )
  const tables: RawTable[] = tableRows.map((r) => ({
    schema: r.schema,
    name: r.name,
    comment: r.comment,
    isView: r.ttype === 'VIEW'
  }))

  const colRows = await q<{
    schema: string
    tbl: string
    name: string
    type: string
    nullable: string
    dflt: string | null
    comment: string
    ord: number
  }>(
    `SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS tbl, COLUMN_NAME AS name, COLUMN_TYPE AS type,
            IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt,
            IFNULL(COLUMN_COMMENT,'') AS comment, ORDINAL_POSITION AS ord
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA ${inScope}
     ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
    [scope]
  )
  const columns: RawColumn[] = colRows.map((r) => ({
    schema: r.schema,
    table: r.tbl,
    name: r.name,
    type: r.type,
    nullable: r.nullable === 'YES',
    default: r.dflt,
    comment: r.comment,
    ordinal: Number(r.ord)
  }))

  const keyRows = await q<{
    schema: string
    tbl: string
    name: string
    nonuniq: number
    col: string
    seq: number
    coll: string | null
  }>(
    `SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS tbl, INDEX_NAME AS name, NON_UNIQUE AS nonuniq,
            COLUMN_NAME AS col, SEQ_IN_INDEX AS seq, COLLATION AS coll
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA ${inScope}
     ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [scope]
  )
  const keys: RawKey[] = keyRows.map((r) => ({
    schema: r.schema,
    table: r.tbl,
    name: r.name,
    kind: r.name === 'PRIMARY' ? 'pk' : Number(r.nonuniq) === 0 ? 'uk' : 'idx',
    column: r.col,
    ordinal: Number(r.seq),
    direction: r.coll === 'D' ? 'DESC' : 'ASC'
  }))

  // REFERENCED_TABLE_SCHEMA 도 읽는다 — MySQL 은 교차 database FK 가 실제로 있어서,
  // 참조 대상이 범위 밖 database 일 수 있다.
  const fkRows = await q<{
    schema: string
    tbl: string
    name: string
    col: string
    ref_schema: string
    ref_table: string
    ref_col: string
    ord: number
    del: string
    upd: string
  }>(
    `SELECT k.TABLE_SCHEMA AS \`schema\`, k.TABLE_NAME AS tbl, k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS col,
            k.REFERENCED_TABLE_SCHEMA AS ref_schema, k.REFERENCED_TABLE_NAME AS ref_table,
            k.REFERENCED_COLUMN_NAME AS ref_col,
            k.ORDINAL_POSITION AS ord, r.DELETE_RULE AS del, r.UPDATE_RULE AS upd
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA ${inScope} AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.TABLE_SCHEMA, k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [scope]
  )
  const foreignKeys: RawForeignKey[] = fkRows.map((r) => ({
    schema: r.schema,
    table: r.tbl,
    name: r.name,
    column: r.col,
    refSchema: r.ref_schema ?? r.schema,
    refTable: r.ref_table,
    refColumn: r.ref_col,
    ordinal: Number(r.ord),
    onDelete: toFkAction(r.del),
    onUpdate: toFkAction(r.upd)
  }))

  return { dialect, schemas: scope, tables, columns, keys, foreignKeys }
}

/** 이 서버에서 고를 수 있는 database 목록(= MySQL 의 스키마). 시스템 것은 뺀다. */
export async function listMysqlSchemas(conn: Connection): Promise<string[]> {
  const [rows] = await conn.query(
    `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA
     WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys')
     ORDER BY SCHEMA_NAME`
  )
  return (rows as { name: string }[]).map((r) => r.name)
}
