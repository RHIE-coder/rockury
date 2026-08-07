import type { Client } from 'pg'
import {
  toFkAction,
  type IntrospectedSchema,
  type RawCheck,
  type RawColumn,
  type RawForeignKey,
  type RawKey,
  type RawTable
} from './types'
import { stripCheckKeyword } from './sqlText'

/**
 * PostgreSQL 역설계 — **넘겨받은 스키마 목록**의 pg_catalog 를 읽는다(§db-remote.scope).
 * 목록이 비면 예전처럼 `current_schema()` 한 곳만 — 범위를 안 고른 연결의 동작이 안 바뀐다.
 * 타입은 format_type(예: `character varying(255)`, `jsonb`, `uuid`) 네이티브.
 * 파티션 자식(relispartition)은 제외하고 논리 테이블(일반 r + 파티션 부모 p)만.
 * 인덱스 방향(ASC/DESC)은 int2vector 서브스크립팅이 까다로워 ASC 로 고정(2a 한계, 문서화).
 *
 * 카탈로그(database)를 넘는 것은 여기서 읽지 않는다 — 한 연결은 database 하나에 묶이고
 * PostgreSQL 은 교차 database 질의 자체가 없다. 다른 database 는 다른 연결이다.
 */
export async function introspectPg(client: Client, schemas: string[] = []): Promise<IntrospectedSchema> {
  const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[]

  // 범위를 안 고른 연결은 예전 그대로 current_schema() 한 곳.
  const scope = schemas.length > 0 ? schemas : [(await q<{ s: string }>('SELECT current_schema() AS s'))[0]?.s ?? 'public']
  const inScope = 'n.nspname = ANY($1)'

  // 일반 테이블(r/p) + 뷰(v)/구체화뷰(m). 파티션 자식은 제외.
  const tableRows = await q<{ schema: string; name: string; comment: string; is_view: boolean }>(
    `SELECT n.nspname AS schema, c.relname AS name, COALESCE(obj_description(c.oid), '') AS comment,
            (c.relkind IN ('v','m')) AS is_view
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE ${inScope} AND c.relkind IN ('r','p','v','m') AND NOT c.relispartition
     ORDER BY n.nspname, c.relname`,
    [scope]
  )
  const tables: RawTable[] = tableRows.map((r) => ({
    schema: r.schema,
    name: r.name,
    comment: r.comment,
    isView: r.is_view
  }))

  const colRows = await q<{
    schema: string
    tbl: string
    name: string
    type: string
    nullable: boolean
    dflt: string | null
    comment: string
    ord: number
  }>(
    `SELECT n.nspname AS schema, c.relname AS tbl, a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type,
            (NOT a.attnotnull) AS nullable,
            pg_get_expr(d.adbin, d.adrelid) AS dflt,
            COALESCE(col_description(a.attrelid, a.attnum), '') AS comment,
            a.attnum AS ord
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE ${inScope} AND c.relkind IN ('r','p','v','m') AND NOT c.relispartition
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY n.nspname, c.relname, a.attnum`,
    [scope]
  )
  const columns: RawColumn[] = colRows.map((r) => ({
    schema: r.schema,
    table: r.tbl,
    name: r.name,
    type: r.type,
    nullable: r.nullable,
    default: r.dflt,
    comment: r.comment,
    ordinal: Number(r.ord)
  }))

  const keyRows = await q<{
    schema: string
    tbl: string
    name: string
    kind: 'pk' | 'uk' | 'idx'
    col: string
    ord: number
  }>(
    `SELECT n.nspname AS schema, c.relname AS tbl, ic.relname AS name,
            CASE WHEN i.indisprimary THEN 'pk'
                 WHEN i.indisunique THEN 'uk' ELSE 'idx' END AS kind,
            a.attname AS col, k.ord AS ord
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_class ic ON ic.oid = i.indexrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE ${inScope} AND c.relkind IN ('r','p') AND NOT c.relispartition
       AND a.attnum > 0
     ORDER BY n.nspname, c.relname, ic.relname, k.ord`,
    [scope]
  )
  const keys: RawKey[] = keyRows.map((r) => ({
    schema: r.schema,
    table: r.tbl,
    name: r.name,
    kind: r.kind,
    column: r.col,
    ordinal: Number(r.ord),
    direction: 'ASC'
  }))

  // 참조 대상(clf)의 스키마도 함께 읽는다 — 범위 안의 테이블이 **범위 밖**을 가리킬 수 있고,
  // 그때 어디를 가리키는지 알아야 화면이 "범위 밖 카드"로 그릴 수 있다.
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
    `SELECT n.nspname AS schema, cl.relname AS tbl, con.conname AS name, att.attname AS col,
            nf.nspname AS ref_schema, clf.relname AS ref_table, attf.attname AS ref_col, k.ord AS ord,
            con.confdeltype AS del, con.confupdtype AS upd
     FROM pg_constraint con
     JOIN pg_class cl ON cl.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = cl.relnamespace
     JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
     JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
     JOIN pg_class clf ON clf.oid = con.confrelid
     JOIN pg_namespace nf ON nf.oid = clf.relnamespace
     JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS kf(attnum, ord) ON kf.ord = k.ord
     JOIN pg_attribute attf ON attf.attrelid = con.confrelid AND attf.attnum = kf.attnum
     WHERE con.contype = 'f' AND ${inScope} AND NOT cl.relispartition
     ORDER BY n.nspname, cl.relname, con.conname, k.ord`,
    [scope]
  )
  const foreignKeys: RawForeignKey[] = fkRows.map((r) => ({
    schema: r.schema,
    table: r.tbl,
    name: r.name,
    column: r.col,
    refSchema: r.ref_schema,
    refTable: r.ref_table,
    refColumn: r.ref_col,
    ordinal: Number(r.ord),
    onDelete: toFkAction(r.del),
    onUpdate: toFkAction(r.upd)
  }))

  // CHECK — pg_get_constraintdef 이 `CHECK ((expr))` 로 돌려주므로 `CHECK ` 를 떼고 괄호 한 겹을 벗긴다
  // (설계부의 식은 괄호 없이 저장되고, DDL 생성기가 `CHECK (...)` 를 다시 씌운다).
  // NOT NULL 은 PostgreSQL 에서 제약 행이 아니라 컬럼 속성이라 여기 안 들어온다 — 컬럼의 nullable 이 이미 말한다.
  const checkRows = await q<{ schema: string; tbl: string; name: string; def: string }>(
    `SELECT n.nspname AS schema, cl.relname AS tbl, con.conname AS name,
            pg_get_constraintdef(con.oid) AS def
     FROM pg_constraint con
     JOIN pg_class cl ON cl.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = cl.relnamespace
     WHERE con.contype = 'c' AND ${inScope} AND NOT cl.relispartition
     ORDER BY n.nspname, cl.relname, con.conname`,
    [scope]
  )
  const checks: RawCheck[] = checkRows.map((r) => ({
    schema: r.schema,
    table: r.tbl,
    name: r.name,
    expression: stripCheckKeyword(r.def)
  }))

  // pg_catalog 는 권한으로 조용히 가려지지 않는다(못 보면 오류로 터진다) — 경고할 구멍이 없다.
  return { dialect: 'postgresql', schemas: scope, tables, columns, keys, foreignKeys, checks, warnings: [] }
}

/** 시스템 스키마 — 사람이 고를 목록에서 뺀다. */
const PG_SYSTEM_SCHEMA = `nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'`

/** 이 연결(= 이 database)에서 고를 수 있는 스키마 목록. */
export async function listPgSchemas(client: Client): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT nspname FROM pg_namespace WHERE ${PG_SYSTEM_SCHEMA} ORDER BY nspname`
  )
  return (rows as { nspname: string }[]).map((r) => r.nspname)
}

/**
 * 이 서버의 database 목록. PostgreSQL 만 의미가 있다 — 고르면 **연결을 갈아탄다**
 * (한 연결은 database 하나에 묶여서, 여기서 고른 것을 지금 연결로 볼 수 없다).
 */
export async function listPgCatalogs(client: Client): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname`
  )
  return (rows as { datname: string }[]).map((r) => r.datname)
}
