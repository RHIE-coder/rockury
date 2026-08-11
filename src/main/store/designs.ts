import { getDb } from './db'

/** 저장소의 설계 레코드 (IPC 경계에서 오가는 순수 데이터 형태). */
export interface DesignRecord {
  id: string
  name: string
  description: string
  dialect: string
  /** 범위(scope) — 이 설계에서 지금 보고 있는 스키마 목록. **빈 배열이면 전부 본다.** */
  schemas: string[]
  /**
   * **이 설계가 선언한 스키마들** — 순서가 뜻을 갖는다(첫째가 새 표가 태어날 자리).
   *
   * `schemas`(보는 범위)와 자리가 다르다: 범위는 "지금 눈에 보일 것"이라 줄였다 늘렸다 하는
   * 값이고, 이쪽은 "이 설계에 어떤 스키마가 있다"는 **선언**이다. 겸용하면 범위를 하나로
   * 좁히는 순간 다른 스키마가 설계에서 사라진다.
   */
  declaredSchemas: string[]
  created_at: string
  /** 속한 프로젝트. null 이면 무소속 — 설계류라 프로젝트를 고르면 목록에서 숨는다. */
  project_id: string | null
}

export interface CreateDesignInput {
  name: string
  description?: string
  dialect: string
  /** 만들 때 보고 있던 프로젝트. 안 주면 무소속. */
  projectId?: string | null
  /** 처음 선언할 스키마 이름(새 설계 모달에서 받는다). 안 주면 선언 없이 시작. */
  schemaName?: string
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'design'
  )
}

/** 저장된 행(스키마는 JSON 문자열) → 도메인 레코드. */
interface DesignRow {
  id: string
  name: string
  description: string
  dialect: string
  schemas: string | null
  declared_schemas: string | null
  created_at: string
  project_id: string | null
}

/** 범위 JSON 파싱 — 깨진 값이면 빈 배열(= 전부 보기). 범위 하나 때문에 설계가 안 열리면 안 된다. */
function parseSchemas(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const toRecord = (r: DesignRow): DesignRecord => ({
  id: r.id,
  name: r.name,
  description: r.description,
  dialect: r.dialect,
  schemas: parseSchemas(r.schemas),
  declaredSchemas: parseSchemas(r.declared_schemas),
  created_at: r.created_at,
  project_id: r.project_id ?? null
})

const SELECT =
  'SELECT id, name, description, dialect, schemas, declared_schemas, created_at, project_id FROM designs'

export function listDesigns(): DesignRecord[] {
  return (getDb().prepare(`${SELECT} ORDER BY created_at ASC`).all() as unknown as DesignRow[]).map(toRecord)
}

/**
 * 설계 수정 (dialect 는 고정 속성이라 변경 불가). 갱신된 레코드를 반환.
 * 준 것만 고친다 — 범위 손잡이는 이름을 모르고, 이름 편집 창은 범위를 모른다.
 */
export function updateDesign(
  id: string,
  patch: {
    name?: string
    description?: string
    schemas?: string[]
    declaredSchemas?: string[]
    projectId?: string | null
  }
): DesignRecord {
  const d = getDb()
  const sets: string[] = []
  const args: (string | null)[] = []
  if (patch.name !== undefined) (sets.push('name = ?'), args.push(patch.name.trim()))
  if (patch.description !== undefined) (sets.push('description = ?'), args.push(patch.description.trim()))
  if (patch.schemas !== undefined) (sets.push('schemas = ?'), args.push(JSON.stringify(patch.schemas)))
  if (patch.declaredSchemas !== undefined)
    (sets.push('declared_schemas = ?'), args.push(JSON.stringify(patch.declaredSchemas)))
  // 소속 옮기기 — null 이 "무소속으로 되돌리기" 라서 undefined 와 갈라야 한다.
  if (patch.projectId !== undefined) (sets.push('project_id = ?'), args.push(patch.projectId))
  if (sets.length > 0) d.prepare(`UPDATE designs SET ${sets.join(', ')} WHERE id = ?`).run(...args, id)
  return toRecord(d.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as DesignRow)
}

/** 설계 삭제 — 소속 테이블도 함께 제거(cascade). */
export function deleteDesign(id: string): void {
  const d = getDb()
  d.exec('BEGIN')
  try {
    d.prepare('DELETE FROM tables WHERE design_id = ?').run(id)
    // 시드 세트도 설계 소유물 — 남기면 같은 이름의 새 설계에 유령 시드가 붙는다.
    d.prepare('DELETE FROM seed_sets WHERE design_id = ?').run(id)
    d.prepare('DELETE FROM designs WHERE id = ?').run(id)
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

/** 이름 슬러그 + 충돌 시 -2, -3… 로 유일 id 생성 후 삽입. 삽입된 레코드를 반환. */
export function createDesign(input: CreateDesignInput): DesignRecord {
  const d = getDb()
  const base = slugify(input.name)
  const taken = new Set(listDesigns().map((r) => r.id))
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`

  const record: DesignRecord = {
    id,
    name: input.name.trim(),
    description: (input.description ?? '').trim(),
    dialect: input.dialect,
    schemas: [], // 새 설계는 범위를 안 고른 상태 = 전부 보기
    // 이름을 받았으면 그것 하나로 시작한다 — 표는 이 이름 아래 태어난다.
    declaredSchemas: input.schemaName?.trim() ? [input.schemaName.trim()] : [],
    created_at: new Date().toISOString(),
    project_id: input.projectId ?? null
  }
  d.prepare(
    'INSERT INTO designs (id, name, description, dialect, declared_schemas, created_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    record.id,
    record.name,
    record.description,
    record.dialect,
    JSON.stringify(record.declaredSchemas),
    record.created_at,
    record.project_id
  )
  return record
}
