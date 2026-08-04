import { describe, expect, it } from 'vitest'
import { uiuxService } from './index'

/**
 * UI/UX 서비스 선언 무결성 — 정의는 `docs/qa/uiux-ia.md` (CASE-uiux-001~005),
 * 명세는 `docs/spec/uiux-ia.md` (Surface `uiux.shell`).
 *
 * 선언이 깨지면 셸이 조용히 이상하게 그려진다(탭이 사라지거나, 두 칸이 같은 id 라 하나만 잡힌다).
 * 그래서 "깨지면 실제로 문제가 되는 것"만 붙든다 — 라벨 문자열을 그대로 옮겨 적지 않는다.
 */
describe('uiuxService — 모듈·뷰 트리', () => {
  const moduleIds = uiuxService.modules.map((m) => m.id)
  const byId = (id: string) => uiuxService.modules.find((m) => m.id === id)

  it('CASE-uiux-001 모듈은 6개이고 features 가 첫 칸이다', () => {
    expect(moduleIds).toEqual(['features', 'screens', 'flows', 'rules', 'style', 'versions'])
  })

  it('CASE-uiux-002 뷰를 가진 모듈은 선언한 뷰를 그대로 갖는다', () => {
    expect(byId('screens')?.views?.map((v) => v.id)).toEqual(['canvas', 'spec', 'review'])
    expect(byId('style')?.views?.map((v) => v.id)).toEqual(['tokens', 'components'])
    expect(byId('versions')?.views?.map((v) => v.id)).toEqual(['timeline', 'diff'])
  })

  it('CASE-uiux-002 뷰 없는 모듈은 자기 workspace 를 갖는다 (둘 다 없으면 빈 화면이 된다)', () => {
    for (const id of ['features', 'flows', 'rules']) {
      const m = byId(id)
      expect(m?.views, `${id} 는 뷰 없이 자기 자신이 화면이다`).toBeUndefined()
      expect(m?.workspace, `${id} 에 workspace 가 없다`).toBeTypeOf('function')
    }
  })

  it('CASE-uiux-003 모듈 id 와 한 모듈 안의 뷰 id 는 겹치지 않는다', () => {
    expect(new Set(moduleIds).size).toBe(moduleIds.length)
    for (const m of uiuxService.modules) {
      const viewIds = (m.views ?? []).map((v) => v.id)
      expect(new Set(viewIds).size, `${m.id} 의 뷰 id 중복`).toBe(viewIds.length)
    }
  })
})

describe('uiuxService — 컨텍스트 셀렉터', () => {
  const ctx = uiuxService.context ?? []
  const sel = (id: string) => ctx.find((c) => c.id === id)

  it('CASE-uiux-004 셀렉터는 version · viewport 둘이다', () => {
    expect(ctx.map((c) => c.id)).toEqual(['version', 'viewport'])
  })

  it('Project 셀렉터는 이 서비스에 없다 — 다섯 서비스를 함께 좁히는 범위라 셸이 든다', () => {
    // 서비스에도 두면 같은 이름의 셀렉터가 둘이 되고, 어느 쪽이 진짜인지 알 수 없다.
    expect(sel('project')).toBeUndefined()
  })

  it('CASE-uiux-004 version 기본값은 draft 다', () => {
    expect(sel('version')?.defaultOptionId).toBe('draft')
    expect(sel('version')?.options.map((o) => o.id)).toContain('draft')
  })

  it('CASE-uiux-004 viewport 는 pc·tablet·mobile 셋이고 기본값은 pc 다', () => {
    expect(sel('viewport')?.options.map((o) => o.id)).toEqual(['pc', 'tablet', 'mobile'])
    expect(sel('viewport')?.defaultOptionId).toBe('pc')
  })

  it('CASE-uiux-005 구획(설계부/운영부)을 나누지 않는다 — 모든 모듈에서 모든 셀렉터가 활성', () => {
    for (const c of ctx) expect(c.activeInAreas, `${c.id} 가 구획을 탄다`).toBeUndefined()
    for (const m of uiuxService.modules) expect(m.area, `${m.id} 에 area 가 붙었다`).toBeUndefined()
  })
})
