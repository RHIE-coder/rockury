import { describe, expect, it } from 'vitest'
import { collectRules, describeRule, hasRule } from './rules'
import type { SurfaceContent } from './types'

/** CASE-uiux-120~123 · `uiux.rules`. */

describe('규칙을 사람 말로', () => {
  it('CASE-uiux-120 값 제약을 문장으로', () => {
    expect(describeRule({ constraints: { format: 'email' } })).toEqual(['이메일 주소 형식이어야 해요'])
    expect(describeRule({ constraints: { minLength: 8, maxLength: 20 } })).toEqual(['8~20자'])
    expect(describeRule({ constraints: { minLength: 8 } })).toEqual(['8자 이상'])
    expect(describeRule({ constraints: { maxLength: 254 } })).toEqual(['254자까지'])
  })

  it('CASE-uiux-120 모르는 형식은 그대로 보인다 (지어낸 말로 바꾸지 않는다)', () => {
    expect(describeRule({ constraints: { format: 'business-no' } })).toEqual([
      'business-no 형식이어야 해요'
    ])
  })

  it('CASE-uiux-121 검증 시점과 문구', () => {
    expect(describeRule({ validation: { on: 'blur', message: '이메일을 확인해 주세요' } })).toEqual([
      '칸을 벗어날 때 알려요: "이메일을 확인해 주세요"'
    ])
    expect(describeRule({ validation: { on: 'change' } })).toEqual(['입력하는 동안 확인해요'])
    // 시점 없이 문구만 있어도 버리지 않는다.
    expect(describeRule({ validation: { message: '다시 확인해 주세요' } })).toEqual([
      '어긋나면 "다시 확인해 주세요"'
    ])
  })

  it('CASE-uiux-122 활성 조건', () => {
    expect(describeRule({ enabled: { default: 'disabled', requires: 'all-required' } })).toEqual([
      '처음엔 꺼져 있어요',
      '필수 칸이 다 채워지면 켜져요'
    ])
    expect(describeRule({ enabled: { requires: 'valid' } })).toEqual(['입력이 모두 맞으면 켜져요'])
    expect(describeRule({ enabled: { requires: ['email', 'password'] } })).toEqual([
      'email · password 가 채워지면 켜져요'
    ])
    expect(describeRule({ enabled: { when: { description: '관리자만' } } })).toEqual(['조건: 관리자만'])
  })

  it('CASE-uiux-122 여러 축이 함께 있으면 순서대로 이어진다', () => {
    const lines = describeRule({
      constraints: { format: 'email', maxLength: 254 },
      validation: { on: 'blur' },
      enabled: { default: 'disabled' },
      note: 'PCI 범위 밖'
    })
    expect(lines).toEqual([
      '이메일 주소 형식이어야 해요',
      '254자까지',
      '칸을 벗어날 때 확인해요',
      '처음엔 꺼져 있어요',
      'PCI 범위 밖'
    ])
  })

  it('CASE-uiux-123 빈 규칙·없는 규칙은 아무 말도 하지 않는다', () => {
    expect(describeRule(undefined)).toEqual([])
    expect(describeRule({})).toEqual([])
    expect(describeRule({ constraints: {}, validation: {}, enabled: {} })).toEqual([])
    expect(hasRule({})).toBe(false)
    expect(hasRule({ note: '한 줄' })).toBe(true)
  })
})

describe('화면에서 규칙 모으기', () => {
  const content: SurfaceContent = {
    sections: [
      {
        id: 'form',
        name: '입력',
        components: [
          { id: 'email', type: 'input', label: '이메일', rule: { constraints: { format: 'email' } } },
          { id: 'memo', type: 'textarea', label: '메모' },
          { id: 'blank', type: 'input', rule: {} },
          { id: 'submit', type: 'button', label: '로그인', rule: { enabled: { requires: 'all-required' } } }
        ]
      }
    ]
  }
  const meta = { surfaceId: 's1', surfaceName: '로그인', address: 'p.a.s.login' }

  it('CASE-uiux-123 규칙이 있는 요소만 모은다 (빈 껍데기는 뺀다 — "규칙이 많다"는 착시 방지)', () => {
    const rules = collectRules(content, meta)
    expect(rules.map((r) => r.componentId)).toEqual(['email', 'submit'])
    expect(rules[0].lines).toEqual(['이메일 주소 형식이어야 해요'])
    expect(rules[0].address).toBe('p.a.s.login')
  })

  it('CASE-uiux-123 이름표가 없으면 종류를 대신 보인다', () => {
    const c: SurfaceContent = {
      sections: [{ id: 's', name: '', components: [{ id: 'x', type: 'input', rule: { note: '메모' } }] }]
    }
    expect(collectRules(c, meta)[0].componentLabel).toBe('input')
  })

  it('CASE-uiux-123 빈 화면이면 빈 목록', () => {
    expect(collectRules({ sections: [] }, meta)).toEqual([])
  })
})
