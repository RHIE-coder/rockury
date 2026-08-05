import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Service } from './types'

/** 모듈이 상태를 하나 들고 있으므로 검사마다 새로 읽어 온다. */
const freshRef = (): Promise<typeof import('./registryRef')> => import('./registryRef')

describe('registryRef — nav 트리를 늦게 받는 창구', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('등록 전에 쓰면 이유를 밝히고 멈춘다 — 조용한 undefined 보다 낫다', async () => {
    const ref = await freshRef()
    expect(() => ref.navRegistry()).toThrow(/nav 트리/)
  })

  it('등록한 트리를 그대로 돌려준다', async () => {
    const ref = await freshRef()
    const tree = [{ id: 'db' }] as Service[]
    ref.provideRegistry(() => tree)
    expect(ref.navRegistry()).toBe(tree)
  })

  it('트리는 부를 때마다 새로 읽는다 — 등록 뒤에 배열이 바뀌어도 따라간다', async () => {
    const ref = await freshRef()
    let tree = [{ id: 'db' }] as Service[]
    ref.provideRegistry(() => tree)
    tree = [{ id: 'api' }] as Service[]
    expect(ref.navRegistry()[0].id).toBe('api')
  })
})
