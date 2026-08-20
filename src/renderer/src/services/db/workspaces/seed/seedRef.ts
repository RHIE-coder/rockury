import type { TableDef } from '../definition/types'
import type { SeedRow, SeedSet } from './types'

/**
 * 시드 **참조**(순수) — 한 시드 행이 다른 시드 행을 가리키는 표기 `@테이블#별칭`.
 *
 * 왜 문법을 도구가 못박나(사용자가 자유롭게 쓰면 안 되나):
 *  ① 반영할 때 기계가 읽어 그 환경의 **실제 id 로 치환**해야 한다,
 *  ② 가리키는 행이 없는 **깨진 참조**를 검출해야 한다,
 *  ③ 되먹임(운영→설계)에서 도구가 `user_id=7` 을 **다시 이 표기로 되돌려 써야** 한다 —
 *     규칙이 없으면 되돌릴 수가 없다(③이 결정적 이유).
 *
 * 왜 짝짓기 기준 값이 아니라 별칭인가: 기준 값(email·code)은 실제로 바뀌고, 그때 그걸 가리키던
 * 참조가 전부 깨진다. 별칭은 설계 안에서만 사는 이름이라 기준 값이 바뀌어도 참조가 살아남는다.
 */

/** 별칭에 쓸 수 있는 글자 — 영숫자·`_`·`-` 만. 값에 섞인 `@`·`.`·`,` 로 파싱이 애매해지는 것을 막는다. */
export const ALIAS_PATTERN = /^[A-Za-z0-9_-]+$/

/** `@테이블#별칭` — 테이블 이름은 SQL 식별자 관례를 따른다. */
const REF_PATTERN = /^@([A-Za-z_][A-Za-z0-9_]*)#([A-Za-z0-9_-]+)$/

export interface SeedRefTarget {
  table: string
  alias: string
}

/** 참조 표기 만들기 — 되먹임에서 도구가 값을 되돌릴 때도 이 함수를 쓴다(양방향 같은 규칙). */
export function formatSeedRef(table: string, alias: string): string {
  return `@${table}#${alias}`
}

/** 참조 표기 읽기. `@@` 로 시작하면 리터럴 탈출이라 참조가 아니다. */
export function parseSeedRef(v: string | null | undefined): SeedRefTarget | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (s.startsWith('@@')) return null
  const m = REF_PATTERN.exec(s)
  return m ? { table: m[1], alias: m[2] } : null
}

/** `@` 로 시작하지만 규칙에 안 맞는 값 — 오타를 잡기 위한 판정(`@users.admin` 같은 옛 표기). */
export function looksLikeSeedRef(v: string | null | undefined): boolean {
  return typeof v === 'string' && /^@(?!@)/.test(v.trim())
}

/** 반영할 때 셀에 들어갈 실제 문자열 — `@@x` 는 `@x` 로 되돌린다(탈출 해제). 그 밖은 그대로. */
export function unescapeSeedValue(v: string): string {
  return v.startsWith('@@') ? v.slice(1) : v
}

/**
 * 짝짓기 기준 값에서 기본 별칭을 만든다 — 사람이 행마다 이름을 짓는 부담을 없애려고.
 * 소문자 영숫자와 `-`·`_` 만 남기고, 나머지는 `-` 로 접는다(`admin@acme.com` → `admin-acme-com`).
 */
export function defaultAlias(parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

export type SeedAliasIssueKind = 'invalid-alias' | 'duplicate-alias'

export interface SeedAliasIssue {
  kind: SeedAliasIssueKind
  message: string
}

/**
 * 별칭 검증 — 행 id → 문제. **비어 있는 것은 오류가 아니다**(참조 대상이 아닌 행이 대부분이다).
 * 형식이 틀리거나 같은 세트 안에서 겹치면 오류이고, 겹치면 **양쪽 다** 지목한다.
 */
export function validateAliases(rows: SeedRow[]): Record<string, SeedAliasIssue> {
  const out: Record<string, SeedAliasIssue> = {}
  const byAlias = new Map<string, string[]>()

  for (const r of rows) {
    const a = (r.alias ?? '').trim()
    if (!a) continue
    if (!ALIAS_PATTERN.test(a)) {
      out[r.id] = { kind: 'invalid-alias', message: '별칭에는 영문·숫자·`-`·`_` 만 쓸 수 있어요' }
      continue
    }
    const ids = byAlias.get(a)
    if (ids) ids.push(r.id)
    else byAlias.set(a, [r.id])
  }
  for (const ids of byAlias.values()) {
    if (ids.length < 2) continue
    for (const id of ids) out[id] = { kind: 'duplicate-alias', message: '별칭이 다른 행과 겹쳐요' }
  }
  return out
}

export type SeedRefIssueKind =
  | 'malformed'
  | 'unknown-table'
  | 'unknown-alias'
  | 'not-fk-column'
  | 'fk-table-mismatch'

export interface SeedRefIssue {
  kind: SeedRefIssueKind
  message: string
}

/** 참조 문제의 키 — 세트·행·컬럼 단위(널 문자로 이어 값 충돌을 피한다). */
export function refCellKey(tableName: string, rowId: string, column: string): string {
  return `${tableName}\u0000${rowId}\u0000${column}`
}

/**
 * FK 컬럼 이름 → 그 FK 가 가리키는 테이블들.
 * 컬럼이 FK 인지뿐 아니라 **어디를 가리키는지**까지 필요하다 — `user_id`(→users)에 `@orders#…` 를
 * 넣으면 문법은 맞지만 관계가 어긋난다(반영하면 남의 테이블 id 를 꽂는다).
 */
function fkTargetsByColumn(table: TableDef): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const con of table.constraints) {
    if (con.kind !== 'fk') continue
    for (const ref of con.columns) {
      const name = table.columns.find((c) => c.id === ref.columnId)?.name
      if (!name) continue
      const set = out.get(name) ?? new Set<string>()
      if (con.refTable) set.add(con.refTable)
      out.set(name, set)
    }
  }
  return out
}

