import { create } from 'zustand'
import type { StreamMessage, StreamState } from '@shared/api/types'
import type { StreamTransport } from '@shared/api/stream'
import { ipcErrorText } from '../errorText'

/**
 * 스트림 세션 스토어
 *
 * **세션은 여기 안 산다.** 소켓은 메인 프로세스가 들고 있고 이 스토어는 그 그림자다 —
 * 화면을 나갔다 와도 세션이 안 끊기는 것이 그 덕이다. 여기서 하는 일은 밀려오는 이벤트를
 * 타임라인에 쌓고, 마지막 상태와 이유를 들고 있는 것뿐이다.
 */

/**
 * 화면이 들고 있는 타임라인 상한. 메인도 5,000건에서 자르는데(`streamSession.ts`) 여기 상한이
 * 없으면 **화면과 기록이 다른 수를 말한다** — 초당 100건짜리 세션을 10분 열면 화면은 6만 건을
 * 쌓고 전부 그리는데(DOM 40만 노드) 저장된 기록은 5,000건이다. 같은 수로 맞춘다.
 */
const MAX_TIMELINE = 5_000

interface StreamStoreState {
  sessionId: string | null
  /** 어느 요청의 세션인가 — 요청을 바꾸면 타임라인이 남의 것으로 보이면 안 된다. */
  requestName: string | null
  transport: StreamTransport | null
  /** 가려진 접속 주소. */
  url: string
  state: StreamState
  messages: StreamMessage[]
  /** 끊긴 이유 (AC-1). */
  reason: string | null
  /** 세션이 Run 으로 굳었을 때의 한 줄 — 무엇이 남았는지 알린다. */
  savedNote: string | null
  /** 상한으로 타임라인에서 빠진 건수 — 메인이 센 것을 그대로 받는다(조용한 소실 금지). */
  dropped: number
  autoReconnect: boolean
  error: string | null
  busy: boolean

  setAutoReconnect: (on: boolean) => void
  open: (input: { specId: string; requestName: string; environmentId: string; call: Record<string, string> }) => Promise<void>
  send: (text: string) => Promise<boolean>
  close: () => Promise<void>
  /** 요청을 바꾸거나 화면을 벗어날 때 — 세션은 안 건드리고 화면 상태만 비운다. */
  resetIfIdle: () => void
  clearError: () => void
}

export const useStreamStore = create<StreamStoreState>()((set, get) => ({
  sessionId: null,
  requestName: null,
  transport: null,
  url: '',
  state: 'idle',
  messages: [],
  reason: null,
  savedNote: null,
  dropped: 0,
  autoReconnect: false,
  error: null,
  busy: false,

  setAutoReconnect: (on) => set({ autoReconnect: on }),

  open: async (input) => {
    // **id 를 먼저 정하고 상태에 심은 뒤 부른다.** 메인이 만들어 응답으로 주면, 붙자마자
    // 동기로 실패하는 경우(주소 스킴 오타 등) 오류·종료 이벤트가 응답보다 먼저 도착해
    // 아래 구독이 "내 세션이 아니다"로 버린다 — 그러면 '접속 중' 에 영구히 갇히고 끊기
    // 버튼도 죽는다(세션은 이미 정리됐으므로 아무 일도 안 일어난다).
    const sessionId = `str_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
    set({
      sessionId,
      requestName: input.requestName,
      busy: true,
      error: null,
      savedNote: null,
      messages: [],
      dropped: 0,
      reason: null,
      state: 'connecting'
    })
    try {
      const res = await window.rockury.apiStream.open({
        ...input,
        sessionId,
        autoReconnect: get().autoReconnect
      })
      set({ transport: res.transport, url: res.url })
    } catch (e) {
      // 못 붙는 이유(미지원 인터페이스·미해결 참조)가 여기로 온다 — 빈 화면으로 두지 않는다.
      // 세션이 아예 안 열렸으므로 id 도 놓아 준다(안 놓으면 '접속 중' 으로 남는다).
      set({ sessionId: null, state: 'idle', error: ipcErrorText(e) })
    } finally {
      set({ busy: false })
    }
  },

  send: async (text) => {
    const id = get().sessionId
    if (!id) return false
    try {
      await window.rockury.apiStream.send(id, text)
      return true
    } catch (e) {
      set({ error: ipcErrorText(e) })
      return false
    }
  },

  close: async () => {
    const id = get().sessionId
    if (!id) return
    // Run 저장·마지막 상태는 `onEnded` 로 온다 — 사용자가 껐든 서버가 끊었든 같은 길이다.
    await window.rockury.apiStream.close(id)
  },

  resetIfIdle: () => {
    const s = get()
    if (s.state === 'open' || s.state === 'connecting') return
    set({
      sessionId: null,
      requestName: null,
      transport: null,
      url: '',
      state: 'idle',
      messages: [],
      dropped: 0,
      reason: null,
      savedNote: null
    })
  },

  clearError: () => set({ error: null })
}))

// ── 메인에서 밀려오는 것 ───────────────────────────────────────────────────
// 구독을 스토어 밖 모듈 최상단에 거는 이유: 화면이 마운트되기 전에 온 이벤트도 받아야
// 한다(세션은 화면보다 오래 산다). 화면에서 걸면 잠깐 나갔다 온 사이의 메시지를 잃는다.

window.rockury.apiStream.onEvent((e) => {
  const s = useStreamStore.getState()
  if (e.sessionId !== s.sessionId) return
  let messages = s.messages
  if (e.messages.length > 0) {
    messages = [...s.messages, ...e.messages]
    // 메인과 같은 상한으로 자른다 — 안 자르면 화면이 기록보다 큰 수를 말한다.
    if (messages.length > MAX_TIMELINE) messages = messages.slice(messages.length - MAX_TIMELINE)
  }
  useStreamStore.setState({
    state: e.state,
    messages,
    dropped: e.droppedCount,
    reason: e.reason ?? s.reason
  })
})

// 새 렌더러가 뜨면 앞선 화면이 열어 둔 세션은 **주인이 없다** — 끊을 창구가 없는 소켓이
// 남고, 자동 재접속이 켜져 있었으면 계속 다시 붙는다. 여기서 정리한다(Inbox 가 앱을 켤 때
// 대기를 꺼짐으로 시작하는 것과 같은 규율 — 모르는 새 열려 있지 않게).
void window.rockury.apiStream.closeAll()

window.rockury.apiStream.onEnded((e) => {
  const s = useStreamStore.getState()
  if (e.sessionId !== s.sessionId) return
  const dropped = e.dropped > 0 ? ` · 타임라인 상한으로 ${e.dropped}건이 빠졌습니다` : ''
  const pruned = e.pruned > 0 ? ` · 보관 상한으로 오래된 기록 ${e.pruned}건을 지웠습니다` : ''
  useStreamStore.setState({
    sessionId: null,
    savedNote: `세션이 실행 기록으로 남았습니다 — 메시지 ${e.run.messages?.length ?? 0}건${dropped}${pruned}`
  })
})
