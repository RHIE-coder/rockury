import { useEffect } from 'react'
import { create } from 'zustand'
import { useContextOptions } from '@renderer/nav/contextOptions'
import { useNav } from '@renderer/nav/useNav'
import { cryptoUnavailable, type FunctionEnv } from '@shared/api/functions'
import type { EnvironmentDef, RunRecord } from '@shared/api/types'
import { useApiStore } from '../store'
import type { SendRequestResult } from '../../../../../preload/services/api'
import { ipcErrorText } from '../errorText'

/**
 * 운영부 스토어 — 환경과 실행 기록.
 *
 * **화면에서 쓰는 함수 환경은 암호 함수가 빠져 있다**(`node:crypto` 는 렌더러에 없다).
 * 미리보기에서 서명은 "전송 시 계산"으로 남고, 진짜 계산은 메인이 한다.
 */
export const rendererFunctionEnv: FunctionEnv = {
  now: () => Date.now(),
  random: () => Math.random(),
  uuid: () => crypto.randomUUID(),
  ...cryptoUnavailable
}

interface OpsState {
  environments: EnvironmentDef[]
  runs: RunRecord[]
  /** 마지막 실행 결과 — 오른쪽 응답 패널이 읽는다. */
  lastRun: RunRecord | null
  /** 보관 상한으로 지워진 건수. 0 이 아니면 알린다(조용한 소실 금지). */
  pruned: number
  sending: boolean
  /** 도는 중인 전송의 취소 손잡이. **응답을 기다리기 전에 화면이 알아야** 버튼을 누를 수 있다. */
  sendId: string | null
  error: string | null
  /** 요청별 호출 파라미터 입력값. 요청을 옮겨도 값이 남아 있게 요청 이름으로 가른다. */
  callValues: Record<string, Record<string, string>>

  loadEnvironments: (specId: string | null) => Promise<void>
  saveEnvironment: (input: Omit<EnvironmentDef, 'id'> & { id?: string }) => Promise<boolean>
  duplicateEnvironment: (id: string, name: string) => Promise<void>
  deleteEnvironment: (id: string) => Promise<string | null>

  setCallValue: (requestName: string, param: string, value: string) => void
  setCallValues: (requestName: string, values: Record<string, string>) => void
  loadRuns: (specId: string | null) => Promise<void>
  send: (input: { specId: string; requestName: string; environmentId: string }) => Promise<void>
  cancelSend: () => Promise<void>
  clearError: () => void
}

