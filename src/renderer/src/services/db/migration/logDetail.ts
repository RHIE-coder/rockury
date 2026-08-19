import { dialectInfo, type DialectId } from '../dialects'
import type { MigrationStatement } from './ddlDiff'
import type { SeedApplyStep } from '../workspaces/seed/seedApplyPlan'

/**
 * 기록 상세(`migration_logs.detail`) 문안 — **순수**.
 *
 * 왜 따로 두나: 요약 한 줄("38개 테이블")만으로는 되짚을 수 없다는 지적(2026-08-18 사용자:
 * "기록이 이렇게 있으면 감사용으로 사용할 수 있는거야?")에 답하는 자리다. 감사 기록이
 * 답해야 하는 것은 넷이다 — **어디에**(연결·계정·호스트) · **무엇을**(스키마·테이블·행) ·
 * **어떻게**(실제로 나간 문) · **어떻게 끝났나**(성공·실패·롤백).
 *
 * 값(파라미터)은 절대 안 담는다: 시드 문의 값에는 환경 변수로 채운 비밀이 섞인다.
 * 문은 자리표시자(`?`) 그대로 남기고, 어느 행이었는지는 짝짓기 기준 값(label)으로 남긴다.
 */

/** 기록이 가리키는 대상 — "어디에 한 일인가". */
export interface LogTarget {
  name: string
  dialectLabel: string
  host: string
  port: number
  database: string
  user: string
}

/** 연결 하나를 기록이 쓰는 대상으로 옮긴다 — 기록은 연결이 지워진 뒤에도 읽혀야 해서 값을 베껴 둔다. */
export const logTarget = (c: {
  name: string
  dbType: DialectId
  host: string
  port: number
  database: string
  user: string
}): LogTarget => ({
  name: c.name,
  dialectLabel: dialectInfo(c.dbType).label,
  host: c.host,
  port: c.port,
  database: c.database,
  user: c.user
})

/**
 * 지금 목록에 있는 연결을 기록 대상으로 집는다. 없으면 null — 없는 값을 지어내느니 안 적는 편이
 * 감사에 정직하다.
 *
 * 왜 접속 스토어를 **호출 시점에** 늦게 부르나: 그 모듈은 읽히는 순간 `window` 를 건드린다.
 * 정적으로 물면 window 가 없는 노드 환경 테스트가 임포트 단계에서 통째로 깨진다.
 */
export async function logTargetOf(connectionId: string): Promise<LogTarget | null> {
  const { useConnectionsStore } = await import('../connections/store')
  const c = useConnectionsStore.getState().connections.find((x) => x.id === connectionId)
  return c ? logTarget(c) : null
}

/** 스키마가 빈 테이블은 그 연결의 기본 스키마다(TableDef.schema 주석) — 빈칸으로 두면 안 보인다. */
const DEFAULT_SCHEMA_LABEL = '(기본)'

export const targetLine = (t: LogTarget): string =>
  `연결 ${t.name} · ${t.dialectLabel} · ${t.user}@${t.host}:${t.port}/${t.database}`

/** 스키마별 테이블 수 — 원래 나온 순서를 지킨다(정렬하면 실 DB 의 스코프 순서를 잃는다). */
export function schemaCounts(tables: { schema?: string }[]): { schema: string; count: number }[] {
  const out: { schema: string; count: number }[] = []
  const at = new Map<string, number>()
  for (const t of tables) {
    const key = t.schema?.trim() || DEFAULT_SCHEMA_LABEL
    const i = at.get(key)
    if (i === undefined) {
      at.set(key, out.length)
      out.push({ schema: key, count: 1 })
    } else out[i].count++
  }
  return out
}

export const schemaLine = (tables: { schema?: string }[]): string =>
  `스키마 ${schemaCounts(tables)
    .map((s) => `${s.schema} ${s.count}`)
    .join(' · ')}`

const qualified = (t: { schema?: string; name: string }): string =>
  t.schema?.trim() ? `${t.schema}.${t.name}` : t.name

/** 줄을 잇되 빈 줄은 떨어뜨린다 — 빈 줄이 섞이면 화면에서 이유 없는 공백이 된다. */
const lines = (...xs: (string | null)[]): string => xs.filter((x): x is string => !!x).join('\n')

/** 맵핑·가져오기 — 그때 읽은 범위(어느 스키마의 어느 테이블)를 그대로 박아 둔다. */
export function scopeLogDetail(input: {
  target: LogTarget
  tables: { schema?: string; name: string }[]
}): string {
  const { target, tables } = input
  return lines(
    targetLine(target),
    tables.length > 0 ? schemaLine(tables) : null,
    tables.length > 0 ? `테이블 ${tables.map(qualified).join(', ')}` : '테이블 없음'
  )
}

