import type { DialectId } from '../../dialects'
import type { Column, Constraint, TableDef } from './types'
import { resolveColumns } from './derive'

export const isMyDialect = (d: DialectId): boolean => d === 'mysql' || d === 'mariadb'
const isMy = isMyDialect
const esc = (s: string) => s.replace(/'/g, "''")

/** 자동증가 의도 토큰 — 방언 네이티브 표기 셋 다 인식(설계 화면엔 방언 표기 그대로). */
const AUTO_TOKENS = new Set(['AUTO_INCREMENT', 'IDENTITY', 'AUTOINCREMENT'])
const isAutoDefault = (v: string | null): boolean => !!v && AUTO_TOKENS.has(v.trim().toUpperCase())

/**
 * 식별자 인용 — MySQL/MariaDB 백틱, PostgreSQL/SQLite 큰따옴표.
 * 인용부호를 이중화해 이스케이프한다(SQL 표준 식별자 인용) — 이름에 인용부호가 섞여도
 * 인용을 탈출하지 못하게. MCP set_schema 가 식별자를 원격 작성자(에이전트)에게 열어,
 * 이스케이프 없이는 조작된 이름이 실 DB DDL 로 주입될 수 있었다(보안 감사 HIGH).
 * 정상 식별자엔 인용부호가 없어 출력 불변 — 조작 입력만 무해화된다.
 */
export function quoteId(d: DialectId, name: string): string {
  return isMy(d) ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`
}
const q = quoteId

/**
 * MySQL 표기 타입을 타 방언 타입으로 변환.
 * 설계 방언 그대로 출력할 땐 identity — 이 매핑은 추후 명시적 "포팅"(새 설계 생성)
 * 엔진으로 옮겨질 로직의 씨앗이다.
 */
export function mapType(d: DialectId, type: string): string {
  if (isMy(d)) return type
  let t = type
  if (d === 'postgresql') {
    t = t
      .replace(/\s+UNSIGNED\b/gi, '')
      .replace(/\bDATETIME\b/gi, 'TIMESTAMP')
      .replace(/\bDECIMAL\b/gi, 'NUMERIC')
      .replace(/\bJSON\b/gi, 'JSONB')
  } else {
    // sqlite — 느슨한 타입 어피니티
    t = t
      .replace(/\bBIGINT\s+UNSIGNED\b/gi, 'INTEGER')
      .replace(/\bINT\s+UNSIGNED\b/gi, 'INTEGER')
      .replace(/\bBIGINT\b/gi, 'INTEGER')
      .replace(/\s+UNSIGNED\b/gi, '')
      .replace(/\bDATETIME\b/gi, 'TEXT')
      .replace(/\bDECIMAL\b/gi, 'NUMERIC')
      .replace(/\bJSON\b/gi, 'TEXT')
  }
  return t.replace(/\s+/g, ' ').trim()
}

function enumValues(type: string): string | null {
  const m = type.match(/^\s*ENUM\s*\((.*)\)\s*$/i)
  return m ? m[1] : null
}

/** 제약 컬럼 목록 → "(`a`, `b` DESC)" (direction 은 인덱스 성격일 때만). */
function colList(d: DialectId, t: TableDef, con: Constraint, withDirection: boolean): string {
  const parts = resolveColumns(t, con).map((c) => {
    const dir = withDirection && c.direction === 'DESC' ? ' DESC' : ''
    return `${q(d, c.name)}${dir}`
  })
  return `(${parts.join(', ')})`
}

/**
 * TableDef → DDL. 구조화된 제약에서 생성(생 SQL 문자열 없음).
 * 기본 사용은 소속 Design 의 방언 그대로 출력("쓴 그대로 나온다").
 * 타 방언 경로(타입 매핑·자동증가·ENUM 에뮬레이션 등)는 추후 포팅 엔진으로 승격 예정.
 */
/**
 * 뷰 DDL — `CREATE VIEW <name> AS <본문 SELECT>`.
 * `OR REPLACE` 는 MySQL/MariaDB/PostgreSQL 만 지원한다(SQLite 는 DROP 후 재생성해야 함) →
 * 방언이 받는 구문만 낸다. 본문이 비면 자리만 만들고 무엇이 비었는지 주석으로 알린다.
 */
function generateViewDdl(t: TableDef, d: DialectId): string {
  const body = (t.viewSql ?? '').trim().replace(/;\s*$/, '')
  const head = d === 'sqlite' ? 'CREATE VIEW' : 'CREATE OR REPLACE VIEW'
  // 이름·방언은 SQL 본문과 화면 머리에 이미 있다 — 주석으로 되풀이하지 않는다.
  const out: string[] = []
  // 본문이 없는 경우가 둘이다 — 설계부에서 아직 안 쓴 뷰, 그리고 운영부 역설계로 들어온 뷰
  // (introspection 은 뷰 본문을 가져오지 않는다). 어느 쪽인지 모르므로 둘 다 알린다.
  if (!body)
    out.push('-- 뷰 본문(SELECT)이 비어 있어요 — 설계에서 선언한 뷰면 Definition 에서 채우세요(실 DB 역설계는 본문을 가져오지 않습니다).')
  out.push(`${head} ${q(d, t.name)} AS`)
  out.push(`${body || 'SELECT 1'};`)
  // PG 는 뷰 설명도 COMMENT ON 으로 따로 붙는다(테이블 경로와 같은 규칙).
  if (d === 'postgresql' && t.comment) out.push('', `COMMENT ON VIEW ${q(d, t.name)} IS '${esc(t.comment)}';`)
  return out.join('\n')
}

export function generateDdl(t: TableDef, d: DialectId): string {
  if (t.isView) return generateViewDdl(t, d)

  const pre: string[] = []
  const comments: string[] = []
  const indexes: string[] = []

  // PG: ENUM → CREATE TYPE
  const pgEnumType: Record<string, string> = {}
  if (d === 'postgresql') {
    for (const c of t.columns) {
      const vals = enumValues(c.type)
      if (vals) {
        const name = `${t.name}_${c.name}`
        pgEnumType[c.id] = name
        pre.push(`CREATE TYPE ${q(d, name)} AS ENUM (${vals});`)
      }
    }
    if (t.comment) comments.push(`COMMENT ON TABLE ${q(d, t.name)} IS '${esc(t.comment)}';`)
  }

  // SQLite: 단일 컬럼 PK + AUTO_INCREMENT → INTEGER PRIMARY KEY AUTOINCREMENT 인라인
  const pkCon = t.constraints.find((k) => k.kind === 'pk')
  const sqliteAutoPk =
    d === 'sqlite' && pkCon?.columns.length === 1
      ? t.columns.find(
          (c) => c.id === pkCon.columns[0].columnId && isAutoDefault(c.defaultValue)
        )
      : undefined

  function buildColumn(c: Column): string {
    if (sqliteAutoPk && c.id === sqliteAutoPk.id) {
      return `  ${q(d, c.name)} INTEGER PRIMARY KEY AUTOINCREMENT`
    }
    const seg: string[] = [`  ${q(d, c.name || 'column')}`]
    let trailing = ''

    const vals = enumValues(c.type)
    if (d === 'postgresql' && pgEnumType[c.id]) {
      seg.push(q(d, pgEnumType[c.id]))
    } else if (d === 'sqlite' && vals) {
      seg.push('TEXT')
      trailing = ` CHECK (${q(d, c.name)} IN (${vals}))`
    } else {
      seg.push(mapType(d, c.type))
    }

    if (isAutoDefault(c.defaultValue)) {
      if (isMy(d)) seg.push(c.nullable ? 'NULL' : 'NOT NULL', 'AUTO_INCREMENT')
      else if (d === 'postgresql') seg.push('GENERATED BY DEFAULT AS IDENTITY')
    } else {
      seg.push(c.nullable ? 'NULL' : 'NOT NULL')
      if (c.defaultValue != null && c.defaultValue !== '') seg.push(`DEFAULT ${c.defaultValue}`)
    }

    if (isMy(d) && c.comment) seg.push(`COMMENT '${esc(c.comment)}'`)
    if (d === 'postgresql' && c.comment) {
      comments.push(`COMMENT ON COLUMN ${q(d, t.name)}.${q(d, c.name)} IS '${esc(c.comment)}';`)
    }
    return seg.join(' ') + trailing
  }

  const consLines: string[] = []
  for (const k of t.constraints) {
    if (sqliteAutoPk && k.kind === 'pk') continue // 인라인 처리됨
    const name = q(d, k.name)
    switch (k.kind) {
      case 'pk':
        consLines.push(`  CONSTRAINT ${name} PRIMARY KEY ${colList(d, t, k, false)}`)
        break
      case 'uk':
        consLines.push(
          `  CONSTRAINT ${name} ${isMy(d) ? 'UNIQUE KEY' : 'UNIQUE'} ${colList(d, t, k, isMy(d))}`
        )
        break
      case 'fk': {
        const refCols = (k.refColumns ?? []).map((rc) => q(d, rc)).join(', ')
        let line =
          `  CONSTRAINT ${name} FOREIGN KEY ${colList(d, t, k, false)}` +
          ` REFERENCES ${q(d, k.refTable ?? '?')} (${refCols})`
        if (k.onDelete) line += ` ON DELETE ${k.onDelete}`
        if (k.onUpdate) line += ` ON UPDATE ${k.onUpdate}`
        consLines.push(line)
        break
      }
      case 'check':
        consLines.push(`  CONSTRAINT ${name} CHECK (${k.expression ?? ''})`)
        break
      case 'idx':
        if (isMy(d)) {
          consLines.push(`  INDEX ${name} ${colList(d, t, k, true)}`)
        } else {
          indexes.push(`CREATE INDEX ${name} ON ${q(d, t.name)} ${colList(d, t, k, true)};`)
        }
        break
    }
  }

  const close = isMy(d)
    ? `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4${t.comment ? ` COMMENT='${esc(t.comment)}'` : ''};`
    : ');'

  const out: string[] = []
  if (pre.length) out.push(...pre, '')
  out.push(`CREATE TABLE ${q(d, t.name)} (`)
  out.push([...t.columns.map(buildColumn), ...consLines].join(',\n'))
  out.push(close)
  if (comments.length) out.push('', ...comments)
  if (indexes.length) out.push('', ...indexes)
  return out.join('\n')
}
