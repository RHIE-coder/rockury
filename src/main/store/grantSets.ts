import { randomUUID } from 'node:crypto'
import {
  sanitizeGrantSetItems,
  type GrantSetItem,
  type GrantSetRecord
} from '../../shared/db/grantSet'
import { getDb } from './db'

/**
 * 권한 세트 저장(§db-remote.grants.sets) — 재사용 가능한 권한 요구 묶음.
 * **연결 참조가 없다** — 연결을 지워도 세트가 남아 다른 환경의 계정에 재적용된다(AC-2).
 * 항목은 테이블 이름/패턴 기준(JSON 블롭) — 실 DB 에선 이름이 정체성이라 id 조인이 필요 없다.
 * 항목 검증은 shared/db/grantSet 한 곳 — 여기 담긴 권한 문자열이 GRANT 문에 보간되므로
 * 저장 시점에 화이트리스트로 막는다(보안 감사 H-1).
 */
export type { GrantSetItem, GrantSetRecord } from '../../shared/db/grantSet'

/** 검증 통과분만 저장한다 — 위반은 조용한 정제가 아니라 오류(정상 화면은 못 만드는 값). */
function assertItems(items: GrantSetItem[]): GrantSetItem[] {
  const ok = sanitizeGrantSetItems(items)
  if (ok === null) throw new Error('권한 세트 항목이 올바르지 않습니다(패턴·권한 화이트리스트)')
  return ok
}

interface Row {
  id: string
  name: string
  items: string
  created_at: string
  updated_at: string
}

/** 안전 파싱 — 손상된 JSON 이 화면 전체를 못 죽이게 빈 배열로 떨어뜨린다. */
function parseItems(raw: string): GrantSetItem[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as GrantSetItem[]) : []
  } catch {
    return []
  }
}

const toRecord = (r: Row): GrantSetRecord => ({
  id: r.id,
  name: r.name,
  items: parseItems(r.items),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function listGrantSets(): GrantSetRecord[] {
  const rows = getDb()
    .prepare(`SELECT id, name, items, created_at, updated_at FROM db_grant_sets ORDER BY name`)
    .all() as unknown as Row[]
  return rows.map(toRecord)
}

export function createGrantSet(name: string, items: GrantSetItem[]): GrantSetRecord {
  const safe = assertItems(items)
  const now = new Date().toISOString()
  const id = randomUUID()
  getDb()
    .prepare(`INSERT INTO db_grant_sets (id, name, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, name, JSON.stringify(safe), now, now)
  return { id, name, items: safe, createdAt: now, updatedAt: now }
}

export function updateGrantSet(id: string, patch: { name?: string; items?: GrantSetItem[] }): GrantSetRecord {
  const cur = (getDb()
    .prepare(`SELECT id, name, items, created_at, updated_at FROM db_grant_sets WHERE id = ?`)
    .get(id) ?? null) as Row | null
  if (!cur) throw new Error(`권한 세트를 찾을 수 없습니다: ${id}`)
  const next = {
    name: patch.name ?? cur.name,
    items: patch.items ? assertItems(patch.items) : parseItems(cur.items)
  }
  const now = new Date().toISOString()
  getDb()
    .prepare(`UPDATE db_grant_sets SET name = ?, items = ?, updated_at = ? WHERE id = ?`)
    .run(next.name, JSON.stringify(next.items), now, id)
  return { id, name: next.name, items: next.items, createdAt: cur.created_at, updatedAt: now }
}

export function deleteGrantSet(id: string): void {
  getDb().prepare(`DELETE FROM db_grant_sets WHERE id = ?`).run(id)
}
