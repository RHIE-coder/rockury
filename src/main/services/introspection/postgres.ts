import type { Client } from 'pg'
import {
  toFkAction,
  type IntrospectedSchema,
  type RawColumn,
  type RawForeignKey,
  type RawKey,
  type RawTable
} from './types'

/**
 * PostgreSQL 역설계 — current_schema() 스코프의 pg_catalog 를 읽는다.
 * 타입은 format_type(예: `character varying(255)`, `jsonb`, `uuid`) 네이티브.
 * 파티션 자식(relispartition)은 제외하고 논리 테이블(일반 r + 파티션 부모 p)만.
 * 인덱스 방향(ASC/DESC)은 int2vector 서브스크립팅이 까다로워 ASC 로 고정(2a 한계, 문서화).
 */
export async function introspectPg(client: Client): Promise<IntrospectedSchema> {
  const q = async <T>(sql: string): Promise<T[]> => (await client.query(sql)).rows as T[]

  // 일반 테이블(r/p) + 뷰(v)/구체화뷰(m). 파티션 자식은 제외.
  const tableRows = await q<{ name: string; comment: string; is_view: boolean }>(
    `SELECT c.relname AS name, COALESCE(obj_description(c.oid), '') AS comment,
            (c.relkind IN ('v','m')) AS is_view
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema() AND c.relkind IN ('r','p','v','m') AND NOT c.relispartition
     ORDER BY c.relname`
  )
  const tables: RawTable[] = tableRows.map((r) => ({ name: r.name, comment: r.comment, isView: r.is_view }))

  const colRows = await q<{
    tbl: string
    name: string
    type: string
    nullable: boolean
    dflt: string | null
    comment: string
    ord: number
  }>(
    `SELECT c.relname AS tbl, a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type,
            (NOT a.attnotnull) AS nullable,
            pg_get_expr(d.adbin, d.adrelid) AS dflt,
            COALESCE(col_description(a.attrelid, a.attnum), '') AS comment,
            a.attnum AS ord
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = current_schema() AND c.relkind IN ('r','p','v','m') AND NOT c.relispartition
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum`
  )
  const columns: RawColumn[] = colRows.map((r) => ({
    table: r.tbl,
    name: r.name,
    type: r.type,
    nullable: r.nullable,
    default: r.dflt,
    comment: r.comment,
    ordinal: Number(r.ord)
  }))

  const keyRows = await q<{
    tbl: string
    name: string
    kind: 'pk' | 'uk' | 'idx'
    col: string
    ord: number
  }>(
    `SELECT c.relname AS tbl, ic.relname AS name,
            CASE WHEN i.indisprimary THEN 'pk'
                 WHEN i.indisunique THEN 'uk' ELSE 'idx' END AS kind,
            a.attname AS col, k.ord AS ord
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_class ic ON ic.oid = i.indexrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE n.nspname = current_schema() AND c.relkind IN ('r','p') AND NOT c.relispartition
       AND a.attnum > 0
     ORDER BY c.relname, ic.relname, k.ord`
  )
  const keys: RawKey[] = keyRows.map((r) => ({
    table: r.tbl,
    name: r.name,
    kind: r.kind,
    column: r.col,
    ordinal: Number(r.ord),
    direction: 'ASC'
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
    `SELECT cl.relname AS tbl, con.conname AS name, att.attname AS col,
            clf.relname AS ref_table, attf.attname AS ref_col, k.ord AS ord,
            con.confdeltype AS del, con.confupdtype AS upd
     FROM pg_constraint con
     JOIN pg_class cl ON cl.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = cl.relnamespace
     JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
     JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
     JOIN pg_class clf ON clf.oid = con.confrelid
     JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS kf(attnum, ord) ON kf.ord = k.ord
     JOIN pg_attribute attf ON attf.attrelid = con.confrelid AND attf.attnum = kf.attnum
     WHERE con.contype = 'f' AND n.nspname = current_schema() AND NOT cl.relispartition
     ORDER BY cl.relname, con.conname, k.ord`
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

  return { dialect: 'postgresql', tables, columns, keys, foreignKeys }
}
