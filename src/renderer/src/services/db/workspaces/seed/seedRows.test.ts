import { describe, expect, it } from 'vitest'
import {
  isVariableCell,
  matchSeedRows,
  missingRequiredCells,
  naturalKeyLabel,
  naturalKeyOf,
  seedVariables,
  validateSeedRows
} from './seedRows'
import type { SeedRow } from './types'

/** CASE-design-010~013 (docs/qa/db-design.md) */

const row = (id: string, values: Record<string, string | null>): SeedRow => ({ id, values })

describe('CASE-design-010 자연키 구성', () => {
  it('선언 순서대로 이어 하나의 키를 만든다 — 순서가 다르면 키도 다르다', () => {
    const r = row('r1', { org: 'acme', code: 'admin' })
    expect(naturalKeyOf(r, ['org', 'code'])).not.toBe(naturalKeyOf(r, ['code', 'org']))
  })

  it('NULL 과 빈 문자열을 다르게 취급한다', () => {
    expect(naturalKeyOf(row('r1', { code: null }), ['code'])).not.toBe(
      naturalKeyOf(row('r2', { code: '' }), ['code'])
    )
  })

  it('없는 컬럼은 NULL 과 같게 본다', () => {
    expect(naturalKeyOf(row('r1', {}), ['code'])).toBe(naturalKeyOf(row('r2', { code: null }), ['code']))
  })

  it('값에 구분자가 섞여도 서로 다른 행이 같은 키가 되지 않는다', () => {
    const a = row('a', { x: 'a|b', y: 'c' })
    const b = row('b', { x: 'a', y: 'b|c' })
    expect(naturalKeyOf(a, ['x', 'y'])).not.toBe(naturalKeyOf(b, ['x', 'y']))
  })

  it('라벨은 사람이 읽는 한 줄 — 빈 값은 ∅', () => {
    expect(naturalKeyLabel(row('r', { org: 'acme', code: 'admin' }), ['org', 'code'])).toBe('acme · admin')
    expect(naturalKeyLabel(row('r', { code: null }), ['code'])).toBe('∅')
    expect(naturalKeyLabel(row('r', { code: 'x' }), [])).toBe('')
  })
})

describe('CASE-design-011 행 검증(빈 자연키·중복)', () => {
  it('정상 행은 문제가 없다', () => {
    const issues = validateSeedRows([row('r1', { code: 'admin' }), row('r2', { code: 'viewer' })], ['code'])
    expect(issues).toEqual({})
  })

  it('자연키 값이 비면(NULL·빈 문자열·공백) 그 행을 지목한다', () => {
    const issues = validateSeedRows(
      [row('r1', { code: null }), row('r2', { code: '' }), row('r3', { code: '   ' }), row('r4', { code: 'ok' })],
      ['code']
    )
    expect(issues.r1?.kind).toBe('empty-key')
    expect(issues.r2?.kind).toBe('empty-key')
    expect(issues.r3?.kind).toBe('empty-key')
    expect(issues.r4).toBeUndefined()
  })

  it('겹치는 자연키는 양쪽 다 지목한다', () => {
    const issues = validateSeedRows(
      [row('r1', { code: 'admin' }), row('r2', { code: 'admin' }), row('r3', { code: 'viewer' })],
      ['code']
    )
    expect(issues.r1?.kind).toBe('duplicate-key')
    expect(issues.r2?.kind).toBe('duplicate-key')
    expect(issues.r3).toBeUndefined()
  })

  it('복합 자연키는 조합이 같을 때만 중복이다', () => {
    const rows = [
      row('r1', { org: 'acme', code: 'admin' }),
      row('r2', { org: 'other', code: 'admin' }),
      row('r3', { org: 'acme', code: 'admin' })
    ]
    const issues = validateSeedRows(rows, ['org', 'code'])
    expect(issues.r1?.kind).toBe('duplicate-key')
    expect(issues.r3?.kind).toBe('duplicate-key')
    expect(issues.r2).toBeUndefined()
  })

  it('자연키 미선언이면 판정하지 않는다(세트 자체가 비교 불가)', () => {
    expect(validateSeedRows([row('r1', { code: 'a' }), row('r2', { code: 'a' })], [])).toEqual({})
  })
})

describe('CASE-design-012 변수 자리표시자', () => {
  it('bare {{X}} 만 뽑고 따옴표 안은 제외한다', () => {
    const rows = [
      row('r1', { pw: '{{ADMIN_PASSWORD_HASH}}', note: "'{{LITERAL}}'" }),
      row('r2', { pw: '{{ ADMIN_PASSWORD_HASH }}', url: '{{CALLBACK_URL}}' })
    ]
    expect(seedVariables(rows)).toEqual(['ADMIN_PASSWORD_HASH', 'CALLBACK_URL'])
  })

  it('중복 없이 이름순으로 준다', () => {
    expect(seedVariables([row('r1', { a: '{{Z}}', b: '{{A}}', c: '{{Z}}' })])).toEqual(['A', 'Z'])
  })

  it('변수가 없으면 빈 목록 — NULL 셀도 안전하다', () => {
    expect(seedVariables([row('r1', { a: 'plain', b: null })])).toEqual([])
    expect(seedVariables([])).toEqual([])
  })

  it('셀이 통째로 변수인지 가른다(표식용)', () => {
    expect(isVariableCell('{{X}}')).toBe(true)
    expect(isVariableCell('  {{ X }} ')).toBe(true)
    expect(isVariableCell('prefix {{X}}')).toBe(false)
    expect(isVariableCell(null)).toBe(false)
  })
})

describe('CASE-design-013 행 짝짓기', () => {
  it('자연키로 양쪽/왼쪽만/오른쪽만 을 가른다(base 순 → target 전용 순)', () => {
    const base = [row('b1', { code: 'admin' }), row('b2', { code: 'gone' })]
    const target = [row('t1', { code: 'admin' }), row('t2', { code: 'new' })]
    const m = matchSeedRows(base, target, ['code'])
    expect(m.map((x) => [x.base?.id ?? null, x.target?.id ?? null])).toEqual([
      ['b1', 't1'],
      ['b2', null],
      [null, 't2']
    ])
  })

  it('같은 키가 한 목록에 여럿이면 첫 행만 쓴다', () => {
    const base = [row('b1', { code: 'dup' }), row('b2', { code: 'dup' })]
    const m = matchSeedRows(base, [], ['code'])
    expect(m).toHaveLength(1)
    expect(m[0].base?.id).toBe('b1')
  })

  it('빈 목록끼리는 빈 결과', () => {
    expect(matchSeedRows([], [], ['code'])).toEqual([])
  })
})

describe('CASE-design-014 필수 컬럼 빈 셀', () => {
  it('NOT NULL·기본값 없는 컬럼이 비면 그 행·컬럼을 지목한다', () => {
    const rows = [
      row('r1', { email: 'a@b.c', code: 'X' }),
      row('r2', { email: null, code: '' }),
      row('r3', { email: '   ', code: 'Y' })
    ]
    expect(missingRequiredCells(rows, ['email', 'code'])).toEqual({
      r2: ['email', 'code'],
      r3: ['email']
    })
  })

  it('변수 자리표시자는 채운 것으로 본다 — 값은 반영할 때 들어온다', () => {
    expect(missingRequiredCells([row('r1', { pw: '{{ADMIN_PASSWORD_HASH}}' })], ['pw'])).toEqual({})
  })

  it('필수 컬럼이 없으면 아무것도 지목하지 않는다', () => {
    expect(missingRequiredCells([row('r1', {})], [])).toEqual({})
  })
})
