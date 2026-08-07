import type { Connection } from 'mysql2/promise'
import {
  toFkAction,
  type FkAction,
  type IntroDbType,
  type IntrospectedSchema,
  type RawCheck,
  type RawColumn,
  type RawForeignKey,
  type RawKey,
  type RawTable
} from './types'
import { balancedParens, stripOuterParens } from './sqlText'

/**
 * MySQL/MariaDB 역설계 — **넘겨받은 database 목록**의 information_schema 를 읽는다.
 * 목록이 비면 예전처럼 `DATABASE()` 하나만 — 범위를 안 고른 연결의 동작이 안 바뀐다.
 *
 * MySQL 은 database 와 schema 가 **같은 말**이고 연결 하나로 여러 database 를 넘나든다
 * (`db1.t JOIN db2.t`, InnoDB 는 교차 database FK 도 건다). 그래서 PostgreSQL 의 schema 와
 * 같은 자리에 놓고 `schema` 필드에 database 이름을 담는다(§db-remote.scope).
 *
 * 타입은 COLUMN_TYPE(예: `varchar(255)`, `int unsigned`) 네이티브 그대로.
 * PK/UK/IDX 는 STATISTICS, FK·CHECK 는 아래 "제약" 절 참조 — **뷰를 조인하지 않는다.**
 */
