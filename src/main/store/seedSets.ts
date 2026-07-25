import { getDb } from './db'

/**
 * 시드 세트 저장 (IPC 경계 형태) — 설계가 정의하는 기준 데이터(roles·permissions 류).
 * 정본 명세: `docs/spec/db-studio.md` Section `db-studio.seed.persistence`.
 *
 * 문서형 저장: 선언(자연키·무시 컬럼)과 행은 JSON 블롭으로 둔다 — `tables` 와 같은 방식.
 * 컬럼을 이름으로 가리키므로 스키마 컬럼 id 와 조인할 필요가 없다(실 DB 에선 이름이 정체성).
 */
export interface SeedSetRecord {
  designId: string
  tableName: string
  naturalKey: string[]
  ignoredColumns: string[]
  /** 설계에 없는 행 처리 — 'ensure'(그대로 둠) | 'authoritative'(삭제 후보). */
  strength: string
  rows: unknown[]
}

interface SeedSetRow {
  design_id: string
  table_name: string
  natural_key: string
  ignored_columns: string
  strength: string
  rows_json: string
}

/** 안전 파싱 — 손상된 JSON 이 화면 전체를 못 죽이게 빈 배열로 떨어뜨린다. */
function parseArray(raw: string): unknown[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

const toRecord = (r: SeedSetRow): SeedSetRecord => ({
  designId: r.design_id,
  tableName: r.table_name,
  naturalKey: parseArray(r.natural_key) as string[],
  ignoredColumns: parseArray(r.ignored_columns) as string[],
  strength: r.strength,
  rows: parseArray(r.rows_json)
})

/** 전체 시드 세트(설계 무관) — 렌더러가 활성 설계로 스코프해 읽는다(`tables:list` 와 같은 형태). */
export function listSeedSets(): SeedSetRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT design_id, table_name, natural_key, ignored_columns, strength, rows_json
         FROM seed_sets ORDER BY design_id, position`
    )
    .all() as unknown as SeedSetRow[]
  return rows.map(toRecord)
}

/**
 * 설계 스코프 교체 — 대상 설계의 세트만 지우고 다시 쓴다(tx).
 * `replaceTablesForDesign` 과 같은 규칙: 설계 X 저장이 설계 Y 를 건드리지 않는다.
 */
export function replaceSeedSetsForDesign(designId: string, records: SeedSetRecord[]): void {
  const d = getDb()
  const insert = d.prepare(
    `INSERT INTO seed_sets (design_id, table_name, position, natural_key, ignored_columns, strength, rows_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  d.exec('BEGIN')
  try {
    d.prepare('DELETE FROM seed_sets WHERE design_id = ?').run(designId)
    records.forEach((s, i) => {
      // 스코프 밖 레코드 혼입은 격리 위반 — tx 전체 롤백으로 부분 반영을 막는다.
      if (s.designId !== designId)
        throw new Error(`설계 "${designId}" 교체 배치에 다른 설계("${s.designId}") 시드가 섞였습니다.`)
      insert.run(
        designId,
        s.tableName,
        i,
        JSON.stringify(s.naturalKey ?? []),
        JSON.stringify(s.ignoredColumns ?? []),
        s.strength || 'ensure',
        JSON.stringify(s.rows ?? [])
      )
    })
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}
