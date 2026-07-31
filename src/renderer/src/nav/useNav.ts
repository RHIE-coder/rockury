import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { registry } from './registry'
import {
  emptyRecall,
  normalizeRecall,
  recallModule,
  recallView,
  rememberModule,
  rememberView,
  type NavRecall
} from './recall'
import type { Module, Service, View } from './types'

/** 기억이 아직 없는 첫 실행의 진입 서비스 — 가장 구체화된 DB 서비스로 시작. */
const DEFAULT_SERVICE_ID = 'db'

function findService(serviceId: string): Service {
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

interface NavState {
  serviceId: string
  moduleId: string
  viewId: string | null
  /** 상단 컨텍스트 바의 선택값 (selectorId → optionId). 서비스별로 초기화된다. */
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
}

/*
 * 초기 moduleId ''/viewId null 은 "각 계층의 첫 항목" 폴백으로 해석된다(useActive).
 * 모듈 초기화 시점에 registry 를 평가하지 않기 위한 장치 — 서비스의 워크스페이스
 * 컴포넌트가 useNav 를 임포트하면 순환(useNav → registry → 서비스 → useNav)이 생기는데,
 * 번들 초기화 순서에 따라 registry 가 TDZ 상태일 수 있다. registry 접근은 전부
 * 호출 시점(액션/useActive)으로 미룬다.
 */
export const useNav = create<NavState>()(
  persist(
    (set, get) => ({
      serviceId: DEFAULT_SERVICE_ID,
      moduleId: '',
      viewId: null,
      contextValues: {},
      recall: emptyRecall(),

      selectService: (serviceId) => {
        const service = findService(serviceId)
        // 기억한 id 가 그 사이 없어졌으면 find* 가 첫 항목으로 떨어뜨린다 — 폴백이 곧 예전 규칙.
        const module = findModule(service, recallModule(get().recall, serviceId))
        const view = findView(module, recallView(get().recall, serviceId, module.id))
        set((s) => ({
          serviceId,
          moduleId: module.id,
          viewId: view?.id ?? null,
          recall: remember(s.recall, serviceId, module.id, view?.id ?? null),
          // 컨텍스트 선택(예: Design)은 유지한다 — 서비스를 오가도 다시 고르지 않도록.
          // 아직 안 고른 셀렉터에만 서비스 기본값을 채운다.
          contextValues: { ...defaultContext(service), ...s.contextValues }
        }))
      },

      selectModule: (moduleId) => {
        const { serviceId, recall } = get()
        const service = findService(serviceId)
        const module = findModule(service, moduleId)
        const view = findView(module, recallView(recall, serviceId, module.id))
        set({
          moduleId: module.id,
          viewId: view?.id ?? null,
          recall: remember(recall, serviceId, module.id, view?.id ?? null)
        })
      },

      selectView: (viewId) =>
        set((s) => {
          // 아직 아무것도 안 누른 첫 화면이면 moduleId 가 '' 다(= "첫 모듈" 폴백) —
          // 기억의 열쇠로는 실제 모듈 id 를 써야 하므로 여기서 풀어 준다.
          const module = findModule(findService(s.serviceId), s.moduleId)
          return { viewId, recall: rememberView(s.recall, s.serviceId, module.id, viewId) }
        }),

      setContextValue: (selectorId, optionId) =>
        set((s) => ({ contextValues: { ...s.contextValues, [selectorId]: optionId } }))
    }),
    {
      name: 'rockury.nav',
      storage: createJSONStorage(() => localStorage),
      // 선택 상태만 저장(액션 제외). 화면 위치도 저장한다 — 앱을 껐다 켜도 보던 자리로
      // 돌아온다(2026-07-30 사용자 피드백). 그전에는 저장하지 않아 늘 기본 진입이었다.
      partialize: (s) => ({
        contextValues: s.contextValues,
        recall: s.recall,
        serviceId: s.serviceId,
        moduleId: s.moduleId,
        viewId: s.viewId
      }),
      // 저장본은 이 기능이 없던 시절 것일 수 있다 — 기억 지도만 걸러 받는다.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<NavState>
        return { ...current, ...saved, recall: normalizeRecall(saved.recall) }
      }
    }
  )
)

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
  const serviceId = useNav((s) => s.serviceId)
  const moduleId = useNav((s) => s.moduleId)
  const viewId = useNav((s) => s.viewId)

  const service = findService(serviceId)
  const module = findModule(service, moduleId)
  const view = findView(module, viewId)
  const leaf: View | Module = view ?? module

  return { service, module, view, leaf }
}
