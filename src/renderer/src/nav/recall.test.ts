import { describe, expect, it } from 'vitest'
import {
  emptyRecall,
  normalizeRecall,
  recallModule,
  recallView,
  rememberModule,
  rememberView
} from './recall'

describe('nav recall — 마지막에 본 자리', () => {
  it('기억이 없으면 아무것도 돌려주지 않는다 (호출한 쪽이 첫 모듈·첫 뷰로 폴백)', () => {
    const r = emptyRecall()
    expect(recallModule(r, 'db')).toBeNull()
    expect(recallView(r, 'db', 'remote')).toBeNull()
  })

  it('모듈마다 따로 기억한다 — Remote 의 뷰가 Migration 의 뷰를 덮지 않는다', () => {
    let r = emptyRecall()
    r = rememberView(r, 'db', 'remote', 'definition')
    r = rememberView(r, 'db', 'migration', 'plan')
    expect(recallView(r, 'db', 'remote')).toBe('definition')
    expect(recallView(r, 'db', 'migration')).toBe('plan')
  })

  it('서비스마다 따로 기억한다 — 같은 이름의 모듈이 서로를 덮지 않는다', () => {
    let r = emptyRecall()
    r = rememberView(r, 'db', 'design', 'seed')
    r = rememberView(r, 'api', 'design', 'mocking')
    expect(recallView(r, 'db', 'design')).toBe('seed')
    expect(recallView(r, 'api', 'design')).toBe('mocking')
  })

  it('서비스의 마지막 모듈도 기억한다', () => {
    const r = rememberModule(emptyRecall(), 'db', 'remote')
    expect(recallModule(r, 'db')).toBe('remote')
    expect(recallModule(r, 'api')).toBeNull()
  })

  it('나중에 본 것이 앞의 기억을 덮는다', () => {
    let r = rememberView(emptyRecall(), 'db', 'remote', 'connections')
    r = rememberView(r, 'db', 'remote', 'data')
    expect(recallView(r, 'db', 'remote')).toBe('data')
  })

  it('뷰가 없는 모듈(null)로 들어오면 그 모듈의 기억을 지운다', () => {
    let r = rememberView(emptyRecall(), 'infra', 'middleware', 'console')
    r = rememberView(r, 'infra', 'middleware', null)
    expect(recallView(r, 'infra', 'middleware')).toBeNull()
  })

  it('값이 그대로면 같은 객체를 돌려준다 — 클릭마다 헛저장·헛리렌더를 만들지 않는다', () => {
    const r = rememberView(rememberModule(emptyRecall(), 'db', 'remote'), 'db', 'remote', 'data')
    expect(rememberModule(r, 'db', 'remote')).toBe(r)
    expect(rememberView(r, 'db', 'remote', 'data')).toBe(r)
    expect(rememberView(r, 'db', 'versions', null)).toBe(r)
  })

  it('저장본이 없거나 모양이 어긋나도 빈 기억으로 살아난다', () => {
    expect(normalizeRecall(undefined)).toEqual(emptyRecall())
    expect(normalizeRecall(null)).toEqual(emptyRecall())
    expect(normalizeRecall('망가진 값')).toEqual(emptyRecall())
    expect(normalizeRecall({ module: 'nope', view: 42 })).toEqual(emptyRecall())
  })

  it('저장본에서 문자열 항목만 살린다 — 한 칸이 깨져도 나머지 기억은 남는다', () => {
    const r = normalizeRecall({
      module: { db: 'remote', api: 7 },
      view: { 'db/remote': 'data', 'db/design': '', 'api/runner': null }
    })
    expect(r).toEqual({ module: { db: 'remote' }, view: { 'db/remote': 'data' } })
  })
})
