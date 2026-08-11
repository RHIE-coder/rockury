import { create } from 'zustand'
import { useContextOptions } from '@renderer/nav/contextOptions'
import { useContextValue, useNav } from '@renderer/nav/useNav'
import { filterByScope, type ProjectScope } from '@renderer/shell/projectScope'
import { useProjectStore } from '@renderer/shell/projectStore'
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
  /**
   * 범위(scope) — 이 설계에서 지금 보고 있는 스키마 목록. **빈 배열이면 전부 본다.**
   * 운영부의 `connections.schemas` 와 같은 자리다(§db-remote.scope). 다른 점은 기본값의 뜻:
   * 연결은 안 고르면 "기본 스키마 하나"지만(읽는 비용이 든다), 설계는 이미 손에 있어 다 보인다.
   */
  schemas: string[]
  /**
   * **이 설계가 선언한 스키마들** — 순서가 뜻을 갖는다(첫째가 새 표가 태어날 자리).
   *
   * `schemas`(보는 범위)와 다른 자리다. 범위는 눈에 보일 것을 줄였다 늘렸다 하는 값이고,
   * 이쪽은 "이 설계에 어떤 스키마가 있다"는 선언이다. 선언이 따로 있어야 **표가 하나도 없는
   * 빈 스키마**를 만들 수 있고, 그게 없어서 실 DB 를 물리지 않으면 설계를 시작할 수 없었다
   * (2026-08-11 사용자 지적).
   */
  declaredSchemas: string[]
  /** 속한 프로젝트. null 이면 무소속 — 프로젝트를 고르면 목록에서 숨는다(설계류 규칙). */
  projectId: string | null
}

interface DesignsState {
  designs: DesignDef[]
  /** IPC 하이드레이션 완료 여부. */
  loaded: boolean
  /** 새 설계 모달 열림 상태. */
  createOpen: boolean
  /** 설계 관리 모달 열림 상태. */
  manageOpen: boolean
  /** 스키마 관리 모달 열림 상태. */
  schemasOpen: boolean
  openCreate: () => void
  closeCreate: () => void
  openManage: () => void
  closeManage: () => void
  openSchemas: () => void
  closeSchemas: () => void
  /** 저장소에서 설계 목록을 불러와 채운다(앱 시작 시 1회). */
  init: () => Promise<void>
  /** 저장소에 새 설계를 만들고 로컬 상태에 반영. 생성된 id 반환. */
  addDesign: (input: {
    name: string
    description?: string
    dialect: DialectId
    schemaName?: string
  }) => Promise<string>
  /** 이름·설명 수정 (dialect 는 고정이라 변경 불가). */
  updateDesign: (id: string, patch: { name: string; description: string }) => Promise<void>
  /** 범위 갈아끼우기 — 낙관 반영 후 영속(연결 쪽 `setSchemas` 와 같은 규율). */
  setSchemas: (id: string, schemas: string[]) => Promise<void>
  /** 선언한 스키마 목록 갈아끼우기 — 추가·이름변경·삭제가 모두 이 하나를 거친다. */
  setDeclaredSchemas: (id: string, declaredSchemas: string[]) => Promise<void>
  /** 설계 삭제 — 저장소에서 소속 테이블도 함께 제거된다. */
  removeDesign: (id: string) => Promise<void>
}

const toDef = (r: {
  id: string
  name: string
  description: string
  dialect: string
  schemas?: string[]
  declaredSchemas?: string[]
  project_id?: string | null
}): DesignDef => ({
  id: r.id,
  name: r.name,
  description: r.description,
  dialect: r.dialect as DialectId,
  schemas: r.schemas ?? [],
  declaredSchemas: r.declaredSchemas ?? [],
  projectId: r.project_id ?? null
})

