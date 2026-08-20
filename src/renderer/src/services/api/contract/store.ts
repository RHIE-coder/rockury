import { useEffect } from 'react'
import { create } from 'zustand'
import { useContextValue } from '@renderer/nav/useNav'
import type { DriftResult } from '@shared/api/drift'
import type { AbsorbPreview } from '@shared/api/absorb'
import type { ContractLog } from '../../../../../preload/services/api'
import { useApiStore } from '../store'
import { ipcErrorText } from '../errorText'

/**
 * 판정 스토어.
 *
 * 화면이 지켜야 하는 것 하나: **결과가 없는 것과 어긋남이 없는 것을 섞지 않는다.**
 * `drift === null` 은 "아직 안 돌렸다"이지 "이상 없다"가 아니다.
 */

interface ContractState {
  /** 마지막 판정 결과. null 이면 **아직 안 돌렸다**(이상 없음이 아니다). */
  drift: DriftResult | null
  ranAt: string | null
  logs: ContractLog[]
  preview: AbsorbPreview | null
  running: boolean
  error: string | null

  load: (specId: string | null) => Promise<void>
  run: (specId: string, environmentId: string) => Promise<void>
  makePreview: (specId: string, environmentId: string, requestNames: string[]) => Promise<void>
  accept: (specId: string, environmentId: string, requestNames: string[]) => Promise<void>
  clearPreview: () => void
  clearError: () => void
}

export const useContractStore = create<ContractState>()((set, get) => ({
  drift: null,
  ranAt: null,
  logs: [],
  preview: null,
  running: false,
  error: null,

  load: async (specId) => {
    if (!specId) {
      set({ drift: null, ranAt: null, logs: [] })
      return
    }
    const [log, logs] = await Promise.all([
      window.rockury.apiContract.getDrift(specId),
      window.rockury.apiContract.listLogs(specId)
    ])
    set({
      drift: log ? (log.payload as DriftResult) : null,
      ranAt: log?.createdAt ?? null,
      logs
    })
  },

  run: async (specId, environmentId) => {
    set({ running: true, error: null })
    try {
      const drift = await window.rockury.apiContract.runDrift(specId, environmentId)
      set({ drift, ranAt: new Date().toISOString() })
      set({ logs: await window.rockury.apiContract.listLogs(specId) })
    } catch (e) {
      set({ error: ipcErrorText(e) })
    } finally {
      set({ running: false })
    }
  },

  makePreview: async (specId, environmentId, requestNames) => {
    try {
      set({ preview: await window.rockury.apiContract.previewAbsorb(specId, environmentId, requestNames) })
    } catch (e) {
      set({ error: ipcErrorText(e) })
    }
  },

  accept: async (specId, environmentId, requestNames) => {
    try {
      await window.rockury.apiContract.acceptAbsorb(specId, environmentId, requestNames)
      set({ preview: null })
      // 흡수는 Draft 를 바꾼다 — 명세를 다시 읽어야 Studio 화면이 따라온다.
      await useApiStore.getState().loadSpec(specId)
      await get().load(specId)
    } catch (e) {
      set({ error: ipcErrorText(e) })
    }
  },

  clearPreview: () => set({ preview: null }),
  clearError: () => set({ error: null })
}))

/** 판정 화면이 뜰 때 지난 결과·이력을 읽는다. */
export function useContractSync(): void {
  const specId = useContextValue('spec') || null
  useEffect(() => {
    void useApiStore.getState().loadSpec(specId)
    void useContractStore.getState().load(specId)
  }, [specId])
}
