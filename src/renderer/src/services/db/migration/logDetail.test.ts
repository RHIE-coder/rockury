import { describe, expect, it } from 'vitest'
import type { MigrationStatement } from './ddlDiff'
import type { SeedApplyStep } from '../workspaces/seed/seedApplyPlan'
import {
  applyLogDetail,
  derivedScopeDetail,
  scopeLogDetail,
  outcomeLogDetail,
  logDetailPreview,
  logSummaryText,
  parseLogDetail,
  schemaCounts,
  schemaLine,
  seedApplyLogDetail,
  targetLine,
  type LogTarget
} from './logDetail'

const target: LogTarget = {
  name: 'test-mysql',
  dialectLabel: 'MySQL',
  host: '127.0.0.1',
  port: 3306,
  database: 'testdb',
  user: 'app'
}

const ddl = (over: Partial<MigrationStatement>): MigrationStatement => ({
  sql: 'CREATE TABLE a (id int)',
  kind: 'create',
  destructive: false,
  table: 'a',
  ...over
})

const step = (over: Partial<SeedApplyStep>): SeedApplyStep => ({
  kind: 'insert',
  table: 'users',
  label: 'admin@x.com',
  statement: { sql: 'INSERT INTO users (email) VALUES (?)', params: ['admin@x.com'] },
  ...over
})

describe('targetLine — 어디에 한 일인가', () => {
  it('연결·벤더·계정·주소를 한 줄로 남긴다', () => {
    expect(targetLine(target)).toBe('연결 test-mysql · MySQL · app@127.0.0.1:3306/testdb')
  })
})

describe('schemaCounts — 스키마별 테이블 수', () => {
  it('나온 순서를 지킨다', () => {
    expect(schemaCounts([{ schema: 'b' }, { schema: 'a' }, { schema: 'b' }])).toEqual([
      { schema: 'b', count: 2 },
      { schema: 'a', count: 1 }
    ])
  })

  it('스키마가 비면 기본 스키마로 묶는다', () => {
    expect(schemaCounts([{}, { schema: '  ' }])).toEqual([{ schema: '(기본)', count: 2 }])
  })

  it('한 줄 문안으로 잇는다', () => {
    expect(schemaLine([{ schema: 'service1' }, { schema: 'testdb' }, { schema: 'testdb' }])).toBe(
      '스키마 service1 1 · testdb 2'
    )
  })
})

describe('scopeLogDetail — 가져오기', () => {
  it('스키마 수와 테이블 이름을 남긴다', () => {
    const detail = scopeLogDetail({
      target,
      tables: [
        { schema: 'service1', name: 'customers' },
        { schema: 'service1', name: 'members' },
        { name: 'legacy' }
      ]
    })
    expect(detail.split('\n')).toEqual([
      '연결 test-mysql · MySQL · app@127.0.0.1:3306/testdb',
      '스키마 service1 2 · (기본) 1',
      '테이블 service1.customers, service1.members, legacy'
    ])
  })

  it('읽은 것이 없으면 그렇게 적는다 — 빈 줄로 얼버무리지 않는다', () => {
    expect(scopeLogDetail({ target, tables: [] })).toContain('테이블 없음')
  })
})

describe('applyLogDetail — 스키마 반영', () => {
  it('대상 테이블·문 수·전문을 남긴다', () => {
    const detail = applyLogDetail({
      target,
      affected: 3,
      statements: [ddl({ table: 'a', sql: '  CREATE TABLE a (id int)  ' }), ddl({ table: 'b', kind: 'index', sql: 'CREATE INDEX i ON b (x)' })]
    })
    expect(detail.split('\n')).toEqual([
      '연결 test-mysql · MySQL · app@127.0.0.1:3306/testdb',
      '대상 a, b',
      '문 2개 · 영향 3행',
      'CREATE TABLE a (id int)',
      'CREATE INDEX i ON b (x)'
    ])
  })

  it('지우는 문이 섞이면 개수를 따로 밝힌다', () => {
    const detail = applyLogDetail({
      target,
      affected: 0,
      statements: [ddl({ kind: 'drop', destructive: true, sql: 'DROP TABLE a' })]
    })
    expect(detail).toContain('지우는 문 1개')
  })
})

