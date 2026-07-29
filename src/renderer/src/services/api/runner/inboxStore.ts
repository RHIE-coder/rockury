import { create } from 'zustand'
import type { ReceivedRequest } from '@shared/api/inbox'
import type { InboxStatus } from '../../../../../preload/services/api'
import { ipcErrorText } from '../errorText'

/**
 * 웹훅 수신 스토어 — `docs/spec/api-runner.md` § inbox.
 *
 * 스트림 스토어와 같은 성격이다 — **서버는 여기 안 산다.** 포트는 메인이 들고 있고 이건 그
 * 그림자다. 다른 점 하나: 스트림은 내가 접속을 시작하지만 여기는 **언제 올지 모르는 것을
 * 기다린다** — 그래서 화면이 떠 있지 않은 사이에 온 것도 따라잡아야 한다(`refresh`).
 */

/** 화면이 들고 있는 수신 상한. 메인과 같은 수 — 다르면 화면과 기록이 다른 수를 말한다. */
const MAX_RECEIVED = 500

interface InboxStoreState {
  status: InboxStatus
  received: ReceivedRequest[]
  /** 상한으로 목록에서 빠진 건수 — 메인이 센 것을 그대로 받는다. */
  dropped: number
  /** 켜기 전에 고르는 값. 켠 뒤에는 `status` 가 사실이다. */
  port: number
  responseCode: number
  error: string | null
  busy: boolean

  setPort: (p: number) => void
  setResponseCode: (c: number) => Promise<void>
  refresh: () => Promise<void>
  start: (input: { specId: string; requestName: string; environmentId: string }) => Promise<void>
  stop: () => Promise<void>
  clearError: () => void
}

const IDLE: InboxStatus = {
  listening: false,
  port: null,
  url: null,
  specId: null,
  requestName: null,
  responseCode: 200,
  dropped: 0
}

export const useInboxStore = create<InboxStoreState>()((set, get) => ({
  status: IDLE,
  received: [],
  dropped: 0,
  port: 7799,
  responseCode: 200,
  error: null,
  busy: false,

  setPort: (p) => set({ port: p }),

  setResponseCode: async (c) => {
    set({ responseCode: c })
    // 대기 중이면 메인에도 알린다 — 끊지 않고 바꾼다(재전송 유도를 켜고 끄는 자리).
    if (!get().status.listening) return
    try {
      set({ status: await window.rockury.apiInbox.setResponseCode(c) })
    } catch (e) {
      set({ error: ipcErrorText(e) })
    }
  },

  refresh: async () => {
    const { status, received } = await window.rockury.apiInbox.get()
    set({ status, received, dropped: status.dropped, responseCode: status.responseCode })
    if (status.port !== null) set({ port: status.port })
  },

  start: async (input) => {
    set({ busy: true, error: null })
    try {
      const status = await window.rockury.apiInbox.start({
        ...input,
        port: get().port,
        responseCode: get().responseCode
      })
      set({ status, received: [], dropped: 0 })
    } catch (e) {
      // 포트 충돌 사유·제안이 여기로 온다 — 몰래 다른 포트로 옮기지 않는다.
      set({ error: ipcErrorText(e) })
    } finally {
      set({ busy: false })
    }
  },

  stop: async () => {
    set({ busy: true })
    try {
      set({ status: await window.rockury.apiInbox.stop() })
    } finally {
      set({ busy: false })
    }
  },

  clearError: () => set({ error: null })
}))

// ── 메인에서 밀려오는 것 ───────────────────────────────────────────────────
// 모듈 최상단에 거는 이유: 화면이 안 떠 있는 사이에 온 것도 받아야 한다. 웹훅은 내가
// 시작한 것이 아니라 남이 보내는 것이라, 이 구독이 화면 수명에 묶이면 조용히 놓친다.

window.rockury.apiInbox.onReceived((e) => {
  const s = useInboxStore.getState()
  let received = [...s.received, e.received]
  if (received.length > MAX_RECEIVED) received = received.slice(received.length - MAX_RECEIVED)
  useInboxStore.setState({ received, dropped: e.dropped })
})

window.rockury.apiInbox.onStatus((status) => {
  useInboxStore.setState({ status, dropped: status.dropped })
})
