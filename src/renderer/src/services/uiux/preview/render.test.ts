import { describe, expect, it } from 'vitest'
import { COMPONENT_TEMPLATES, FALLBACK_TEMPLATE, templateFor } from './components'
import { COMPONENT_KINDS } from '../catalog'
import { layoutStyle } from './layout'
import { isolateTemplate, renderSurface, splitTemplate, withNodeId } from './render'
import { DEFAULT_TOKENS, tokenVarName, VIEWPORT_WIDTH } from './tokens'
import { renderTemplate } from './template'
import type { SurfaceContent } from '../types'

/** 정의: `docs/qa/uiux-ia.md` S8 (CASE-uiux-070~077) · 명세: `docs/spec/uiux-ia.md` §6. */

describe('토큰이 렌더를 지배한다', () => {
  it('CASE-uiux-070 고르기 목록의 모든 종류에 조각이 있다 (빈칸이면 대체 조각으로 떨어진다)', () => {
    for (const kind of COMPONENT_KINDS) {
      expect(COMPONENT_TEMPLATES[kind.type], `${kind.type} 조각 없음`).toBeTruthy()
    }
  })

  it('CASE-uiux-071 조각 CSS 에 하드코딩된 색·길이가 없다 — 있으면 토큰을 바꿔도 안 따라온다', () => {
    const literal = /(#[0-9a-f]{3,8}\b)|(\brgba?\()|(\bhsla?\()|(\b\d+(\.\d+)?(px|rem|em|pt)\b)/i
    for (const [type, template] of Object.entries({ ...COMPONENT_TEMPLATES, __fallback: FALLBACK_TEMPLATE })) {
      const { style } = splitTemplate(template)
      // 토큰 참조·계산식 안의 것은 제외하고 남은 리터럴만 본다.
      const stripped = style.replace(/var\(--t-[\w-]+\)/g, '').replace(/calc\([^)]*\)/g, '')
      const hit = stripped.match(literal)
      expect(hit?.[0], `${type} 조각에 하드코딩: ${hit?.[0]}`).toBeUndefined()
    }
  })

  it('CASE-uiux-071 조각이 쓰는 토큰 변수가 기본 토큰에 전부 있다 (죽은 변수 = 안 먹는 스타일)', () => {
    const known = new Set(Object.keys(DEFAULT_TOKENS).map(tokenVarName))
    for (const [type, template] of Object.entries(COMPONENT_TEMPLATES)) {
      for (const ref of template.match(/--t-[\w-]+/g) ?? []) {
        expect(known.has(ref), `${type} 이 모르는 토큰 ${ref} 를 쓴다`).toBe(true)
      }
    }
  })

  it('CASE-uiux-072 모르는 종류는 대체 조각으로 떨어진다 — 화면에 구멍을 내지 않는다', () => {
    expect(templateFor('전혀-모르는-것')).toBe(FALLBACK_TEMPLATE)
    expect(templateFor('button')).toBe(COMPONENT_TEMPLATES.button)
  })

  it('CASE-uiux-072 모든 조각이 값 없이도 그려진다 (막 만든 컴포넌트는 이름표도 없다)', () => {
    for (const [type, template] of Object.entries(COMPONENT_TEMPLATES)) {
      const { markup } = splitTemplate(template)
      const out = renderTemplate(markup, {})
      expect(out, `${type} 이 비었다`).not.toBe('')
      expect(out, `${type} 에 치환 안 된 슬롯이 남았다`).not.toContain('{{')
    }
  })
})

describe('조각 가르기·스코프', () => {
  it('CASE-uiux-073 마크업과 스타일을 가른다', () => {
    const { markup, style } = splitTemplate('<b>x</b><style>.c{color:red}</style>')
    expect(markup).toBe('<b>x</b>')
    expect(style).toBe('.c{color:red}')
    expect(splitTemplate('<b>x</b>').style).toBe('')
  })

  it('CASE-uiux-073 클래스 이름을 조각별로 고유하게 바꾼다 — 마크업과 CSS 를 같은 규칙으로', () => {
    const { markup, style } = isolateTemplate('<b class="c">x</b><style>.c{color:var(--t-color-fg)}</style>', 't-button')
    expect(markup).toBe('<b class="t-button-c">x</b>')
    expect(style).toBe('.t-button-c{color:var(--t-color-fg)}')
  })

  it('CASE-uiux-073 감싸는 상자를 만들지 않는다 — 배치가 밀리면 잰 자리도 그 껍데기 것이 된다', () => {
    const { markup } = isolateTemplate('<i class="a b">x</i>', 't-x')
    expect(markup).toBe('<i class="t-x-a t-x-b">x</i>')
  })

  it('CASE-uiux-073 CSS 에만 있고 마크업에 없는 이름은 건드리지 않는다 (어차피 아무것도 안 잡는다)', () => {
    const { style } = isolateTemplate('<b class="c">x</b><style>.c{color:red}.없는것{color:blue}</style>', 't-y')
    expect(style).toContain('.t-y-c{')
    expect(style).toContain('.없는것{')
  })

  it('CASE-uiux-073 조각 첫 태그에 요소 id 를 심는다 (끌어놓기·고르기의 손잡이)', () => {
    expect(withNodeId('<b class="c">x</b>', 'email')).toBe('<b data-uiux-node="email" class="c">x</b>')
    expect(withNodeId('<input />', 'a-1')).toBe('<input data-uiux-node="a-1" />')
  })
})