export async function introspectMysql(
  conn: Connection,
  dialect: IntroDbType,
  schemas: string[] = []
): Promise<IntrospectedSchema> {
  const warnings: string[] = []
  const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const [rows] = await conn.query(sql, params)
    return rows as T[]
  }
  /**
   * 못 보는 뷰가 있어도 나머지는 읽는다 — 질의 하나의 실패가 결과 전체를 0으로 만들지 않게.
   * 여기서 사용자 경고를 남기지 않는 이유: 실패해도 아래 실물(DDL) 경로가 메우면 손실이 없다.
   * 경고는 **정말 못 읽고 끝난 것**만 담는다(안 그러면 경고가 흔해져 아무도 안 본다).
   */
  const tryQ = async <T>(what: string, sql: string, params: unknown[] = []): Promise<T[]> => {
    try {
      return await q<T>(sql, params)
    } catch (e) {
      console.warn(`[introspect] ${what} 를 읽지 못했습니다 — 대체 경로로 갑니다.`, e)
      return []
    }
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

  // ── 제약(FK·CHECK) ─────────────────────────────────────────────────────────
  // 조각을 **따로** 읽고 코드에서 잇는다. 예전엔 뷰를 JOIN 했는데, 한쪽만 못 보는 계정에서는
  // 결과가 0행이 되어 제약이 통째로 사라졌다 — 오류가 아니라 빈 결과라 화면엔 "없음"이라는
  // 조용한 거짓으로 보인다. information_schema 는 권한에 따라 뷰별로 다르게 가려진다.
  //
  // TABLE_CONSTRAINTS 는 **심판** 노릇을 한다 — 어느 표를 "봤는지"를 알려 준다.
  // 여기 한 줄도 없는 표는 제약이 없는 게 아니라 안 보이는 표다(아래 판정 참조).
  const tcRows = await tryQ<{ schema: string; tbl: string; name: string; ctype: string }>(
    'information_schema.TABLE_CONSTRAINTS',
    `SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS tbl, CONSTRAINT_NAME AS name,
            CONSTRAINT_TYPE AS ctype
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA ${inScope}`,
    [scope]
  )

  // REFERENCED_TABLE_SCHEMA 도 읽는다 — MySQL 은 교차 database FK 가 실제로 있어서,
  // 참조 대상이 범위 밖 database 일 수 있다.
  const kcuRows = await tryQ<{
    schema: string
    cschema: string
    tbl: string
    name: string
    col: string
    ref_schema: string | null
    ref_table: string | null
    ref_col: string | null
    ord: number
  }>(
    'information_schema.KEY_COLUMN_USAGE',
    `SELECT k.TABLE_SCHEMA AS \`schema\`, k.CONSTRAINT_SCHEMA AS cschema,
            k.TABLE_NAME AS tbl, k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS col,
            k.REFERENCED_TABLE_SCHEMA AS ref_schema, k.REFERENCED_TABLE_NAME AS ref_table,
            k.REFERENCED_COLUMN_NAME AS ref_col, k.ORDINAL_POSITION AS ord
     FROM information_schema.KEY_COLUMN_USAGE k
     WHERE k.TABLE_SCHEMA ${inScope}
     ORDER BY k.TABLE_SCHEMA, k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [scope]
  )
  const ruleRows = await tryQ<{ schema: string; tbl: string; name: string; del: string; upd: string }>(
    'information_schema.REFERENTIAL_CONSTRAINTS',
    `SELECT CONSTRAINT_SCHEMA AS \`schema\`, TABLE_NAME AS tbl, CONSTRAINT_NAME AS name,
            DELETE_RULE AS del, UPDATE_RULE AS upd
     FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA ${inScope}`,
    [scope]
  )
  const ruleOf = new Map(ruleRows.map((r) => [conKey(r.schema, r.tbl, r.name), r]))

  let foreignKeys: RawForeignKey[] = kcuRows
    .filter((r) => r.ref_table)
    .map((r) => ({
      schema: r.schema,
      table: r.tbl,
      name: r.name,
      column: r.col,
      refSchema: r.ref_schema ?? r.schema,
      refTable: r.ref_table!,
      refColumn: r.ref_col!,
      ordinal: Number(r.ord),
      // 규칙은 제약이 사는 스키마(cschema)로 찾고, 표 소속은 표의 스키마(schema)로 단다.
      onDelete: toFkAction(ruleOf.get(conKey(r.cschema, r.tbl, r.name))?.del),
      onUpdate: toFkAction(ruleOf.get(conKey(r.cschema, r.tbl, r.name))?.upd)
    }))

  // CHECK — 이름은 TABLE_CONSTRAINTS 가, 식은 CHECK_CONSTRAINTS 가 안다(MySQL 8.0.16+ / MariaDB 10.2+).
  // 옛 버전엔 뷰 자체가 없어 빈 목록이 되는데, 그때는 실물에도 CHECK 가 없으니 결과가 같다.
  const clauseRows = await tryQ<{ schema: string; name: string; expr: string }>(
    'information_schema.CHECK_CONSTRAINTS',
    `SELECT CONSTRAINT_SCHEMA AS \`schema\`, CONSTRAINT_NAME AS name, CHECK_CLAUSE AS expr
     FROM information_schema.CHECK_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA ${inScope}`,
    [scope]
  )
  const clauseOf = new Map(clauseRows.map((r) => [`${r.schema}\u0000${r.name}`, r.expr]))
  let checks: RawCheck[] = tcRows
    .filter((r) => r.ctype === 'CHECK')
    .map((r) => ({
      schema: r.schema,
      table: r.tbl,
      name: r.name,
      expression: stripOuterParens(clauseOf.get(`${r.schema}\u0000${r.name}`) ?? '')
    }))

  // "없다"와 "못 본다"를 가른다 — 빈 결과는 오류가 아니라서 그냥 두면 "없다"로 읽힌다.
  // 판정은 **표마다** 한다: MySQL 은 표 단위로 권한을 가리므로, 심판이 한 줄도 못 본 표는
  // "제약이 없는 표"가 아니라 "안 보이는 표"다. 그런 표만 실물(DDL)로 확인한다.
  const judged = new Set(tcRows.map((r) => tableKey(r.schema, r.tbl)))
  const need = new Map<string, { schema: string; name: string }>()
  for (const t of tables) {
    if (t.isView || judged.has(tableKey(t.schema, t.name))) continue
    need.set(tableKey(t.schema, t.name), { schema: t.schema, name: t.name })
  }
  // 조각이 비어 온 제약도 실물로 메운다 — 이름만 알고 규칙·식을 모르는 상태를 남기지 않는다.
  const patchy = [
    ...(ruleRows.length === 0 ? uniqueTables(foreignKeys) : []),
    ...uniqueTables(checks.filter((c) => !c.expression))
  ]
  for (const t of patchy) need.set(tableKey(t.schema, t.name), t)

  if (need.size > 0) {
    const ddl = await constraintsFromDdl(q, [...need.values()])
    foreignKeys = mergeByTable(foreignKeys, ddl.fks, ddl.covered)
    checks = mergeByTable(checks, ddl.checks, ddl.covered)

    // 여기까지 와서도 못 읽은 표가 있으면 그건 진짜 구멍이다 — 화면이 그 사실을 말해야 한다.
    if (ddl.failed.length > 0) {
      const shown = ddl.failed.slice(0, 5).join(', ')
      const rest = ddl.failed.length > 5 ? ` 외 ${ddl.failed.length - 5}개` : ''
      warnings.push(`제약을 못 읽은 표 ${ddl.failed.length}개 — ${shown}${rest}`)
    }
  }

  return { dialect, schemas: scope, tables, columns, keys, foreignKeys, checks, warnings }
}