/**
 * 참조 검증 — 셀 단위. 대상 세트가 있는지, 그 세트에 그 별칭 행이 있는지, 그리고 **FK 로 선언된
 * 컬럼에서만** 쓰였는지 본다(참조는 관계를 따라가는 것이므로 FK 아닌 곳에 쓰면 오용 신호).
 */
export function validateSeedRefs(sets: SeedSet[], tables: TableDef[]): Record<string, SeedRefIssue> {
  const out: Record<string, SeedRefIssue> = {}
  const setByTable = new Map(sets.map((s) => [s.tableName, s]))
  const tableByName = new Map(tables.map((t) => [t.name, t]))

  for (const s of sets) {
    const fkTargets = (() => {
      const t = tableByName.get(s.tableName)
      return t ? fkTargetsByColumn(t) : new Map<string, Set<string>>()
    })()

    for (const r of s.rows) {
      for (const [column, value] of Object.entries(r.values)) {
        const key = refCellKey(s.tableName, r.id, column)
        const target = parseSeedRef(value)

        if (!target) {
          if (looksLikeSeedRef(value))
            out[key] = {
              kind: 'malformed',
              message: '참조 표기가 아니에요 — `@테이블#별칭` 형태로 쓰세요(값이 @ 로 시작해야 하면 @@)'
            }
          continue
        }

        const targetSet = setByTable.get(target.table)
        if (!targetSet) {
          out[key] = { kind: 'unknown-table', message: `${target.table} 테이블에는 시드 세트가 없어요` }
          continue
        }
        if (!targetSet.rows.some((tr) => (tr.alias ?? '').trim() === target.alias)) {
          out[key] = {
            kind: 'unknown-alias',
            message: `${target.table} 시드에 별칭 ${target.alias} 인 행이 없어요`
          }
          continue
        }
        const targets = fkTargets.get(column)
        if (!targets) {
          out[key] = {
            kind: 'not-fk-column',
            message: 'FK 로 선언된 컬럼이 아니에요 — 참조는 관계를 따라가는 표기예요'
          }
          continue
        }
        // 관계가 어긋난 참조 — 문법은 맞지만 반영하면 다른 테이블의 id 를 꽂는다.
        if (targets.size > 0 && !targets.has(target.table)) {
          out[key] = {
            kind: 'fk-table-mismatch',
            message: `이 컬럼은 ${[...targets].join(', ')} 를 가리키는 FK 예요 — ${target.table} 를 가리킬 수 없어요`
          }
        }
      }
    }
  }
  return out
}

/** 참조 그래프의 노드 이름 — `테이블#별칭`(별칭이 없으면 행 id 로 대체). */
function nodeIdOf(tableName: string, row: SeedRow): string {
  const a = (row.alias ?? '').trim()
  return `${tableName}#${a || row.id}`
}

/**
 * 참조 **순환** 탐지 — 삽입 순서를 정할 수 없으므로 금지한다(A 가 B 를, B 가 A 를 가리키면
 * 어느 쪽도 먼저 넣을 수 없다). 자기 자신을 가리키는 행도 순환이다.
 * 반환은 순환에 참여한 노드 경로 목록(시작 노드로 돌아오는 형태).
 */
export function seedRefCycles(sets: SeedSet[]): string[][] {
  const edges = new Map<string, string[]>()
  const setByTable = new Map(sets.map((s) => [s.tableName, s]))

  for (const s of sets) {
    for (const r of s.rows) {
      const from = nodeIdOf(s.tableName, r)
      const to: string[] = []
      for (const value of Object.values(r.values)) {
        const target = parseSeedRef(value)
        if (!target) continue
        const targetSet = setByTable.get(target.table)
        const targetRow = targetSet?.rows.find((tr) => (tr.alias ?? '').trim() === target.alias)
        if (targetRow) to.push(nodeIdOf(target.table, targetRow))
      }
      edges.set(from, [...(edges.get(from) ?? []), ...to])
    }
  }

  const cycles: string[][] = []
  const seen = new Set<string>() // 이미 보고한 순환의 정규화 서명
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const visit = (node: string): void => {
    const st = state.get(node)
    if (st === 'done') return
    if (st === 'visiting') {
      // 스택에서 이 노드까지가 순환이다.
      const at = stack.indexOf(node)
      const path = [...stack.slice(at), node]
      // 같은 순환을 진입 지점만 달리해 두 번 보고하지 않도록 정규화(가장 작은 이름부터).
      const ring = path.slice(0, -1)
      const min = ring.indexOf([...ring].sort()[0])
      const sig = [...ring.slice(min), ...ring.slice(0, min)].join('>')
      if (!seen.has(sig)) {
        seen.add(sig)
        cycles.push(path)
      }
      return
    }
    state.set(node, 'visiting')
    stack.push(node)
    for (const next of edges.get(node) ?? []) visit(next)
    stack.pop()
    state.set(node, 'done')
  }

  for (const node of edges.keys()) visit(node)
  return cycles
}
