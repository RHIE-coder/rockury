import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { NavLocation } from '@shared/navLocation'
import { initialSession, windowStorage } from '../shell/windowSession'
import { navRegistry } from './registryRef'
import {
  emptyRecall,
  normalizeRecall,
  recallModule,
  recallView,
  rememberModule,
  rememberView,
  type NavRecall
} from './recall'
import {
  activeTab,
  closeTab as closeTabIn,
  detachTab as detachTabIn,
  fromSession,
  insertTab as insertTabIn,
  moveActiveTab,
  moveTab as moveTabIn,
  openTab as openTabIn,
  selectTab as selectTabIn,
  selectTabAt as selectTabAtIn,
  stepTab as stepTabIn,
  toSession,
  type NavTab,
  type TabSet
} from './tabs'
import type { Module, Service, View } from './types'

/** 기억이 아직 없는 첫 실행의 진입 서비스 — 가장 구체화된 DB 서비스로 시작. */
const DEFAULT_SERVICE_ID = 'db'

function findService(serviceId: string): Service {
  const registry = navRegistry()
  return registry.find((s) => s.id === serviceId) ?? registry[0]
}

function findModule(service: Service, moduleId: string | null): Module {
  return service.modules.find((m) => m.id === moduleId) ?? service.modules[0]
}

function findView(module: Module, viewId: string | null): View | null {
  if (!module.views?.length) return null
  return module.views.find((v) => v.id === viewId) ?? module.views[0]
}

/** 지금 선 자리(서비스/모듈/뷰)를 한 번에 기억에 새긴다. */
function remember(
  recall: NavRecall,
  serviceId: string,
  moduleId: string,
  viewId: string | null
): NavRecall {
  return rememberView(rememberModule(recall, serviceId, moduleId), serviceId, moduleId, viewId)
}

/**
 * 서비스가 선언한 컨텍스트 셀렉터들의 기본 선택값.
 * `defaultOptionId` 가 있는 셀렉터만 초기 선택된다 — 없으면 "선택 안 됨"으로 시작.
 * (DB 의 Design·Env 는 둘 다 기본값 없이 비어 있음 → 명시적으로 골라야 한다.)
 */
function defaultContext(service: Service): Record<string, string> {
  const values: Record<string, string> = {}
  for (const sel of service.context ?? []) {
    if (sel.defaultOptionId) values[sel.id] = sel.defaultOptionId
  }
  return values
}

function oneTab(loc: NavLocation): TabSet {
  return { tabs: [{ id: 't1', ...loc }], activeTabId: 't1' }
}

function initialTabs(): TabSet {
  const session = initialSession()
  return session ? fromSession(session) : oneTab({ serviceId: DEFAULT_SERVICE_ID, moduleId: '', viewId: null })
}

interface NavState {
  /**
   * 열려 있는 탭들과 그중 활성. **지금 보는 자리는 활성 탭이 든다** — 예전엔 스토어가
   * serviceId/moduleId/viewId 를 직접 들었는데, 자리를 여러 개 여는 순간 그 셋이 "활성 탭의
   * 사본"이 되어 두 곳에 같은 진실이 생긴다. 진실을 탭 쪽 하나로 모았다(`useActive` 로 읽는다).
   */
  tabs: NavTab[]
  activeTabId: string
  /**
   * 상단 컨텍스트 바의 선택값 (selectorId → optionId).
   *
   * **탭이 아니라 창에 딸린다** — 탭을 옮겨도 안 바뀐다. 대상이 다른 화면을 나란히 보려면
   * 창을 하나 더 띄운다(창마다 이 스토어가 따로 산다 · 2026-08-05 사용자 결정).
   */
  contextValues: Record<string, string>
  /** 서비스·모듈마다 "마지막에 본 자리". 다시 들어올 때 첫 항목 대신 여기로 돌아온다. */
  recall: NavRecall
  /** 서비스 전환 → 마지막에 보던 모듈·뷰(없으면 첫 모듈·첫 뷰), 컨텍스트 기본값 채움 */
  selectService: (serviceId: string) => void
  /** 모듈 전환 → 그 모듈에서 마지막에 보던 뷰(없으면 첫 뷰) */
  selectModule: (moduleId: string) => void
  /** 뷰 전환 */
  selectView: (viewId: string) => void
  /** 컨텍스트 셀렉터 선택 변경 */
  setContextValue: (selectorId: string, optionId: string) => void
  /** 탭 열기 — 자리를 안 주면 **지금 자리를 복제**한다(탭 줄의 `+`). */
  openTab: (loc?: NavLocation) => void
  closeTab: (id: string) => void
  selectTab: (id: string) => void
  /** 번호로 고르기(`⌘1~9`). 범위를 넘으면 마지막 탭. */
  selectTabAt: (index: number) => void
  /** 옆 탭으로(`⌃Tab`). 끝에서는 반대쪽 끝으로 감는다. */
  stepTab: (delta: number) => void
  /** 끌어서 자리 옮기기 — `to` 는 옮긴 뒤 이 탭이 설 자리 번호. */
  moveTab: (id: string, to: number) => void
  /** 줄 밖으로 끌어 냈다 — 이 창에서 지우고 그 자리를 돌려준다(새 창은 부르는 쪽이 연다). */
  detachTab: (id: string) => NavLocation | null
  /** 다른 창에서 끌어 온 탭을 이 줄이 삼켰다 — 받은 자리에 끼우고 그 탭으로 옮겨 간다. */
  adoptTab: (loc: NavLocation, index: number) => void
}

