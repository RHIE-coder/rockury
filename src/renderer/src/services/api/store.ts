import { useEffect } from 'react'
import { create } from 'zustand'
import { useContextOptions } from '@renderer/nav/contextOptions'
import { useNav } from '@renderer/nav/useNav'
import { filterByScope, type ProjectScope } from '@renderer/shell/projectScope'
import { useProjectStore } from '@renderer/shell/projectStore'
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
  /** 명세 전체 문서 저장. 글자마다 불리므로 재조회하지 않는다. */
  saveSpecDocs: (docs: string) => Promise<boolean>
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
    // 지금 보고 있는 프로젝트가 그대로 소속이 된다. 전체·프로젝트 없음이면 무소속.
    const scope = useProjectStore.getState().scope
    const projectId = scope.kind === 'one' ? scope.projectId : null
    const row = await window.rockury.apiSpecs.create({ name, kind, description, projectId })
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

  saveSpecDocs: async (docs) => {
    const spec = get().active
    if (!spec) return false
    // 글자를 치는 족족 불린다. 화면부터 바꾸고 저장한다 — 왕복을 기다리면 커서가 튄다.
    // 재조회도 안 한다: 문서는 다른 무엇도 파생시키지 않아 다시 읽을 이유가 없다.
    set({ active: { ...spec, docs } })
    try {
      await window.rockury.apiSpecs.update(spec.id, {
        name: spec.name,
        description: spec.description,
        docs
      })
      set({ error: null })
      return true
    } catch (e) {
      // 저장이 막혔으면 화면도 되돌린다 — 안 그러면 안 남은 글이 남은 듯 보인다.
      // 그 사이 다른 명세로 옮겼으면 손대지 않는다: 남의 화면에 이 명세의 글을 쓰게 된다.
      set((s) =>
        s.active?.id === spec.id
          ? { active: { ...s.active, docs: spec.docs }, error: ipcErrorText(e) }
          : { error: ipcErrorText(e) }
      )
      return false
    }
  },

  clearError: () => set({ error: null })
}))

void useApiStore.getState().init()

/**
 * specs → 'spec' 셀렉터 옵션 동기화. **프로젝트 범위로 먼저 거른다** —
 * 명세는 그 프로젝트의 산출물이라 남의 것도, 정체 모를 무소속도 섞이면 안 된다(strict).
 */
function pushSpecOptions(specs: SpecSummary[], scope: ProjectScope): void {
  useContextOptions.getState().setOptions(
    'spec',
    filterByScope(specs, scope, 'strict').map((s) => ({
      id: s.id,
      label: s.name,
      hint: interfaceMeta(s.kind).label,
      subtitle: s.description || undefined
    }))
  )
}
function syncSpecOptions(): void {
  pushSpecOptions(useApiStore.getState().specs, useProjectStore.getState().scope)
}

syncSpecOptions()
useApiStore.subscribe((s, prev) => {
  if (s.specs !== prev.specs) syncSpecOptions()
})
useProjectStore.subscribe((s, prev) => {
  if (s.scope !== prev.scope) syncSpecOptions()
  // 소속 정리 창이 저장소를 직접 고쳤다 — 우리가 든 사본은 아직 옛 소속이라 다시 읽는다.
  if (s.itemsRevision !== prev.itemsRevision) void useApiStore.getState().init()
})

/** 지금 프로젝트 범위에 드는 명세만. 목록 화면이 쓴다. */
export function useScopedSpecs(): SpecSummary[] {
  const specs = useApiStore((s) => s.specs)
  const scope = useProjectStore((s) => s.scope)
  return filterByScope(specs, scope, 'strict')
}

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
