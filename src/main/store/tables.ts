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
  /** 역설계로 들여온 뷰(view)면 true — 목록에서 테이블과 갈라 보이기 위해 저장까지 보존한다. */
  isView?: boolean
}

interface TableRow {
  id: string
  design_id: string
  name: string
  comment: string
  columns: string
  constraints: string
  is_view: number
}

export function listTables(): TableRecord[] {
  const rows = getDb()
    .prepare(
      'SELECT id, design_id, name, comment, columns, constraints, is_view FROM tables ORDER BY design_id, position'
    )
    .all() as unknown as TableRow[]
  return rows.map((r) => ({
    id: r.id,
    designId: r.design_id,
    name: r.name,
    comment: r.comment,
    columns: JSON.parse(r.columns),
    constraints: JSON.parse(r.constraints),
    isView: r.is_view === 1
  }))
}

/**
 * 설계 스코프 교체 — 대상 설계의 행만 지우고 다시 쓴다(tx, wipe + rewrite).
 * 전량 교체(구 replaceAllTables)를 대체: 에이전트(MCP)와 렌더러가 서로 다른 설계를
 * 동시에 저장해도 낡은 사본이 상대 설계를 되덮지 못하게 저장 단위를 설계로 좁혔다
 * (spec mcp-server tools.write AC-4).
 */
export function replaceTablesForDesign(designId: string, records: TableRecord[]): void {
  const d = getDb()
  const insert = d.prepare(
    'INSERT INTO tables (id, design_id, name, comment, position, columns, constraints, is_view) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  d.exec('BEGIN')
  try {
    d.prepare('DELETE FROM tables WHERE design_id = ?').run(designId)
    records.forEach((t, i) => {
      // 스코프 밖 레코드 혼입은 격리 위반 — tx 전체 롤백으로 부분 반영을 막는다.
      if (t.designId !== designId)
        throw new Error(`설계 "${designId}" 교체 배치에 다른 설계("${t.designId}") 레코드가 섞였습니다.`)
      insert.run(
        t.id,
        designId,
        t.name,
        t.comment ?? '',
        i,
        JSON.stringify(t.columns ?? []),
        JSON.stringify(t.constraints ?? []),
        t.isView ? 1 : 0
      )
    })
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}