/*
 * 초기 moduleId ''/viewId null 은 "각 계층의 첫 항목" 폴백으로 해석된다(useActive).
 * 파일을 읽는 시점에 nav 트리를 건드리지 않기 위한 장치 — 트리 접근은 전부 호출 시점
 * (액션/useActive)으로 미룬다. 트리를 `registry` 대신 `registryRef` 로 늦게 받는 이유도 같은
 * 결이다(그쪽 주석에 임포트 고리 사고가 적혀 있다).
 */
export const useNav = create<NavState>()(
  persist(
    (set, get) => ({
      // 열자마자 들 탭들은 **메인이 실행 인자로 실어 보낸다** — 창 배치의 주인이 메인이라
      // 첫 그림부터 제자리다. 못 받았으면(개발 중 새로고침 등) 기본 한 장.
      ...initialTabs(),
      contextValues: {},
      recall: emptyRecall(),

      selectService: (serviceId) => {
        const service = findService(serviceId)
        // 기억한 id 가 그 사이 없어졌으면 find* 가 첫 항목으로 떨어뜨린다 — 폴백이 곧 예전 규칙.
        const module = findModule(service, recallModule(get().recall, serviceId))
        const view = findView(module, recallView(get().recall, serviceId, module.id))
        set((s) => ({
          ...moveActiveTab(s, { serviceId, moduleId: module.id, viewId: view?.id ?? null }),
          recall: remember(s.recall, serviceId, module.id, view?.id ?? null),
          // 컨텍스트 선택(예: Design)은 유지한다 — 서비스를 오가도 다시 고르지 않도록.
          // 아직 안 고른 셀렉터에만 서비스 기본값을 채운다.
          contextValues: { ...defaultContext(service), ...s.contextValues }
        }))
      },

      selectModule: (moduleId) => {
        set((s) => {
          const { serviceId } = activeTab(s)
          const module = findModule(findService(serviceId), moduleId)
          const view = findView(module, recallView(s.recall, serviceId, module.id))
          return {
            ...moveActiveTab(s, { serviceId, moduleId: module.id, viewId: view?.id ?? null }),
            recall: remember(s.recall, serviceId, module.id, view?.id ?? null)
          }
        })
      },

      selectView: (viewId) =>
        set((s) => {
          const { serviceId, moduleId } = activeTab(s)
          // 아직 아무것도 안 누른 첫 화면이면 moduleId 가 '' 다(= "첫 모듈" 폴백) —
          // 기억의 열쇠로는 실제 모듈 id 를 써야 하므로 여기서 풀어 준다.
          const module = findModule(findService(serviceId), moduleId)
          return {
            ...moveActiveTab(s, { serviceId, moduleId, viewId }),
            recall: rememberView(s.recall, serviceId, module.id, viewId)
          }
        }),

      setContextValue: (selectorId, optionId) =>
        set((s) => ({ contextValues: { ...s.contextValues, [selectorId]: optionId } })),

      openTab: (loc) => set((s) => openTabIn(s, loc ?? activeTab(s))),
      closeTab: (id) => set((s) => closeTabIn(s, id)),
      selectTab: (id) => set((s) => selectTabIn(s, id)),
      selectTabAt: (index) => set((s) => selectTabAtIn(s, index)),
      stepTab: (delta) => set((s) => stepTabIn(s, delta)),
      moveTab: (id, to) => set((s) => moveTabIn(s, id, to)),

      detachTab: (id) => {
        const s = get()
        const leaving = s.tabs.find((t) => t.id === id)
        const { set: next, detached } = detachTabIn(s, id)
        if (!detached || !leaving) return null
        set(next)
        return { serviceId: leaving.serviceId, moduleId: leaving.moduleId, viewId: leaving.viewId }
      },

      adoptTab: (loc, index) => set((s) => insertTabIn(s, loc, index))
    }),
    {
      name: 'rockury.nav',
      // 떼어낸 창은 읽기만 한다 — 안 그러면 두 창이 서로의 대상 선택을 덮어쓴다(`windowSession`).
      storage: createJSONStorage(windowStorage),
      /*
       * **탭은 여기 안 담는다** — 창 배치의 주인은 메인 프로세스다(`main/windows.ts`). 저장소는
       * 창끼리 하나뿐이라 탭을 여기 담으면 두 창이 서로를 덮어쓴다. 남는 것은 창을 가리지 않는
       * 두 가지다: 지금 고른 대상(설계·접속 …)과 서비스·모듈마다의 "마지막에 본 자리".
       */
      partialize: (s) => ({ contextValues: s.contextValues, recall: s.recall }),
      merge: (persisted, current) => {
        // 저장본은 이 기능이 없던 시절 것일 수 있다 — 항목마다 걸러 받는다.
        // (옛 저장본에 남아 있는 자리·탭 키는 흘려 넣지 않는다. 그건 이제 메인이 든다.)
        const saved = (persisted ?? {}) as Partial<NavState>
        return {
          ...current,
          contextValues:
            saved.contextValues && typeof saved.contextValues === 'object'
              ? saved.contextValues
              : current.contextValues,
          recall: normalizeRecall(saved.recall)
        }
      }
    }
  )
)

