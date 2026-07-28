/**
 * 조각 치환 엔진 — 명세 정본 `docs/spec/uiux-ia.md` §6(미리보기 렌더).
 *
 * **논리 없는 치환만 한다.** 조건식·반복문·스크립트를 넣을 수 있게 하면 조각이 작은 프로그램이
 * 되고, 그 순간 ① 특정 프레임워크에 묶이고 ② 무엇이 그려질지 미리 알 수 없어지고(결정적이지 않다)
 * ③ 사용자·에이전트가 넣은 조각이 임의 코드가 된다. 그래서 문법을 셋으로 못박는다:
 *
 *   {{label}} · {{props.placeholder}}          값 넣기
 *   {{#props.required}}…{{/props.required}}    있으면 보이기 (없으면 통째로 사라짐)
 *   {{#props.options}}…{{.}}…{{/props.options}} 배열이면 반복 ({{.}} = 지금 항목)
 *
 * 변형(variant)·상태(hover 등)는 **마크업이 아니라 CSS 가 가른다** — `data-variant="{{props.variant}}"`
 * 를 두고 `[data-variant=outline]` 로 받는 식. 그래야 마크업은 슬롯까지만 남는다.
 */

/** 조각에 넘기는 값. 컴포넌트 인스턴스에서 그대로 온다. */
export interface TemplateData {
  label?: string
  props?: Record<string, unknown>
}

/**
 * HTML 이스케이프 — **없으면 사용자가 넣은 이름표가 그대로 마크업이 된다.**
 * 미리보기는 Shadow DOM 안이지만 스크립트는 그 안에서도 돈다.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** `label` · `props.foo` 같은 경로를 읽는다. 없으면 undefined. */
function lookup(data: TemplateData, path: string): unknown {
  if (path === 'label') return data.label
  if (path.startsWith('props.')) return data.props?.[path.slice(6)]
  return undefined
}

/** 값이 "보일 만한 것"인가 — 빈 문자열·빈 배열·false·null 은 없는 것으로 본다. */
function isPresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.length > 0
  return value !== undefined && value !== null && value !== false
}

/** 값을 화면 문자열로. 객체는 그릴 수 없으니 비운다(조각이 `[object Object]` 를 뱉지 않게). */
function toText(value: unknown): string {
  if (value === undefined || value === null || value === false) return ''
  if (typeof value === 'object') return ''
  return String(value)
}

// 경로에 ASCII 만 허용하지 않는다 — `props` 키는 열린 어휘라 한글 키도 들어올 수 있다.
const SECTION = /\{\{#([^{}\s]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g
const SLOT = /\{\{([^{}\s#/][^{}\s]*)\}\}/g

/**
 * 조각 + 값 → HTML. **어떤 입력에도 던지지 않는다** — 조각은 사용자·에이전트가 고칠 수 있고,
 * 하나가 잘못됐다고 화면 전체가 안 그려지면 무엇이 잘못됐는지도 볼 수 없다.
 *
 * 중첩 섹션은 지원하지 않는다(기본 조각에 필요 없다). 안쪽 것이 먼저 닫히는 형태로 읽힌다.
 */
export function renderTemplate(html: string, data: TemplateData): string {
  // 1) 섹션 — 있으면 내용을, 배열이면 항목마다 반복.
  const withSections = html.replace(SECTION, (_all, path: string, inner: string) => {
    const value = lookup(data, path)
    if (Array.isArray(value)) {
      return value.map((item) => inner.replace(/\{\{\.\}\}/g, escapeHtml(toText(item)))).join('')
    }
    return isPresent(value) ? inner : ''
  })

  // 2) 남은 슬롯 — 값이 없으면 빈 문자열(조각에 `{{...}}` 가 그대로 남지 않게).
  return withSections.replace(SLOT, (_all, path: string) => escapeHtml(toText(lookup(data, path))))
}
