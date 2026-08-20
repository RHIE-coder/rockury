import type { SurfaceContent } from '../types'
import { templateFor } from './components'
import { layoutStyle } from './layout'
import { escapeHtml, renderTemplate } from './template'
import { tokenCss, type TokenMap } from './tokens'

/**
 * 화면 구조 → 실제 화면
 *
 * 조각마다 `<style>` 을 그대로 붙이면 클래스 이름이 겹쳐 서로를 덮는다(여러 조각이 `.c`·`.f` 를
 * 쓴다). 그렇다고 인스턴스마다 그림자 뿌리를 하나씩 만들면 화면 하나에 수십 개가 생긴다.
 * 그래서 **조각별로 클래스 이름 자체를 고유하게 바꾼다**(`.c` → `.t-button-c`) — 겹침도 막고
 * 감싸는 상자도 안 생긴다.
 *
 * 감싸는 상자를 안 만드는 게 중요하다: 끌어놓기가 요소의 **실제 자리**를 재야 하는데, 껍데기를
 * 하나 끼우면 배치가 한 단계 밀리고(가로 배치에서 폭이 0 이 되는 등) 잰 값도 그 껍데기 것이 된다.
 */

export interface RenderedSurface {
  html: string
  css: string
}

export interface RenderOptions {
  tokens?: TokenMap
  /** 고른 요소 — 외곽선으로 표시한다. */
  selectedId?: string | null
  /** 끌고 있는 요소 — 흐리게 해 "지금 이걸 옮기는 중"을 보인다. */
  draggingId?: string | null
  /** 의견(핀)이 달린 요소 — 점선으로 표시한다. **개수·내용은 옆 목록에서 본다** — 미리보기 위에
   *  말풍선을 띄우면 화면이 가려져 무엇을 고치라는 건지 되레 안 보인다. */
  pinnedIds?: string[]
}

/** 조각을 마크업과 스타일로 가른다. `<style>` 이 없으면 스타일은 빈 문자열. */
export function splitTemplate(template: string): { markup: string; style: string } {
  const styles: string[] = []
  const markup = template
    .replace(/<style>([\s\S]*?)<\/style>/g, (_all, css: string) => {
      styles.push(css)
      return ''
    })
    .trim()
  return { markup, style: styles.join('\n') }
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 조각 안의 클래스 이름에 조각 이름을 붙여 고유하게 만든다 — 마크업과 CSS 를 같은 규칙으로.
 * 마크업에 실제로 쓰인 이름만 바꾼다(CSS 에만 있는 이름은 어차피 아무것도 안 잡는다).
 */
export function isolateTemplate(
  template: string,
  scope: string
): { markup: string; style: string } {
  const { markup, style } = splitTemplate(template)
  const names = new Set(
    [...markup.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].trim().split(/\s+/)).filter(Boolean)
  )

  const scopedMarkup = markup.replace(
    /class="([^"]+)"/g,
    (_all, list: string) =>
      `class="${list
        .trim()
        .split(/\s+/)
        .map((n) => `${scope}-${n}`)
        .join(' ')}"`
  )

  let scopedStyle = style
  for (const name of names) {
    scopedStyle = scopedStyle.replace(new RegExp(`\\.${escapeRe(name)}\\b`, 'g'), `.${scope}-${name}`)
  }
  return { markup: scopedMarkup, style: scopedStyle }
}

/**
 * 조각의 첫 태그에 요소 id 를 심는다. 끌어놓기·고르기가 "지금 만진 게 무엇인지" 알아내는 유일한
 * 손잡이다 — 그림자 뿌리 안에서도 이벤트 경로를 타고 밖에서 읽힌다.
 */
export function withNodeId(markup: string, id: string): string {
  return markup.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 data-uiux-node="${escapeHtml(id)}"`)
}

export function renderSurface(content: SurfaceContent, options: RenderOptions = {}): RenderedSurface {
  const usedTypes = new Set<string>()

  const sections = (content.sections ?? []).map((section) => {
    const items = (section.components ?? []).map((component) => {
      usedTypes.add(component.type)
      const scope = `t-${cssSafe(component.type)}`
      const { markup } = isolateTemplate(templateFor(component.type), scope)
      const rendered = renderTemplate(markup, { label: component.label, props: component.props })
      return withNodeId(rendered, component.id)
    })

    const caption = section.showLabel
      ? `<div class="sec-name">${escapeHtml(section.name ?? '')}</div>`
      : ''
    const layout = layoutStyle(section.layout)
    return `<section class="sec" data-uiux-section="${escapeHtml(section.id)}">${caption}<div class="sec-body" data-uiux-body="${escapeHtml(section.id)}" style="${layout}">${items.join('')}</div></section>`
  })

  const scoped = [...usedTypes]
    .map((type) => isolateTemplate(templateFor(type), `t-${cssSafe(type)}`).style)
    .join('\n')

  const marks = [
    options.selectedId
      ? `[data-uiux-node="${cssQuote(options.selectedId)}"]{outline:2px solid var(--t-color-primary);outline-offset:2px}`
      : '',
    options.draggingId
      ? `[data-uiux-node="${cssQuote(options.draggingId)}"]{opacity:0.4}`
      : '',
    (options.pinnedIds ?? [])
      .map(
        (id) =>
          `[data-uiux-node="${cssQuote(id)}"]{outline:2px dashed var(--t-color-danger);outline-offset:2px}`
      )
      .join('\n')
  ].join('\n')

  return {
    html: `<div class="surface" style="${layoutStyle(content.layout)}">${sections.join('')}</div>`,
    css: `:host{${tokenCss(options.tokens)}}
.surface{font-family:inherit;font-size:var(--t-font-body);line-height:var(--t-line-body);color:var(--t-color-fg);background:var(--t-color-bg);padding:var(--t-space-lg);min-height:100%;box-sizing:border-box}
/* 설계를 보는 곳이지 실제로 쓰는 곳이 아니다 — 끌 때 글자가 잡혀 끌리지 않게. */
.surface,.surface *{user-select:none}
.sec{display:block}
.sec-name{font-size:var(--t-font-small);color:var(--t-color-muted);margin-bottom:var(--t-space-sm)}
${scoped}
${marks}`
  }
}

/** 종류 이름이 클래스에 들어가므로 CSS 에서 안전한 글자만 남긴다(열린 어휘라 무엇이든 올 수 있다). */
function cssSafe(type: string): string {
  return type.replace(/[^\w-]/g, '_') || 'unknown'
}

/** 속성 셀렉터 안에 들어가는 값 — 따옴표·역슬래시만 막으면 된다(요소 id 는 우리가 만든다). */
function cssQuote(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}
