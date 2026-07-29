import { useEffect } from 'react'
import { create } from 'zustand'
import { useNav } from '@renderer/nav/useNav'
import { diffSpecs, type DiffResult } from '@shared/api/breaking'
import type { SpecDef } from '@shared/api/types'
import { useApiStore } from '../store'
import type { VersionRecord } from '../../../../../preload/services/api'
import { ipcErrorText } from '../errorText'

/**
 * 버전 스토어 — `docs/spec/api-studio.md` § versions.
 *
 * 버전은 **명세 전체의 불변 스냅샷**이다. 컷한 뒤 Draft 를 고쳐도 스냅샷은 안 흔들린다 —
 * 그래야 "어느 버전 기준의 관측인가"가 뜻을 갖는다.
 */

/** Diff 의 한쪽으로 고를 수 있는 대상 — 버전 번호이거나 지금 Draft. */
export const DRAFT = '__draft__'

interface VersionsState {
  versions: VersionRecord[]
  loading: boolean
  error: string | null
  cutOpen: boolean
  /** Diff 에서 고른 양쪽. 기본은 최신 버전 ↔ Draft. */
  left: string | null
  right: string

  load: (specId: string | null) => Promise<void>
  openCut: () => void
  closeCut: () => void
  cut: (specId: string, number: string, note: string) => Promise<boolean>
  pick: (side: 'left' | 'right', value: string) => void
  clearError: () => void
}

export const useVersionsStore = create<VersionsState>()((set, get) => ({
  versions: [],
  loading: false,
  error: null,
  cutOpen: false,
  left: null,
  right: DRAFT,

  load: async (specId) => {
    if (!specId) {
      set({ versions: [], left: null, right: DRAFT })
      return
    }
    set({ loading: true })
    try {
      const versions = await window.rockury.apiSpecs.listVersions(specId)
      set((s) => ({
        versions,
        // 고른 게 사라졌으면 최신 ↔ Draft 로 되돌린다.
        left: versions.some((v) => v.number === s.left) ? s.left : (versions[0]?.number ?? null),
        right: s.right === DRAFT || versions.some((v) => v.number === s.right) ? s.right : DRAFT
      }))
    } finally {
      set({ loading: false })
    }
  },

  openCut: () => set({ cutOpen: true }),
  closeCut: () => set({ cutOpen: false }),

  cut: async (specId, number, note) => {
    try {
      await window.rockury.apiSpecs.createVersion(specId, number, note)
      await get().load(specId)
      await useApiStore.getState().init() // 목록 요약의 최신 버전 번호
      set({ error: null, cutOpen: false })
      return true
    } catch (e) {
      set({ error: ipcErrorText(e) })
      return false
    }
  },

  pick: (side, value) => set(side === 'left' ? { left: value } : { right: value }),
  clearError: () => set({ error: null })
}))

export function useVersionsSync(): void {
  const specId = useNav((s) => s.contextValues['spec']) || null
  useEffect(() => {
    void useApiStore.getState().loadSpec(specId)
    void useVersionsStore.getState().load(specId)
  }, [specId])
}

/** 다음 버전 번호 제안 — 마지막 번호의 끝자리를 올린다. 규칙을 모르면 v0.1.0. */
export function suggestNextNumber(versions: VersionRecord[]): string {
  const last = versions[0]?.number
  const m = last && /^v(\d+)\.(\d+)\.(\d+)$/.exec(last)
  if (!m) return 'v0.1.0'
  return `v${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}

/** 고른 대상을 실제 명세로 푼다. `DRAFT` 면 지금 Draft. */
export function resolveSide(target: string | null, versions: VersionRecord[], draft: SpecDef | null): SpecDef | null {
  if (!target) return null
  if (target === DRAFT) return draft
  return versions.find((v) => v.number === target)?.snapshot ?? null
}

/**
 * 컷 직전 판정 — 마지막 버전 대비 지금 Draft 가 무엇을 깨는가.
 * **버전 diff 와 같은 함수**(`diffSpecs`)를 쓴다 — 규칙이 두 곳에 갈라지면 한쪽만 고쳐진다.
 */
export function cutImpact(versions: VersionRecord[], draft: SpecDef | null): DiffResult | null {
  const base = versions[0]?.snapshot
  if (!base || !draft) return null
  return diffSpecs(base, draft)
}
