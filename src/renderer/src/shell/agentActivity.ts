import { create } from 'zustand'

/**
 * 에이전트(MCP)가 방금 어느 서비스를 고쳤는가 — 좌측 레일이 이걸 보고 점을 켠다.
 *
 * 왜 필요한가: 에이전트가 도구로 쓰면 화면은 조용히 따라온다(리하이드레이션). 조용한 게 맞지만,
 * **아무 표시가 없으면 사람은 자기가 안 한 변경을 자기가 한 줄 안다.** 어디서 온 변경인지
 * 한 번은 보여야 한다. 그래서 "무엇이 바뀌었나"가 아니라 **"어느 서비스가 방금 밖에서 바뀌었나"**
 * 만 든다 — 내용은 그 서비스 화면이 이미 보여 준다.
 *
 * 서비스별 리하이드레이션 모듈이 `markAgentActivity(<서비스 id>)` 로 찍는다.
 */

/** 서비스 id → 마지막으로 에이전트가 고친 시각(ms). */
export type ActivityMap = Readonly<Record<string, number>>

/**
 * 점이 켜져 있는 시간. 너무 짧으면 다른 화면을 보다 돌아왔을 때 이미 꺼져 있고,
 * 너무 길면 "방금"이라는 말이 거짓이 된다.
 */
export const AGENT_ACTIVITY_TTL_MS = 6_000

export function withActive(map: ActivityMap, serviceId: string, at: number): ActivityMap {
  return { ...map, [serviceId]: at }
}

export function isActive(map: ActivityMap, serviceId: string, now: number, ttlMs: number): boolean {
  const at = map[serviceId]
  return at !== undefined && now - at < ttlMs
}

/** 만료된 것을 턴 지도. 다 살아 있으면 **같은 객체를 그대로** 돌려준다 — 헛 렌더를 만들지 않으려고. */
export function pruned(map: ActivityMap, now: number, ttlMs: number): ActivityMap {
  const live = Object.entries(map).filter(([, at]) => now - at < ttlMs)
  if (live.length === Object.keys(map).length) return map
  return Object.fromEntries(live)
}

interface AgentActivityState {
  at: ActivityMap
  mark: (serviceId: string) => void
}

export const useAgentActivity = create<AgentActivityState>()((set, get) => ({
  at: {},
  mark: (serviceId) => {
    set({ at: withActive(get().at, serviceId, Date.now()) })
    // TTL 이 지나면 스스로 꺼진다. 타이머로 한 번만 깨우는 이유: 매초 도는 시계를 두면
    // 아무 일도 없는 동안 레일이 계속 다시 그려진다.
    setTimeout(() => set({ at: pruned(get().at, Date.now(), AGENT_ACTIVITY_TTL_MS) }), AGENT_ACTIVITY_TTL_MS + 50)
  }
}))

/** 서비스 리하이드레이션 모듈이 부르는 창구 — 스토어를 직접 알 필요가 없게. */
export function markAgentActivity(serviceId: string): void {
  useAgentActivity.getState().mark(serviceId)
}
