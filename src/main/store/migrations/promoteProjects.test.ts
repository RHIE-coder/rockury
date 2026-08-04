import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promoteProjectsToShared } from './promoteProjects'

/**
 * UI/UX 전용이던 프로젝트를 공용 `projects` 로 올리는 이관.
 *
 * 사용자의 로컬 DB 에 이미 프로젝트가 들어 있다 — 이관이 어긋나면 화면 설계 트리 전체가
 * 부모를 잃는다(`uiux_applications.project_id` 가 가리킬 곳이 없어짐). 그래서 **id 보존**이
 * 이 테스트의 핵심이다.
 */

function tempDbFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'rockury-promote-')), 'test.db')
}

/** 이관 전 모양 — 공용 projects + 옛 uiux_projects 가 함께 있는 상태를 만든다. */
function oldShape(withTokens = true): DatabaseSync {
  const d = new DatabaseSync(tempDbFile())
  d.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, key TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_projects_key ON projects(key);
    CREATE TABLE uiux_project_tokens (
      project_id TEXT PRIMARY KEY, tokens TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE uiux_projects (
      id TEXT PRIMARY KEY, key TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''${withTokens ? ", tokens TEXT NOT NULL DEFAULT '{}'" : ''},
      created_at TEXT NOT NULL
    );
  `)
  return d
}

function insertOld(
  d: DatabaseSync,
  row: { id: string; key: string; name: string; tokens?: string }
): void {
  d.prepare(
    `INSERT INTO uiux_projects (id, key, name, description, tokens, created_at) VALUES (?,?,?,?,?,?)`
  ).run(row.id, row.key, row.name, '', row.tokens ?? '{}', '2026-08-01T00:00:00.000Z')
}

function tableExists(d: DatabaseSync, name: string): boolean {
  return !!d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name)
}

describe('프로젝트 공용 승격', () => {
  it('행이 공용 projects 로 옮겨지고 id 가 그대로다', () => {
    // id 가 바뀌면 uiux_applications.project_id 가 통째로 고아가 된다.
    const d = oldShape()
    insertOld(d, { id: 'p-coupang', key: 'coupang', name: '쿠팡' })
    promoteProjectsToShared(d)

    const rows = d.prepare('SELECT id, key, name FROM projects').all() as unknown as {
      id: string
      key: string
      name: string
    }[]
    expect(rows).toEqual([{ id: 'p-coupang', key: 'coupang', name: '쿠팡' }])
    d.close()
  })

  it('디자인 토큰은 UI/UX 소유 테이블로 따로 옮겨진다', () => {
    // 토큰은 UI/UX 전용이라 공용 테이블에 두지 않는다 — 두면 서비스마다 전용 칸이 붙어 잡동사니가 된다.
    const d = oldShape()
    insertOld(d, { id: 'p1', key: 'coupang', name: '쿠팡', tokens: '{"color.brand":"#f00"}' })
    promoteProjectsToShared(d)

    const t = d
      .prepare('SELECT tokens FROM uiux_project_tokens WHERE project_id = ?')
      .get('p1') as unknown as { tokens: string }
    expect(JSON.parse(t.tokens)).toEqual({ 'color.brand': '#f00' })
    d.close()
  })

  it('빈 토큰은 옮기지 않는다 (기본값을 행으로 만들지 않음)', () => {
    const d = oldShape()
    insertOld(d, { id: 'p1', key: 'coupang', name: '쿠팡', tokens: '{}' })
    promoteProjectsToShared(d)

    const c = d.prepare('SELECT COUNT(*) AS c FROM uiux_project_tokens').get() as unknown as {
      c: number
    }
    expect(c.c).toBe(0)
    d.close()
  })

  it('옮기고 나면 옛 테이블은 사라진다', () => {
    const d = oldShape()
    insertOld(d, { id: 'p1', key: 'coupang', name: '쿠팡' })
    promoteProjectsToShared(d)
    expect(tableExists(d, 'uiux_projects')).toBe(false)
    d.close()
  })

  it('두 번 돌려도 안전하다 (앱을 다시 켜도 같은 결과)', () => {
    const d = oldShape()
    insertOld(d, { id: 'p1', key: 'coupang', name: '쿠팡' })
    promoteProjectsToShared(d)
    expect(() => promoteProjectsToShared(d)).not.toThrow()

    const c = d.prepare('SELECT COUNT(*) AS c FROM projects').get() as unknown as { c: number }
    expect(c.c).toBe(1)
    d.close()
  })

  it('공용 쪽에 같은 id 가 이미 있으면 덮어쓰지 않는다', () => {
    // 반쯤 이관된 DB 에서 다시 돌 때, 사용자가 그 사이 고친 이름을 옛 값으로 되돌리면 안 된다.
    const d = oldShape()
    d.prepare('INSERT INTO projects (id, key, name, description, created_at) VALUES (?,?,?,?,?)').run(
      'p1',
      'coupang',
      '새 이름',
      '',
      '2026-08-02T00:00:00.000Z'
    )
    insertOld(d, { id: 'p1', key: 'coupang', name: '옛 이름' })
    promoteProjectsToShared(d)

    const r = d.prepare('SELECT name FROM projects WHERE id = ?').get('p1') as unknown as {
      name: string
    }
    expect(r.name).toBe('새 이름')
    d.close()
  })

  it('옛 테이블이 없는 새 DB 에서는 아무 일도 안 한다', () => {
    const d = new DatabaseSync(tempDbFile())
    d.exec(`CREATE TABLE projects (
      id TEXT PRIMARY KEY, key TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );`)
    expect(() => promoteProjectsToShared(d)).not.toThrow()
    d.close()
  })

  it('토큰 칸이 없던 아주 옛 DB 도 옮긴다', () => {
    // tokens 는 나중에 ALTER 로 붙은 칸이라, 그 전에 만들어진 로컬 DB 에는 없을 수 있다.
    const d = oldShape(false)
    d.prepare(
      `INSERT INTO uiux_projects (id, key, name, description, created_at) VALUES (?,?,?,?,?)`
    ).run('p1', 'coupang', '쿠팡', '', '2026-08-01T00:00:00.000Z')
    promoteProjectsToShared(d)

    const r = d.prepare('SELECT key FROM projects WHERE id = ?').get('p1') as unknown as {
      key: string
    }
    expect(r.key).toBe('coupang')
    d.close()
  })
})
