import { describe, expect, it } from 'vitest'
import { describeSignature, validateCall, validateParamDefs } from './signature'
import type { ParamDef } from './types'

/** 파라미터 시그니처 — `docs/qa/api-studio.md` S1 (CASE-apistudio-001~004). */

const params: ParamDef[] = [
  { name: 'userId', type: 'string', required: true, description: '조회할 사용자' },
  { name: 'limit', type: 'number', required: false, defaultValue: '20' },
  { name: 'active', type: 'boolean', required: false },
  { name: 'sort', type: 'enum', required: false, enumValues: ['asc', 'desc'] },
  { name: 'filter', type: 'object', required: false },
  { name: 'tags', type: 'array', required: false }
]

describe('CASE-apistudio-001 필수 파라미터 검증', () => {
  it('빠진 필수 파라미터를 이름으로 지목한다', () => {
    const problems = validateCall(params, {})
    expect(problems).toHaveLength(1)
    expect(problems[0].name).toBe('userId')
  })

  it('기본값이 있는 선택 파라미터는 안 넣어도 문제가 아니다', () => {
    expect(validateCall(params, { userId: 'u_1' })).toEqual([])
  })

  it('빈 문자열은 "안 넣음"이 아니다 — 일부러 빈 값을 보내는 것과 구분한다', () => {
    expect(validateCall(params, { userId: '' })).toEqual([])
  })
})

describe('CASE-apistudio-002 타입 검증', () => {
  it('맞는 값은 통과한다', () => {
    expect(
      validateCall(params, {
        userId: 'u_1',
        limit: '10',
        active: 'true',
        sort: 'asc',
        filter: '{"a":1}',
        tags: '["x"]'
      })
    ).toEqual([])
  })

  it('숫자 자리에 숫자가 아닌 값이 오면 그 파라미터를 지목한다', () => {
    const p = validateCall(params, { userId: 'u', limit: '열개' })
    expect(p.map((x) => x.name)).toEqual(['limit'])
    expect(p[0].reason).toMatch(/숫자/)
  })

  it('불리언은 true/false 만 받는다', () => {
    expect(validateCall(params, { userId: 'u', active: '1' })[0].name).toBe('active')
    expect(validateCall(params, { userId: 'u', active: 'false' })).toEqual([])
  })

  it('object 는 JSON 객체, array 는 JSON 배열이어야 한다 — 서로 바뀌면 잡는다', () => {
    expect(validateCall(params, { userId: 'u', filter: '[1]' })[0].name).toBe('filter')
    expect(validateCall(params, { userId: 'u', tags: '{"a":1}' })[0].name).toBe('tags')
    expect(validateCall(params, { userId: 'u', filter: '깨진 json' })[0].name).toBe('filter')
  })

  it('문자열 자리는 무엇이든 받는다', () => {
    expect(validateCall(params, { userId: '{[?' })).toEqual([])
  })

  it('시그니처에 없는 이름을 보내면 알린다 — 오타가 조용히 무시되지 않는다', () => {
    const p = validateCall(params, { userId: 'u', usreId: 'u' })
    expect(p.map((x) => x.name)).toEqual(['usreId'])
  })
})

describe('CASE-apistudio-003 enum 경계', () => {
  it('허용 목록 안은 통과, 밖은 거부하며 허용 목록을 함께 알린다', () => {
    expect(validateCall(params, { userId: 'u', sort: 'desc' })).toEqual([])
    const p = validateCall(params, { userId: 'u', sort: 'sideways' })
    expect(p[0].name).toBe('sort')
    expect(p[0].reason).toMatch(/asc.*desc/)
  })

  it('빈 허용 목록은 정의 자체의 오류다 (어떤 값도 통과 못 하는 파라미터)', () => {
    const bad: ParamDef[] = [{ name: 'x', type: 'enum', required: true, enumValues: [] }]
    expect(validateParamDefs(bad)[0].reason).toMatch(/허용 값/)
  })

  it('이름 중복은 정의 오류다', () => {
    const dup: ParamDef[] = [
      { name: 'a', type: 'string', required: true },
      { name: 'a', type: 'number', required: false }
    ]
    expect(validateParamDefs(dup).map((p) => p.name)).toEqual(['a'])
  })

  it('올바른 정의에는 문제가 없다', () => {
    expect(validateParamDefs(params)).toEqual([])
  })
})

describe('CASE-apistudio-004 시그니처 직렬화 (MCP 응답 형태)', () => {
  it('이름·타입·필수·기본값·설명이 손실 없이 실린다', () => {
    const doc = describeSignature(params)
    expect(doc[0]).toEqual({
      name: 'userId',
      type: 'string',
      required: true,
      description: '조회할 사용자'
    })
    expect(doc[1]).toEqual({ name: 'limit', type: 'number', required: false, defaultValue: '20' })
    expect(doc[3]).toEqual({
      name: 'sort',
      type: 'enum',
      required: false,
      enumValues: ['asc', 'desc']
    })
  })

  it('빈 칸은 키 자체를 넣지 않는다 — AI 가 읽을 때 잡음이 된다', () => {
    expect(describeSignature([{ name: 'a', type: 'string', required: true }])[0]).toEqual({
      name: 'a',
      type: 'string',
      required: true
    })
  })
})
