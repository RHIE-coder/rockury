/**
 * 탭 목록 다루기 — 브라우저 탭과 같은 뜻으로, **사용자가 만들고 지우는 자리 묶음**이다.
 * (모듈 탭·뷰 탭은 이름만 같은 고정 메뉴다. 그쪽은 nav 트리가 정한다.)
 *
 * 탭 하나는 **자리와 대상**을 든다. 대상(= 지금 어느 설계·접속을 보나)은 2026-08-05 에 창에
 * 딸리게 정했다가 2026-08-07 에 탭으로 내렸다 — 탭 두 장으로 접속을 나란히 보려는데 한쪽을
 * 고르면 다른 쪽까지 바뀌었기 때문이다.
 *
 * 서비스 스토어를 탭 단위로 쪼개지는 않았다. 쪼개는 대신 **고른 id 만** 탭이 들고, 스토어는
 * 그 id 로 읽는다(`useContextValue`). 목록·상태는 창 하나에 하나로 남는다.
 *
 * 탭 **묶음의 주인은 메인 프로세스**다(`main/windows.ts`) — 창끼리 부딪히지 않고, 껐다 켜도
 * 창 배치째 돌아온다. 여기 있는 것은 창 안에서 도는 사본이고, 바뀔 때마다 메인에 되보고한다.
 *
 * 여기엔 배열 조작만 둔다 — nav 트리(registry)를 모른다. 기억한 id 가 아직 존재하는지는
 * useNav 의 find* 가 폴백으로 판정한다(`recall.ts` 와 같은 결).
 */

import type { NavLocation } from '@shared/navLocation'
import { normalizeContext, type SessionTab, type WindowSession } from '@shared/windowSession'
import type { Module, View } from './types'

export interface NavTab extends NavLocation {
  id: string
  /**
   * 이 탭이 고른 대상들(셀렉터 id → 옵션 id). **탭마다 따로 논다** — 탭1 은 접속 A,
   * 탭2 는 접속 B. 값이 없는 셀렉터는 키가 아예 없다("아직 안 골랐다").
   */
  context: Record<string, string>
}

/** 탭 목록과 그중 활성 — 조작 함수들이 이 짝을 통째로 주고받는다(둘이 늘 함께 바뀐다). */
export interface TabSet {
  tabs: NavTab[]
  activeTabId: string
}

/**
 * 다음 탭 id. 난수 대신 **쓰이지 않는 가장 작은 번호**를 준다 — 순수하게 유지해야 단위
 * 테스트로 덮이고, 저장본을 다시 읽어도 같은 규칙으로 이어진다.
 */
export function nextTabId(tabs: NavTab[]): string {
  const used = new Set(tabs.map((t) => t.id))
  let n = 1
  while (used.has(`t${n}`)) n++
  return `t${n}`
}

export function activeTab(set: TabSet): NavTab {
  return set.tabs.find((t) => t.id === set.activeTabId) ?? set.tabs[0]
}

/**
 * 자리에서 **자리만** 뽑는다.
 *
 * 자리를 넘겨받는 자리마다 이걸 거친다 — 부르는 쪽이 흔히 넘기는 값이 탭 자신이기 때문이다
 * ("이 탭을 하나 더"). 탭에는 id 가 붙어 있어서 통째로 펼치면 갓 지은 id 를 덮어써, 같은 id 를
 * 가진 탭이 두 장 생긴다(실측: `+` 를 눌러도 새 탭이 안 켜지고 두 장이 함께 켜져 보였다).
 */
function place(loc: NavLocation): NavLocation {
  return { serviceId: loc.serviceId, moduleId: loc.moduleId, viewId: loc.viewId }
}

/**
 * 새 탭 하나를 짓는다 — 자리에 **대상까지** 얹는다.
 *
 * `+` 로 여는 탭은 지금 탭의 사본이라 보던 대상도 따라와야 한다("이 화면을 하나 더"). 거기서
 * 대상을 바꾸면 그 탭에서만 갈린다. 사본을 뜨는 이유는 `place` 와 같다 — 같은 객체를 두 탭이
 * 나눠 쥐면 한쪽에서 고른 것이 다른 쪽에도 비친다.
 */
function newTab(seed: SessionTab, id: string): NavTab {
  return { id, ...place(seed), context: { ...(seed.context ?? {}) } }
}

