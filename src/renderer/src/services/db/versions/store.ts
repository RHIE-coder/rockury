import { useEffect } from 'react'
import { create } from 'zustand'
import type { TableDef } from '../workspaces/definition/types'
import type { SeedSet } from '../workspaces/seed/types'

/**
 * 버전 스냅샷 — 컷 시점의 설계 스키마 전체 + 시드(기준 데이터)를 담는다.
 * `seeds` 는 **옵셔널**이다: 시드 개념이 없던 옛 스냅샷이 그대로 남아 있고, 실 DB 역설계로
 * 만든 스냅샷(Drift·가져오기)에도 시드가 없다 — 읽는 쪽이 "없음 = 빈 목록"으로 다룬다.
 */
export interface VersionSnapshot {
  tables: TableDef[]
  seeds?: SeedSet[]
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
  /** 저장소에서 다시 읽어 덮는다 — 에이전트(MCP) 버전 컷 리하이드레이션용. 미로드 설계는 lazy 로딩 몫. */
  refresh: (designId: string) => Promise<void>
  cut: (input: {
    designId: string
    number: string
    note: string
    snapshot: VersionSnapshot
  }) => Promise<void>
  /** 버전 삭제(잘못 컷된 버전 회수). 저장소에서 지우고 로컬 목록에서도 제거. */
  remove: (designId: string, id: string) => Promise<void>
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
  refresh: async (designId) => {
    if (!get().loaded[designId]) return
    const rows = await window.rockury.versions.list(designId)
    set((s) => ({ byDesign: { ...s.byDesign, [designId]: rows.map(toDef) } }))
  },
  cut: async ({ designId, number, note, snapshot }) => {
    const row = await window.rockury.versions.create({ designId, number, note, snapshot })
    const def = toDef(row)
    set((s) => ({
      byDesign: { ...s.byDesign, [designId]: [def, ...(s.byDesign[designId] ?? [])] }
    }))
  },
  remove: async (designId, id) => {
    await window.rockury.versions.delete(id)
    set((s) => ({
      byDesign: { ...s.byDesign, [designId]: (s.byDesign[designId] ?? []).filter((v) => v.id !== id) }
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