describe('seedApplyLogDetail — 시드 반영', () => {
  it('테이블별로 어느 행을 어떻게 했는지 남긴다', () => {
    const detail = seedApplyLogDetail({
      target,
      affected: 3,
      steps: [
        step({}),
        step({ kind: 'update', label: 'ops@x.com' }),
        step({ table: 'roles', label: 'admin' })
      ]
    })
    expect(detail.split('\n')).toEqual([
      '연결 test-mysql · MySQL · app@127.0.0.1:3306/testdb',
      '문 3개 · 영향 3행',
      'users — 넣기 admin@x.com · 고치기 ops@x.com',
      'roles — 넣기 admin'
    ])
  })

  it('값(파라미터)은 담지 않는다 — 시드 값엔 환경 비밀이 섞인다', () => {
    const detail = seedApplyLogDetail({
      target,
      affected: 1,
      steps: [
        step({
          statement: { sql: 'INSERT INTO users (pw) VALUES (?)', params: ['s3cret'] },
          label: 'admin'
        })
      ]
    })
    expect(detail).not.toContain('s3cret')
  })
})

describe('derivedScopeDetail — 상세 없이 쌓인 옛 기록', () => {
  it('버전 스냅샷에서 되짚되, 되짚은 값이라고 먼저 밝힌다', () => {
    const rows = derivedScopeDetail([
      { schema: 'testdb', name: 'users' },
      { schema: 'testdb', name: 'roles' }
    ]).split('\n')
    expect(rows[0]).toContain('되짚은 것입니다')
    expect(rows[1]).toBe('스키마 testdb 2')
    expect(rows[2]).toBe('테이블 testdb.users, testdb.roles')
  })

  it('연결 정보는 안 적는다 — 지금 연결이 그때 것이라는 보장이 없다', () => {
    expect(derivedScopeDetail([{ name: 'users' }])).not.toContain('연결 ')
  })

  it('되짚을 스냅샷이 없으면 빈 문자열 — 화면이 "상세 없음"으로 가른다', () => {
    expect(derivedScopeDetail([])).toBe('')
  })
})

describe('outcomeLogDetail — 실패·롤백', () => {
  it('무엇을 하려다 왜 그리 됐는지 남긴다', () => {
    expect(outcomeLogDetail({ target, attempted: '문 2개 실행 중 실패', message: 'syntax error' })).toBe(
      '연결 test-mysql · MySQL · app@127.0.0.1:3306/testdb\n문 2개 실행 중 실패\n사유 syntax error'
    )
  })

  it('사유가 없으면 그 줄을 안 만든다', () => {
    expect(outcomeLogDetail({ target, attempted: '롤백 — 반영하지 않음' }).split('\n')).toHaveLength(2)
  })
})


describe('logDetailPreview — 목록에 보일 맛보기', () => {
  it('되짚었다는 머리줄은 뺀다 — 두 줄뿐인 자리를 그 한 줄이 다 먹는다', () => {
    const preview = logDetailPreview(derivedScopeDetail([{ schema: 'testdb', name: 'users' }]))
    expect(preview.startsWith('스키마 testdb 1')).toBe(true)
  })

  it('보통 기록은 그대로 둔다', () => {
    const d = scopeLogDetail({ target, tables: [{ name: 'users' }] })
    expect(logDetailPreview(d)).toBe(d)
  })
})

