import { isNoiseComponentName, probePoints, type FeedbackRect, type FeedbackTarget } from '@shared/devFeedback'

/**
 * 화면의 한 점 아래에 실제로 무엇이 있었는지 캐내는 헬퍼 (개발 전용).
 *
 * 이 도구의 핵심 가치가 여기 있다. 좌표만 넘기면 에이전트는 결국 "대충 이 근처겠지"로
 * 추측해야 하지만, 그 자리의 DOM 요소와 React 컴포넌트 이름을 같이 넘기면 소스 파일을
 * 바로 특정할 수 있다.
 *
 * 판정 규칙(어떤 이름을 노이즈로 볼지, 어디를 찔러 볼지)은 `@shared/devFeedback` 의
 * 순수 함수에 있다 — DOM 에 묶인 이 파일은 테스트가 안 되기 때문에, 규칙만 따로 뺐다.
 */

/** 오버레이 자신을 표시 대상에서 걸러내기 위한 표식. */
export const FEEDBACK_ATTR = 'data-rockury-feedback'

type FiberLike = {
  type?: unknown
  return?: FiberLike | null
}

function fiberOf(el: Element): FiberLike | null {
  for (const key of Object.keys(el)) {
    if (key.startsWith('__reactFiber$')) {
      return (el as unknown as Record<string, FiberLike>)[key] ?? null
    }
  }
  return null
}

function nameOfType(type: unknown): string | null {
  if (typeof type === 'function') {
    const fn = type as { displayName?: string; name?: string }
    return fn.displayName || fn.name || null
  }
  // memo() / forwardRef() 로 감싼 컴포넌트는 함수가 아니라 객체로 온다.
  if (type && typeof type === 'object') {
    const obj = type as { displayName?: string; render?: { name?: string }; type?: unknown }
    if (obj.displayName) return obj.displayName
    if (obj.render?.name) return obj.render.name
    if (obj.type) return nameOfType(obj.type)
  }
  return null
}

/**
 * 이 요소를 만든 React 컴포넌트 사슬을 안쪽에서 바깥쪽 순으로 최대 6개.
 * React 19 에는 JSX 호출 위치(파일·줄)가 안정적으로 노출되지 않아 컴포넌트 이름을 대신 쓴다 —
 * 이름 + className + 보이던 글자면 grep 한 번에 파일이 잡힌다.
 */
export function componentChainOf(el: Element): string[] {
  let fiber = fiberOf(el)
  const names: string[] = []
  let hops = 0
  while (fiber && hops < 80 && names.length < 6) {
    hops += 1
    const name = nameOfType(fiber.type)
    if (name && !isNoiseComponentName(name) && names[names.length - 1] !== name) names.push(name)
    fiber = fiber.return ?? null
  }
  return names
}

/** 부모를 타고 올라가며 만든 CSS 선택자 경로. 같은 컴포넌트가 여러 번 쓰일 때 구분자가 된다. */
export function cssPathOf(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el
  while (node && node.nodeType === 1 && parts.length < 6 && node.tagName !== 'BODY') {
    const tag = node.tagName.toLowerCase()
    const parent: Element | null = node.parentElement
    if (!parent) {
      parts.unshift(tag)
      break
    }
    const current = node
    const siblings = [...parent.children].filter((c) => c.tagName === current.tagName)
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag)
    node = parent
  }
  return parts.join(' > ')
}

function describe(el: Element): FeedbackTarget {
  const rect = el.getBoundingClientRect()
  return {
    tag: el.tagName.toLowerCase(),
    // SVG 요소의 className 은 문자열이 아니라 객체라, 속성에서 직접 읽는다.
    className: (el.getAttribute('class') ?? '').trim().slice(0, 400),
    testId: el.getAttribute('data-testid'),
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    cssPath: cssPathOf(el),
    components: componentChainOf(el),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }
}

function elementAt(x: number, y: number): Element | null {
  // elementsFromPoint 로 겹친 것을 전부 받아, 우리 오버레이만 걷어낸다.
  // 오버레이를 잠깐 숨겼다 되돌리는 방식은 그 사이 화면이 한 프레임 깜빡인다.
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest(`[${FEEDBACK_ATTR}]`)) continue
    if (el === document.body || el === document.documentElement) continue
    return el
  }
  return null
}

/** 표시한 영역 아래의 요소를 찾는다. 못 찾으면 null(빈 자리를 표시한 경우). */
export function targetInBounds(bounds: FeedbackRect): FeedbackTarget | null {
  for (const [px, py] of probePoints(bounds)) {
    const el = elementAt(px, py)
    if (el) return describe(el)
  }
  return null
}
