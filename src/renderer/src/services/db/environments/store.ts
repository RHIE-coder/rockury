import { useEffect } from 'react'
import { create } from 'zustand'
import type { DialectId } from '../dialects'

/**
 * Environment(배포 바인딩) 렌더러 스토어(§IA · ops-plan Phase 1).
 *
 * - 영속 데이터(목록/CRUD)는 main 의 SQLite(window.rockury.environments, 봉투 패턴) 하이드레이션.
 * - **연결 상태(statusMap)는 휘발성** — DB 에 넣지 않고 zustand 메모리에만 둔다(§ops-plan).
 * designs/store 의 하이드레이션 관례를 그대로 따른다.
 */
export type EnvDbType = DialectId

export interface EnvironmentDef {
  id: string
  designId: string
  name: string
  dbType: EnvDbType
  host: string
  port: number
  database: string
  user: string
  sslEnabled: boolean
  sslConfig?: Record<string, unknown>
  targetVersion: string
  appliedVersion: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 환경 폼(생성/수정 공용) — 평문 password 포함(main 에서 암호화). */
export interface EnvFormInput {
  designId: string
  name: string
  dbType: EnvDbType
  host: string
  port: number
  database: string
  user: string
  password: string
  sslEnabled: boolean
  sslConfig?: Record<string, unknown>
  targetVersion: string
}

/** 휘발성 연결 상태 — 카드 배지/다이얼로그 배너의 시맨틱 컬러 근거. */
export interface ConnStatus {
  state: 'idle' | 'testing' | 'ok' | 'error'
  message?: string
  latencyMs?: number
  serverVersion?: string
}

interface EnvironmentsState {
  byDesign: Record<string, EnvironmentDef[]>
  loaded: Record<string, boolean>
  /** envId → 연결 상태(휘발). */
  statusMap: Record<string, ConnStatus>
  /** 다이얼로그: 열림 · 대상 설계 · 편집 중 환경(신규면 null). */
  dialogOpen: boolean
  dialogDesignId: string | null
  editing: EnvironmentDef | null

  ensureLoaded: (designId: string) => Promise<void>
  create: (form: EnvFormInput) => Promise<EnvironmentDef>
  update: (id: string, form: Partial<EnvFormInput>) => Promise<void>
  remove: (id: string) => Promise<void>
  setApplied: (id: string, version: string) => Promise<void>
  reorder: (designId: string, orderedIds: string[]) => Promise<void>
  /** 저장된 환경 연결 테스트(암호문 복호화는 main). 결과를 statusMap 에 반영. */
  testExisting: (id: string) => Promise<void>
  setStatus: (id: string, status: ConnStatus) => void

  openCreate: (designId: string) => void
  openEdit: (env: EnvironmentDef) => void
  closeDialog: () => void
}

export const useEnvironmentsStore = create<EnvironmentsState>()((set, get) => ({
  byDesign: {},
  loaded: {},
  statusMap: {},
  dialogOpen: false,
  dialogDesignId: null,
  editing: null,

  ensureLoaded: async (designId) => {
    if (get().loaded[designId]) return
    const rows = (await window.rockury.environments.list(designId)) as EnvironmentDef[]
    set((s) => ({
      byDesign: { ...s.byDesign, [designId]: rows },
      loaded: { ...s.loaded, [designId]: true }
    }))
  },

  create: async (form) => {
    const row = (await window.rockury.environments.create(form)) as EnvironmentDef
    set((s) => ({
      byDesign: {
        ...s.byDesign,
        [row.designId]: [...(s.byDesign[row.designId] ?? []), row]
      }
    }))
    return row
  },

  update: async (id, form) => {
    const row = (await window.rockury.environments.update(id, form)) as EnvironmentDef
    set((s) => ({
      byDesign: {
        ...s.byDesign,
        [row.designId]: (s.byDesign[row.designId] ?? []).map((e) => (e.id === id ? row : e))
      }
    }))
  },

  remove: async (id) => {
    await window.rockury.environments.delete(id)
    set((s) => {
      const byDesign: Record<string, EnvironmentDef[]> = {}
      for (const [d, list] of Object.entries(s.byDesign)) byDesign[d] = list.filter((e) => e.id !== id)
      const statusMap = { ...s.statusMap }
      delete statusMap[id]
      return { byDesign, statusMap }
    })
  },

  setApplied: async (id, version) => {
    const row = (await window.rockury.environments.setApplied(id, version)) as EnvironmentDef
    set((s) => ({
      byDesign: {
        ...s.byDesign,
        [row.designId]: (s.byDesign[row.designId] ?? []).map((e) => (e.id === id ? row : e))
      }
    }))
  },

  reorder: async (designId, orderedIds) => {
    // 낙관적 재배치 후 영속.
    set((s) => {
      const list = s.byDesign[designId] ?? []
      const byId = new Map(list.map((e) => [e.id, e]))
      const next = orderedIds.map((id) => byId.get(id)).filter((e): e is EnvironmentDef => !!e)
      return { byDesign: { ...s.byDesign, [designId]: next } }
    })
    await window.rockury.environments.reorder(orderedIds)
  },

  testExisting: async (id) => {
    get().setStatus(id, { state: 'testing' })
    try {
      const r = await window.rockury.environments.testById(id)
      get().setStatus(id, {
        state: r.success ? 'ok' : 'error',
        message: r.message,
        latencyMs: r.latencyMs,
        serverVersion: r.serverVersion
      })
    } catch (e) {
      get().setStatus(id, { state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  },

  setStatus: (id, status) => set((s) => ({ statusMap: { ...s.statusMap, [id]: status } })),

  openCreate: (designId) => set({ dialogOpen: true, dialogDesignId: designId, editing: null }),
  openEdit: (env) => set({ dialogOpen: true, dialogDesignId: env.designId, editing: env }),
  closeDialog: () => set({ dialogOpen: false, editing: null, dialogDesignId: null })
}))

/** 활성 설계의 환경 목록(로드 트리거 포함). */
export function useDesignEnvironments(designId: string | null): EnvironmentDef[] {
  const ensureLoaded = useEnvironmentsStore((s) => s.ensureLoaded)
  const list = useEnvironmentsStore((s) => (designId ? s.byDesign[designId] : undefined))
  useEffect(() => {
    if (designId) void ensureLoaded(designId)
  }, [designId, ensureLoaded])
  return list ?? []
}
