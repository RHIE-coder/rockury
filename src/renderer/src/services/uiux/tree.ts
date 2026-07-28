import type { NavKind, SpecComponent, SpecSection, SurfaceContent, SurfaceEvent } from './types'

/**
 * 화면 안 트리 조작 — 명세 정본 `docs/spec/uiux-ia.md` §6(구조가 데이터, 조작은 캔버스).
 *
 * **Spec 뷰와 Canvas 가 같이 쓰는 층이다.** 드래그로 옮기든 폼으로 고치든 결국 여기를 부른다 —
 * 편집 규칙이 화면마다 흩어지면 한쪽에서만 되는 조작이 생기고, 그때부터 두 화면이 서로 다른
 * 데이터를 만든다. 그래서 순수 함수로 두고 테스트로 고정한다.
 *
 * 모든 함수는 **새 객체를 돌려준다**(입력을 고치지 않는다) — 상태 저장소가 변경을 감지해야 하고,
 * 되돌리기(undo)를 나중에 붙일 때 스냅샷이 그대로 쓰인다.
 */

/** 화면 안의 모든 id — 섹션과 컴포넌트가 **한 이름 공간**을 쓴다(이벤트가 id 하나로 가리키게). */
export function allIds(content: SurfaceContent): string[] {
  const ids: string[] = []
  for (const s of content.sections) {
    ids.push(s.id)
    for (const c of s.components) ids.push(c.id)
  }
  return ids
}

/**
 * 이미 쓰인 id 를 피해 새 id 를 만든다. `prefix` → `prefix-2` → `prefix-3` …
 * 무작위 값을 쓰지 않는 이유: 결정적이어야 테스트가 되고, 사람이 읽을 수 있어야 이벤트가
 * 가리키는 대상을 눈으로 확인한다(`submit-2` vs `c7f3a1`).
 */
export function newId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(prefix)) return prefix
  for (let n = 2; ; n++) {
    const candidate = `${prefix}-${n}`
    if (!used.has(candidate)) return candidate
  }
}

/** 섹션을 찾는다. 없으면 null. */
export function findSection(content: SurfaceContent, id: string): SpecSection | null {
  return content.sections.find((s) => s.id === id) ?? null
}

/** 컴포넌트를 그것이 사는 섹션과 함께 찾는다. 없으면 null. */
export function findComponent(
  content: SurfaceContent,
  id: string
): { section: SpecSection; component: SpecComponent } | null {
  for (const section of content.sections) {
    const component = section.components.find((c) => c.id === id)
    if (component) return { section, component }
  }
  return null
}

/** 섹션 추가. `at` 을 주면 그 자리에, 없으면 맨 뒤에. 만들어진 id 를 함께 돌려준다. */
export function addSection(
  content: SurfaceContent,
  input: { name?: string; at?: number } = {}
): { content: SurfaceContent; id: string } {
  const id = newId('section', allIds(content))
  const section: SpecSection = { id, name: input.name ?? '새 영역', components: [] }
  const sections = [...content.sections]
  sections.splice(input.at ?? sections.length, 0, section)
  return { content: { ...content, sections }, id }
}

/**
 * 컴포넌트 추가. id 는 종류에서 딴다(`input` → `input`, 두 번째는 `input-2`) — 사람이 읽는 손잡이.
 * 대상 섹션이 없으면 아무것도 하지 않는다(화면이 사라진 섹션을 가리키고 있을 수 있다).
 */
export function addComponent(
  content: SurfaceContent,
  sectionId: string,
  type: string,
  input: { label?: string; at?: number } = {}
): { content: SurfaceContent; id: string | null } {
  if (!findSection(content, sectionId)) return { content, id: null }
  const id = newId(type, allIds(content))
  const component: SpecComponent = { id, type, ...(input.label ? { label: input.label } : {}) }
  const sections = content.sections.map((s) => {
    if (s.id !== sectionId) return s
    const components = [...s.components]
    components.splice(input.at ?? components.length, 0, component)
    return { ...s, components }
  })
  return { content: { ...content, sections }, id }
}

/** 섹션이든 컴포넌트든 id 하나로 지운다. 섹션을 지우면 그 안 컴포넌트도 함께 사라진다. */
export function removeNode(content: SurfaceContent, id: string): SurfaceContent {
  if (findSection(content, id)) {
    return { ...content, sections: content.sections.filter((s) => s.id !== id) }
  }
  return {
    ...content,
    sections: content.sections.map((s) =>
      s.components.some((c) => c.id === id)
        ? { ...s, components: s.components.filter((c) => c.id !== id) }
        : s
    )
  }
}