/** 스키마 반영 — 실제로 나간 DDL 전문. DDL 에는 값이 안 들어가 그대로 남겨도 안전하다. */
export function applyLogDetail(input: {
  target: LogTarget
  statements: MigrationStatement[]
  affected: number
}): string {
  const { target, statements, affected } = input
  const tables = [...new Set(statements.map((s) => s.table).filter(Boolean))]
  const destructive = statements.filter((s) => s.destructive).length
  return lines(
    targetLine(target),
    tables.length > 0 ? `대상 ${tables.join(', ')}` : null,
    `문 ${statements.length}개 · 영향 ${affected}행${destructive > 0 ? ` · 지우는 문 ${destructive}개` : ''}`,
    ...statements.map((s) => s.sql.trim())
  )
}

/** 시드 반영 — 어느 테이블의 어느 행을 넣고 고치고 지웠나. */
export function seedApplyLogDetail(input: {
  target: LogTarget
  steps: SeedApplyStep[]
  affected: number
}): string {
  const { target, steps, affected } = input
  const KIND: Record<string, string> = { insert: '넣기', update: '고치기', 'delete-candidate': '지우기' }
  const byTable = new Map<string, string[]>()
  for (const s of steps) {
    const list = byTable.get(s.table) ?? []
    list.push(`${KIND[s.kind] ?? s.kind} ${s.label}`)
    byTable.set(s.table, list)
  }
  return lines(
    targetLine(target),
    `문 ${steps.length}개 · 영향 ${affected}행`,
    ...[...byTable].map(([table, items]) => `${table} — ${items.join(' · ')}`)
  )
}

/**
 * **되짚은 상세** — 상세를 남기기 전에 쌓인 옛 기록용.
 *
 * 그 시절 기록엔 요약 한 줄뿐이지만, 맵핑 기록은 버전을 가리키고 그 **버전 스냅샷**이 당시
 * 스키마를 통째로 들고 있다. 그걸 읽어 무엇을 들였는지 되짚는다.
 *
 * 기록된 값이 아니라 **되짚은 값**이라는 것을 첫 줄에 밝힌다 — 감사에서 이 둘을 섞으면
 * 안 된다(연결 정보는 그때 것이 아닐 수 있어 아예 안 적는다).
 */
export function derivedScopeDetail(tables: { schema?: string; name: string }[]): string {
  if (tables.length === 0) return ''
  return lines(
    DERIVED_HEAD,
    schemaLine(tables),
    `테이블 ${tables.map(qualified).join(', ')}`
  )
}

/** 되짚은 상세임을 알리는 머리줄 — 파서가 이 줄을 표식으로 삼는다(문구를 고치면 여기도 같이). */
const DERIVED_HEAD = '상세 없이 쌓인 기록 — 아래는 그 버전 스냅샷에서 되짚은 것입니다'

/** 실패·롤백 — 성공만 남는 기록은 감사 기록이 아니다. 무엇을 하려다 어떻게 됐는지 남긴다. */
export function outcomeLogDetail(input: {
  target: LogTarget
  attempted: string
  message?: string
}): string {
  return lines(targetLine(input.target), input.attempted, input.message ? `사유 ${input.message}` : null)
}


// ── 읽기: 저장된 상세를 화면이 쓸 모양으로 ─────────────────────────────────

/**
 * 상세 한 덩어리를 **갈래별로 나눈다** — 모달이 표·칩·코드로 갈라 그리기 위한 것.
 *
 * 왜 저장은 여전히 글줄인가: 기록은 오래 남고 화면보다 수명이 길다. 구조를 저장하면 그 구조를
 * 바꿀 때 옛 기록이 못 읽히지만, 글줄은 사람이 그냥 읽을 수 있다. 대신 **읽는 쪽에서** 나눈다.
 * 어디에도 안 붙는 줄은 버리지 않고 `notes` 로 넘긴다 — 조용히 사라지면 감사에서 그게 제일 나쁘다.
 */
export interface LogDetailView {
  /** 기록된 값이 아니라 버전 스냅샷에서 되짚은 것인가. */
  derived: boolean
  target: string | null
  schemas: { schema: string; count: number }[]
  tables: string[]
  /** `문 N개 · 영향 M행` 같은 셈 한 줄. */
  stats: string | null
  /** 시드 반영에서 테이블별로 건드린 행. */
  rowChanges: { table: string; items: string[] }[]
  /** 실제로 나간 문. */
  statements: string[]
  notes: string[]
}

/** 문으로 볼 줄 — DDL·DML 로 시작하는 것만. 나머지는 지어내지 말고 `notes` 로 보낸다. */
const SQL_HEAD = /^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|RENAME|TRUNCATE|COMMENT|SET|GRANT|REVOKE|WITH|SELECT)\b/i

