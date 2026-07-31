/**
 * "마지막에 본 자리" 기억 — 서비스·모듈에 다시 들어오면 첫 뷰가 아니라 보던 뷰로 돌아온다.
 *
 * 2026-07-30 사용자 피드백: "화면 접근할 때 내가 마지막에 본 화면을 저장 안해서 자꾸
 * connections에 들어오네". 기억이 **없을 때의 폴백이 곧 예전 규칙**(첫 모듈·첫 뷰)이라
 * 첫인상은 안 바뀐다 — Remote 첫 방문은 여전히 Connections 로 착지한다.
 *
 * 여기엔 문자열 지도만 둔다 — nav 트리(registry)를 모른다. 기억한 id 가 아직 존재하는지는
 * useNav 의 find* 가 폴백으로 판정하므로, 이 모듈은 트리 없이 단위 테스트로 덮인다.
 */

export interface NavRecall {
  /** 서비스 id → 마지막으로 본 모듈 id */
  module: Record<string, string>
  /** `서비스id/모듈id` → 마지막으로 본 뷰 id */
  view: Record<string, string>
}

export function emptyRecall(): NavRecall {
  return { module: {}, view: {} }
}

function viewKey(serviceId: string, moduleId: string): string {
  return `${serviceId}/${moduleId}`
}

export function recallModule(recall: NavRecall, serviceId: string): string | null {
  return recall.module[serviceId] ?? null
}

export function recallView(recall: NavRecall, serviceId: string, moduleId: string): string | null {
  return recall.view[viewKey(serviceId, moduleId)] ?? null
}

// 바뀐 게 없으면 **같은 객체를 그대로 돌려준다** — 새 객체를 만들면 상태가 매번 달라져
// 구독자가 헛돌고 저장도 매 클릭마다 일어난다.
export function rememberModule(recall: NavRecall, serviceId: string, moduleId: string): NavRecall {
  if (recall.module[serviceId] === moduleId) return recall
  return { ...recall, module: { ...recall.module, [serviceId]: moduleId } }
}

/** 뷰가 없는 모듈(depth 2)은 `viewId: null` 로 들어온다 — 그 모듈의 기억은 지운다. */
export function rememberView(
  recall: NavRecall,
  serviceId: string,
  moduleId: string,
  viewId: string | null
): NavRecall {
  const key = viewKey(serviceId, moduleId)
  if (viewId == null) {
    if (!(key in recall.view)) return recall
    const view = { ...recall.view }
    delete view[key]
    return { ...recall, view }
  }
  if (recall.view[key] === viewId) return recall
  return { ...recall, view: { ...recall.view, [key]: viewId } }
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v !== '') out[k] = v
  }
  return out
}

/**
 * 저장본(localStorage)을 걸러 받는다 — 앱을 쓰던 사람의 브라우저 저장소엔 이 기능이 없던
 * 시절의 값이나 손상된 값이 들어 있을 수 있다. 모양이 어긋나면 지도를 통째로 버리지 않고
 * 문자열 항목만 살린다(자리 기억은 틀려도 앱이 안 뜨면 안 되는 값이 아니다).
 */
export function normalizeRecall(value: unknown): NavRecall {
  const raw = (value ?? {}) as { module?: unknown; view?: unknown }
  return { module: stringMap(raw?.module), view: stringMap(raw?.view) }
}