/**
 * 컴포넌트를 옮긴다 — 섹션 사이 이동과 같은 섹션 안 순서 바꾸기를 한 함수로(드래그의 바탕).
 *
 * `toIndex` 는 **뽑아낸 뒤의 자리**다. 같은 섹션에서 아래로 옮길 때 뽑기 때문에 뒤 항목이
 * 한 칸 당겨지는데, 이 기준이면 "3번째 자리에 놓는다"가 언제나 같은 뜻이 된다.
 * 대상 섹션이 없거나 컴포넌트가 없으면 아무것도 하지 않는다.
 */
export function moveComponent(
  content: SurfaceContent,
  id: string,
  toSectionId: string,
  toIndex?: number
): SurfaceContent {
  const found = findComponent(content, id)
  if (!found || !findSection(content, toSectionId)) return content

  const plucked = content.sections.map((s) =>
    s.components.some((c) => c.id === id)
      ? { ...s, components: s.components.filter((c) => c.id !== id) }
      : s
  )
  const sections = plucked.map((s) => {
    if (s.id !== toSectionId) return s
    const components = [...s.components]
    const at = clamp(toIndex ?? components.length, 0, components.length)
    components.splice(at, 0, found.component)
    return { ...s, components }
  })
  return { ...content, sections }
}

/** 섹션 순서 바꾸기. `toIndex` 기준은 moveComponent 와 같다(뽑아낸 뒤의 자리). */
export function moveSection(content: SurfaceContent, id: string, toIndex: number): SurfaceContent {
  const from = content.sections.findIndex((s) => s.id === id)
  if (from < 0) return content
  const sections = [...content.sections]
  const [section] = sections.splice(from, 1)
  sections.splice(clamp(toIndex, 0, sections.length), 0, section)
  return { ...content, sections }
}

/** 섹션 속성 수정. id 는 손잡이라 바꾸지 않는다(이벤트가 가리키고 있을 수 있다). */
export function patchSection(
  content: SurfaceContent,
  id: string,
  patch: Partial<Omit<SpecSection, 'id' | 'components'>>
): SurfaceContent {
  return {
    ...content,
    sections: content.sections.map((s) => (s.id === id ? { ...s, ...patch } : s))
  }
}

/** 컴포넌트 속성 수정. id 는 바꾸지 않는다(같은 이유). */
export function patchComponent(
  content: SurfaceContent,
  id: string,
  patch: Partial<Omit<SpecComponent, 'id'>>
): SurfaceContent {
  return {
    ...content,
    sections: content.sections.map((s) =>
      s.components.some((c) => c.id === id)
        ? { ...s, components: s.components.map((c) => (c.id === id ? { ...c, ...patch } : c)) }
        : s
    )
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

// ── 흐름(이벤트) ────────────────────────────────────────────────────

/**
 * 이 요소가 누르면 어디로 가나. **한 요소에 전이는 하나로 본다(v1)** — 조건에 따라 갈리는
 * 전이는 조건 어휘가 서고 나서 다룬다. 지금 여러 개를 허용하면 편집 화면이 먼저 복잡해진다.
 */
export function findNav(content: SurfaceContent, componentId: string): { to: string; kind: NavKind } | null {
  const event = (content.events ?? []).find((e) => e.trigger?.component === componentId && e.nav?.to)
  return event?.nav ? { to: event.nav.to, kind: event.nav.kind ?? 'navigate' } : null
}

/** 전이를 붙이거나(`nav`) 뗀다(`null`). 같은 요소의 기존 전이는 갈아탄다. */
export function setNav(
  content: SurfaceContent,
  componentId: string,
  nav: { to: string; kind: NavKind } | null
): SurfaceContent {
  const rest = (content.events ?? []).filter((e) => e.trigger?.component !== componentId)
  if (!nav || !nav.to) {
    // 남는 이벤트가 없으면 칸 자체를 지운다 — 빈 배열이 저장되면 diff 가 지저분해진다.
    const next = { ...content }
    if (rest.length > 0) next.events = rest
    else delete next.events
    return next
  }
  const event: SurfaceEvent = {
    trigger: { component: componentId, event: 'click' },
    nav: { kind: nav.kind, to: nav.to }
  }
  return { ...content, events: [...rest, event] }
}
