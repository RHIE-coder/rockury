import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { registry } from './registry'
import type { Module, Service, View } from './types'

/** 기본 진입 서비스 — 이번 마일스톤에서 가장 구체화된 DB 서비스로 시작. */
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
  /** 서비스 전환 → 첫 모듈, 첫 뷰(있으면), 컨텍스트 기본값으로 초기화 */
  selectService: (serviceId: string) => void
  /** 모듈 전환 → 첫 뷰(있으면)로 초기화 */
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

      selectService: (serviceId) => {
        const service = findService(serviceId)
        const module = service.modules[0]
        set((s) => ({
          serviceId,
          moduleId: module.id,
          viewId: module.views?.[0]?.id ?? null,
          // 컨텍스트 선택(예: Design)은 유지한다 — 서비스를 오가도 다시 고르지 않도록.
          // 아직 안 고른 셀렉터에만 서비스 기본값을 채운다.
          contextValues: { ...defaultContext(service), ...s.contextValues }
        }))
      },

      selectModule: (moduleId) => {
        const service = findService(get().serviceId)
        const module = findModule(service, moduleId)
        set({ moduleId: module.id, viewId: module.views?.[0]?.id ?? null })
      },

      selectView: (viewId) => set({ viewId }),

      setContextValue: (selectorId, optionId) =>
        set((s) => ({ contextValues: { ...s.contextValues, [selectorId]: optionId } }))
    }),
    {
      name: 'rockury.nav',
      storage: createJSONStorage(() => localStorage),
      // 선택 상태만 저장(액션 제외). 화면 위치는 저장하지 않아 앱은 항상 기본 진입.
      partialize: (s) => ({ contextValues: s.contextValues })
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