/*
 * 탭이 바뀌면 **메인에 되보고한다** — 창 배치의 주인이 메인이라, 이 보고가 곧 다음 실행에
 * 되살아날 값이다. 대상 선택(contextValues)이 바뀌었을 때는 안 보낸다: 그건 창 안 이야기다.
 *
 * 스토어를 만든 **뒤에** 붙는다(파일 읽는 도중이 아니다) — 여기서 남을 부르면 임포트 고리에
 * 걸린다(`registryRef` 주석 참고).
 */
useNav.subscribe((s, prev) => {
  if (s.tabs === prev.tabs && s.activeTabId === prev.activeTabId) return
  window.rockury?.window?.report?.(toSession(s))
})

/**
 * 현재 활성 경로를 registry 기준으로 해석한다.
 * `leaf` 는 워크스페이스/툴바를 렌더할 실제 노드(View 또는 Module).
 */
export function useActive(): {
  service: Service
  module: Module
  view: View | null
  leaf: View | Module
} {
  const tab = useActiveTab()

  const service = findService(tab.serviceId)
  const module = findModule(service, tab.moduleId)
  const view = findView(module, tab.viewId)
  const leaf: View | Module = view ?? module

  return { service, module, view, leaf }
}

/** 지금 보고 있는 탭. 자리(서비스/모듈/뷰)의 정본이다. */
export function useActiveTab(): NavTab {
  return useNav((s) => activeTab(s))
}

/** 탭 하나가 가리키는 곳을 registry 기준으로 푼다 — 탭 줄이 이름·아이콘을 여기서 얻는다. */
export function resolveTab(tab: NavTab): { service: Service; module: Module; view: View | null } {
  const service = findService(tab.serviceId)
  const module = findModule(service, tab.moduleId)
  return { service, module, view: findView(module, tab.viewId) }
}
