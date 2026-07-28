import type { SpecComponent, SpecSection, SurfaceContent, SurfaceEvent } from './types'

/**
 * 화면 내용(JSON 한 칸)의 읽기·쓰기 — 명세 정본 `docs/spec/uiux-ia.md` §7(INV-3).
 *
 * 저장소에서 읽은 JSON 은 **믿을 수 없다.** 손으로 고쳤을 수도, 예전 모델로 저장됐을 수도,
 * 에이전트가 잘못 썼을 수도 있다. 여기서 터지면 화면 목록 전체가 안 뜬다 — 그래서
 * 파싱은 절대 던지지 않고 **읽어낼 수 있는 만큼만 살려서** 돌려준다.
 */

export const EMPTY_CONTENT: SurfaceContent = { sections: [] }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** id 는 트리 조작(이동·삭제)의 손잡이라 없으면 그 조각을 살릴 수 없다. */
const hasId = (v: Record<string, unknown>): boolean =>
  typeof v.id === 'string' && v.id.length > 0

function reviveComponent(v: unknown): SpecComponent | null {
  if (!isRecord(v) || !hasId(v)) return null
  if (typeof v.type !== 'string' || v.type.length === 0) return null
  return v as unknown as SpecComponent
}

function reviveSection(v: unknown): SpecSection | null {
  if (!isRecord(v) || !hasId(v)) return null
  const components = Array.isArray(v.components)
    ? v.components.map(reviveComponent).filter((c): c is SpecComponent => c !== null)
    : []
  return {
    ...(v as unknown as SpecSection),
    name: typeof v.name === 'string' ? v.name : '',
    components
  }
}

/** 이벤트는 효과(nav·data)가 하나도 없으면 아무 일도 안 하는 껍데기라 버린다. */
function reviveEvent(v: unknown): SurfaceEvent | null {
  if (!isRecord(v) || !isRecord(v.trigger)) return null
  if (!isRecord(v.nav) && !isRecord(v.data)) return null
  return v as unknown as SurfaceEvent
}

/**
 * 저장소의 JSON 문자열 → 화면 내용. **어떤 입력에도 던지지 않는다**(INV-3):
 * 깨진 JSON·배열이 아닌 sections·id 없는 조각은 조용히 걸러지고 나머지는 살아남는다.
 */
export function parseContent(raw: string | null | undefined): SurfaceContent {
  if (!raw) return EMPTY_CONTENT
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY_CONTENT
  }
  if (!isRecord(parsed)) return EMPTY_CONTENT

  const sections = Array.isArray(parsed.sections)
    ? parsed.sections.map(reviveSection).filter((s): s is SpecSection => s !== null)
    : []
  const events = Array.isArray(parsed.events)
    ? parsed.events.map(reviveEvent).filter((e): e is SurfaceEvent => e !== null)
    : undefined

  const content: SurfaceContent = { sections }
  if (isRecord(parsed.layout)) content.layout = parsed.layout as SurfaceContent['layout']
  if (events && events.length > 0) content.events = events
  if (isRecord(parsed.viewports)) content.viewports = parsed.viewports as SurfaceContent['viewports']
  return content
}

/** 화면 내용 → 저장소 문자열. 빈 값은 적지 않는다(diff 를 조용하게 유지). */
export function serializeContent(content: SurfaceContent): string {
  const out: SurfaceContent = { sections: content.sections ?? [] }
  if (content.layout) out.layout = content.layout
  if (content.events && content.events.length > 0) out.events = content.events
  if (content.viewports && Object.keys(content.viewports).length > 0) out.viewports = content.viewports
  return JSON.stringify(out)
}
