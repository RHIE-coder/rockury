import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setDbPath } from './db'
import { createSpec } from './apiSpecs'
import {
  appendRun,
  deleteEnvironment,
  duplicateEnvironment,
  getEnvironment,
  listEnvironments,
  listRuns,
  pruneRuns,
  saveEnvironment,
  type AppendRunInput
} from './apiOps'

/** 운영부 저장소 — `docs/qa/api-runner.md` S2·S4 (CASE-apirunner-010~017, 030~037). */

beforeAll(() => {
  setDbPath(join(mkdtempSync(join(tmpdir(), 'rockury-api-ops-')), 'test.db'))
})

const spec = (name: string): string => createSpec({ name, kind: 'rest' }).id

const run = (over: Partial<AppendRunInput> & Pick<AppendRunInput, 'specId' | 'environmentId'>): AppendRunInput => ({
  requestName: 'getUser',
  environmentName: 'DEV',
  baseVersion: null,
  shape: 'unary',
  messages: null,
  status: 'ok',
  httpStatus: 200,
  durationMs: 12,
  request: { method: 'GET', url: 'https://x.test/u', headers: {}, body: '' },
  response: { status: 200, headers: {}, body: '{}', size: 2 },
  error: null,
  ...over
})

describe('CASE-apirunner-015~017 환경 저장', () => {
  it('만들고 목록에 뜬다 — 카드에 이름·주소가 담긴다', () => {
    const s = spec('EnvSpec')
    const e = saveEnvironment({ specId: s, name: 'DEV', baseUrl: 'https://dev.test', production: false, values: [] })
    expect(listEnvironments(s).map((x) => x.name)).toEqual(['DEV'])
    expect(getEnvironment(e.id)?.baseUrl).toBe('https://dev.test')
  })

  it('이름은 명세 안에서 유일하다', () => {
    const s = spec('EnvDup')
    saveEnvironment({ specId: s, name: 'STG', baseUrl: '', production: false, values: [] })
    expect(() =>
      saveEnvironment({ specId: s, name: 'STG', baseUrl: '', production: false, values: [] })
    ).toThrow(/이미 있습니다/)
  })

  it('다른 명세에는 같은 이름이 있어도 된다', () => {
    const a = spec('EnvA')
    const b = spec('EnvB')
    saveEnvironment({ specId: a, name: 'PROD', baseUrl: '', production: true, values: [] })
    expect(() =>
      saveEnvironment({ specId: b, name: 'PROD', baseUrl: '', production: true, values: [] })
    ).not.toThrow()
  })

  it('값 이름 중복·빈 이름을 막는다', () => {
    const s = spec('EnvValues')
    const bad = (values: { name: string; value: string; secret: boolean }[]) =>
      saveEnvironment({ specId: s, name: `E${Math.round(values.length)}`, baseUrl: '', production: false, values })
    expect(() => bad([{ name: 'a', value: '1', secret: false }, { name: 'a', value: '2', secret: false }])).toThrow(
      /두 번/
    )
    expect(() => bad([{ name: '', value: '1', secret: false }])).toThrow(/비어/)
  })

  it('수정하면 같은 id 를 유지한다', () => {
    const s = spec('EnvEdit')
    const e = saveEnvironment({ specId: s, name: 'DEV', baseUrl: '', production: false, values: [] })
    const after = saveEnvironment({ id: e.id, specId: s, name: 'DEV2', baseUrl: 'https://y', production: true, values: [] })
    expect(after.id).toBe(e.id)
    expect(after.production).toBe(true)
    expect(listEnvironments(s)).toHaveLength(1)
  })
})

// CASE-apirunner-010 — 복제 시 값 제거
describe('CASE-apirunner-010 복제는 구조만 가져온다', () => {
  it('값은 비고 이름·비밀 표식은 남는다', () => {
    const s = spec('EnvClone')
    const src = saveEnvironment({
      specId: s,
      name: 'STG',
      baseUrl: 'https://stg.test',
      production: false,
      values: [
        { name: 'apiKey', value: 'STG-SECRET', secret: true },
        { name: 'tenant', value: 'acme', secret: false }
      ]
    })
    const copy = duplicateEnvironment(src.id, 'PROD')
    expect(copy.values).toEqual([
      { name: 'apiKey', value: '', secret: true },
      { name: 'tenant', value: '', secret: false }
    ])
    // 주소도 안 따라온다 — STG 주소로 PROD 를 치는 사고가 여기서 난다.
    expect(copy.baseUrl).toBe('')
    expect(copy.production).toBe(false)
  })

  it('복제본 어디에도 원본 값이 남지 않는다', () => {
    const s = spec('EnvCloneLeak')
    const src = saveEnvironment({
      specId: s,
      name: 'STG',
      baseUrl: 'https://stg.test',
      production: false,
      values: [{ name: 'k', value: 'LEAK-ME', secret: true }]
    })
    expect(JSON.stringify(duplicateEnvironment(src.id, 'PROD'))).not.toContain('LEAK-ME')
  })
})

