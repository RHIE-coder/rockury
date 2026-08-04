import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  SCOPE_ALL,
  scopeFromOptionId,
  scopeToOptionId,
  type ProjectScope
} from './projectScope'

export type Project = Awaited<ReturnType<typeof window.rockury.projects.list>>[number]

/**
 * 프로젝트 범위 상태 — 셸 셀렉터 하나가 들고, 다섯 서비스의 목록이 이 선택을 따른다.
 *
 * 어느 서비스 스토어도 이 값을 복제하지 않는다. 복제하면 서비스마다 "지금 어느 프로젝트"가
 * 달라져, 같은 앱 안에서 화면끼리 다른 것을 보게 된다.
 */
interface ProjectState {
  projects: Project[]
  scope: ProjectScope
  loaded: boolean
  /**
   * 소속이 바뀔 때마다 오르는 값. 각 서비스 스토어가 이걸 구독해 자기 목록을 다시 읽는다.
   *
   * 소속 정리 창은 저장소를 직접 고치므로, 이 신호가 없으면 서비스 스토어가 든 사본이 옛
   * 소속인 채 남는다(실측: 설계를 프로젝트로 옮겼는데 셀렉터가 계속 비어 있었다).
   * 셸이 서비스 스토어를 직접 부르지 않는 이유는 방향이다 — 서비스가 셸을 알지, 그 반대가 아니다.
   */
  itemsRevision: number

  load: () => Promise<void>
  setScope: (scope: ProjectScope) => void
  /** 소속을 고친 뒤 부른다 — 구독 중인 서비스 스토어들이 목록을 새로 읽는다. */
  markItemsChanged: () => void
  create: (input: { key: string; name: string; description?: string }) => Promise<Project>
  update: (id: string, patch: { key?: string; name?: string; description?: string }) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      scope: SCOPE_ALL,
      loaded: false,
      itemsRevision: 0,

      load: async () => {
        const projects = await window.rockury.projects.list()
        // 저장된 선택이 그 사이 지워진 프로젝트를 가리킬 수 있다 — 빈 목록을 보이느니 전체로 되돌린다.
        const scope = get().scope
        const stale = scope.kind === 'one' && !projects.some((p) => p.id === scope.projectId)
        set({ projects, loaded: true, ...(stale ? { scope: SCOPE_ALL } : {}) })
      },

      setScope: (scope) => set({ scope }),

      markItemsChanged: () => set((s) => ({ itemsRevision: s.itemsRevision + 1 })),

      create: async (input) => {
        const created = await window.rockury.projects.create(input)
        await get().load()
        return created
      },

      update: async (id, patch) => {
        await window.rockury.projects.update(id, patch)
        await get().load()
      },

      remove: async (id) => {
        await window.rockury.projects.remove(id)
        // 보고 있던 프로젝트를 지웠으면 전체로 — load() 의 stale 검사가 받아 준다.
        await get().load()
        // 소속됐던 것들이 무소속으로 돌아왔다 — 서비스 목록도 그 사실을 알아야 한다.
        get().markItemsChanged()
      }
    }),
    {
      name: 'rockury.project',
      storage: createJSONStorage(() => localStorage),
      // 목록은 저장하지 않는다(저장소가 정본이라 켤 때 다시 읽는다). 고른 범위만 남긴다.
      partialize: (s) => ({ scope: s.scope }),
      // 저장본은 이 기능이 없던 시절 것일 수 있다 — 옵션 id 로 접었다 펴서 모양을 보정한다.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ProjectState>
        const scope = saved.scope ? scopeFromOptionId(scopeToOptionId(saved.scope)) : SCOPE_ALL
        return { ...current, scope }
      }
    }
  )
)

/** 지금 고른 범위. 서비스 목록이 `filterByScope` 에 그대로 넘긴다. */
export function useProjectScope(): ProjectScope {
  return useProjectStore((s) => s.scope)
}
