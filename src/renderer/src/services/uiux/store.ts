import { create } from 'zustand'
import { oneProject } from '@renderer/shell/projectScope'
import { useProjectStore } from '@renderer/shell/projectStore'
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
export type SpecNoteRow = Awaited<ReturnType<Api['listNotes']>>[number]
export type SpecVersionRow = Awaited<ReturnType<Api['listVersions']>>[number]

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

  /** 고른 화면에 달린 의견(핀). 화면을 바꾸면 함께 다시 읽는다. */
  notes: SpecNoteRow[]

  /** 이 프로젝트가 **덮어쓴** 토큰만(전부가 아니라 차이만 — 기본값이 바뀌면 따라오게). */
  tokens: Record<string, string>

  /** 설계 스냅샷 이력(최신순, 본문 제외). */
  versions: SpecVersionRow[]

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

  loadVersions: (projectId: string | null) => Promise<void>
  /** 지금 설계를 통째로 굳힌다. 만들어진 번호를 돌려준다. */
  cutVersion: (note: string) => Promise<string | null>

  loadTokens: (projectId: string | null) => Promise<void>
  /** 토큰 하나를 바꾼다. 빈 값이면 기본으로 되돌린다(지우기와 같은 뜻). */
  setToken: (path: string, value: string) => Promise<void>

  loadNotes: (surfaceId: string | null) => Promise<void>
  addNote: (target: string, body: string) => Promise<void>
  toggleNote: (id: string, resolved: boolean) => Promise<void>
  removeNote: (id: string) => Promise<void>
}

const EMPTY_TREE: SpecTree = { applications: [], services: [], surfaces: [] }

/**
 * 활성 프로젝트 id — **셸의 프로젝트 범위가 정본**이라 스토어가 따로 들지 않는다(두 곳에 두면 어긋난다).
 *
 * 범위는 셋인데(전체·프로젝트 하나·프로젝트 없음) 화면 설계 트리는 **뿌리 하나**를 요구한다.
 * 지목이 없는 두 경우에는 첫 프로젝트로 떨어진다 — UI/UX 를 열자마자 빈 화면을 보이느니
 * 무언가를 보이고, 셸에서 프로젝트를 고르면 그때부터 그것을 따른다.
 */
function activeProjectId(): string | null {
  const scope = useProjectStore.getState().scope
  if (scope.kind === 'one') return scope.projectId
  return useSpecStore.getState().projects[0]?.id ?? null
}

