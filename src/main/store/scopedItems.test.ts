import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, setDbPath } from './db'
import { createProject } from './projects'
import { SCOPED_KINDS, listScopedItems, setItemProject } from './scopedItems'

/**
 * 소속 편집 창구.
 *
 * 이 자리가 있어야 **이미 쌓인** 설계·접속을 프로젝트로 나눌 수 있다 — 만들 때 정하는 것만으로는
 * 기능 도입 전에 만든 것들이 영원히 무소속으로 남는다.
 */
beforeAll(() => {
  setDbPath(join(mkdtempSync(join(tmpdir(), 'rockury-scoped-')), 'test.db'))
  const d = getDb()
  d.prepare(
    'INSERT INTO designs (id, name, description, dialect, created_at) VALUES (?,?,?,?,?)'
  ).run('d1', '커머스 코어', '', 'mysql', '2026-08-04T00:00:00.000Z')
  d.prepare(
    'INSERT INTO connections (id, name, db_type, created_at, updated_at) VALUES (?,?,?,?,?)'
  ).run('c1', '로컬 Postgres', 'postgresql', 'now', 'now')
  d.prepare('INSERT INTO api_specs (id, name, description, kind, created_at) VALUES (?,?,?,?,?)').run(
    's1',
    '주문 API',
    '',
    'rest',
    '2026-08-04T00:00:00.000Z'
  )
})

describe('소속 목록', () => {
  it('여섯 종류를 모두 다룬다', () => {
    expect([...SCOPED_KINDS].sort()).toEqual([
      'apiSpec',
      'connection',
      'design',
      'infraDesign',
      'infraProvider',
      'middleware'
    ])
  })

  it('이름과 지금 소속을 함께 준다', () => {
    const design = listScopedItems().find((i) => i.id === 'd1')
    expect(design).toMatchObject({ kind: 'design', name: '커머스 코어', projectId: null })
  })

  it('무소속을 공용으로 다루는 종류를 표시해 준다', () => {
    const items = listScopedItems()
    // 접속은 공용(shared) — 프로젝트를 골라도 무소속이면 남는다.
    expect(items.find((i) => i.id === 'c1')?.sharedWhenUnassigned).toBe(true)
    // 설계는 아니다(strict) — 프로젝트를 고르면 무소속은 숨는다.
    expect(items.find((i) => i.id === 'd1')?.sharedWhenUnassigned).toBe(false)
  })
})

describe('소속 옮기기', () => {
  it('프로젝트에 넣고 다시 뺄 수 있다', () => {
    const p = createProject({ key: 'move-target', name: '쿠팡' })

    setItemProject('design', 'd1', p.id)
    expect(listScopedItems().find((i) => i.id === 'd1')?.projectId).toBe(p.id)

    setItemProject('design', 'd1', null)
    expect(listScopedItems().find((i) => i.id === 'd1')?.projectId).toBe(null)
  })

  it('종류마다 제 테이블을 고친다', () => {
    const p = createProject({ key: 'per-kind', name: '배민' })
    setItemProject('apiSpec', 's1', p.id)

    const items = listScopedItems()
    expect(items.find((i) => i.id === 's1')?.projectId).toBe(p.id)
    // 같은 id 를 가진 다른 종류가 휩쓸리지 않는다.
    expect(items.find((i) => i.id === 'c1')?.projectId).toBe(null)
  })

  it('없는 프로젝트로는 못 옮긴다 — 어느 범위에서도 안 보이는 유령이 된다', () => {
    expect(() => setItemProject('design', 'd1', '없는-프로젝트')).toThrow(/없는 프로젝트/)
  })

  it('모르는 종류는 거부한다', () => {
    // @ts-expect-error 런타임 방어 — IPC 로 아무 문자열이나 올 수 있다.
    expect(() => setItemProject('nope', 'd1', null)).toThrow()
  })
})