/**
 * 탭 하나를 연다. **활성 탭 바로 오른쪽**에 끼우고 새 탭으로 옮겨 간다 — 브라우저와 같은 자리다
 * (맨 끝에 붙이면 방금 연 탭이 화면 밖으로 밀려나 어디 생겼는지 눈으로 못 쫓는다).
 */
export function openTab(set: TabSet, seed: SessionTab): TabSet {
  const tab = newTab(seed, nextTabId(set.tabs))
  const at = set.tabs.findIndex((t) => t.id === set.activeTabId)
  const tabs = [...set.tabs]
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab)
  return { tabs, activeTabId: tab.id }
}

/**
 * 탭 하나를 닫는다. **마지막 한 장은 안 닫는다** — 브라우저라면 창이 닫히겠지만, 여기선
 * 실수로 앱이 꺼지는 길이 된다. 창은 제목 줄의 닫기로 닫는다.
 *
 * 활성 탭을 닫으면 **오른쪽 것**으로 옮겨 간다(없으면 왼쪽) — 여러 장을 잇달아 닫을 때
 * 손이 한 자리에 머문다.
 */
export function closeTab(set: TabSet, id: string): TabSet {
  if (set.tabs.length <= 1) return set
  const at = set.tabs.findIndex((t) => t.id === id)
  if (at < 0) return set

  const tabs = set.tabs.filter((t) => t.id !== id)
  if (id !== set.activeTabId) return { tabs, activeTabId: set.activeTabId }
  return { tabs, activeTabId: (tabs[at] ?? tabs[tabs.length - 1]).id }
}

/** 활성 탭이 가리키는 자리를 옮긴다 — 서비스·모듈·뷰를 누를 때마다 여기로 들어온다. */
export function moveActiveTab(set: TabSet, loc: NavLocation): TabSet {
  const current = activeTab(set)
  if (
    current.serviceId === loc.serviceId &&
    current.moduleId === loc.moduleId &&
    current.viewId === loc.viewId
  ) {
    // 바뀐 게 없으면 **같은 배열을 그대로** — 새 배열을 만들면 구독자가 헛돌고 저장도 매 클릭마다 일어난다.
    return set
  }
  return {
    tabs: set.tabs.map((t) => (t.id === current.id ? { ...t, ...place(loc) } : t)),
    activeTabId: set.activeTabId
  }
}

/**
 * 활성 탭의 대상 선택만 갈아 끼운다 — 대상을 고치는 길은 여기 하나다.
 *
 * 바뀐 게 없으면 **같은 묶음을 그대로** 돌려준다. 새 배열을 만들면 구독자가 헛돌고, 탭이
 * 바뀐 줄 알고 메인에 되보고까지 나간다(`moveActiveTab` 과 같은 결).
 */
export function setActiveContext(
  set: TabSet,
  edit: (context: Record<string, string>) => Record<string, string>
): TabSet {
  const current = activeTab(set)
  const next = edit(current.context)
  const same =
    Object.keys(next).length === Object.keys(current.context).length &&
    Object.entries(next).every(([k, v]) => current.context[k] === v)
  if (same) return set
  return {
    tabs: set.tabs.map((t) => (t.id === current.id ? { ...t, context: next } : t)),
    activeTabId: set.activeTabId
  }
}

/**
 * 이 셀렉터의 선택을 **모든 탭에서** 푼다. `optionId` 를 주면 그 값을 고른 탭만.
 *
 * 탭마다 따로 노는 것이 규칙이지만 "여기서는 절대 남아 있으면 안 된다"는 것이 있다 —
 * 앱을 켤 때의 환경 선택과 방금 지운 대상. 활성 탭만 풀면 나머지 탭에 그대로 살아 있다.
 */
export function clearContextEverywhere(set: TabSet, selectorId: string, optionId?: string): TabSet {
  const hit = (t: NavTab): boolean =>
    t.context[selectorId] !== undefined &&
    (optionId === undefined || t.context[selectorId] === optionId)
  if (!set.tabs.some(hit)) return set
  return {
    tabs: set.tabs.map((t) => {
      if (!hit(t)) return t
      const context = { ...t.context }
      delete context[selectorId]
      return { ...t, context }
    }),
    activeTabId: set.activeTabId
  }
}

