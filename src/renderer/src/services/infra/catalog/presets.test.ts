import { describe, it, expect } from 'vitest'
import { makePresetType, mergePromotion, promoteSeed } from './presets'
import { parseCatalog } from './schema'
import { newUserCatalog } from './userCatalog'
import type { Discover, NodeTypeDef } from './types'

const discover: Discover = {
  call: { type: 'cli', cmd: 'kubectl', args: ['get', 'pods', '-o', 'json'] },
  list: 'items[]',
  map: { externalId: 'metadata.uid', name: 'metadata.name' }
}

describe('makePresetType — 모양만 있는 종류 만들기', () => {
  it('CASE-icat-110 탐침 없이도 유효한 종류가 된다 — 그게 프리셋이다', () => {
    const r = makePresetType({ id: 'my.grafana', label: '그라파나', icon: 'phosphor:chart-line' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.type.discover).toBeUndefined()
    expect(r.type).toMatchObject({ id: 'my.grafana', label: '그라파나' })
  })

  it('CASE-icat-110 만든 프리셋은 카탈로그 검증을 그대로 통과한다', () => {
    const r = makePresetType({ id: 'my.thing', label: '사내 시스템', icon: 'phosphor:cube' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const parsed = parseCatalog(newUserCatalog('my', '내 것', [r.type]))
    expect(parsed.ok).toBe(true)
  })

  it('id 가 비면 거부하고 이유를 준다', () => {
    expect(makePresetType({ id: '  ', label: 'x', icon: 'phosphor:cube' })).toEqual({
      ok: false,
      error: '종류 id 를 입력하세요.'
    })
  })

  it('id 에 공백이 있으면 거부한다 — 표현식·저장 키로 쓰이는 값이다', () => {
    const r = makePresetType({ id: 'my thing', label: 'x', icon: 'phosphor:cube' })
    expect(r.ok).toBe(false)
  })

  it('표시 이름을 안 주면 id 를 쓴다 — 이름 없는 노드를 만들지 않는다', () => {
    const r = makePresetType({ id: 'my.x', label: '   ', icon: 'phosphor:cube' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.type.label).toBe('my.x')
  })

  it('아이콘을 안 주면 기본 아이콘으로 떨어진다', () => {
    const r = makePresetType({ id: 'my.x', label: 'x', icon: '' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.type.icon).toBe('phosphor:cube')
  })

  it('담을 수 있는 것(canContain)을 함께 선언할 수 있다 — 묶음 상자용', () => {
    const r = makePresetType({ id: 'my.box', label: '묶음', icon: '', canContain: ['*'] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.type.canContain).toEqual(['*'])
  })
})

describe('promoteSeed / mergePromotion — 프리셋에 탐침을 붙여 올린다', () => {
  const preset: NodeTypeDef = {
    id: 'my.k8s-pod',
    label: '파드',
    icon: 'phosphor:cube',
    color: '#326ce5',
    canNestIn: ['my.k8s'],
    docTemplate: { role: '무엇을 돌리나' }
  }

  it('승격 대상은 탐침이 없는 종류다', () => {
    expect(promoteSeed(preset)).not.toBeNull()
    expect(promoteSeed({ ...preset, discover })).toBeNull()
  })

  it('CASE-icat-111 승격해도 **종류 id 가 이어진다** — 이미 그려 둔 설계 노드가 살아남는 근거', () => {
    const seed = promoteSeed(preset)
    expect(seed?.id).toBe('my.k8s-pod')
    const promoted = mergePromotion(seed as NonNullable<typeof seed>, discover)
    expect(promoted.id).toBe('my.k8s-pod')
  })

  it('CASE-icat-111 모양(아이콘·색·담길 곳·문서 틀)이 그대로 따라온다 — 승격이 새로 그리기가 되지 않는다', () => {
    const promoted = mergePromotion(promoteSeed(preset) as NonNullable<ReturnType<typeof promoteSeed>>, discover)
    expect(promoted).toMatchObject({
      label: '파드',
      icon: 'phosphor:cube',
      color: '#326ce5',
      canNestIn: ['my.k8s'],
      docTemplate: { role: '무엇을 돌리나' }
    })
  })

  it('승격 결과에는 탐침이 붙어 있다', () => {
    const promoted = mergePromotion(promoteSeed(preset) as NonNullable<ReturnType<typeof promoteSeed>>, discover)
    expect(promoted.discover).toEqual(discover)
  })

  it('사용자가 표시 이름을 바꿔 올릴 수 있다(모양은 유지)', () => {
    const seed = promoteSeed(preset) as NonNullable<ReturnType<typeof promoteSeed>>
    const promoted = mergePromotion({ ...seed, label: 'Pod' }, discover)
    expect(promoted.label).toBe('Pod')
    expect(promoted.id).toBe('my.k8s-pod')
  })
})
