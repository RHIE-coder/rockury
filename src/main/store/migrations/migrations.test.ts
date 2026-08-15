import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MIGRATIONS,
  SHARED_OWNER,
  applyMigrations,
  declaredTables,
  type ServiceMigration
} from './index'

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
/**
 * 분할 전 표 목록 — "조용히 사라진 표 0" 을 지킨다.
 * `env_snapshots`(드리프트 기준선)는 2026-08-12 에 **의도적으로** 폐기했다(§migrations/db 의
 * DROP 단계). 의도한 삭제는 이 목록에서도 빼야 가드가 다음 사고를 잡을 수 있다.
 */
const TABLES_BEFORE_SPLIT = [
  'collection_folders',
  'collection_items',
  'collections',
  'connection_groups',
  'connections',
  'designs',
  'diagram_layouts',
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
  /**
   * 분할 전 테이블이 **하나도 빠지지 않았는지** 본다.
   * 서비스가 자기 테이블을 새로 더하는 것은 정상이므로 정확히 같음이 아니라 포함으로 본다 —
   * 이 검사의 목적은 "늘었나"가 아니라 "사용자 데이터가 갈 곳을 잃었나"다.
   */
  function expectNoTableLost(d: DatabaseSync): void {
    const actual = new Set(tableNames(d))
    for (const t of TABLES_BEFORE_SPLIT) expect(actual.has(t), `테이블 '${t}' 가 사라졌다`).toBe(true)
  }

  it('CASE-pdev-020 모든 서비스 마이그레이션을 적용하면 분할 전 테이블이 전수 생성된다', () => {
    const d = new DatabaseSync(tempDbFile())
    applyMigrations(d)
    expectNoTableLost(d)
    d.close()
  })

  it('서비스가 더한 테이블은 전부 자기 서비스 접두어를 쓴다 (네임스페이스 규칙)', () => {
    // 접두어가 없으면 두 서비스가 같은 이름을 고를 확률이 생기고, 그 충돌은 앱이 안 켜지는 것으로 나타난다.
    // 공용 소유(shell)는 제외한다 — 접두어의 목적은 서비스끼리의 충돌 회피인데 공용은 하나뿐이라
    // 충돌 상대가 없고, `shell_projects` 로 적으면 모든 서비스가 참조하는 이름이 셸 전용으로 읽힌다.
    const before = new Set(TABLES_BEFORE_SPLIT)
    for (const m of MIGRATIONS) {
      if (m.service === SHARED_OWNER) continue
      for (const t of m.tables) {
        if (before.has(t)) continue // 분할 전부터 있던 이름은 레거시 예외
        expect(t.startsWith(`${m.service}_`), `'${t}' 는 '${m.service}_' 로 시작해야 한다`).toBe(true)
      }
    }
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
    expectNoTableLost(second)
    second.close()
  })

  it('명세 문서 칸이 없던 구 DB 에도 칸이 뒤늦게 붙는다', () => {
    const file = tempDbFile()
    const legacy = new DatabaseSync(file)
    // docs 가 생기기 전 모양. `CREATE TABLE IF NOT EXISTS` 는 이미 있는 표에 칸을 못 더하므로
    // alter 가 없으면 앱이 명세를 읽자마자 터진다 — 그 자리를 지키는 회귀 테스트.
    legacy.exec(`CREATE TABLE api_specs (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind        TEXT NOT NULL,
      created_at  TEXT NOT NULL
    )`)
    legacy
      .prepare('INSERT INTO api_specs (id, name, description, kind, created_at) VALUES (?,?,?,?,?)')
      .run('old', '예전 명세', '', 'rest', '2026-07-27T00:00:00.000Z')
    legacy.close()

    const d = new DatabaseSync(file)
    applyMigrations(d)
    const row = d.prepare('SELECT name, docs FROM api_specs WHERE id = ?').get('old') as unknown as {
      name: string
      docs: string
    }
    expect(row).toEqual({ name: '예전 명세', docs: '' })
    d.close()
  })

  it('기준선을 걷어내기 전에 쌓인 이력이 지금 낱말로 정리된다', () => {
    // 회귀: 표(`env_snapshots`)만 지우고 이력을 안 건드려, 기록 화면이 이제 없는
    // 낱말("기준선")을 배지로 계속 보였다(2026-08-13 사용자 지적).
    const file = tempDbFile()
    const first = new DatabaseSync(file)
    applyMigrations(first)
    const insert = first.prepare(
      `INSERT INTO migration_logs (id, env_id, kind, from_version, to_version, summary, status, detail, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    const at = '2026-07-24T04:31:35.000Z'
    insert.run('l1', 'e1', 'baseline', '', 'v0.1.0', '운영 DB 가져오기', 'success', '', at)
    insert.run('l2', 'e1', 'drift', '', '', '설계와 다름', 'success', '+orders', at)
    insert.run('l3', 'e1', 'apply', 'v0.1.0', 'v0.2.0', '반영', 'success', '', at)
    first.close()

    const d = new DatabaseSync(file)
    applyMigrations(d)
    const rows = d
      .prepare('SELECT id, kind, summary FROM migration_logs ORDER BY id')
      .all() as unknown as { id: string; kind: string; summary: string }[]
    // 가져오기는 실은 맵핑이었으므로 종류만 갈아 끼워 이력을 잇고, 드리프트는 지운다.
    expect(rows).toEqual([
      { id: 'l1', kind: 'map', summary: '운영 DB 가져오기' },
      { id: 'l3', kind: 'apply', summary: '반영' }
    ])
    d.close()
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

  it('다섯 서비스 + 공용 자리가 모두 자기 마이그레이션을 갖는다 (병렬 개발 소유권)', () => {
    expect(MIGRATIONS.map((m) => m.service).sort()).toEqual([
      'ai',
      'api',
      'db',
      'infra',
      'shell',
      'uiux'
    ])
  })
})

/**
 * 공용 소유(shell) — 어느 서비스에도 속하지 않는 테이블의 자리.
 * 프로젝트는 다섯 서비스가 **함께** 쓰는 범위라 어느 한 서비스가 소유할 수 없다.
 * (`ai/coverage/shell.ts` 가 이미 같은 뜻으로 'shell' 을 쓰고 있어 토큰을 맞춘다.)
 */
describe('공용 소유 자리', () => {
  it('projects 테이블이 생긴다', () => {
    const d = new DatabaseSync(tempDbFile())
    applyMigrations(d)
    expect(tableNames(d)).toContain('projects')
    d.close()
  })

  it('같은 key 를 가진 프로젝트를 둘 만들 수 없다', () => {
    // key 는 UI/UX 안정 주소의 첫 조각(`coupang.buyer.auth.login`)이다 — 겹치면 주소가 두 곳을 가리킨다.
    const d = new DatabaseSync(tempDbFile())
    applyMigrations(d)
    const insert = d.prepare(
      'INSERT INTO projects (id, key, name, description, created_at) VALUES (?,?,?,?,?)'
    )
    insert.run('p1', 'coupang', '쿠팡', '', '2026-08-04T00:00:00.000Z')
    expect(() => insert.run('p2', 'coupang', '쿠팡 둘', '', '2026-08-04T00:00:00.000Z')).toThrow()
    d.close()
  })

  /**
   * 소속 칸을 갖는 테이블 전수 — 각 서비스에서 **목록 맨 위에 이름으로 뜨는 것**만이다.
   * 그 안에 든 것(테이블·요청·환경·노드)은 부모를 타고 프로젝트가 정해지므로 칸을 두지 않는다.
   * 안쪽까지 칸을 두면 "명세는 쿠팡인데 그 안 요청은 배민" 인 있을 수 없는 상태가 생긴다.
   */
  const SCOPED_TABLES = [
    'designs', // DB 설계
    'connections', // DB 접속
    'api_specs', // API 명세
    'infra_designs', // 인프라 설계본
    'infra_providers', // 클라우드 공급자 연결
    'infra_mw_connections' // 미들웨어 접속
  ]

  it.each(SCOPED_TABLES)('%s 에 소속 칸(project_id)이 있다', (table) => {
    const d = new DatabaseSync(tempDbFile())
    applyMigrations(d)
    const cols = (
      d.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as unknown as { name: string }[]
    ).map((r) => r.name)
    expect(cols).toContain('project_id')
    d.close()
  })

  it.each(SCOPED_TABLES)('%s 의 소속은 비워 둘 수 있다 (무소속 허용)', (table) => {
    // 프로젝트를 안 정한 것도 만들 수 있어야 한다 — NOT NULL 이면 프로젝트를 먼저 만들라는
    // 관문이 생기고, 이미 쌓인 로컬 데이터가 갈 곳을 잃는다.
    const d = new DatabaseSync(tempDbFile())
    applyMigrations(d)
    const notNull = d
      .prepare(`SELECT "notnull" AS nn FROM pragma_table_info(?) WHERE name='project_id'`)
      .get(table) as unknown as { nn: number }
    expect(notNull.nn).toBe(0)
    d.close()
  })

  it('공용도 서비스도 아닌 이름을 선언하면 여전히 실패한다', () => {
    // 공용 자리를 연다고 아무 이름이나 통과하면 오타가 조용히 새 소유자를 만든다.
    const d = new DatabaseSync(tempDbFile())
    expect(() => applyMigrations(d, [{ service: 'core', tables: [], schema: '' }])).toThrow(/core/)
    d.close()
  })
})