/**
 * 목록에 보일 맛보기 — 되짚었다는 머리줄은 뺀다. 그 사실은 모달이 배지로 말하고, 두 줄짜리
 * 맛보기에서 한 줄을 통째로 먹으면 정작 무엇을 들였는지가 안 보인다.
 */
export const logDetailPreview = (detail: string): string =>
  detail
    .split('\n')
    .filter((l) => l.trim() !== DERIVED_HEAD)
    .join('\n')

export function parseLogDetail(detail: string): LogDetailView {
  const out: LogDetailView = {
    derived: false,
    target: null,
    schemas: [],
    tables: [],
    stats: null,
    rowChanges: [],
    statements: [],
    notes: []
  }

  for (const raw of detail.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    if (line === DERIVED_HEAD) {
      out.derived = true
    } else if (line.startsWith('연결 ')) {
      out.target = line.slice('연결 '.length)
    } else if (line.startsWith('스키마 ')) {
      out.schemas = line
        .slice('스키마 '.length)
        .split(' · ')
        .map((chunk) => {
          const at = chunk.lastIndexOf(' ')
          return { schema: chunk.slice(0, at), count: Number(chunk.slice(at + 1)) || 0 }
        })
    } else if (line === '테이블 없음') {
      out.tables = []
    } else if (line.startsWith('테이블 ') || line.startsWith('대상 ')) {
      const body = line.startsWith('테이블 ') ? line.slice('테이블 '.length) : line.slice('대상 '.length)
      out.tables = body.split(', ').filter(Boolean)
    } else if (line.startsWith('문 ')) {
      out.stats = line
    } else if (line.startsWith('사유 ')) {
      out.notes.push(line)
    } else if (SQL_HEAD.test(line)) {
      out.statements.push(line)
    } else {
      const hit = /^(\S+) — (.+)$/.exec(line)
      if (hit) out.rowChanges.push({ table: hit[1], items: hit[2].split(' · ') })
      else out.notes.push(line)
    }
  }
  return out
}


// ── 목록 한 줄 ────────────────────────────────────────────────────────────

/**
 * 갈래 이름 — 배지에 그대로 뜬다. `맵핑` 은 안에서만 쓰던 말이라 화면에서는 뜻으로 바꿨다
 * (2026-08-18 사용자: "맵핑이 도대체 뭐지").
 */
export const LOG_KIND_LABEL: Record<string, string> = {
  map: '버전 지정',
  apply: '반영',
  'seed-apply': '시드'
}

const escapeRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 목록에 그릴 요약 — **저장된 글을 화면이 다듬는다.**
 *
 * 왜 저장값을 안 고치고 그리는 쪽에서 다듬나: 요약은 기록을 남기는 순간 박힌다. 그래서 문구를
 * 고쳐도 **이미 쌓인 기록은 옛 글을 그대로 들고 있었다**(2026-08-18 사용자: "여전히 문구를
 * 수정안하네"). 그렇다고 남은 기록의 글을 나중에 고쳐 쓸 수는 없다 — 뒤에 고쳐 쓴 것은
 * 이미 기록이 아니다. 그래서 원본은 두고 **보일 때만** 겹치는 말을 걷어낸다.
 *
 * 걷어내는 것은 셋뿐이다: 옆 칸이 그리는 **버전 짝** · 아래 상세가 늘어놓는 **테이블 수** ·
 * 배지가 말하는 **갈래**.
 */
export function logSummaryText(log: {
  kind: string
  summary: string
  fromVersion: string
  toVersion: string
}): string {
  let s = log.summary.trim()

  for (const v of [log.toVersion, log.fromVersion].filter(Boolean)) {
    s = s.replace(new RegExp(`\\s*—?\\s*이 연결은 ${escapeRe(v)}\\s*입니다`, 'g'), '')
    s = s.replace(new RegExp(`\\s*→\\s*${escapeRe(v)}`, 'g'), '')
  }
  s = s.replace(/\s*\(\d+개 테이블\)/g, '')

  s = s.replace(/^시드 반영\s*/, '')
  s = s.replace(/^시드 (\d+)개 문/, '문 $1개')
  s = s.replace(/(\d+)개 문 반영/, '문 $1개')
  s = s.replace(/^(\d+)개 문/, '문 $1개')
  s = s.replace(/^맵핑 확정/, '버전 확정')
  s = s.replace(/\s*—\s*반영하지 않음$/, '')

  s = s.replace(/^[\s—·]+|[\s—·]+$/g, '')
  return s || LOG_KIND_LABEL[log.kind] || log.kind
}
