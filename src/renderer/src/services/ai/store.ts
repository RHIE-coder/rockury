import { create } from 'zustand'
import type { McpServiceTools } from './toolCatalog'

/**
 * AI › Agents 스토어 — 게이트웨이 상태 + 접속 키 관리.
 * 연동은 "등록 명령 복사" 방식(프로젝트별 파일 셋업 방식은 제거됨 — 앱이 프로젝트 파일을 안 건드린다).
 */

export interface AiStatus {
  running: boolean
  url: string | null
  port: number | null
  /** 접속 키(Bearer) — 화면 기본은 마스킹, 보기/복사/재발급은 사용자 조작으로만. */
  token: string | null
  claudeCommand: string | null
  codexCommand: string | null
  /** 접속 키를 재발급한 뒤 기존 등록을 다시 잇는 명령(remove→add). */
  claudeReregisterCommand: string | null
  codexReregisterCommand: string | null
}

interface AiServerState {
  status: AiStatus | null
  loaded: boolean
  error: string | null
  /** 접속 키 노출 여부 — 기본 마스킹. 화면을 떠나면 다시 가려진다(마운트 시 리셋). */
  revealed: boolean
  rotating: boolean
  /**
   * 에이전트에게 열어 둔 MCP 도구 목록(서비스별). null = 아직 안 읽음.
   * 앱을 켠 동안 바뀌지 않는 정적 목록이라 화면에 들어올 때 한 번만 읽는다.
   */
  catalog: McpServiceTools[] | null
  catalogError: string | null
  refresh: () => Promise<void>
  toggleReveal: () => void
  /** 접속 키 재발급 — 즉시 적용(구 키 401). 호출 전 UI 가 반드시 확인을 받는다. */
  rotate: () => Promise<void>
  loadTools: () => Promise<void>
}

export const useAiStore = create<AiServerState>()((set) => ({
  status: null,
  loaded: false,
  error: null,
  revealed: false,
  rotating: false,
  catalog: null,
  catalogError: null,

  refresh: async () => {
    try {
      const status = await window.rockury.ai.status()
      set({ status, loaded: true, error: null, revealed: false })
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : String(e) })
    }
  },

  toggleReveal: () => set((s) => ({ revealed: !s.revealed })),

  loadTools: async () => {
    try {
      const catalog = await window.rockury.ai.tools()
      set({ catalog, catalogError: null })
    } catch (e) {
      set({ catalogError: e instanceof Error ? e.message : String(e) })
    }
  },

  rotate: async () => {
    set({ rotating: true })
    try {
      const status = await window.rockury.ai.rotateToken()
      set({ status, rotating: false, error: null })
    } catch (e) {
      set({ rotating: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
}))