/**
 * 아직 아무 대상도 없는 탭들에만 주어진 대상을 심는다 — 옛 저장본을 한 번 옮겨 올 때 쓴다.
 *
 * **대상이 이미 있는 탭이 하나라도 있으면 통째로 안 건드린다.** 메인이 실어 보낸 탭(껐다 켠
 * 창·떼어낸 창)이 제 대상을 들고 오는데 거기에 옛 값을 덮으면, 창을 열 때마다 마지막에 고른
 * 하나로 되돌아간다.
 */
export function seedContext(set: TabSet, context: Record<string, string>): TabSet {
  if (Object.keys(context).length === 0) return set
  if (set.tabs.some((t) => Object.keys(t.context).length > 0)) return set
  return { tabs: set.tabs.map((t) => ({ ...t, context: { ...context } })), activeTabId: set.activeTabId }
}

export function selectTab(set: TabSet, id: string): TabSet {
  return set.tabs.some((t) => t.id === id) ? { ...set, activeTabId: id } : set
}

/** 번호로 고르기 — 메뉴의 `⌘1~9`. 범위를 벗어나면 **마지막 탭**(브라우저의 `⌘9`와 같다). */
export function selectTabAt(set: TabSet, index: number): TabSet {
  if (set.tabs.length === 0) return set
  const at = Math.min(Math.max(index, 0), set.tabs.length - 1)
  return selectTab(set, set.tabs[at].id)
}

/** 옆 탭으로 — 끝에서는 반대쪽 끝으로 감는다(브라우저의 `⌃Tab`). */
export function stepTab(set: TabSet, delta: number): TabSet {
  const at = set.tabs.findIndex((t) => t.id === set.activeTabId)
  if (at < 0 || set.tabs.length === 0) return set
  const n = set.tabs.length
  return selectTab(set, set.tabs[(((at + delta) % n) + n) % n].id)
}

/**
 * 탭을 끌어 자리를 옮긴다 — `to` 는 **옮긴 뒤에 이 탭이 설 자리 번호**다.
 * 활성 탭은 안 바뀐다: 자리를 옮기는 것과 보는 것을 고르는 것은 다른 일이다.
 */
export function moveTab(set: TabSet, id: string, to: number): TabSet {
  const from = set.tabs.findIndex((t) => t.id === id)
  if (from < 0) return set
  const at = Math.min(Math.max(to, 0), set.tabs.length - 1)
  if (at === from) return set

  const tabs = [...set.tabs]
  const [moved] = tabs.splice(from, 1)
  tabs.splice(at, 0, moved)
  return { tabs, activeTabId: set.activeTabId }
}

/**
 * 탭을 줄 밖으로 끌어 냈다 — 이 창에서는 지운다. 지운 뒤 남는 것이 없으면(한 장뿐이었으면)
 * **그대로 둔다**: 빈 창을 남겨 두느니 떼어내기를 없던 일로 한다. 그 경우 부르는 쪽이
 * 새 창을 안 열도록 `detached: false` 로 알린다.
 */
export function detachTab(set: TabSet, id: string): { set: TabSet; detached: boolean } {
  if (set.tabs.length <= 1) return { set, detached: false }
  return { set: closeTab(set, id), detached: true }
}

/**
 * 탭에 적히는 이름 — `모듈 · 뷰`, 뷰가 없으면 모듈 이름만.
 *
 * 서비스 이름은 안 적는다: 탭에 서비스 아이콘이 함께 서기 때문에 글자로 되풀이하면 좁은 칸이
 * 두 번 같은 말을 하게 된다(화면 문구 규율 — "같은 정보는 한 화면에 한 번").
 */
export function tabTitle(module: Module, view: View | null): string {
  return view ? `${module.label} · ${view.label}` : module.label
}

/** 누른 채 이만큼(px) 움직여야 끌기로 친다 — 이게 없으면 탭을 고르는 클릭이 끌기로 먹힌다. */
export const DRAG_SLOP = 4

/**
 * 탭 줄 위아래로 이만큼(px) 벗어나면 창으로 떨어져 나간다.
 *
 * 줄 높이(32px)와 비슷하게 잡았다 — 더 좁으면 줄 안에서 자리를 옮기다 손이 조금 떨려도 창이
 * 생기고, 더 넓으면 "빼냈는데 왜 안 나오지" 하고 한참을 더 끌게 된다.
 */
export const TEAR_OFF_MARGIN = 28

