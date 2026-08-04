import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, setDbPath } from './db'
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject
} from './projects'

/**
 * 공용 프로젝트 저장소.
 *
 * 가장 중요한 규칙은 **지울 때**다 — 프로젝트를 지워도 그 안에 있던 설계·접속은 지워지지
 * 않고 무소속으로 돌아와야 한다. 이름표를 떼는 일에 산출물이 딸려 지워지면 되돌릴 수 없다.
 */
beforeAll(() => {
  setDbPath(join(mkdtempSync(join(tmpdir(), 'rockury-projects-')), 'test.db'))
})

function newProject(key: string): string {
  return createProject({ key, name: key }).id
}

describe('프로젝트 만들기', () => {
  it('만들면 목록에 뜬다', () => {
    const id = newProject('coupang')
    expect(listProjects().some((p) => p.id === id)).toBe(true)
  })

  it('이름을 비우면 키를 이름으로 쓴다', () => {
    const p = createProject({ key: 'baemin', name: '   ' })
    expect(p.name).toBe('baemin')
  })

  it('같은 키를 두 번 쓰면 사람이 읽을 수 있는 오류가 난다', () => {
    createProject({ key: 'dup-check', name: 'A' })
    expect(() => createProject({ key: 'dup-check', name: 'B' })).toThrow(/이미 있는 프로젝트 키/)
  })

  it.each(['Coupang', '-lead', '쿠팡', 'has space', ''])('키 규칙에 안 맞는 %o 는 거부한다', (key) => {
    expect(() => createProject({ key, name: 'x' })).toThrow(/프로젝트 키/)
  })
})

describe('프로젝트 고치기', () => {
  it('이름과 설명을 고친다', () => {
    const id = newProject('edit-me')
    updateProject(id, { name: '고친 이름', description: '설명' })
    const p = getProject(id)
    expect(p?.name).toBe('고친 이름')
    expect(p?.description).toBe('설명')
  })

  it('남이 쓰는 키로는 못 바꾼다', () => {
    newProject('taken-key')
    const id = newProject('mine-key')
    expect(() => updateProject(id, { key: 'taken-key' })).toThrow(/이미 있는 프로젝트 키/)
  })

  it('자기 키를 그대로 다시 저장하는 건 된다', () => {
    const id = newProject('same-key')
    expect(() => updateProject(id, { key: 'same-key', name: '새 이름' })).not.toThrow()
  })
})

describe('프로젝트 지우기 — 소속됐던 것은 무소속으로 돌아온다', () => {
  it('설계는 지워지지 않고 소속만 풀린다', () => {
    const d = getDb()
    const id = newProject('del-design')
    d.prepare(
      'INSERT INTO designs (id, name, description, dialect, created_at, project_id) VALUES (?,?,?,?,?,?)'
    ).run('design-in-project', '살아남을 설계', '', 'mysql', '2026-08-04T00:00:00.000Z', id)

    deleteProject(id)

    const row = d
      .prepare('SELECT name, project_id FROM designs WHERE id = ?')
      .get('design-in-project') as unknown as { name: string; project_id: string | null }
    expect(row.name).toBe('살아남을 설계')
    expect(row.project_id).toBe(null)
  })

  it('접속도 마찬가지로 살아남는다', () => {
    const d = getDb()
    const id = newProject('del-conn')
    d.prepare(
      `INSERT INTO connections (id, name, db_type, created_at, updated_at, project_id)
       VALUES (?,?,?,?,?,?)`
    ).run('conn-in-project', '살아남을 접속', 'mysql', 'now', 'now', id)

    deleteProject(id)

    const row = d
      .prepare('SELECT project_id FROM connections WHERE id = ?')
      .get('conn-in-project') as unknown as { project_id: string | null }
    expect(row.project_id).toBe(null)
  })

  it('다른 프로젝트의 소속은 건드리지 않는다', () => {
    const d = getDb()
    const keep = newProject('keep-scope')
    const drop = newProject('drop-scope')
    d.prepare(
      'INSERT INTO designs (id, name, description, dialect, created_at, project_id) VALUES (?,?,?,?,?,?)'
    ).run('design-keep', '남의 설계', '', 'mysql', '2026-08-04T00:00:00.000Z', keep)

    deleteProject(drop)

    const row = d
      .prepare('SELECT project_id FROM designs WHERE id = ?')
      .get('design-keep') as unknown as { project_id: string | null }
    expect(row.project_id).toBe(keep)
  })

  it('지운 프로젝트는 목록에서 사라진다', () => {
    const id = newProject('gone')
    deleteProject(id)
    expect(getProject(id)).toBe(null)
  })
})
