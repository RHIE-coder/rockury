import { useEffect } from 'react'
import { create } from 'zustand'
import { useContextOptions } from '@renderer/nav/contextOptions'
import { useNav } from '@renderer/nav/useNav'
import { interfaceMeta, type InterfaceKind, type RequestDef, type SpecDef } from '@shared/api/types'
import type { SpecSummary } from '../../../../preload/services/api'
import { ipcErrorText } from './errorText'

/**
 * API 명세 스토어 — 컨텍스트 바의 Spec 셀렉터와 Studio 화면이 함께 쓴다.
 *
 * 데이터 규칙(이름 유일·모양 정합 등)은 여기 두지 않는다 — 메인 스토어가 강제한다.
 * 화면에 두면 MCP 경로가 그대로 우회하기 때문이다(spec api-service §4).
 * 여기서는 저장 실패를 **삼키지 않고** 화면에 올리는 것까지가 몫이다.
 */

interface ApiState {
  specs: SpecSummary[]
  loaded: boolean
  /** 지금 열려 있는 명세의 전체 내용(요청 포함). 컨텍스트 바 선택을 따라간다. */
  active: SpecDef | null
  /** Studio 트리에서 고른 요청 이름. */
  selectedRequest: string | null
  /** 마지막 저장 실패 문구. 조용히 넘기지 않는다. */
  error: string | null
  createOpen: boolean
  /** 가져오기·내보내기 모달. */
  transferOpen: boolean

  init: () => Promise<void>
  openCreate: () => void
  closeCreate: () => void
  openTransfer: () => void
  closeTransfer: () => void
  addSpec: (input: { name: string; kind: InterfaceKind; description?: string }) => Promise<string>
  loadSpec: (id: string | null) => Promise<void>
  selectRequest: (name: string | null) => void
  /** 요청 전량 교체 후 재조회. 실패하면 화면에 이유를 올리고 상태를 되돌린다. */
  saveRequests: (requests: RequestDef[]) => Promise<boolean>
  clearError: () => void
}

export const useApiStore = create<ApiState>()((set, get) => ({
  specs: [],
  loaded: false,
  active: null,
  selectedRequest: null,
  error: null,
  createOpen: false,
  transferOpen: false,

  init: async () => {
    const specs = await window.rockury.apiSpecs.list()
    set({ specs, loaded: true })
  },

  openCreate: () => set({ createOpen: true }),
  closeCreate: () => set({ createOpen: false }),
  openTransfer: () => set({ transferOpen: true }),
  closeTransfer: () => set({ transferOpen: false }),

  addSpec: async ({ name, kind, description = '' }) => {
    const row = await window.rockury.apiSpecs.create({ name, kind, description })
    set((s) => ({ specs: [...s.specs, row] }))
    return row.id
  },

  loadSpec: async (id) => {
    if (!id) {
      set({ active: null, selectedRequest: null })
      return
    }
    const spec = await window.rockury.apiSpecs.get(id)
    set((s) => ({
      active: spec,
      // 고른 요청이 그대로 남아 있으면 선택을 유지한다(에이전트 쓰기로 재조회될 때 튀지 않게).
      selectedRequest: spec?.requests.some((r) => r.name === s.selectedRequest)
        ? s.selectedRequest
        : (spec?.requests[0]?.name ?? null)
    }))
  },

  selectRequest: (name) => set({ selectedRequest: name }),

  saveRequests: async (requests) => {
    const spec = get().active
    if (!spec) return false
    try {
      await window.rockury.apiSpecs.setRequests(spec.id, requests)
      await get().loadSpec(spec.id)
      await get().init() // 요청 수가 목록 요약에 실린다
      set({ error: null })
      return true
    } catch (e) {
      set({ error: ipcErrorText(e) })
      return false
    }
  },

  clearError: () => set({ error: null })
}))

void useApiStore.getState().init()

/** specs → 컨텍스트 바 'spec' 셀렉터 옵션 동기화. */
function pushSpecOptions(specs: SpecSummary[]): void {
  useContextOptions.getState().setOptions(
    'spec',
    specs.map((s) => ({
      id: s.id,
      label: s.name,
      hint: interfaceMeta(s.kind).label,
      subtitle: s.description || undefined
    }))
  )
}
pushSpecOptions(useApiStore.getState().specs)
useApiStore.subscribe((s, prev) => {
  if (s.specs !== prev.specs) pushSpecOptions(s.specs)
})

/** 컨텍스트 바 선택이 바뀌면 그 명세를 통째로 읽어 온다. */
useNav.subscribe((s, prev) => {
  if (s.contextValues['spec'] !== prev.contextValues['spec']) {
    void useApiStore.getState().loadSpec(s.contextValues['spec'] ?? null)
  }
})

export function useActiveSpecId(): string | null {
  return useNav((s) => s.contextValues['spec']) ?? null
}

/**
 * 설계부 화면이 뜰 때 명세를 다시 읽는다.
 *
 * 컨텍스트 전환 구독만으로는 부족하다 — **이미 골라져 있는 명세로 진입하면 전환이 안 일어난다.**
 * 화면 밖에서 바뀐 것(에이전트 쓰기·다른 화면의 저장)도 여기서 따라잡는다.
 */
export function useSpecSync(): void {
  const specId = useNav((s) => s.contextValues['spec']) || null
  useEffect(() => {
    void useApiStore.getState().loadSpec(specId)
  }, [specId])
}