export const useSpecStore = create<SpecState>()((set, get) => ({
  projects: [],
  projectsLoaded: false,
  tree: null,
  treeLoading: false,
  selectedSurfaceId: null,
  content: null,
  selectedNodeId: null,
  notes: [],
  tokens: {},
  versions: [],
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
      void get().loadTokens(projectId)
      void get().loadVersions(projectId)
      // 고른 화면이 이 프로젝트에 없으면 선택을 놓는다(다른 프로젝트의 화면을 계속 열어 두지 않는다).
      const still = tree.surfaces.some((s) => s.id === get().selectedSurfaceId)
      if (!still) get().selectSurface(null)
    } catch (e) {
      set({ treeLoading: false, error: message(e) })
    }
  },

  selectSurface: (surfaceId) => {
    if (!surfaceId) {
      set({ selectedSurfaceId: null, content: null, selectedNodeId: null, notes: [] })
      return
    }
    const row = get().tree?.surfaces.find((s) => s.id === surfaceId)
    set({
      selectedSurfaceId: surfaceId,
      content: row ? parseContent(row.content) : null,
      selectedNodeId: null,
      notes: []
    })
    void get().loadNotes(surfaceId)
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  clearError: () => set({ error: null }),

  createNode: async (level, parentId, input) => {
    try {
      const { id } = await window.rockury.uiux.createNode(level, parentId, input)
      if (level === 'project') {
        const projects = await window.rockury.uiux.listProjects()
        set({ projects })
        // 만들면 바로 그것을 보게 한다 — 만들자마자 빈 화면이면 무엇을 한 건지 알 수 없다.
        // 셸 셀렉터가 범위의 정본이라 그쪽 목록도 함께 새로 읽는다.
        useProjectStore.setState({ scope: oneProject(id) })
        void useProjectStore.getState().load()
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
      if (level === 'project') {
        set({ projects: await window.rockury.uiux.listProjects() })
        void useProjectStore.getState().load() // 셀렉터에 뜬 이름도 함께 바뀌어야 한다
      } else await get().loadTree(activeProjectId())
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
        // 보고 있던 프로젝트를 지웠으면 범위를 되돌린다 — load() 의 stale 검사가 전체로 떨군다.
        void useProjectStore.getState().load()
      } else {
        if (get().selectedSurfaceId === id) get().selectSurface(null)
        await get().loadTree(activeProjectId())
      }
    } catch (e) {
      set({ error: message(e) })
    }
  },

  loadVersions: async (projectId) => {
    if (!projectId) {
      set({ versions: [] })
      return
    }
    try {
      set({ versions: await window.rockury.uiux.listVersions(projectId) })
    } catch (e) {
      set({ error: message(e) })
    }
  },

  cutVersion: async (note) => {
    const projectId = activeProjectId()
    const tree = get().tree
    if (!projectId || !tree) return null
    const { nextVersionNumber, takeSnapshot } = await import('./versions')
    const number = nextVersionNumber(get().versions.map((v) => v.number))
    try {
      await window.rockury.uiux.createVersion({
        projectId,
        number,
        note,
        snapshot: JSON.stringify(takeSnapshot(tree))
      })
      await get().loadVersions(projectId)
      return number
    } catch (e) {
      set({ error: message(e) })
      return null
    }
  },

  loadTokens: async (projectId) => {
    if (!projectId) {
      set({ tokens: {} })
      return
    }
    try {
      set({ tokens: await window.rockury.uiux.getTokens(projectId) })
    } catch (e) {
      set({ error: message(e) })
    }
  },

  setToken: async (path, value) => {
    const projectId = activeProjectId()
    if (!projectId) return
    const next = { ...get().tokens }
    if (value.trim() === '') delete next[path]
    else next[path] = value
    // 미리보기가 즉시 따라야 손맛이 산다 — 먼저 반영하고 저장한다(화면 내용 편집과 같은 판단).
    set({ tokens: next })
    try {
      await window.rockury.uiux.setTokens(projectId, next)
    } catch (e) {
      set({ error: message(e) })
    }
  },

  loadNotes: async (surfaceId) => {
    if (!surfaceId) {
      set({ notes: [] })
      return
    }
    try {
      set({ notes: await window.rockury.uiux.listNotes(surfaceId) })
    } catch (e) {
      set({ error: message(e) })
    }
  },

  addNote: async (target, body) => {
    const surfaceId = get().selectedSurfaceId
    if (!surfaceId || !body.trim()) return
    try {
      await window.rockury.uiux.createNote({ surfaceId, target, body })
      await get().loadNotes(surfaceId)
    } catch (e) {
      set({ error: message(e) })
    }
  },

  toggleNote: async (id, resolved) => {
    try {
      await window.rockury.uiux.setNoteResolved(id, resolved)
      await get().loadNotes(get().selectedSurfaceId)
    } catch (e) {
      set({ error: message(e) })
    }
  },

  removeNote: async (id) => {
    try {
      await window.rockury.uiux.deleteNote(id)
      await get().loadNotes(get().selectedSurfaceId)
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

/** 지금 보고 있는 프로젝트. 하나도 없으면 null. */
export function useActiveProject(): SpecProjectRow | null {
  const scope = useProjectStore((s) => s.scope)
  const projects = useSpecStore((s) => s.projects)
  if (scope.kind === 'one') return projects.find((p) => p.id === scope.projectId) ?? null
  return projects[0] ?? null
}

// ── 셸 프로젝트 범위 연동 ──────────────────────────────────────────

// 셸에서 범위를 바꾸면 그 위계를 다시 읽는다. 목록이 늦게 도착해도(첫 프로젝트 폴백이
// null → 실제 값으로 바뀔 때) 같은 자리에서 받아 준다.
useProjectStore.subscribe((s, prev) => {
  if (s.scope !== prev.scope || s.projects !== prev.projects) {
    void useSpecStore.getState().loadTree(activeProjectId())
  }
})

// 앱 시작 시 프로젝트 목록 하이드레이션(위 구독이 옵션 동기화를 받아준다).
void useSpecStore.getState().init()

// 에이전트(MCP) 쓰기 재조회 구독. 서비스 선언 파일(`index.tsx`)이 아니라 여기서 거는 이유:
// 그 파일은 스토어를 정적으로 끌지 않는 규율이라(파일 머리 주석) 거기 두면 규율이 깨진다.
// 이 스토어가 로드됐다는 건 UI/UX 화면이 열렸다는 뜻이고, 재조회가 필요한 때가 정확히 그때다.
import './rehydration'