export const useOpsStore = create<OpsState>()((set, get) => ({
  environments: [],
  runs: [],
  lastRun: null,
  pruned: 0,
  sending: false,
  sendId: null,
  error: null,
  callValues: {},

  loadEnvironments: async (specId) => {
    if (!specId) {
      set({ environments: [] })
      return
    }
    set({ environments: await window.rockury.apiOps.listEnvironments(specId) })
  },

  saveEnvironment: async (input) => {
    try {
      await window.rockury.apiOps.saveEnvironment({
        id: input.id,
        specId: input.specId,
        name: input.name,
        baseUrl: input.baseUrl,
        production: input.production,
        values: input.values
      })
      await get().loadEnvironments(input.specId)
      set({ error: null })
      return true
    } catch (e) {
      set({ error: ipcErrorText(e) })
      return false
    }
  },

  duplicateEnvironment: async (id, name) => {
    try {
      const copy = await window.rockury.apiOps.duplicateEnvironment(id, name)
      await get().loadEnvironments(copy.specId)
      set({ error: null })
    } catch (e) {
      set({ error: ipcErrorText(e) })
    }
  },

  deleteEnvironment: async (id) => {
    const env = get().environments.find((e) => e.id === id)
    const res = await window.rockury.apiOps.deleteEnvironment(id)
    if (!res.deleted) {
      // 지우지 않고 남긴다 — 기록이 가리키는 환경이 사라지면 지나간 관측을 해석할 수 없다.
      const msg = `실행 기록 ${res.runCount}건이 이 환경을 가리키고 있어 지우지 않았습니다.`
      set({ error: msg })
      return msg
    }
    if (env) await get().loadEnvironments(env.specId)
    if (useNav.getState().contextValues['env'] === id) useNav.getState().setContextValue('env', '')
    return null
  },

  setCallValue: (requestName, param, value) =>
    set((s) => ({
      callValues: {
        ...s.callValues,
        [requestName]: { ...(s.callValues[requestName] ?? {}), [param]: value }
      }
    })),

  /** 값 묶음을 통째로 갈아 끼운다 — 재실행이 지나간 파라미터를 그대로 되살릴 때 쓴다. */
  setCallValues: (requestName, values) =>
    set((s) => ({ callValues: { ...s.callValues, [requestName]: { ...values } } })),

  loadRuns: async (specId) => {
    if (!specId) {
      set({ runs: [] })
      return
    }
    set({ runs: await window.rockury.apiOps.listRuns(specId, { limit: 200 }) })
  },

  send: async ({ specId, requestName, environmentId }) => {
    // id 를 먼저 정해 상태에 심는다 — 그래야 응답을 기다리는 동안 취소 버튼이 살아 있다.
    const sendId = `snd_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
    set({ sending: true, sendId, error: null })
    try {
      const res: SendRequestResult = await window.rockury.apiOps.send({
        specId,
        requestName,
        environmentId,
        sendId,
        call: get().callValues[requestName] ?? {}
      })
      set({ lastRun: res.run, pruned: res.pruned })
      await get().loadRuns(specId)
    } catch (e) {
      set({ error: ipcErrorText(e) })
    } finally {
      set({ sending: false, sendId: null })
    }
  },

  /**
   * 도는 중인 전송 끊기 (spec send.execute AC-3).
   * 여기서 상태를 안 바꾼다 — 끊긴 결과는 `send` 가 **취소 기록**으로 정상 반환한다.
   * 화면에서 미리 "취소됨"으로 바꾸면 실제 기록과 화면이 어긋난다.
   */
  cancelSend: async () => {
    const id = get().sendId
    if (id) await window.rockury.apiOps.cancelSend(id)
  },

  clearError: () => set({ error: null })
}))

/** environments → 컨텍스트 바 'env' 셀렉터 옵션 동기화. */
function pushEnvOptions(envs: EnvironmentDef[]): void {
  useContextOptions.getState().setOptions(
    'env',
    envs.map((e) => ({
      id: e.id,
      label: e.name,
      hint: e.production ? '운영' : undefined,
      subtitle: e.baseUrl || undefined,
      dot: e.production ? 'var(--color-danger)' : undefined
    }))
  )
}
pushEnvOptions([])
useOpsStore.subscribe((s, prev) => {
  if (s.environments !== prev.environments) pushEnvOptions(s.environments)
})

// **앱을 켤 때마다 환경 선택을 푼다**(guard AC-1).
// nav 는 컨텍스트 선택을 localStorage 에 저장하는데, 그러면 어제 PROD 를 골라 둔 채로
// 앱이 열린다 — 어제의 선택으로 오늘 첫 요청이 운영에 나가는 사고가 여기서 난다.
useNav.getState().setContextValue('env', '')

// 명세가 바뀌면 환경·기록을 다시 읽고 **환경 선택을 푼다** —
// 다른 명세의 환경이 골라진 채로 남으면 "어디로 보내는지"가 흐려진다(guard AC-1).
useNav.subscribe((s, prev) => {
  const spec = s.contextValues['spec'] ?? null
  if (spec !== (prev.contextValues['spec'] ?? null)) {
    useNav.getState().setContextValue('env', '')
    void useOpsStore.getState().loadEnvironments(spec)
    void useOpsStore.getState().loadRuns(spec)
  }
})

/**
 * 운영부 화면이 뜰 때 자기 데이터를 읽는다.
 *
 * 명세 전환 구독만으로는 부족하다 — **이미 골라져 있는 명세로 진입하면 전환이 안 일어나서**
 * 환경 목록이 빈 채로 남는다(앱을 켜자마자 Environments 로 가는 경우가 정확히 그렇다).
 * 화면 밖에서 바뀐 것(에이전트·다른 화면)도 여기서 따라잡는다.
 */
export function useOpsSync(): void {
  const specId = useNav((s) => s.contextValues['spec']) || null
  useEffect(() => {
    // 명세 본문까지 다시 읽는다 — 화면 밖(에이전트·다른 화면)에서 요청이 늘었을 수 있다.
    void useApiStore.getState().loadSpec(specId)
    void useOpsStore.getState().loadEnvironments(specId)
    void useOpsStore.getState().loadRuns(specId)
  }, [specId])
}

/** 컨텍스트 바에서 고른 환경. **고르기 전에는 null** 이고, 그동안 실행이 막힌다. */
export function useActiveEnvironment(): EnvironmentDef | null {
  const id = useNav((s) => s.contextValues['env'])
  const envs = useOpsStore((s) => s.environments)
  return envs.find((e) => e.id === id) ?? null
}

/** 지금 화면이 다루는 명세 id. */
export function useSpecId(): string | null {
  return useApiStore((s) => s.active?.id ?? null)
}
