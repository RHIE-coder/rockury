import { create } from 'zustand'

/**
 * 운영부(Remote)가 함께 쓰는 **지금 보는 표**.
 *
 * Definition·Diagram·Data 가 고른 표를 각자 자기 화면 안에만 들고 있어서, 뷰를 옮길 때마다
 * 처음으로 돌아갔다(2026-08-04 사용자 제보 — "자꾸 초기화되니까 보기가 쉽지 않네").
 * 셋이 같은 값을 보게 해서 "표 하나를 여러 각도로 본다"는 흐름이 안 끊기게 한다.
 *
 * **연결마다 따로** 기억한다 — 연결을 바꾸면 이름이 같아도 다른 DB 의 다른 표다.
 * 담는 값은 표 id(`t:<스키마>.<이름>`)다: 이름에서 결정적으로 나오므로 역설계를 다시 해도 같다
 * (`remote/introspection`).
 */
interface RemoteFocusState {
  /** 연결 id → 표 id. 빈 문자열은 "고른 것 없음"이다. */
  byConn: Record<string, string>
  setFocus: (connId: string | null, tableId: string | null) => void
}

export const useRemoteFocusStore = create<RemoteFocusState>()((set) => ({
  byConn: {},
  setFocus: (connId, tableId) => {
    if (!connId) return
    set((s) => ({ byConn: { ...s.byConn, [connId]: tableId ?? '' } }))
  }
}))

/** 이 연결에서 지금 보는 표 id. 고른 것이 없으면 null. */
export function useRemoteFocus(connId: string | null): string | null {
  return useRemoteFocusStore((s) => (connId ? s.byConn[connId] || null : null))
}

/**
 * Data 화면이 고른 표를 따라갈 것인가 — 순수 판정.
 *
 * 저장 안 한 셀 변경이나 커밋 대기 트랜잭션(= 아직 커밋/롤백 안 한 열린 거래)이 있으면
 * **따라가지 않는다**: 다른 화면에서 표를 골랐다는 이유로 남이 치던 편집을 조용히 버릴 수는 없다.
 * (표를 이 화면에서 직접 바꿀 때는 확인 창이 뜨고, 사람이 "롤백하고 이동"을 고른다.)
 */
export function shouldFollowFocus(args: {
  focusId: string | null
  /** 지금 이 화면이 열어 둔 표 id. */
  currentId: string | null
  pendingCount: number
  hasOpenTx: boolean
}): boolean {
  if (!args.focusId || args.focusId === args.currentId) return false
  return args.pendingCount === 0 && !args.hasOpenTx
}
