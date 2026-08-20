import { randomUUID } from 'node:crypto'
import { sanitizeColumnSet, type ColumnSetColumn, type ColumnSetRecord } from '../../shared/db/columnSet'
import { getDb } from './db'

/**
 * 컬럼 묶음 저장 — 여러 표에 되풀이해 넣는 컬럼 세트(`created_at`·`updated_at` 같은 것)를
 * 이름 붙여 남긴다 (2026-08-20 사용자 요청 ⓒ).
 *
 * **설계 참조가 없다.** 묶음의 존재 이유가 재사용이라, 설계를 지워도 남아 다른 설계에 다시
 * 쓰여야 한다(`db_grant_sets` 와 같은 결). 대신 벤더(방언)도 안 묶는다 — 타입 글자가 방언마다
 * 다르지만, 묶어 두면 "MySQL 묶음을 PostgreSQL 설계에 못 쓴다"가 되어 재사용이 반쪽이 된다.
 * 타입이 안 맞으면 넣은 뒤 고치는 편이 낫다(가져오기의 벤더 경고와 같은 판단).
 *
 * 컬럼은 JSON 블롭이다 — 화면의 `Column` 모양 그대로 담고 **id 는 안 담는다**(넣을 때
 * 대상마다 새로 발급하므로 저장해 둔 id 는 뜻이 없고, 남겨 두면 충돌의 씨앗이 된다).
 */

export type { ColumnSetColumn, ColumnSetRecord } from '../../shared/db/columnSet'

interface Row {
  id: string
  name: string
  columns: string
  created_at: string
  updated_at: string
}

/** 손상된 JSON 이 화면 전체를 죽이지 않게 빈 배열로 떨어뜨린다. */
function parseColumns(raw: string): ColumnSetColumn[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as ColumnSetColumn[]) : []
  } catch {
    return []
  }
}

const toRecord = (r: Row): ColumnSetRecord => ({
  id: r.id,
  name: r.name,
  columns: parseColumns(r.columns),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function listColumnSets(): ColumnSetRecord[] {
  const rows = getDb()
    .prepare(`SELECT id, name, columns, created_at, updated_at FROM db_column_sets ORDER BY name`)
    .all() as unknown as Row[]
  return rows.map(toRecord)
}

export function createColumnSet(name: string, columns: ColumnSetColumn[]): ColumnSetRecord {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('묶음 이름을 적어 주세요.')
  /*
   * 같은 이름을 두 번 저장하지 못하게 한다 — 목록이 이름으로만 서서, 둘이 나란히 있으면
   * 어느 것이 무엇인지 화면에서 가릴 길이 없다(고르는 순간 결과가 갈리는데도).
   *
   * 저장소 UNIQUE 인덱스가 아니라 여기서 막는 이유: 인덱스는 **이미 들어와 있는 중복**이 있으면
   * 마이그레이션 자체를 실패시킨다. 앱이 안 뜨는 것이 이름이 겹치는 것보다 나쁘다.
   * 대소문자·공백은 다듬은 뒤 그대로 견준다 — 사람이 적은 대로 남기고, 눈에 같은 것만 막는다.
   */
  if (listColumnSets().some((s) => s.name === trimmed))
    throw new Error(`"${trimmed}" 묶음이 이미 있습니다 — 다른 이름을 쓰거나 있던 것을 지우세요.`)
  const safe = sanitizeColumnSet(columns)
  if (safe.length === 0) throw new Error('묶음에 담을 컬럼이 없습니다.')
  const now = new Date().toISOString()
  const rec: ColumnSetRecord = { id: randomUUID(), name: trimmed, columns: safe, createdAt: now, updatedAt: now }
  getDb()
    .prepare(`INSERT INTO db_column_sets (id, name, columns, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(rec.id, rec.name, JSON.stringify(rec.columns), now, now)
  return rec
}

export function deleteColumnSet(id: string): void {
  getDb().prepare(`DELETE FROM db_column_sets WHERE id = ?`).run(id)
}
