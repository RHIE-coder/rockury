import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MIGRATIONS, applyMigrations, declaredTables, type ServiceMigration } from './index'

/**
 * TestPlan: parallel-dev · Scenario S3 (CASE-pdev-020 ~ 022)
 *
 * 마이그레이션을 서비스별 파일로 쪼갠 뒤에도 로컬 저장소가 온전한지 본다.
 * "통과했다"가 아니라 **"막을 것을 막는다"** 를 보는 게 목적이다 — 중복 선언·조용한 누락은
 * 분할이 새로 만드는 위험이라, 여기서 안 잡으면 아무 데서도 안 잡힌다.
 */

/**
 * 분할 **전** `db.ts migrate()` 가 만들던 테이블 전수(17개).
 * 이 목록이 줄면 사용자의 로컬 데이터가 갈 곳을 잃는다 — 손으로 적어 둔 대조 기준이다.
 *
 * **줄었는지만 본다(포함 검사).** 서비스가 자기 테이블을 더하는 건 정상이므로 "정확히 일치"로
 * 보면 테이블을 더할 때마다 이 공용 테스트가 깨져 병렬 개발 규칙("테이블은 자기 서비스 파일에만
 * 더한다")과 충돌한다. 유령·누락 검사는 아래 CASE-pdev-022(선언 ↔ 실제 대조)가 따로 맡는다.
 */
const TABLES_BEFORE_SPLIT = [
  'collection_folders',
  'collection_items',
  'collections',
  'connection_groups',
  'connections',
  'designs',
  'diagram_layouts',
  'env_snapshots',
  'env_variables',
  'environments',
  'migration_logs',
  'query_folders',
  'query_history',
  'saved_queries',
  'seed_sets',
  'tables',
  'versions'
]

function tempDbFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'rockury-migrations-')), 'test.db')
}

function tableNames(d: DatabaseSync): string[] {
  return (
    d
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all() as unknown as { name: string }[]
  ).map((r) => r.name)
}

describe('서비스별 마이그레이션 분할', () => {
  it('CASE-pdev-020 모든 서비스 마이그레이션을 적용하면 분할 전 테이블이 전수 생성된다', () => {
    const d = new DatabaseSync(tempDbFile())
    applyMigrations(d)
    expect(tableNames(d)).toEqual(expect.arrayContaining(TABLES_BEFORE_SPLIT))
    d.close()
  })

  it('CASE-pdev-021 이미 쓰던 DB 를 다시 열어도 데이터가 보존된다 (사용자 로컬 무손상)', () => {
    const file = tempDbFile()
    const first = new DatabaseSync(file)
    applyMigrations(first)
    first
      .prepare('INSERT INTO designs (id, name, description, dialect, created_at) VALUES (?,?,?,?,?)')
      .run('keep-me', '보존 확인', '', 'mysql', '2026-07-27T00:00:00.000Z')
    first.close()

    // 두 번째 열기 = 앱 재시작. 마이그레이션이 다시 돌아도 기존 행을 건드리면 안 된다.
    const second = new DatabaseSync(file)
    applyMigrations(second)
    const rows = second.prepare('SELECT id, name FROM designs').all() as unknown as {
      id: string
      name: string
    }[]
    expect(rows).toEqual([{ id: 'keep-me', name: '보존 확인' }])
    expect(tableNames(second)).toEqual(expect.arrayContaining(TABLES_BEFORE_SPLIT))
    second.close()
  })

  it('CASE-pdev-022 두 서비스가 같은 테이블을 선언하면 적용이 실패한다', () => {
    // 분할이 새로 만드는 위험: 서비스 A 와 B 가 같은 이름을 선언하면 `IF NOT EXISTS` 탓에
    // 뒤에 온 쪽이 조용히 무시되고, 한쪽 서비스는 자기가 원한 모양이 아닌 테이블을 쓰게 된다.
    const clash: ServiceMigration[] = [
      { service: 'uiux', tables: ['shared_thing'], schema: 'CREATE TABLE IF NOT EXISTS shared_thing (id TEXT PRIMARY KEY);' },
      { service: 'api', tables: ['shared_thing'], schema: 'CREATE TABLE IF NOT EXISTS shared_thing (id TEXT PRIMARY KEY);' }
    ]
    const d = new DatabaseSync(tempDbFile())
    expect(() => applyMigrations(d, clash)).toThrow(/shared_thing/)
    d.close()
  })

  it('CASE-pdev-022 선언한 테이블과 실제 생성된 테이블이 일치한다 — 조용한 누락 금지', () => {
    // `tables:` 에 적었는데 SQL 에 빠졌거나(선언만), SQL 로 만들었는데 안 적었으면(유령) 잡는다.
    const d = new DatabaseSync(tempDbFile())
    applyMigrations(d)
    expect([...declaredTables()].sort()).toEqual(tableNames(d))
    d.close()
  })

  it('CASE-pdev-022 서비스 목록에 없는 이름을 선언하면 실패한다', () => {
    const stray: ServiceMigration[] = [
      { service: 'nope', tables: [], schema: '' }
    ]
    const d = new DatabaseSync(tempDbFile())
    expect(() => applyMigrations(d, stray)).toThrow(/nope/)
    d.close()
  })

  it('안전핀: 등록된 마이그레이션이 0개면 실패한다 (목록이 통째로 날아간 상태 감지)', () => {
    const d = new DatabaseSync(tempDbFile())
    expect(() => applyMigrations(d, [])).toThrow()
    d.close()
  })

  it('다섯 서비스가 모두 자기 마이그레이션 자리를 갖는다 (병렬 개발 소유권)', () => {
    expect(MIGRATIONS.map((m) => m.service).sort()).toEqual(['ai', 'api', 'db', 'infra', 'uiux'])
  })
})
