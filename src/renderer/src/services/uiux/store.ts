import { create } from 'zustand'
import { useContextOptions } from '@renderer/nav/contextOptions'
import { useNav } from '@renderer/nav/useNav'
import { parseContent, serializeContent } from './content'
import type { SurfaceContent } from './types'

/**
 * 저장소 행 타입은 preload 창구에서 **추론**해 온다 — 렌더러가 preload·main 을 직접 import 하지
 * 않는 이 프로젝트의 경계를 지키면서(그렇다고 같은 타입을 손으로 한 벌 더 적으면 어긋난다).
 */
type Api = typeof window.rockury.uiux
export type SpecTree = Awaited<ReturnType<Api['getTree']>>
export type SpecProjectRow = Awaited<ReturnType<Api['listProjects']>>[number]
export type SpecApplicationRow = SpecTree['applications'][number]
export type SpecServiceRow = SpecTree['services'][number]
export type SpecSurfaceRow = SpecTree['surfaces'][number]
export type SpecLevel = Parameters<Api['createNode']>[0]

/**
 * UI/UX 설계 상태 — 명세 정본 `docs/spec/uiux-ia.md` §7.
 *
 * 위계(프로젝트·앱·서비스·화면)는 저장소가 정본이고 여기는 그 사본이다. 편집은 **낙관적 반영이
 * 아니라 저장 후 반영**이다 — 주소 유일성 같은 규칙을 저장소가 최종 판정하므로, 먼저 화면에
 * 그렸다가 되돌리면 사용자가 "됐다가 취소된" 것을 보게 된다.
 *
 * 화면 **내용**만 예외로 먼저 반영하고 저장한다: 트리 조작은 순수 함수가 이미 판정했고(`tree.ts`),
 * 매 클릭마다 왕복을 기다리면 편집이 끊긴다.
 */

export interface SpecState {
  projects: SpecProjectRow[]
  projectsLoaded: boolean

  /** 활성 프로젝트의 위계. 프로젝트가 안 골라졌으면 null. */
  tree: SpecTree | null
  treeLoading: boolean

  /** 지금 보고 있는 화면(Surface) id. */
  selectedSurfaceId: string | null
  /** 그 화면의 내용 — 저장소 JSON 을 파싱한 것. 화면이 안 골라졌으면 null. */
  content: SurfaceContent | null
  /** 화면 안에서 고른 조각(섹션 또는 컴포넌트) id. */
  selectedNodeId: string | null

  /** 마지막 오류 — 저장소가 거절한 이유를 그대로 보인다(주소 중복 등). */
  error: string | null

  /**
   * 노드 만들기·고치기 모달. 층마다 모달을 따로 두지 않는 이유는 저장소와 같다 —
   * 세 층의 입력이 같아서(주소 조각·이름·설명) 따로 두면 같은 폼이 세 벌 복제된다.
   * `editing` 이 있으면 고치기, 없으면 만들기.
   */
  dialog: {
    level: SpecLevel
    parentId: string | null
    editing?: { id: string; key: string; name: string; description: string; kind?: string }
  } | null
  openDialog: (dialog: NonNullable<SpecState['dialog']>) => void
  closeDialog: () => void

  init: () => Promise<void>
  loadTree: (projectId: string | null) => Promise<void>
  selectSurface: (surfaceId: string | null) => void
  selectNode: (nodeId: string | null) => void
  clearError: () => void

  createNode: (
    level: SpecLevel,
    parentId: string | null,
    input: { key: string; name: string; description?: string; kind?: string }
  ) => Promise<string | null>
  updateNode: (
    level: SpecLevel,
    id: string,
    patch: { key?: string; name?: string; description?: string; kind?: string }
  ) => Promise<boolean>
  deleteNode: (level: SpecLevel, id: string) => Promise<void>

  /** 화면 내용 편집 — `tree.ts` 순수 함수를 넘겨 부른다. 먼저 반영하고 저장한다. */
  editContent: (fn: (content: SurfaceContent) => SurfaceContent) => Promise<void>
}

const EMPTY_TREE: SpecTree = { applications: [], services: [], surfaces: [] }

/** 활성 프로젝트 id — 컨텍스트 바가 정본이라 스토어가 따로 들지 않는다(두 곳에 두면 어긋난다). */
function activeProjectId(): string | null {
  return useNav.getState().contextValues['project'] ?? null
}

