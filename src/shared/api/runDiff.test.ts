import { describe, expect, it } from 'vitest'
import { diffRuns, flatten, summarizeRunDiff } from './runDiff'
import type { RunRecord } from './types'

/** TestPlan: api-runner · CASE-apirunner-036 (history.list AC-4). */

const run = (body: string, over: Partial<RunRecord> = {}): RunRecord => ({
  id: `run_${body.length}_${Math.abs(body.length)}`,
  specId: 's1',
  requestName: 'getUser',
  environmentId: 'e1',
  environmentName: 'DEV',
  baseVersion: null,
  shape: 'unary',
  call: {},
  status: 'ok',
  httpStatus: 200,
  durationMs: 10,
  createdAt: '2026-07-29T00:00:00.000Z',
  request: { method: 'GET', url: '/u', headers: {}, body: '' },
  response: { status: 200, headers: {}, body, size: body.length },
  messages: null,
  messageCount: null,
  error: null,
  ...over
})

describe('본문 펴기', () => {
  it('중첩 객체를 점 경로로 편다', () => {
    expect([...flatten({ user: { id: 'x' } })]).toEqual([['user.id', 'x']])
  })

  it('배열은 자리번호가 경로에 들어간다 — 순서가 바뀐 것도 달라진 것이다', () => {
    expect([...flatten({ tags: ['a', 'b'] })]).toEqual([
      ['tags[0]', 'a'],
      ['tags[1]', 'b']
    ])
  })

  it('null 은 값이다 — "없음" 과 다르므로 경로가 남는다', () => {
    expect([...flatten({ memo: null })]).toEqual([['memo', 'null']])
  })

  it('스칼라 본문도 경로 하나를 갖는다', () => {
    expect([...flatten(3)]).toEqual([['(본문)', '3']])
  })
})

describe('두 Run 비교 (CASE-apirunner-036)', () => {
  it('새로 생긴 · 없어진 · 달라진 필드를 각각 가려낸다', () => {
    const d = diffRuns(run('{"id":"x","gone":1,"n":1}'), run('{"id":"x","fresh":2,"n":9}'))
    expect(d.unavailable).toBeNull()
    expect(d.fields).toEqual([
      { kind: 'removed', path: 'gone', before: '1' },
      { kind: 'changed', path: 'n', before: '1', after: '9' },
      { kind: 'added', path: 'fresh', after: '2' }
    ])
  })

  it('**순서가 뜻을 갖는다** — 뒤바꾸면 새로 생김과 없어짐이 뒤집힌다', () => {
    const a = run('{"only":1}')
    const b = run('{}')
    expect(diffRuns(a, b).fields[0].kind).toBe('removed')
    expect(diffRuns(b, a).fields[0].kind).toBe('added')
  })

  it('같은 응답이면 필드 차이가 없다', () => {
    expect(diffRuns(run('{"id":"x"}'), run('{"id":"x"}')).fields).toEqual([])
  })

  it('중첩 안까지 경로와 함께 들어간다', () => {
    const d = diffRuns(run('{"user":{"email":"a@b"}}'), run('{"user":{"email":"c@d"}}'))
    expect(d.fields[0]).toMatchObject({ path: 'user.email', before: 'a@b', after: 'c@d' })
  })

  it('응답 밖(상태·버전·환경)의 차이도 따로 센다 — 본문이 같아도 이건 다를 수 있다', () => {
    const d = diffRuns(run('{}'), run('{}', { status: 'http-error', httpStatus: 500 }))
    expect(d.fields).toEqual([])
    expect(d.meta.map((m) => m.path)).toEqual(['상태', 'HTTP 상태'])
  })

  it('**JSON 이 아니면 "같다"로 넘기지 않는다** — 못 쪼갰다는 사실을 남긴다', () => {
    const same = diffRuns(run('<html/>'), run('<html/>'))
    expect(same.unavailable).toContain('JSON 이 아니라')
    expect(same.unavailable).toContain('같습니다')
    expect(same.fields).toEqual([])

    const diff = diffRuns(run('<html/>'), run('<xml/>'))
    expect(diff.unavailable).toContain('다릅니다')
  })

  it('한쪽에 응답이 없으면(못 붙음·스트림) 비교 불가다', () => {
    const failed = run('', { status: 'connect-failed', response: null, httpStatus: null })
    expect(diffRuns(run('{}'), failed).unavailable).toContain('응답이 없습니다')
  })

  it('요약은 비교가 실제로 돌았을 때만 "같습니다" 를 만든다', () => {
    expect(summarizeRunDiff(diffRuns(run('{"a":1}'), run('{"a":1}')))).toContain('같습니다')
    expect(summarizeRunDiff(diffRuns(run('<x/>'), run('<x/>')))).toContain('비교 불가')
    expect(summarizeRunDiff(diffRuns(run('<x/>'), run('<x/>')))).not.toContain('같습니다')
  })

  it('요약에 갈래별 건수가 실린다', () => {
    const s = summarizeRunDiff(diffRuns(run('{"gone":1,"n":1}'), run('{"n":2,"fresh":3}')))
    expect(s).toContain('없어짐 1')
    expect(s).toContain('값이 달라짐 1')
    expect(s).toContain('새로 생김 1')
  })
})
