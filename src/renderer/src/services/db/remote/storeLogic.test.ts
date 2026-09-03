import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemoteStore } from './store'

/**
 * 역설계 캐시 스토어의 **재조회 조율** 검증 — 무엇을 건너뛰고 무엇을 밀어 뒀다 다시 읽는가.
 *
 * 이 자리가 조용히 어긋나면 증상이 "새로고침이 안 먹는다"로만 보인다(2026-09-03 지적의 뿌리).
 * `window.rockury.introspection.run` 을 손으로 풀어 주는 promise 로 바꿔, 조회가 **도는 도중**에
 * 들어온 요청이 어떻게 처리되는지를 본다.
 */
const ir = (tables: string[]) => ({
  dialect: 'mysql' as const,
  schemas: ['testdb'],
  tables: tables.map((name) => ({ schema: 'testdb', name, comment: '' })),
  columns: [],
  keys: [],
  foreignKeys: [],
  checks: [],
  warnings: []
})

/** 다음 `run` 호출이 돌려줄 값을 **나중에** 정해 준다 — "도는 도중"을 만들기 위한 손잡이. */
function deferrable() {
  const calls: { schemas?: string[]; resolve: (tables: string[]) => void }[] = []
  const run = vi.fn(
    (_connId: string, schemas?: string[]) =>
      new Promise((res) => calls.push({ schemas, resolve: (t) => res(ir(t)) }))
  )
  return { calls, run }
}

let d: ReturnType<typeof deferrable>

beforeEach(() => {
  d = deferrable()
  ;(globalThis as unknown as { window: unknown }).window = {
    rockury: { introspection: { run: d.run } }
  }
  useRemoteStore.setState({ byEnv: {}, loading: {}, error: {}, warnings: {} })
})

const names = (envId: string) => (useRemoteStore.getState().byEnv[envId] ?? []).map((t) => t.name)

describe('load — 언제 읽고 언제 건너뛰나', () => {
  it('캐시가 있으면 force 없이는 안 읽는다', async () => {
    const p = useRemoteStore.getState().load('c1', 'c1')
    d.calls[0].resolve(['users'])
    await p
    await useRemoteStore.getState().load('c1', 'c1')
    expect(d.run).toHaveBeenCalledTimes(1)
  })

  it('force 면 캐시가 있어도 다시 읽는다', async () => {
    const p1 = useRemoteStore.getState().load('c1', 'c1')
    d.calls[0].resolve(['users'])
    await p1
    const p2 = useRemoteStore.getState().load('c1', 'c1', true)
    d.calls[1].resolve(['users', 'orders'])
    await p2
    expect(names('c1')).toEqual(['orders', 'users'])
  })

  it('실패하면 오류만 남기고 옛 목록은 안 건드린다', async () => {
    const p1 = useRemoteStore.getState().load('c1', 'c1')
    d.calls[0].resolve(['users'])
    await p1
    d.run.mockImplementationOnce(() => Promise.reject(new Error('연결 끊김')))
    await useRemoteStore.getState().load('c1', 'c1', true)
    expect(useRemoteStore.getState().error.c1).toBe('연결 끊김')
    expect(names('c1')).toEqual(['users'])
    expect(useRemoteStore.getState().loading.c1).toBe(false)
  })
})

/**
 * 회귀(2026-09-03): Query 로 DDL 을 잇달아 치면 두 번째 재조회가 첫 조회가 도는 동안 도착한다.
 * 그걸 버리면 **첫 DDL 만 반영된 목록**이 최종본으로 굳고, 다시 읽힐 계기가 없어 사용자에겐
 * 자동 반영이 또 안 된 것으로 보인다.
 */
describe('읽는 도중에 들어온 요청', () => {
  it('⭐ 강제 재조회는 버리지 않고 끝난 뒤 한 번 더 읽는다', async () => {
    const first = useRemoteStore.getState().load('c1', 'c1', true)
    // 아직 안 끝난 사이에 두 번째 DDL 이 들어온다.
    void useRemoteStore.getState().load('c1', 'c1', true)
    expect(d.run).toHaveBeenCalledTimes(1) // 겹쳐 쏘지는 않는다

    d.calls[0].resolve(['users'])
    await vi.waitFor(() => expect(d.run).toHaveBeenCalledTimes(2)) // 밀어 뒀던 것이 이어서 나갔다

    d.calls[1].resolve(['users', 'ddl_probe'])
    // 부른 쪽은 **밀린 것까지 끝난 뒤에** 돌아온다 — 그래야 곧바로 읽는 목록이 최신이다.
    await first
    expect(names('c1')).toContain('ddl_probe')
  })

  it('밀어 둔 요청의 범위(schemas)를 그대로 쓴다', async () => {
    const first = useRemoteStore.getState().load('c1', 'c1', true, ['a'])
    void useRemoteStore.getState().load('c1', 'c1', true, ['a', 'b'])
    d.calls[0].resolve([])
    await vi.waitFor(() => expect(d.calls).toHaveLength(2))
    expect(d.calls[1].schemas).toEqual(['a', 'b'])
    d.calls[1].resolve([])
    await first
  })

  it('강제가 아닌 요청은 밀어 두지 않는다 — 캐시가 차면 어차피 건너뛴다', async () => {
    const first = useRemoteStore.getState().load('c1', 'c1', true)
    void useRemoteStore.getState().load('c1', 'c1')
    d.calls[0].resolve(['users'])
    await first
    expect(d.run).toHaveBeenCalledTimes(1)
  })

  it('밀어 둔 것은 한 번만 나간다 — 스스로를 다시 예약해 맴돌지 않는다', async () => {
    const first = useRemoteStore.getState().load('c1', 'c1', true)
    void useRemoteStore.getState().load('c1', 'c1', true)
    void useRemoteStore.getState().load('c1', 'c1', true) // 셋이 겹쳐도 밀린 것은 하나
    d.calls[0].resolve([])
    await vi.waitFor(() => expect(d.run).toHaveBeenCalledTimes(2))
    d.calls[1].resolve([])
    await first
    expect(d.run).toHaveBeenCalledTimes(2)
  })

  it('연결이 다르면 서로 안 막는다 — 각자 읽는다', async () => {
    void useRemoteStore.getState().load('c1', 'c1', true)
    void useRemoteStore.getState().load('c2', 'c2', true)
    expect(d.run).toHaveBeenCalledTimes(2)
  })
})
