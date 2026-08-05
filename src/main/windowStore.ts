import type { Rect } from './windowSize'
import { normalizeSession, type WindowSession } from '../shared/windowSession'

/**
 * 창 배치 저장본 다루기 — **순수**(파일도 electron 도 안 건드린다). 읽고 쓰는 일은 `windows.ts` 가 한다.
 *
 * 껐을 때 떠 있던 창들을 다음 실행에 되살리기 위한 것이다. 이 앱은 이미 "마지막에 본 화면"으로
 * 돌아오므로(2026-07-30), 창이 여럿이 되면 "마지막에 열려 있던 창들"로 돌아오는 것이 같은 약속의
 * 연장이다.
 */

export interface StoredWindow extends WindowSession {
  /** 껐을 때의 창 자리·크기. 그 화면이 없어졌으면 복원할 때 버린다(`usableBounds`). */
  bounds: Rect
}

export interface WindowStoreFile {
  windows: StoredWindow[]
}

/**
 * 되살릴 창 수 상한. 저장본이 깨졌거나 사용자가 창을 잔뜩 열어 둔 채 껐을 때, 부팅하자마자
 * 창 수십 개가 뜨는 것을 막는다 — 그 상태에서는 앱을 끄기도 어렵다.
 */
export const MAX_WINDOWS = 8

function isRect(value: unknown): value is Rect {
  const r = value as Partial<Rect> | null
  return (
    !!r &&
    typeof r === 'object' &&
    typeof r.x === 'number' &&
    typeof r.y === 'number' &&
    typeof r.width === 'number' &&
    typeof r.height === 'number' &&
    [r.x, r.y, r.width, r.height].every(Number.isFinite)
  )
}

/**
 * 저장본을 걸러 받는다. 살릴 창이 하나도 없으면 **빈 배열** — 부르는 쪽이 기본 창 하나를 연다.
 *
 * 자리(bounds)가 깨진 창은 **버리지 않고 자리만 지운다**: 사용자가 열어 둔 탭 묶음이 창 자리
 * 하나 때문에 통째로 사라지면 안 된다. 자리는 다시 계산하면 되지만 탭은 못 되살린다.
 */
export function normalizeWindowStore(value: unknown): StoredWindow[] {
  const raw = value as { windows?: unknown } | null
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.windows)) return []

  const out: StoredWindow[] = []
  for (const w of raw.windows.slice(0, MAX_WINDOWS)) {
    const item = w as { tabs?: unknown; active?: unknown; bounds?: unknown }
    const session = normalizeSession({
      tabs: Array.isArray(item?.tabs) ? item.tabs.map(asLocation) : [],
      active: typeof item?.active === 'number' ? item.active : 0
    })
    if (!session) continue
    out.push({
      ...session,
      bounds: isRect(item?.bounds) ? item.bounds : { x: 0, y: 0, width: 0, height: 0 }
    })
  }
  return out
}

function asLocation(value: unknown): { serviceId: string; moduleId: string; viewId: string | null } | null {
  const t = value as { serviceId?: unknown; moduleId?: unknown; viewId?: unknown } | null
  if (!t || typeof t !== 'object') return null
  if (typeof t.serviceId !== 'string' || t.serviceId === '') return null
  if (typeof t.moduleId !== 'string') return null
  if (t.viewId !== null && typeof t.viewId !== 'string') return null
  return { serviceId: t.serviceId, moduleId: t.moduleId, viewId: t.viewId }
}
