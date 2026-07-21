import { create } from 'zustand'
import { useContextOptions } from '@renderer/nav/contextOptions'
import { useNav } from '@renderer/nav/useNav'
import { dialectInfo, type DialectId } from '../dialects'

/**
 * Design(설계) — 이름·버전을 가진 스키마 청사진(§IA).
 *
 * 저장소는 이제 앱 로컬 SQLite(메인 프로세스, window.rockury.designs 경유)다.
 * dialect 는 생성 시 1회 결정되는 고정 속성 — 벤더 변경은 포팅(새 설계)으로만.
 */
export interface DesignDef {
  id: string
  name: string
  description: string
  dialect: DialectId
}

interface DesignsState {
  designs: DesignDef[]
  /** IPC 하이드레이션 완료 여부. */
  loaded: boolean
  /** 새 설계 모달 열림 상태. */
  createOpen: boolean
  /** 설계 관리 모달 열림 상태. */
  manageOpen: boolean
  openCreate: () => void
  closeCreate: () => void
  openManage: () => void
  closeManage: () => void
  /** 저장소에서 설계 목록을 불러와 채운다(앱 시작 시 1회). */
  init: () => Promise<void>
  /** 저장소에 새 설계를 만들고 로컬 상태에 반영. 생성된 id 반환. */
  addDesign: (input: { name: string; description?: string; dialect: DialectId }) => Promise<string>
  /** 이름·설명 수정 (dialect 는 고정이라 변경 불가). */
  updateDesign: (id: string, patch: { name: string; description: string }) => Promise<void>
  /** 설계 삭제 — 저장소에서 소속 테이블도 함께 제거된다. */
  removeDesign: (id: string) => Promise<void>
}

const toDef = (r: { id: string; name: string; description: string; dialect: string }): DesignDef => ({
  id: r.id,
  name: r.name,
  description: r.description,
  dialect: r.dialect as DialectId
})

export const useDesignsStore = create<DesignsState>()((set) => ({
  designs: [],
  loaded: false,
  createOpen: false,
  manageOpen: false,
  openCreate: () => set({ createOpen: true }),
  closeCreate: () => set({ createOpen: false }),
  openManage: () => set({ manageOpen: true }),
  closeManage: () => set({ manageOpen: false }),
  init: async () => {
    const rows = await window.rockury.designs.list()
    set({ designs: rows.map(toDef), loaded: true })
  },
  addDesign: async ({ name, description = '', dialect }) => {
    const row = await window.rockury.designs.create({ name, description, dialect })
    set((s) => ({ designs: [...s.designs, toDef(row)] }))
    return row.id
  },
  updateDesign: async (id, patch) => {
    const row = await window.rockury.designs.update(id, patch)
    set((s) => ({ designs: s.designs.map((d) => (d.id === id ? toDef(row) : d)) }))
  },
  removeDesign: async (id) => {
    await window.rockury.designs.delete(id)
    set((s) => ({ designs: s.designs.filter((d) => d.id !== id) }))
  }
}))

// 앱 시작 시 저장소에서 설계를 하이드레이션(하위 구독이 옵션 동기화를 받아준다).
void useDesignsStore.getState().init()

/** designs → 컨텍스트 바 'design' 셀렉터 옵션 동기화. */
function pushDesignOptions(designs: DesignDef[]): void {
  useContextOptions.getState().setOptions(
    'design',
    designs.map((d) => {
      const info = dialectInfo(d.dialect)
      return {
        id: d.id,
        label: d.name,
        hint: info.label,
        dot: info.dot,
        subtitle: d.description || undefined
      }
    })
  )
}
pushDesignOptions(useDesignsStore.getState().designs)
useDesignsStore.subscribe((s, prev) => {
  if (s.designs !== prev.designs) pushDesignOptions(s.designs)
})

/** 컨텍스트 바에서 선택된 활성 Design. 미선택이면 null. */
export function useActiveDesign(): DesignDef | null {
  const designId = useNav((s) => s.contextValues['design'])
  const designs = useDesignsStore((s) => s.designs)
  return designs.find((d) => d.id === designId) ?? null
}
