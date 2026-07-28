import { describe, expect, it } from 'vitest'
import { EMPTY_CONTENT, parseContent, serializeContent } from './content'
import type { SurfaceContent } from './types'

/** 정의: `docs/qa/uiux-ia.md` S4 (CASE-uiux-030~033) · 명세: `docs/spec/uiux-ia.md` §7 INV-3. */
describe('화면 내용 읽기 — 어떤 입력에도 던지지 않는다 (INV-3)', () => {
  it('CASE-uiux-030 빈 값·깨진 JSON·객체가 아닌 것은 빈 내용으로', () => {
    for (const bad of ['', null, undefined, '{', 'null', '[]', '"문자열"', '42']) {
      expect(parseContent(bad as string), String(bad)).toEqual(EMPTY_CONTENT)
    }
  })

  it('CASE-uiux-031 sections 가 배열이 아니면 빈 목록으로 살린다 (나머지 필드는 남는다)', () => {
    const c = parseContent('{"sections":{"a":1},"layout":{"type":"row"}}')
    expect(c.sections).toEqual([])
    expect(c.layout).toEqual({ type: 'row' })
  })

  it('CASE-uiux-031 id 없는 섹션·컴포넌트는 걸러내고 나머지는 살린다', () => {
    const raw = JSON.stringify({
      sections: [
        { id: 'form', name: '입력', components: [{ id: 'email', type: 'input' }, { type: 'button' }, { id: 'x' }] },
        { name: 'id 없음', components: [] },
        'section 이 아님'
      ]
    })
    const c = parseContent(raw)
    expect(c.sections.map((s) => s.id)).toEqual(['form'])
    // type 없는 컴포넌트(`{id:'x'}`)도 렌더할 수 없으므로 함께 걸린다.
    expect(c.sections[0].components.map((x) => x.id)).toEqual(['email'])
  })

  it('CASE-uiux-031 components 가 없으면 빈 목록, name 이 없으면 빈 문자열', () => {
    const c = parseContent('{"sections":[{"id":"s1"}]}')
    expect(c.sections[0].components).toEqual([])
    expect(c.sections[0].name).toBe('')
  })

  it('CASE-uiux-032 효과가 하나도 없는 이벤트는 버린다 (아무 일도 안 하는 껍데기)', () => {
    const raw = JSON.stringify({
      sections: [],
      events: [
        { trigger: { component: 'submit', event: 'click' }, nav: { to: 'a.b.c.d' } },
        { trigger: { component: 'x', event: 'click' } },
        { nav: { to: 'a.b.c.d' } },
        'event 가 아님'
      ]
    })
    expect(parseContent(raw).events).toHaveLength(1)
  })

  it('CASE-uiux-032 살아남은 이벤트가 없으면 events 칸 자체를 두지 않는다', () => {
    expect(parseContent('{"sections":[],"events":[]}').events).toBeUndefined()
    expect(parseContent('{"sections":[],"events":"x"}').events).toBeUndefined()
  })
})

describe('화면 내용 쓰기', () => {
  it('CASE-uiux-033 빈 값은 적지 않는다 (diff 를 조용하게)', () => {
    expect(serializeContent(EMPTY_CONTENT)).toBe('{"sections":[]}')
    expect(serializeContent({ sections: [], events: [], viewports: {} })).toBe('{"sections":[]}')
  })

  it('CASE-uiux-033 쓴 것은 그대로 읽힌다 (왕복)', () => {
    const content: SurfaceContent = {
      layout: { type: 'stack', gap: 'semantic.space.md' },
      sections: [
        {
          id: 'form',
          name: '로그인 폼',
          layout: { type: 'grid', columns: 2 },
          components: [
            { id: 'email', type: 'input', label: '이메일', props: { placeholder: 'you@site.com' } },
            { id: 'submit', type: 'button', label: '로그인', rule: { enabled: { default: 'disabled' } } }
          ]
        }
      ],
      events: [{ trigger: { component: 'submit', event: 'click' }, nav: { to: 'coupang.buyer.home.main' } }],
      viewports: { mobile: { layout: { type: 'stack' } } }
    }
    expect(parseContent(serializeContent(content))).toEqual(content)
  })
})
