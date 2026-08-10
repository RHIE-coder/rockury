import type { EffectiveRow } from './effective'
import { expandPattern } from './pattern'
import { SET_PRIVILEGES, type GrantSetItem } from '../../../../../../shared/db/grantSet'
import type { GrantLayer } from './types'

/**
 * 세트 ↔ 계정 대조(§db-remote.grants.diff) — **순수 함수**. 판정 기준은 유효 권한이다:
 * 표에 직접 없어도 전역·DB 층에서 내려오면 모자람이 아니다(AC-5).
 * 양쪽 개수를 항상 함께 돌려준다 — 0=0 은 "일치"가 아니라 "아무것도 대조되지 않음"이다(AC-3).
 */

export interface GrantChange {
  account: string
  db: string
  table: string
  privilege: string
  kind: 'missing' | 'excess'
  /** excess 전용 — 가장 넓은 출처 층. 위층이면 REVOKE 로 안 걷힌다(문장 생성기가 거른다). */
  layer?: GrantLayer
}

export interface GrantsDiff {
  changes: GrantChange[]
  counts: {
    patterns: number
    matchedTables: number
    /** 세트가 요구한 항목 수(매칭 표 × 세트 권한). */
    expected: number
    /** 실제에서 확인된 요구 항목 수. */
    actual: number
  }
  /** 아무 표에도 맞지 않은 패턴 — 오타가 조용히 통과하면 세트가 지켜지는 줄로 안다(AC-5). */
  unmatchedPatterns: string[]
  /** 패턴이 매칭한 표의 키(`db table`) — 화면 필터가 '일치'와 '대조 밖'을 가르는 근거. */
  matchedKeys: string[]
  /** 세트가 겨누지 않은 표 중 권한이 있는 표의 수 — `대조 밖 n` 칩(AC-7). */
  outsideCount: number
}

const key = (db: string, table: string): string => `${db} ${table}`

export function diffGrants(
  items: GrantSetItem[],
  tables: { db: string; table: string }[],
  effective: EffectiveRow[],
  account: string
): GrantsDiff {
  const effByTable = new Map(effective.map((r) => [key(r.db, r.table), r]))
  const changes: GrantChange[] = []
  const unmatchedPatterns: string[] = []

  // 패턴 전개 — 표마다 요구 권한의 합집합(여러 패턴이 같은 표를 겨눌 수 있다).
  const wanted = new Map<string, { db: string; table: string; privs: Set<string> }>()
  for (const item of items) {
    const matched = expandPattern(item.pattern, tables)
    if (matched.length === 0) unmatchedPatterns.push(item.pattern)
    for (const t of matched) {
      const k = key(t.db, t.table)
      const w = wanted.get(k) ?? { db: t.db, table: t.table, privs: new Set<string>() }
      for (const p of item.privileges) w.privs.add(p)
      wanted.set(k, w)
    }
  }

  let expected = 0
  let actual = 0
  const common = new Set<string>(SET_PRIVILEGES)

  for (const w of wanted.values()) {
    const eff = effByTable.get(key(w.db, w.table))
    // 모자람 — 요구했는데 유효 권한에 없다.
    for (const priv of w.privs) {
      expected += 1
      if (eff?.privs[priv]) actual += 1
      else changes.push({ account, db: w.db, table: w.table, privilege: priv, kind: 'missing' })
    }
    // 넘침 — 유효 권한에 있는데 세트가 요구하지 않았다. 세트의 언어(공통분모) 안에서만 —
    // 세트가 담을 수 없는 종류(TRUNCATE 등)를 넘침으로 세면 지울 수 없는 소음이 된다.
    if (eff) {
      for (const [priv, sources] of Object.entries(eff.privs)) {
        if (!common.has(priv) || w.privs.has(priv)) continue
        changes.push({
          account,
          db: w.db,
          table: w.table,
          privilege: priv,
          kind: 'excess',
          layer: sources[0]?.layer // 넓은 층부터 정렬돼 온다(composeEffective)
        })
      }
    }
  }

  // 의사 행(table='*')은 표가 아니라 권한의 대표 자리 — 대조 밖 개수에 안 센다.
  const outsideCount = effective.filter(
    (r) => r.table !== '*' && !wanted.has(key(r.db, r.table))
  ).length

  return {
    changes,
    counts: { patterns: items.length, matchedTables: wanted.size, expected, actual },
    unmatchedPatterns,
    matchedKeys: [...wanted.keys()],
    outsideCount
  }
}