export const useSpecStore = create<SpecState>()((set, get) => ({
  projects: [],
  projectsLoaded: false,
  tree: null,
  treeLoading: false,
  selectedSurfaceId: null,
  content: null,
  selectedNodeId: null,
  error: null,
  dialog: null,

  openDialog: (dialog) => set({ dialog, error: null }),
  closeDialog: () => set({ dialog: null }),

  init: async () => {
    const projects = await window.rockury.uiux.listProjects()
    set({ projects, projectsLoaded: true })
    const active = activeProjectId()
    if (active) await get().loadTree(active)
  },

  loadTree: async (projectId) => {
    if (!projectId) {
      set({ tree: null, selectedSurfaceId: null, content: null, selectedNodeId: null })
      return
    }
    set({ treeLoading: true })
    try {
      const tree = await window.rockury.uiux.getTree(projectId)
      set({ tree, treeLoading: false })
      // 고른 화면이 이 프로젝트에 없으면 선택을 놓는다(다른 프로젝트의 화면을 계속 열어 두지 않는다).
      const still = tree.surfaces.some((s) => s.id === get().selectedSurfaceId)
      if (!still) get().selectSurface(null)
    } catch (e) {
      set({ treeLoading: false, error: message(e) })
    }
  },

  selectSurface: (surfaceId) => {
    if (!surfaceId) {
      set({ selectedSurfaceId: null, content: null, selectedNodeId: null })
      return
    }
    const row = get().tree?.surfaces.find((s) => s.id === surfaceId)
    set({
      selectedSurfaceId: surfaceId,
      content: row ? parseContent(row.content) : null,
      selectedNodeId: null
    })
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  clearError: () => set({ error: null }),

  createNode: async (level, parentId, input) => {
    try {
      const { id } = await window.rockury.uiux.createNode(level, parentId, input)
      if (level === 'project') {
        const projects = await window.rockury.uiux.listProjects()
        set({ projects })
        // 첫 프로젝트를 만들면 바로 그것을 보게 한다 — 만들자마자 빈 화면이면 무엇을 한 건지 알 수 없다.
        useNav.getState().setContextValue('project', id)
      } else {
        await get().loadTree(activeProjectId())
      }
      return id
    } catch (e) {
      set({ error: message(e) })
      return null
    }
  },

  updateNode: async (level, id, patch) => {
    try {
      await window.rockury.uiux.updateNode(level, id, patch)
      if (level === 'project') set({ projects: await window.rockury.uiux.listProjects() })
      else await get().loadTree(activeProjectId())
      return true
    } catch (e) {
      set({ error: message(e) })
      return false
    }
  },

  deleteNode: async (level, id) => {
    try {
      await window.rockury.uiux.deleteNode(level, id)
      if (level === 'project') {
        const projects = await window.rockury.uiux.listProjects()
        set({ projects })
        if (activeProjectId() === id) {
          useNav.getState().setContextValue('project', projects[0]?.id ?? '')
        }
      } else {
        if (get().selectedSurfaceId === id) get().selectSurface(null)
        await get().loadTree(activeProjectId())
      }
    } catch (e) {
      set({ error: message(e) })
    }
  },

  editContent: async (fn) => {
    const { content, selectedSurfaceId, tree } = get()
    if (!content || !selectedSurfaceId) return
    const next = fn(content)
    if (next === content) return

    const raw = serializeContent(next)
    // 트리 사본의 원본 문자열도 같이 맞춘다 — 화면을 다시 고르면 여기서 읽으므로,
    // 안 맞추면 방금 한 편집이 되돌아간 것처럼 보인다.
    set({
      content: next,
      tree: tree
        ? {
            ...tree,
            surfaces: tree.surfaces.map((s) => (s.id === selectedSurfaceId ? { ...s, content: raw } : s))
          }
        : tree
    })
    try {
      await window.rockury.uiux.saveSurface(selectedSurfaceId, raw)
    } catch (e) {
      set({ error: message(e) })
    }
  }
}))

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 활성 프로젝트의 위계(없으면 빈 트리) — 화면이 null 검사를 반복하지 않게. */
export function useTree(): SpecTree {
  return useSpecStore((s) => s.tree) ?? EMPTY_TREE
}

/** 컨텍스트 바에서 고른 프로젝트. 미선택이면 null. */
export function useActiveProject(): SpecProjectRow | null {
  const projectId = useNav((s) => s.contextValues['project'])
  const projects = useSpecStore((s) => s.projects)
  return projects.find((p) => p.id === projectId) ?? null
}

// ── 컨텍스트 바 연동 ────────────────────────────────────────────────

/** projects → 컨텍스트 바 'project' 셀렉터 옵션 동기화. */
function pushProjectOptions(projects: SpecProjectRow[]): void {
  useContextOptions.getState().setOptions(
    'project',
    projects.map((p) => ({
      id: p.id,
      label: p.name,
      hint: p.key,
      subtitle: p.description || undefined
    }))
  )
}

pushProjectOptions(useSpecStore.getState().projects)
useSpecStore.subscribe((s, prev) => {
  if (s.projects !== prev.projects) pushProjectOptions(s.projects)
})

// 프로젝트를 바꾸면 그 위계를 다시 읽는다.
useNav.subscribe((s, prev) => {
  if (s.contextValues['project'] !== prev.contextValues['project']) {
    void useSpecStore.getState().loadTree(s.contextValues['project'] ?? null)
  }
})

// 앱 시작 시 프로젝트 목록 하이드레이션(위 구독이 옵션 동기화를 받아준다).
void useSpecStore.getState().init()