// CASE-apirunner-011 — 삭제 게이트
describe('CASE-apirunner-011 기록이 붙은 환경은 못 지운다', () => {
  it('기록이 없으면 지워진다', () => {
    const s = spec('EnvDel')
    const e = saveEnvironment({ specId: s, name: 'DEV', baseUrl: '', production: false, values: [] })
    expect(deleteEnvironment(e.id)).toEqual({ deleted: true, runCount: 0 })
    expect(listEnvironments(s)).toEqual([])
  })

  it('기록이 있으면 안 지우고 건수를 알린다', () => {
    const s = spec('EnvDelKeep')
    const e = saveEnvironment({ specId: s, name: 'DEV', baseUrl: '', production: false, values: [] })
    appendRun(run({ specId: s, environmentId: e.id }))
    expect(deleteEnvironment(e.id)).toEqual({ deleted: false, runCount: 1 })
    expect(listEnvironments(s)).toHaveLength(1)
  })
})

// CASE-apirunner-030~037 — 실행 기록
describe('CASE-apirunner-030~037 실행 기록', () => {
  it('기준 버전까지 담긴다 — 없으면 null(Draft 관측)', () => {
    const s = spec('RunBase')
    const e = saveEnvironment({ specId: s, name: 'DEV', baseUrl: '', production: false, values: [] })
    const a = appendRun(run({ specId: s, environmentId: e.id }))
    const b = appendRun(run({ specId: s, environmentId: e.id, baseVersion: 'v0.1.0' }))
    expect(a.baseVersion).toBeNull()
    expect(b.baseVersion).toBe('v0.1.0')
  })

  it('시간 역순으로 나온다', () => {
    const s = spec('RunOrder')
    const e = saveEnvironment({ specId: s, name: 'DEV', baseUrl: '', production: false, values: [] })
    appendRun(run({ specId: s, environmentId: e.id, requestName: 'first' }))
    appendRun(run({ specId: s, environmentId: e.id, requestName: 'second' }))
    expect(listRuns(s).map((r) => r.requestName)).toEqual(['second', 'first'])
  })

  it('요청·환경·상태 필터가 조합된다', () => {
    const s = spec('RunFilter')
    const e1 = saveEnvironment({ specId: s, name: 'DEV', baseUrl: '', production: false, values: [] })
    const e2 = saveEnvironment({ specId: s, name: 'STG', baseUrl: '', production: false, values: [] })
    appendRun(run({ specId: s, environmentId: e1.id, requestName: 'a', status: 'ok' }))
    appendRun(run({ specId: s, environmentId: e2.id, requestName: 'a', status: 'timeout' }))
    appendRun(run({ specId: s, environmentId: e2.id, requestName: 'b', status: 'ok' }))

    expect(listRuns(s, { requestName: 'a' })).toHaveLength(2)
    expect(listRuns(s, { environmentId: e2.id })).toHaveLength(2)
    expect(listRuns(s, { requestName: 'a', status: 'timeout' })).toHaveLength(1)
  })

  it('명세 스코프다 — 다른 명세의 기록은 안 섞인다', () => {
    const a = spec('RunScopeA')
    const b = spec('RunScopeB')
    const ea = saveEnvironment({ specId: a, name: 'DEV', baseUrl: '', production: false, values: [] })
    const eb = saveEnvironment({ specId: b, name: 'DEV', baseUrl: '', production: false, values: [] })
    appendRun(run({ specId: a, environmentId: ea.id }))
    appendRun(run({ specId: b, environmentId: eb.id }))
    expect(listRuns(a)).toHaveLength(1)
  })

  it('실패 기록도 남는다 — 갈래가 구분된 채로', () => {
    const s = spec('RunFail')
    const e = saveEnvironment({ specId: s, name: 'DEV', baseUrl: '', production: false, values: [] })
    appendRun(run({ specId: s, environmentId: e.id, status: 'connect-failed', httpStatus: null, response: null, error: '붙지 못함' }))
    appendRun(run({ specId: s, environmentId: e.id, status: 'cancelled', httpStatus: null, response: null, error: null }))
    expect(listRuns(s).map((r) => r.status)).toEqual(['cancelled', 'connect-failed'])
  })

  it('상한을 넘기면 오래된 것부터 지우고 건수를 알린다 (조용히 사라지면 안 된다)', () => {
    const s = spec('RunPrune')
    const e = saveEnvironment({ specId: s, name: 'DEV', baseUrl: '', production: false, values: [] })
    for (let i = 0; i < 5; i++) appendRun(run({ specId: s, environmentId: e.id, requestName: `r${i}` }))
    expect(pruneRuns(s, 3)).toEqual({ removed: 2 })
    expect(listRuns(s).map((r) => r.requestName)).toEqual(['r4', 'r3', 'r2'])
    expect(pruneRuns(s, 3)).toEqual({ removed: 0 })
  })
})
