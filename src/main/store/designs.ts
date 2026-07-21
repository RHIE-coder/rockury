import { getDb } from './db'

/** 저장소의 설계 레코드 (IPC 경계에서 오가는 순수 데이터 형태). */
export interface DesignRecord {
  id: string
  name: string
  description: string
  dialect: string
  created_at: string
}

export interface CreateDesignInput {
  name: string
  description?: string
  dialect: string
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

export function listDesigns(): DesignRecord[] {
  return getDb()
    .prepare('SELECT id, name, description, dialect, created_at FROM designs ORDER BY created_at ASC')
    .all() as unknown as DesignRecord[]
}

/** 이름·설명 수정 (dialect 는 고정 속성이라 변경 불가). 갱신된 레코드를 반환. */
export function updateDesign(id: string, patch: { name: string; description: string }): DesignRecord {
  const d = getDb()
  d.prepare('UPDATE designs SET name = ?, description = ? WHERE id = ?').run(
    patch.name.trim(),
    patch.description.trim(),
    id
  )
  return d
    .prepare('SELECT id, name, description, dialect, created_at FROM designs WHERE id = ?')
    .get(id) as unknown as DesignRecord
}

/** 설계 삭제 — 소속 테이블도 함께 제거(cascade). */
export function deleteDesign(id: string): void {
  const d = getDb()
  d.exec('BEGIN')
  try {
    d.prepare('DELETE FROM tables WHERE design_id = ?').run(id)
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
    created_at: new Date().toISOString()
  }
  d.prepare(
    'INSERT INTO designs (id, name, description, dialect, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(record.id, record.name, record.description, record.dialect, record.created_at)
  return record
}
