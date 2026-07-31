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

/** Design 이 보고 있는 시점 — 편집 가능한 작업본. */
export const DRAFT_LENS = 'draft'

interface VersionsState {
  /** 설계별 버전 목록(최신순). */
  byDesign: Record<string, VersionDef[]>
  loaded: Record<string, boolean>
  /**
   * **Design 렌즈** — 지금 어느 시점의 설계를 보고 있는가.
   * `'draft'`(편집 가능) 또는 커밋 버전 번호(읽기 전용).
   *
   * 예전엔 상단 컨텍스트 바의 셀렉터였다. 그런데 컨텍스트 바의 다른 칸(Design·Connection)은
   * "무엇을 대상으로 하느냐"인데 이것만 "그 대상을 언제 시점으로 보느냐"라 성격이 달랐고,
   * 실제로 읽는 화면도 Design 셋뿐이라 운영부에서는 아무 일도 안 했다.
   * 그래서 상태를 이 서비스 스토어로 내리고, 손잡이는 Design 도구줄에 둔다(2026-07-29 사용자 결정).
   */
  lens: string
  setLens: (lens: string) => void
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
  lens: DRAFT_LENS,
  setLens: (lens) => set({ lens }),
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

/** 지금 Design 이 보고 있는 시점. */
export function useVersionLens(): string {
  return useVersionsStore((s) => s.lens)
}

/** 커밋된 버전을 보고 있으면 true — 그동안 Design 은 읽기 전용이다. */
export function isReadOnlyLens(lens: string): boolean {
  return !!lens && lens !== DRAFT_LENS
}

/** 활성 설계의 버전 목록(최신순). 로드되지 않았으면 트리거하고 빈 배열 반환. */
export function useDesignVersions(designId: string | null): VersionDef[] {
  const ensureLoaded = useVersionsStore((s) => s.ensureLoaded)
  const list = useVersionsStore((s) => (designId ? s.byDesign[designId] : undefined))
  useEffect(() => {
    if (designId) void ensureLoaded(designId)
  }, [designId, ensureLoaded])
  return list ?? []
}