/**
 * 탭 줄 밖으로 끌어 냈나 — 그러면 그 탭은 **그 자리에서** 창으로 떨어져 나간다(브라우저와 같다).
 *
 * **세로만 본다.** 좌우 끝을 넘어가는 것은 "맨 앞·맨 뒤로 옮기기"라 창을 만들 일이 아니고,
 * 창을 꽉 채워 놓았을 때 좌우로는 나갈 데도 없다(예전 판정이 "창 밖"이라 여기서 막혔다).
 */
export function pulledOutOfStrip(y: number, strip: { top: number; bottom: number }): boolean {
  return y < strip.top - TEAR_OFF_MARGIN || y > strip.bottom + TEAR_OFF_MARGIN
}

/**
 * 가로 좌표 `x` 가 어느 틈에 떨어지는지 — **0 부터 탭 수까지**의 끼울 자리 번호.
 * 탭 상자(`left`·`width`)는 줄에 선 순서대로 준다. 반보다 왼쪽이면 그 탭 앞이다.
 */
export function dropIndexAt(boxes: readonly { left: number; width: number }[], x: number): number {
  for (const [i, box] of boxes.entries()) {
    if (x < box.left + box.width / 2) return i
  }
  return boxes.length
}

/**
 * 다른 창에서 건너온 탭을 이 줄에 끼운다 — 끼운 탭이 곧 활성이다(가져다 놓았으면 그걸 보려는 것이다).
 * 자리 번호는 `dropIndexAt` 이 준 값이라 **탭 수와 같을 수 있다**(맨 뒤).
 */
export function insertTab(set: TabSet, seed: SessionTab, index: number): TabSet {
  const tab = newTab(seed, nextTabId(set.tabs))
  const tabs = [...set.tabs]
  tabs.splice(Math.min(Math.max(index, 0), tabs.length), 0, tab)
  return { tabs, activeTabId: tab.id }
}

/**
 * 메인에 되보고할 모양으로 접는다 — 메인이 창 배치의 주인이라 탭 id 는 안 보낸다(창을 다시
 * 열 때 새로 짓는다). 순서와 활성 자리만 뜻이 있다.
 */
export function toSession(set: TabSet): WindowSession {
  const active = set.tabs.findIndex((t) => t.id === set.activeTabId)
  return {
    tabs: set.tabs.map((t) => ({ ...place(t), context: t.context })),
    active: active < 0 ? 0 : active
  }
}

/** 메인이 실어 보낸 것을 탭 묶음으로 편다. id 는 여기서 새로 짓는다. */
export function fromSession(session: WindowSession): TabSet {
  const tabs = session.tabs.map((tab, i) => newTab(tab, `t${i + 1}`))
  return { tabs, activeTabId: tabs[Math.min(session.active, tabs.length - 1)].id }
}

/** 대상(context)은 여기서 안 본다 — 없어도 되는 값이라 `normalizeContext` 가 뒤에서 채운다. */
function isTab(value: unknown): value is NavLocation & { id: string } {
  const t = value as Partial<NavTab> | null
  return (
    !!t &&
    typeof t === 'object' &&
    typeof t.id === 'string' &&
    t.id !== '' &&
    typeof t.serviceId === 'string' &&
    t.serviceId !== '' &&
    typeof t.moduleId === 'string' &&
    (t.viewId === null || typeof t.viewId === 'string')
  )
}

/**
 * 저장본(localStorage)을 걸러 받는다 — 이 기능이 없던 시절의 값이나 손상된 값이 들어 있을 수
 * 있다. 살릴 게 하나도 없으면 **null** 을 돌려 부르는 쪽이 기본값을 세우게 한다.
 *
 * id 가 겹치면 뒤엣것을 버린다 — 겹친 채 두면 탭을 눌러도 늘 앞엣것만 활성이 된다.
 */
export function normalizeTabSet(tabs: unknown, activeTabId: unknown): TabSet | null {
  if (!Array.isArray(tabs)) return null
  const seen = new Set<string>()
  const out: NavTab[] = []
  for (const raw of tabs) {
    if (!isTab(raw) || seen.has(raw.id)) continue
    seen.add(raw.id)
    out.push({
      id: raw.id,
      serviceId: raw.serviceId,
      moduleId: raw.moduleId,
      viewId: raw.viewId,
      context: normalizeContext((raw as Partial<NavTab>).context)
    })
  }
  if (out.length === 0) return null
  const active = typeof activeTabId === 'string' && seen.has(activeTabId) ? activeTabId : out[0].id
  return { tabs: out, activeTabId: active }
}