describe('배치 → CSS', () => {
  it('CASE-uiux-074 기본은 세로 쌓기, 가로는 기본 줄바꿈 (좁은 폭에서 안 깨지게)', () => {
    expect(layoutStyle()).toContain('flex-direction:column')
    expect(layoutStyle({ type: 'row' })).toContain('flex-wrap:wrap')
    expect(layoutStyle({ type: 'row', wrap: false })).not.toContain('flex-wrap')
  })

  it('CASE-uiux-074 격자는 칸 수를 반영하고 범위를 벗어난 값은 접는다', () => {
    expect(layoutStyle({ type: 'grid' })).toContain('repeat(2,minmax(0,1fr))')
    expect(layoutStyle({ type: 'grid', columns: 4 })).toContain('repeat(4,')
    expect(layoutStyle({ type: 'grid', columns: 0 })).toContain('repeat(1,')
    expect(layoutStyle({ type: 'grid', columns: 99 })).toContain('repeat(12,')
  })

  it('CASE-uiux-074 간격은 토큰 경로면 변수로, 길이면 그대로', () => {
    expect(layoutStyle({ gap: 'space.lg' })).toContain('gap:var(--t-space-lg)')
    expect(layoutStyle({ gap: '12px' })).toContain('gap:12px')
    expect(layoutStyle({})).toContain('gap:var(--t-space-md)')
  })
})

describe('화면 그리기', () => {
  const sample: SurfaceContent = {
    sections: [
      {
        id: 'form',
        name: '입력',
        showLabel: true,
        layout: { type: 'grid', columns: 2 },
        components: [
          { id: 'email', type: 'input', label: '이메일', props: { placeholder: 'you@site.com' } },
          { id: 'submit', type: 'button', label: '로그인', props: { variant: 'outline' } }
        ]
      }
    ]
  }

  it('CASE-uiux-075 구조대로 그리고, 쓰인 조각의 CSS 만 모은다', () => {
    const { html, css } = renderSurface(sample)
    expect(html).toContain('이메일')
    expect(html).toContain('you@site.com')
    expect(html).toContain('data-variant="outline"')
    expect(css).toContain('.t-input')
    expect(css).toContain('.t-button')
    // 안 쓴 조각의 CSS 는 실리지 않는다.
    expect(css).not.toContain('.t-table')
  })

  it('CASE-uiux-075 요소마다 id 가 심기고 영역에도 표시가 붙는다 (끌어놓기가 잴 대상)', () => {
    const { html } = renderSurface(sample)
    expect(html).toContain('data-uiux-node="email"')
    expect(html).toContain('data-uiux-node="submit"')
    expect(html).toContain('data-uiux-section="form"')
    expect(html).toContain('data-uiux-body="form"')
  })

  it('CASE-uiux-077 고른 요소는 외곽선, 끌고 있는 요소는 흐리게', () => {
    const { css } = renderSurface(sample, { selectedId: 'email', draggingId: 'submit' })
    expect(css).toContain('[data-uiux-node="email"]{outline')
    expect(css).toContain('[data-uiux-node="submit"]{opacity')
    expect(renderSurface(sample).css).not.toContain('outline:2px')
  })

  it('CASE-uiux-075 섹션 이름은 켰을 때만 보인다', () => {
    expect(renderSurface(sample).html).toContain('입력')
    const hidden: SurfaceContent = { sections: [{ ...sample.sections[0], showLabel: false }] }
    expect(renderSurface(hidden).html).not.toContain('sec-name')
  })

  it('CASE-uiux-075 토큰이 뿌리에 실린다', () => {
    expect(renderSurface(sample).css).toContain('--t-color-primary: #2563eb;')
  })

  it('CASE-uiux-076 빈 화면·이상한 내용에도 던지지 않는다', () => {
    expect(() => renderSurface({ sections: [] })).not.toThrow()
    expect(() =>
      renderSurface({ sections: [{ id: 's', name: '', components: [{ id: 'x', type: '이상한 것<>' }] }] })
    ).not.toThrow()
    // 클래스에 들어가는 종류 이름은 CSS 에서 안전한 글자로 바뀐다.
    expect(renderSurface({ sections: [{ id: 's', name: '', components: [{ id: 'x', type: 'a b' }] }] }).html).toContain(
      'class="t-a_b-c"'
    )
  })

  it('CASE-uiux-076 뷰포트 폭은 좁아지는 순서다 (같은 화면을 다른 폭으로 본다)', () => {
    expect(VIEWPORT_WIDTH.pc).toBeGreaterThan(VIEWPORT_WIDTH.tablet)
    expect(VIEWPORT_WIDTH.tablet).toBeGreaterThan(VIEWPORT_WIDTH.mobile)
  })
})
