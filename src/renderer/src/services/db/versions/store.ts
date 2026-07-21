import { useEffect } from 'react'
import { create } from 'zustand'
import type { TableDef } from '../workspaces/definition/types'

/** 버전 스냅샷 — 컷 시점의 설계 스키마 전체를 담는다. */
export interface VersionSnapshot {
  tables: TableDef[]
}

export interface VersionDef {
  id: string
  designId: string
  number: string
  note: string
  snapshot: VersionSnapshot
  locked: boolean
  createdAt: string
}

const toDef = (r: {
  id: string
  designId: string
  number: string
  note: string
  snapshot: unknown
  locked: boolean
  createdAt: string
}): VersionDef => ({
  id: r.id,
  designId: r.designId,
  number: r.number,
  note: r.note,
  snapshot: (r.snapshot ?? { tables: [] }) as VersionSnapshot,
  locked: r.locked,
  createdAt: r.createdAt
})

interface VersionsState {
  /** 설계별 버전 목록(최신순). */
  byDesign: Record<string, VersionDef[]>
  loaded: Record<string, boolean>
  ensureLoaded: (designId: string) => Promise<void>
  cut: (input: {
    designId: string
    number: string
    note: string
    snapshot: VersionSnapshot
  }) => Promise<void>
}

export const useVersionsStore = create<VersionsState>()((set, get) => ({
  byDesign: {},
  loaded: {},
  ensureLoaded: async (designId) => {
    if (get().loaded[designId]) return
    const rows = await window.rockury.versions.list(designId)
    set((s) => ({
      byDesign: { ...s.byDesign, [designId]: rows.map(toDef) },
      loaded: { ...s.loaded, [designId]: true }
    }))
  },
  cut: async ({ designId, number, note, snapshot }) => {
    const row = await window.rockury.versions.create({ designId, number, note, snapshot })
    const def = toDef(row)
    set((s) => ({
      byDesign: { ...s.byDesign, [designId]: [def, ...(s.byDesign[designId] ?? [])] }
    }))
  }
}))

/** 활성 설계의 버전 목록(최신순). 로드되지 않았으면 트리거하고 빈 배열 반환. */
export function useDesignVersions(designId: string | null): VersionDef[] {
  const ensureLoaded = useVersionsStore((s) => s.ensureLoaded)
  const list = useVersionsStore((s) => (designId ? s.byDesign[designId] : undefined))
  useEffect(() => {
    if (designId) void ensureLoaded(designId)
  }, [designId, ensureLoaded])
  return list ?? []
}
