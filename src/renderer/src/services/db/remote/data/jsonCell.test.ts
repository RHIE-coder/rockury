import { describe, expect, it } from 'vitest'
import { compactJson, jsonError, prettyJson, summarizeJson } from './jsonCell'

describe('summarizeJson', () => {
  it('객체는 키 수를 센다', () => {
    const s = summarizeJson('{"a":1,"b":2,"c":3}')
    expect(s.shape).toBe('object')
    expect(s.count).toBe(3)
    expect(s.chip).toBe('{} 3')
    expect(s.label).toBe('객체 · 키 3개')
  })

  it('배열은 항목 수를 센다', () => {
    const s = summarizeJson('[1,2,3,4]')
    expect(s.shape).toBe('array')
    expect(s.count).toBe(4)
    expect(s.chip).toBe('[] 4')
    expect(s.label).toBe('배열 · 항목 4개')
  })

  it('정렬돼 저장된 값도 미리보기는 한 줄로 눌러 보인다', () => {
    const s = summarizeJson('{\n  "a": 1,\n  "b": 2\n}')
    expect(s.preview).toBe('{"a":1,"b":2}')
  })

  it('미리보기는 길이 상한에서 잘리고 말줄임을 붙인다', () => {
    const long = JSON.stringify({ text: 'x'.repeat(500) })
    const s = summarizeJson(long, 40)
    expect(s.preview).toHaveLength(41) // 40 + '…'
    expect(s.preview.endsWith('…')).toBe(true)
  })

  it('빈 문자열은 빈 값', () => {
    const s = summarizeJson('   ')
    expect(s.shape).toBe('empty')
    expect(s.preview).toBe('')
  })

  it('깨진 JSON 은 invalid 로 표시하되 원문 미리보기는 남긴다', () => {
    const s = summarizeJson('{"a":')
    expect(s.shape).toBe('invalid')
    expect(s.chip).toBe('!')
    expect(s.preview).toBe('{"a":')
    expect(s.label).toBe('잘못된 JSON')
  })

  it('스칼라(문자열·숫자)도 다룬다', () => {
    expect(summarizeJson('42').shape).toBe('scalar')
    expect(summarizeJson('"hello"').shape).toBe('scalar')
    // JSON 의 null 은 스칼라 — 셀의 SQL NULL 과는 다른 값이다.
    expect(summarizeJson('null').shape).toBe('scalar')
  })
})

describe('jsonError', () => {
  it('유효하면 null', () => {
    expect(jsonError('{"a":1}')).toBeNull()
  })
  it('빈 값은 오류로 보지 않는다', () => {
    expect(jsonError('  ')).toBeNull()
  })
  it('깨졌으면 메시지', () => {
    expect(jsonError('{oops}')).toBeTruthy()
  })
})

describe('prettyJson / compactJson', () => {
  it('정렬은 들여쓰기를 넣고 압축은 한 줄로 되돌린다', () => {
    const compact = '{"a":1,"b":[1,2]}'
    const pretty = prettyJson(compact)
    expect(pretty).toContain('\n')
    expect(pretty).toContain('  "a": 1')
    expect(compactJson(pretty)).toBe(compact)
  })

  it('깨진 JSON 은 손대지 않고 원문을 돌려준다(사용자가 고칠 수 있게)', () => {
    expect(prettyJson('{broken')).toBe('{broken')
    expect(compactJson('{broken')).toBe('{broken')
  })
})