/** 제약을 짚는 키. 널 문자 구분자 — 식별자에 절대 안 들어가 경계 혼동이 없다. */
const conKey = (schema: string, table: string, name: string): string =>
  `${schema}\u0000${table}\u0000${name}`
const tableKey = (schema: string, table: string): string => `${schema}\u0000${table}`

/** 제약 행 목록에서 표 목록만 뽑는다(중복 없이). */
const uniqueTables = (rows: { schema: string; table: string }[]): { schema: string; name: string }[] => [
  ...new Map(rows.map((r) => [tableKey(r.schema, r.table), r])).values()
].map((r) => ({ schema: r.schema, name: r.table }))

/** 실물에서 읽어낸 표는 실물 값으로 갈고, 못 읽은 표는 원래 값을 남긴다. */
function mergeByTable<T extends { schema: string; table: string }>(
  had: T[],
  fresh: T[],
  covered: Set<string>
): T[] {
  return [...had.filter((r) => !covered.has(tableKey(r.schema, r.table))), ...fresh]
}

/** 식별자 인용 — 이름은 `?` 자리에 못 넣는다(값이 아니라 이름이라서). 백틱은 겹쳐 막는다. */
const qid = (name: string): string => `\`${name.replace(/`/g, '``')}\``

/** 백틱 식별자 — 안쪽 백틱은 두 번 겹쳐 적힌다(``). */
const IDENT = '`(?:[^`]|``)*`'

/**
 * `SHOW CREATE TABLE` 의 FK 한 줄:
 *   CONSTRAINT `이름` FOREIGN KEY (`a`,`b`) REFERENCES `다른db`.`t` (`x`,`y`) ON DELETE CASCADE ...
 * 줄 앞에 앵커를 건다 — 컬럼 주석 안의 같은 글자를 FK 로 오독하지 않게.
 * `FOREIGN KEY` 뒤의 선택적 식별자는 MariaDB 가 찍는 인덱스 이름 자리다.
 */
const FK_LINE = new RegExp(
  `^\\s*(?:CONSTRAINT\\s+(${IDENT})\\s+)?FOREIGN\\s+KEY\\s*(?:${IDENT}\\s*)?\\(([^)]*)\\)\\s*` +
    `REFERENCES\\s+(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?\\s*\\(([^)]*)\\)(.*)$`,
  'i'
)

/** CHECK 한 줄의 **머리**. 식은 괄호를 세어 끝을 찾으므로 여기서는 여는 괄호까지만 본다. */
const CHECK_HEAD = new RegExp(`^\\s*(?:CONSTRAINT\\s+(${IDENT})\\s+)?CHECK\\s*\\(`, 'i')

const unq = (raw: string): string =>
  (raw.startsWith('`') ? raw.slice(1, -1) : raw).replace(/``/g, '`')

const idList = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => unq(s.trim()))
    .filter((s) => s.length > 0)

function fkRule(tail: string, kw: 'DELETE' | 'UPDATE'): FkAction {
  const m = new RegExp(
    `ON\\s+${kw}\\s+(RESTRICT|CASCADE|SET\\s+NULL|SET\\s+DEFAULT|NO\\s+ACTION)`,
    'i'
  ).exec(tail)
  // 절이 없으면 MySQL 기본은 NO ACTION — REFERENTIAL_CONSTRAINTS 가 답하는 값과 같게 맞춘다.
  return toFkAction(m ? m[1].replace(/\s+/g, ' ') : null)
}

