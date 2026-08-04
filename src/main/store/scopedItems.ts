import { getDb } from './db'

/**
 * 소속 편집의 공용 창구 — "무엇이 어느 프로젝트에 속하나"를 한 자리에서 읽고 쓴다.
 *
 * 서비스마다 목록 화면을 뜯어 소속 칸을 붙이는 대신 여기 하나를 둔다. 서비스 소유 파일을
 * 건드리지 않아 병렬 개발 경계가 유지되고, 사람은 네 종류를 한 화면에서 정리할 수 있다.
 */

/** 소속을 가질 수 있는 것의 종류. 화면·IPC·저장소가 같은 토큰을 쓴다. */
export const SCOPED_KINDS = [
  'design',
  'connection',
  'apiSpec',
  'infraDesign',
  'infraProvider',
  'middleware'
] as const
export type ScopedKind = (typeof SCOPED_KINDS)[number]

/**
 * 종류 → 그 종류가 사는 테이블과 화면에 보일 이름 칸.
 *
 * `rule` 은 무소속을 어떻게 보느냐다(렌더러 `projectScope` 와 같은 갈래):
 * 설계류는 `strict`(프로젝트를 고르면 숨음), 접속류는 `shared`(공용이라 늘 보임).
 */
const SOURCE: Record<ScopedKind, { table: string; label: string; rule: 'strict' | 'shared' }> = {
  design: { table: 'designs', label: 'name', rule: 'strict' },
  connection: { table: 'connections', label: 'name', rule: 'shared' },
  apiSpec: { table: 'api_specs', label: 'name', rule: 'strict' },
  infraDesign: { table: 'infra_designs', label: 'name', rule: 'strict' },
  infraProvider: { table: 'infra_providers', label: 'name', rule: 'shared' },
  middleware: { table: 'infra_mw_connections', label: 'name', rule: 'shared' }
}

export interface ScopedItem {
  kind: ScopedKind
  id: string
  name: string
  projectId: string | null
  /** 무소속을 공용으로 다루는 종류인지 — 화면이 '공용' 표시를 붙일지 판단한다. */
  sharedWhenUnassigned: boolean
}

/** 소속을 가질 수 있는 것 전부. 화면이 종류별로 묶어 보인다. */
export function listScopedItems(): ScopedItem[] {
  const d = getDb()
  const out: ScopedItem[] = []
  for (const kind of SCOPED_KINDS) {
    const src = SOURCE[kind]
    // table·label 은 위 상수의 리터럴이라 인터폴레이션 안전(사용자 입력 경로 없음).
    const rows = d
      .prepare(`SELECT id, ${src.label} AS name, project_id FROM ${src.table} ORDER BY ${src.label}`)
      .all() as unknown as { id: string; name: string; project_id: string | null }[]
    for (const r of rows) {
      out.push({
        kind,
        id: r.id,
        name: r.name,
        projectId: r.project_id ?? null,
        sharedWhenUnassigned: src.rule === 'shared'
      })
    }
  }
  return out
}

/** 소속을 옮긴다. `projectId: null` 이면 무소속으로 되돌린다. */
export function setItemProject(kind: ScopedKind, id: string, projectId: string | null): void {
  const src = SOURCE[kind]
  if (!src) throw new Error(`알 수 없는 종류입니다: ${kind}`)
  if (projectId !== null) {
    const exists = getDb().prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    // 없는 프로젝트로 옮기면 그 항목은 어느 범위에서도 안 보이는 유령이 된다.
    if (!exists) throw new Error(`없는 프로젝트입니다: ${projectId}`)
  }
  getDb().prepare(`UPDATE ${src.table} SET project_id = ? WHERE id = ?`).run(projectId, id)
}
