import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setDbPath } from '../store/db'
import { createConnection } from '../store/connections'
import { queryService } from './queryService'
import { connectionService } from './connectionService'
import { introspectionService } from './introspectionService'

/**
 * 서비스 계층 통합 테스트 — **자체 sqlite 픽스처**(임시 파일) 위에서 검증한다.
 * docker/electron 불필요(sqlite 는 비밀번호 없음 → 암복호화 경로 미진입) → 기본 `npm test` 포함.
 * queryService(run/runParams/멀티문/explain), connectionService.testConnection,
 * introspectionService(sqlite 역설계) — 그동안 e2e 로만 덮였던 서비스 로직을 덮는다.
 * (mysql/pg 및 tx 쓰기 게이트는 docker 필요 → 별도 gated 통합 + e2e 가 담당.)
 */
let FIXTURE = ''

beforeAll(() => {
  // 앱 DB(연결 레코드 저장용) — 임시.
  setDbPath(join(mkdtempSync(join(tmpdir(), 'rockury-svc-app-')), 'app.db'))
  // 조회 대상 sqlite 픽스처 — 쓰기 가능하게 만들어 스키마+데이터 채운 뒤 닫는다(앱은 readonly 로 연다).
  FIXTURE = join(mkdtempSync(join(tmpdir(), 'rockury-svc-fix-')), 'fixture.sqlite')
  const w = new DatabaseSync(FIXTURE)
  w.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id));
    INSERT INTO users (id, email) VALUES (1, 'a@x.com'), (2, 'b@x.com');
    INSERT INTO posts (id, user_id, title) VALUES (1, 1, 'hi'), (2, 1, 'yo'), (3, 2, 'sup');
  `)
  w.close()
})

function sqliteConn(): string {
  return createConnection({
    name: 'fix',
    dbType: 'sqlite',
    host: '',
    port: 0,
    database: FIXTURE,
    user: '',
    encryptedPassword: '',
    sslEnabled: false
  }).id
}

describe('queryService (sqlite 픽스처, readonly)', () => {
  it('run — SELECT 결과/컬럼', async () => {
    const r = await queryService.run(sqliteConn(), 'SELECT id, email FROM users ORDER BY id')
    expect(r.columns).toEqual(['id', 'email'])
    expect(r.rowCount).toBe(2)
    expect(r.rows[0]).toMatchObject({ id: 1, email: 'a@x.com' })
  })

  it('runParams — 파라미터 바인드', async () => {
    const r = await queryService.runParams(sqliteConn(), 'SELECT COUNT(*) AS c FROM posts WHERE user_id = ?', [1])
    expect(r.rows[0].c).toBe(2)
  })

  it('멀티문 — 마지막 결과 반환', async () => {
    const r = await queryService.run(sqliteConn(), "SELECT 1 AS a; SELECT 'x' AS b")
    expect(r.rows[0].b).toBe('x')
  })

  it('explain — 실행 계획 rows/summary', async () => {
    const r = await queryService.explain(sqliteConn(), 'SELECT * FROM users')
    expect(r.planRows.length).toBeGreaterThan(0)
    expect(typeof r.summary).toBe('string')
  })
})

describe('connectionService.testConnection (sqlite)', () => {
  it('연결 성공 + serverVersion', async () => {
    const res = await connectionService.testConnection({
      name: 'fix', dbType: 'sqlite', host: '', port: 0, database: FIXTURE, user: '', password: '', sslEnabled: false
    })
    expect(res.success).toBe(true)
    expect(res.serverVersion).toMatch(/^SQLite /)
  })

  it('없는 파일 → 실패 메시지', async () => {
    const res = await connectionService.testConnection({
      name: 'x', dbType: 'sqlite', host: '', port: 0, database: '/nope/none.sqlite', user: '', password: '', sslEnabled: false
    })
    expect(res.success).toBe(false)
  })
})

describe('introspectionService (sqlite 역설계)', () => {
  it('테이블/PK/UK/FK 를 IR 로 뽑는다', async () => {
    const ir = await introspectionService.run(sqliteConn())
    const names = ir.tables.map((t) => t.name).sort()
    expect(names).toEqual(['posts', 'users'])
    expect(ir.keys.some((k) => k.table === 'users' && k.kind === 'pk' && k.column === 'id')).toBe(true)
    expect(ir.keys.some((k) => k.table === 'users' && k.kind === 'uk' && k.column === 'email')).toBe(true)
    expect(ir.foreignKeys.some((f) => f.table === 'posts' && f.refTable === 'users')).toBe(true)
  })
})

afterAll(() => {
  // 임시 파일은 tmp 라 OS 가 정리 — 명시 정리 불필요.
})
