import { create } from 'zustand'

/**
 * AI › Agents 스토어 — 게이트웨이 상태 + 접속 키 관리.
 * 연동은 "등록 명령 복사" 방식(프로젝트별 파일 셋업 방식은 제거됨 — 앱이 프로젝트 파일을 안 건드린다).
 */

export interface McpStatus {
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

interface McpState {
  status: McpStatus | null
  loaded: boolean
  error: string | null
  /** 접속 키 노출 여부 — 기본 마스킹. 화면을 떠나면 다시 가려진다(마운트 시 리셋). */
  revealed: boolean
  rotating: boolean
  refresh: () => Promise<void>
  toggleReveal: () => void
  /** 접속 키 재발급 — 즉시 적용(구 키 401). 호출 전 UI 가 반드시 확인을 받는다. */
  rotate: () => Promise<void>
}

export const useMcpStore = create<McpState>()((set) => ({
  status: null,
  loaded: false,
  error: null,
  revealed: false,
  rotating: false,

  refresh: async () => {
    try {
      const status = await window.rockury.ai.status()
      set({ status, loaded: true, error: null, revealed: false })
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : String(e) })
    }
  },

  toggleReveal: () => set((s) => ({ revealed: !s.revealed })),

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