export const useDesignsStore = create<DesignsState>()((set, get) => ({
  designs: [],
  loaded: false,
  createOpen: false,
  manageOpen: false,
  schemasOpen: false,
  openCreate: () => set({ createOpen: true }),
  closeCreate: () => set({ createOpen: false }),
  openManage: () => set({ manageOpen: true }),
  closeManage: () => set({ manageOpen: false }),
  openSchemas: () => set({ schemasOpen: true }),
  closeSchemas: () => set({ schemasOpen: false }),
  init: async () => {
    const rows = await window.rockury.designs.list()
    set({ designs: rows.map(toDef), loaded: true })
  },
  addDesign: async ({ name, description = '', dialect, schemaName }) => {
    // 지금 보고 있는 프로젝트가 그대로 소속이 된다 — 폴더 안에서 파일을 만드는 것과 같다.
    // 전체·프로젝트 없음을 보고 있으면 무소속으로 만들어진다.
    const scope = useProjectStore.getState().scope
    const projectId = scope.kind === 'one' ? scope.projectId : null
    const row = await window.rockury.designs.create({
      name,
      description,
      dialect,
      projectId,
      schemaName
    })
    set((s) => ({ designs: [...s.designs, toDef(row)] }))
    return row.id
  },
  updateDesign: async (id, patch) => {
    const row = await window.rockury.designs.update(id, patch)
    set((s) => ({ designs: s.designs.map((d) => (d.id === id ? toDef(row) : d)) }))
  },
  setSchemas: async (id, schemas) => {
    // 낙관 반영 — 손잡이를 누른 즉시 목록이 따라와야 한다. 실패하면 되돌린다.
    const prev = get().designs.find((d) => d.id === id)?.schemas ?? []
    set((s) => ({ designs: s.designs.map((d) => (d.id === id ? { ...d, schemas } : d)) }))
    try {
      await window.rockury.designs.update(id, { schemas })
    } catch {
      set((s) => ({ designs: s.designs.map((d) => (d.id === id ? { ...d, schemas: prev } : d)) }))
    }
  },
  setDeclaredSchemas: async (id, declaredSchemas) => {
    // 낙관 반영 — 이름을 바꾸면 목록·표가 곧바로 따라와야 한다. 실패하면 되돌린다.
    const prev = get().designs.find((d) => d.id === id)?.declaredSchemas ?? []
    set((s) => ({ designs: s.designs.map((d) => (d.id === id ? { ...d, declaredSchemas } : d)) }))
    try {
      await window.rockury.designs.update(id, { declaredSchemas })
    } catch {
      set((s) => ({
        designs: s.designs.map((d) => (d.id === id ? { ...d, declaredSchemas: prev } : d))
      }))
    }
  },
  removeDesign: async (id) => {
    await window.rockury.designs.delete(id)
    set((s) => ({ designs: s.designs.filter((d) => d.id !== id) }))
  }
}))

// 앱 시작 시 저장소에서 설계를 하이드레이션(하위 구독이 옵션 동기화를 받아준다).
void useDesignsStore.getState().init()

/**
 * designs → 'design' 셀렉터 옵션 동기화. **프로젝트 범위로 먼저 거른다** —
 * 설계는 그 프로젝트의 산출물이라 남의 것도, 정체 모를 무소속도 섞이면 안 된다(strict).
 */
function pushDesignOptions(designs: DesignDef[], scope: ProjectScope): void {
  useContextOptions.getState().setOptions(
    'design',
    filterByScope(designs, scope, 'strict').map((d) => {
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
function syncDesignOptions(): void {
  pushDesignOptions(useDesignsStore.getState().designs, useProjectStore.getState().scope)
}

syncDesignOptions()
useDesignsStore.subscribe((s, prev) => {
  if (s.designs !== prev.designs) syncDesignOptions()
})
// 프로젝트를 바꾸면 셀렉터 목록도 그 자리에서 따라온다.
useProjectStore.subscribe((s, prev) => {
  if (s.scope !== prev.scope) {
    syncDesignOptions()
    // 범위 밖으로 나간 설계는 놓는다 — 안 그러면 손잡이는 "안 골랐다"고 말하는데 화면은
    // 남의 프로젝트 설계를 계속 붙들고 있다(2026-08-07 실측).
    useNav.getState().keepContextWithin('design', filterByScope(useDesignsStore.getState().designs, s.scope, 'strict').map((d) => d.id))
  }
  // 소속 정리 창이 저장소를 직접 고쳤다 — 우리가 든 사본은 아직 옛 소속이라 다시 읽는다.
  if (s.itemsRevision !== prev.itemsRevision) void useDesignsStore.getState().init()
})

/** 컨텍스트 바에서 선택된 활성 Design. 미선택이면 null. */
export function useActiveDesign(): DesignDef | null {
  const designId = useContextValue('design')
  const designs = useDesignsStore((s) => s.designs)
  return designs.find((d) => d.id === designId) ?? null
}

/** 지금 프로젝트 범위에 드는 설계만. 목록 화면(설계 관리 등)이 쓴다. */
export function useScopedDesigns(): DesignDef[] {
  const designs = useDesignsStore((s) => s.designs)
  const scope = useProjectStore((s) => s.scope)
  return filterByScope(designs, scope, 'strict')
}
