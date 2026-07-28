import { describe, expect, it } from 'vitest'
import { escapeHtml, renderTemplate } from './template'

/** 정의: `docs/qa/uiux-ia.md` S7 (CASE-uiux-060~064) · 명세: `docs/spec/uiux-ia.md` §6. */

describe('값 넣기', () => {
  it('CASE-uiux-060 label 과 props 를 슬롯에 넣는다', () => {
    expect(renderTemplate('<b>{{label}}</b>', { label: '로그인' })).toBe('<b>로그인</b>')
    expect(renderTemplate('<i placeholder="{{props.placeholder}}">', { props: { placeholder: '이메일' } })).toBe(
      '<i placeholder="이메일">'
    )
  })

  it('CASE-uiux-060 값이 없으면 빈 문자열 — 조각에 {{...}} 가 그대로 남지 않는다', () => {
    expect(renderTemplate('<b>{{label}}</b>', {})).toBe('<b></b>')
    expect(renderTemplate('<b>{{props.없음}}</b>', { props: {} })).toBe('<b></b>')
  })

  it('CASE-uiux-060 숫자·불리언은 글자로, 객체는 비운다 ([object Object] 방지)', () => {
    expect(renderTemplate('{{props.n}}', { props: { n: 3 } })).toBe('3')
    expect(renderTemplate('{{props.b}}', { props: { b: true } })).toBe('true')
    expect(renderTemplate('{{props.o}}', { props: { o: { a: 1 } } })).toBe('')
    expect(renderTemplate('{{props.f}}', { props: { f: false } })).toBe('')
  })

  it('CASE-uiux-061 사용자 입력을 이스케이프한다 — 없으면 이름표가 그대로 마크업이 된다', () => {
    const out = renderTemplate('<b>{{label}}</b>', { label: '<img src=x onerror=alert(1)>' })
    expect(out).toBe('<b>&lt;img src=x onerror=alert(1)&gt;</b>')
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})

describe('있으면 보이기', () => {
  it('CASE-uiux-062 값이 있으면 내용을, 없으면 통째로 없앤다', () => {
    const t = '<i>{{#props.required}}*{{/props.required}}</i>'
    expect(renderTemplate(t, { props: { required: true } })).toBe('<i>*</i>')
    expect(renderTemplate(t, { props: { required: false } })).toBe('<i></i>')
    expect(renderTemplate(t, { props: {} })).toBe('<i></i>')
  })

  it('CASE-uiux-062 빈 문자열·빈 배열은 "없는 것"으로 본다', () => {
    const t = '{{#props.hint}}[{{props.hint}}]{{/props.hint}}'
    expect(renderTemplate(t, { props: { hint: '' } })).toBe('')
    expect(renderTemplate(t, { props: { hint: '도움말' } })).toBe('[도움말]')
    expect(renderTemplate('{{#props.list}}x{{/props.list}}', { props: { list: [] } })).toBe('')
  })
})

describe('배열 반복', () => {
  it('CASE-uiux-063 항목마다 반복하고 {{.}} 에 지금 항목을 넣는다', () => {
    const t = '<ul>{{#props.options}}<li>{{.}}</li>{{/props.options}}</ul>'
    expect(renderTemplate(t, { props: { options: ['가', '나'] } })).toBe('<ul><li>가</li><li>나</li></ul>')
  })

  it('CASE-uiux-063 반복 항목도 이스케이프한다', () => {
    const t = '{{#props.options}}<li>{{.}}</li>{{/props.options}}'
    expect(renderTemplate(t, { props: { options: ['<b>'] } })).toBe('<li>&lt;b&gt;</li>')
  })

  it('CASE-uiux-063 숫자 배열도 그린다', () => {
    expect(renderTemplate('{{#props.n}}[{{.}}]{{/props.n}}', { props: { n: [1, 2] } })).toBe('[1][2]')
  })
})

describe('망가진 조각', () => {
  it('CASE-uiux-064 어떤 입력에도 던지지 않는다 — 조각은 사용자가 고칠 수 있다', () => {
    for (const bad of ['{{', '{{#props.a}}닫히지 않음', '{{/props.a}}', '{{a b}}', '']) {
      expect(() => renderTemplate(bad, { label: 'x' }), bad).not.toThrow()
    }
    // 닫히지 않은 섹션은 치환되지 않고 그대로 남는다(무엇이 잘못됐는지 보이게).
    expect(renderTemplate('{{#props.a}}열림', { props: { a: true } })).toContain('열림')
  })
})