/**
 * `SHOW CREATE TABLE` 본문에서 FK 를 읽는 **순수 함수**. information_schema 를 못 보는 계정에서도
 * 이 경로는 열려 있다(표를 읽을 권한만 있으면 된다).
 */
export function parseCreateTableForeignKeys(
  schema: string,
  table: string,
  ddl: string
): RawForeignKey[] {
  const out: RawForeignKey[] = []
  let nth = 0
  for (const line of ddl.split('\n')) {
    const m = FK_LINE.exec(line)
    if (!m) continue
    const [, rawName, rawCols, rawRef1, rawRef2, rawRefCols, tail] = m
    const cols = idList(rawCols)
    const refCols = idList(rawRefCols)
    nth += 1
    // 짝이 안 맞으면 버린다 — 반쪽짜리 관계를 지어내느니 없는 편이 낫다.
    if (cols.length === 0 || cols.length !== refCols.length) continue
    const onDelete = fkRule(tail, 'DELETE')
    const onUpdate = fkRule(tail, 'UPDATE')
    for (const [i, column] of cols.entries()) {
      out.push({
        schema,
        table,
        // 이름이 없는 경우는 MySQL 이 붙이는 자동 이름 규칙을 따라 채운다(표시·짝맞춤용).
        name: rawName ? unq(rawName) : `${table}_ibfk_${nth}`,
        column,
        refSchema: rawRef2 ? unq(rawRef1) : schema,
        refTable: unq(rawRef2 ?? rawRef1),
        refColumn: refCols[i],
        ordinal: i + 1,
        onDelete,
        onUpdate
      })
    }
  }
  return out
}

/** `SHOW CREATE TABLE` 본문에서 CHECK 를 읽는 **순수 함수**. 식이 여러 줄이어도 괄호로 끝을 찾는다. */
export function parseCreateTableChecks(schema: string, table: string, ddl: string): RawCheck[] {
  const out: RawCheck[] = []
  let offset = 0
  let nth = 0
  for (const line of ddl.split('\n')) {
    const m = CHECK_HEAD.exec(line)
    if (m) {
      nth += 1
      const b = balancedParens(ddl, offset + m[0].length - 1)
      if (b) {
        out.push({
          schema,
          table,
          name: m[1] ? unq(m[1]) : `${table}_chk_${nth}`,
          expression: stripOuterParens(b.inner)
        })
      }
    }
    offset += line.length + 1 // 잘라낸 개행 한 글자
  }
  return out
}

/**
 * 표마다 `SHOW CREATE TABLE` 로 제약을 긁는다 — information_schema 가 가려진 계정의 유일한 길.
 * 실제로 읽어낸 표(covered)와 못 읽은 표(failed)를 함께 돌려준다: 못 읽은 것을 조용히 넘기면
 * 그게 "제약 없음"이라는 거짓이 된다.
 */
async function constraintsFromDdl(
  q: <T>(sql: string, params?: unknown[]) => Promise<T[]>,
  targets: { schema: string; name: string }[]
): Promise<{ fks: RawForeignKey[]; checks: RawCheck[]; covered: Set<string>; failed: string[] }> {
  const fks: RawForeignKey[] = []
  const checks: RawCheck[] = []
  const covered = new Set<string>()
  const failed: string[] = []
  for (const t of targets) {
    try {
      const rows = await q<Record<string, string>>(`SHOW CREATE TABLE ${qid(t.schema)}.${qid(t.name)}`)
      const ddl = rows[0]?.['Create Table'] ?? ''
      fks.push(...parseCreateTableForeignKeys(t.schema, t.name, ddl))
      checks.push(...parseCreateTableChecks(t.schema, t.name, ddl))
      covered.add(tableKey(t.schema, t.name))
    } catch (e) {
      // 표 하나가 막혔다고 나머지까지 포기하지 않는다 — 그 표만 빼고, 뺐다고 말한다.
      console.warn(`[introspect] SHOW CREATE TABLE 실패, 건너뜁니다: ${t.schema}.${t.name}`, e)
      failed.push(`${t.schema}.${t.name}`)
    }
  }
  return { fks, checks, covered, failed }
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
