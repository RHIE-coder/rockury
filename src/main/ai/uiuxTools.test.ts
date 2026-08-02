import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setDbPath } from '../store/db'
import { setUiuxChangeNotifier, UIUX_TOOL_DEFS, type UiuxChangedEvent } from './uiuxTools'
import { createNote, saveSurfaceContent, findByAddress } from '../store/uiuxSpecs'

/**
 * UI/UX MCP 도구의 **쓰기 알림**(`uiux:changed`) 검증 — 임시 SQLite 위에서 실제 저장 경로를 돈다.
 * 회귀 대상: 알림이 아예 없어서 에이전트가 쓴 것을 사람이 앱을 껐다 켜야 보던 버그.
 */

const tool = (name: string) => {
  const t = UIUX_TOOL_DEFS.find((x) => x.name === name)
  if (!t) throw new Error(`도구 없음: ${name}`)
  return t
}

const events: UiuxChangedEvent[] = []

beforeAll(() => {
  setDbPath(join(mkdtempSync(join(tmpdir(), 'rockury-uiux-')), 'test.db'))
  setUiuxChangeNotifier((e) => events.push(e))
})

beforeEach(() => {
  events.length = 0
})

describe('UI/UX MCP 쓰기 → 리하이드레이션 알림', () => {
  let projectId = ''

  it('create_ui_node(프로젝트) — nodes 알림 + 만들어진 projectId', () => {
    const out = tool('create_ui_node').handler({ parent: '', key: 'shop', name: '쇼핑몰' }) as {
      id: string
      level: string
    }
    projectId = out.id
    expect(out.level).toBe('project')
    expect(events).toEqual([{ domain: 'nodes', projectId }])
  })

  it('create_ui_node(하위 층) — 그 프로젝트 id 로 알린다', () => {
    tool('create_ui_node').handler({ parent: 'shop', key: 'buyer', name: '이용자 앱' })
    tool('create_ui_node').handler({ parent: 'shop.buyer', key: 'auth', name: '인증' })
    tool('create_ui_node').handler({ parent: 'shop.buyer.auth', key: 'login', name: '로그인' })
    expect(events).toHaveLength(3)
    expect(events.every((e) => e.domain === 'nodes' && e.projectId === projectId)).toBe(true)
  })

  it('set_ui_surface — surface 알림에 화면 주소가 실린다(열린 그 화면만 다시 읽게)', () => {
    tool('set_ui_surface').handler({
      address: 'shop.buyer.auth.login',
      content: { sections: [{ id: 's1', name: '입력', components: [{ id: 'email', type: 'input' }] }] }
    })
    expect(events).toEqual([{ domain: 'surface', projectId, address: 'shop.buyer.auth.login' }])
  })

  it('set_ui_surface_status — status 알림(위계 집계가 함께 바뀐다)', () => {
    tool('set_ui_surface_status').handler({
      address: 'shop.buyer.auth.login',
      status: 'implemented',
      by: 'claude-code'
    })
    expect(events).toEqual([{ domain: 'status', projectId, address: 'shop.buyer.auth.login' }])
  })

  it('set_ui_tokens — tokens 알림', () => {
    tool('set_ui_tokens').handler({ project: 'shop', tokens: { 'color.primary': '#0f766e' } })
    expect(events).toEqual([{ domain: 'tokens', projectId }])
  })

  it('resolve_ui_note — notes 알림. projectId 는 없다(의견 id 로는 프로젝트를 되짚을 수 없다)', () => {
    const surfaceId = findByAddress('shop.buyer.auth.login')!.surfaceId as string
    const { id } = createNote({ surfaceId, body: '버튼이 너무 작아요' })
    events.length = 0
    tool('resolve_ui_note').handler({ id })
    expect(events).toEqual([{ domain: 'notes' }])
  })

  it('읽기 도구는 알림을 만들지 않는다', () => {
    tool('get_ui_tree').handler({ project: 'shop' })
    tool('get_ui_surface').handler({ address: 'shop.buyer.auth.login' })
    tool('list_ui_projects').handler({})
    expect(events).toHaveLength(0)
  })

  it('실패한 쓰기는 알림을 만들지 않는다 — 미상 주소', () => {
    expect(() => tool('set_ui_surface').handler({ address: 'shop.nope.auth.login', content: { sections: [] } })).toThrow()
    expect(() => tool('set_ui_surface_status').handler({ address: 'shop.nope', status: 'verified' })).toThrow()
    expect(events).toHaveLength(0)
  })

  it('구조가 틀린 내용은 저장도 알림도 없다 — sections 가 배열이 아니면 거부', () => {
    expect(() =>
      tool('set_ui_surface').handler({ address: 'shop.buyer.auth.login', content: { sections: 'nope' } })
    ).toThrowError(/sections/)
    expect(events).toHaveLength(0)
  })

  it('화면발 저장(스토어 직접 호출)은 알림을 만들지 않는다 — 자기 메아리 금지', () => {
    const surfaceId = findByAddress('shop.buyer.auth.login')!.surfaceId as string
    saveSurfaceContent(surfaceId, JSON.stringify({ sections: [] }))
    expect(events).toHaveLength(0)
  })
})
