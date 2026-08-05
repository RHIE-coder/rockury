import { describe, expect, it } from 'vitest'
import {
  findSampleConnection,
  planSample,
  sampleButtonLabel,
  samplePaths,
  type SampleStatus
} from './samplePlan'

const PATH = '/Users/me/Library/Application Support/Rockury/samples/sample.sqlite'

function status(over: Partial<SampleStatus> = {}): SampleStatus {
  return { path: PATH, fileExists: false, connectionId: null, ...over }
}

describe('planSample — 파일·접속을 따로 판정한다 (CASE-conn-040)', () => {
  it('둘 다 없으면 둘 다 만든다', () => {
    expect(planSample(status())).toBe('create-both')
  })

  it('파일만 있으면 접속만 만든다 — 기존 파일을 덮지 않는다', () => {
    expect(planSample(status({ fileExists: true }))).toBe('create-connection')
  })

  it('접속만 있으면 파일만 만든다', () => {
    expect(planSample(status({ connectionId: 'conn_1' }))).toBe('create-file')
  })

  it('둘 다 있으면 다시 만들기로 넘긴다', () => {
    expect(planSample(status({ fileExists: true, connectionId: 'conn_1' }))).toBe('reset')
  })
})

describe('findSampleConnection — 이름이 아니라 경로로 판정한다', () => {
  const conn = (id: string, dbType: string, database: string, name = '샘플 DB') => ({
    id,
    name,
    dbType,
    database
  })

  it('이름이 바뀌어 있어도 같은 경로면 우리 것이다 (CASE-conn-041)', () => {
    const rows = [conn('conn_1', 'sqlite', PATH, '내 샘플')]
    expect(findSampleConnection(rows, PATH)).toBe('conn_1')
  })

  it('이름이 같아도 경로가 다르면 남의 접속이다 (CASE-conn-042)', () => {
    const rows = [conn('conn_1', 'sqlite', '/tmp/other.sqlite')]
    expect(findSampleConnection(rows, PATH)).toBeNull()
  })

  it('경로가 같아도 sqlite 가 아니면 아니다', () => {
    const rows = [conn('conn_1', 'postgresql', PATH)]
    expect(findSampleConnection(rows, PATH)).toBeNull()
  })

  it('없으면 null', () => {
    expect(findSampleConnection([], PATH)).toBeNull()
  })

  it('여럿이면 가장 먼저 만든 것을 쓴다 — 새로 만들지 않는다', () => {
    const rows = [conn('conn_1', 'sqlite', PATH), conn('conn_2', 'sqlite', PATH)]
    expect(findSampleConnection(rows, PATH)).toBe('conn_1')
  })
})

describe('samplePaths — 곁 파일까지 함께 다룬다 (CASE-conn-043)', () => {
  it('본 파일과 WAL 곁 파일 둘을 함께 낸다', () => {
    expect(samplePaths(PATH)).toEqual([PATH, `${PATH}-wal`, `${PATH}-shm`])
  })
})

describe('sampleButtonLabel — 라벨이 상태를 말한다 (CASE-conn-044)', () => {
  it('접속이 없으면 만들기', () => {
    expect(sampleButtonLabel(status())).toBe('샘플 DB 만들기')
    // 파일만 남아 있어도 아직 접속이 없으니 '만들기' 다.
    expect(sampleButtonLabel(status({ fileExists: true }))).toBe('샘플 DB 만들기')
  })

  it('접속이 있으면 다시 만들기', () => {
    expect(sampleButtonLabel(status({ connectionId: 'conn_1' }))).toBe('샘플 DB 다시 만들기')
    expect(sampleButtonLabel(status({ fileExists: true, connectionId: 'conn_1' }))).toBe(
      '샘플 DB 다시 만들기'
    )
  })
})
