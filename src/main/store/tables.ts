import { getDb } from './db'

/**
 * 테이블 정의 레코드 (IPC 경계 형태).
 * columns/constraints 는 렌더러 도메인 객체 배열 그대로 — 저장 시 JSON 직렬화한다.
 * (문서형 저장: 현 단계에선 라운드트립이 목적이라 정규화 대신 JSON 블롭. 추후 정규화 여지.)
 */
export interface TableRecord {
  id: string
  designId: string
  name: string
  comment: string
  columns: unknown[]
  constraints: unknown[]
}

interface TableRow {
  id: string
  design_id: string
  name: string
  comment: string
  columns: string
  constraints: string
}

export function listTables(): TableRecord[] {
  const rows = getDb()
    .prepare(
      'SELECT id, design_id, name, comment, columns, constraints FROM tables ORDER BY design_id, position'
    )
    .all() as unknown as TableRow[]
  return rows.map((r) => ({
    id: r.id,
    designId: r.design_id,
    name: r.name,
    comment: r.comment,
    columns: JSON.parse(r.columns),
    constraints: JSON.parse(r.constraints)
  }))
}

/**
 * 전체 테이블을 통째로 교체(wipe + rewrite) — 렌더러의 작업 스토어가
 * 변경 시 디바운스로 현재 전량을 보낸다. 데이터가 작아 단순·정확한 방식.
 */
export function replaceAllTables(records: TableRecord[]): void {
  const d = getDb()
  const insert = d.prepare(
    'INSERT INTO tables (id, design_id, name, comment, position, columns, constraints) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  d.exec('BEGIN')
  try {
    d.exec('DELETE FROM tables')
    records.forEach((t, i) =>
      insert.run(
        t.id,
        t.designId,
        t.name,
        t.comment ?? '',
        i,
        JSON.stringify(t.columns ?? []),
        JSON.stringify(t.constraints ?? [])
      )
    )
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}