describe('parseLogDetail — 저장된 글줄을 갈래로 나눈다', () => {
  it('가져오기 기록: 대상·스키마·테이블', () => {
    const v = parseLogDetail(
      scopeLogDetail({ target, tables: [{ schema: 'testdb', name: 'users' }, { schema: 'testdb', name: 'roles' }] })
    )
    expect(v.derived).toBe(false)
    expect(v.target).toBe('test-mysql · MySQL · app@127.0.0.1:3306/testdb')
    expect(v.schemas).toEqual([{ schema: 'testdb', count: 2 }])
    expect(v.tables).toEqual(['testdb.users', 'testdb.roles'])
  })

  it('반영 기록: 대상 테이블·셈·나간 문', () => {
    const v = parseLogDetail(
      applyLogDetail({
        target,
        affected: 3,
        statements: [ddl({ table: 'a' }), ddl({ table: 'b', kind: 'drop', destructive: true, sql: 'DROP TABLE b' })]
      })
    )
    expect(v.tables).toEqual(['a', 'b'])
    expect(v.stats).toContain('문 2개')
    expect(v.statements).toEqual(['CREATE TABLE a (id int)', 'DROP TABLE b'])
  })

  it('시드 기록: 테이블별로 건드린 행', () => {
    const v = parseLogDetail(
      seedApplyLogDetail({ target, affected: 2, steps: [step({}), step({ kind: 'update', label: 'ops@x.com' })] })
    )
    expect(v.rowChanges).toEqual([{ table: 'users', items: ['넣기 admin@x.com', '고치기 ops@x.com'] }])
  })

  it('되짚은 기록은 표식이 서고 머리줄을 본문에 남기지 않는다', () => {
    const v = parseLogDetail(derivedScopeDetail([{ schema: 'testdb', name: 'users' }]))
    expect(v.derived).toBe(true)
    expect(v.notes).toEqual([])
    expect(v.target).toBeNull()
  })

  it('실패 기록: 셈과 사유', () => {
    const v = parseLogDetail(outcomeLogDetail({ target, attempted: '문 2개 중 1개째에서 실패', message: 'syntax error' }))
    expect(v.stats).toBe('문 2개 중 1개째에서 실패')
    expect(v.notes).toEqual(['사유 syntax error'])
  })

  it('어디에도 안 붙는 줄은 버리지 않는다 — 조용히 사라지면 감사가 깨진다', () => {
    expect(parseLogDetail('알 수 없는 줄').notes).toEqual(['알 수 없는 줄'])
  })

  it('읽은 것이 없는 기록도 터지지 않는다', () => {
    expect(parseLogDetail('')).toMatchObject({ tables: [], schemas: [], statements: [], notes: [] })
  })
})


describe('logSummaryText — 목록 한 줄에서 겹치는 말 걷어내기', () => {
  const log = (summary: string, over: Partial<{ kind: string; fromVersion: string; toVersion: string }> = {}) => ({
    kind: 'map',
    fromVersion: '',
    toVersion: 'v0.1.0',
    summary,
    ...over
  })

  /** 회귀: 옛 기록은 이 글을 그대로 들고 있어 코드만 고쳐서는 화면이 안 바뀌었다. */
  it('옛 기록도 다듬는다 — 옆 칸이 그린 버전, 상세가 늘어놓을 테이블 수를 지운다', () => {
    expect(logSummaryText(log('운영 DB 가져오기 → v0.1.0 (38개 테이블)'))).toBe('운영 DB 가져오기')
  })

  it('맵핑 확정은 뜻으로 바꾸고 버전 되풀이를 지운다', () => {
    expect(logSummaryText(log('맵핑 확정 — 이 연결은 v0.1.0 입니다 (38개 테이블)'))).toBe('버전 확정')
  })

  it('반영·시드는 배지가 말한 갈래를 요약에서 뺀다', () => {
    expect(logSummaryText(log('2개 문 반영 · 영향 3행', { kind: 'apply', toVersion: 'v2' }))).toBe('문 2개 · 영향 3행')
    expect(logSummaryText(log('시드 반영 3개 문 · 영향 3행', { kind: 'seed-apply', toVersion: '' }))).toBe(
      '문 3개 · 영향 3행'
    )
  })

  it('롤백은 "반영하지 않음"을 빼도 뜻이 남는다', () => {
    expect(logSummaryText(log('시드 2개 문 실행 뒤 롤백 — 반영하지 않음', { kind: 'seed-apply', toVersion: '' }))).toBe(
      '문 2개 실행 뒤 롤백'
    )
  })

  it('이미 다듬어진 글은 그대로 둔다(두 번 걸어도 같다)', () => {
    const once = logSummaryText(log('운영 DB 가져오기 → v0.1.0 (38개 테이블)'))
    expect(logSummaryText(log(once))).toBe(once)
    expect(logSummaryText(log('문 2개 · 영향 3행', { kind: 'apply' }))).toBe('문 2개 · 영향 3행')
  })

  it('다 걷어내 빈칸이 되면 갈래 이름으로 갈음한다 — 빈 줄을 그리지 않는다', () => {
    expect(logSummaryText(log('→ v0.1.0'))).toBe('버전 지정')
  })
})
