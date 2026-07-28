import { describe, it, expect } from 'vitest'
import { parseIconRef, collectIconNames, FALLBACK_ICON } from './icon'
import { APP_SCHEMA_VERSION, type Catalog } from './types'

describe('parseIconRef — 아이콘 참조 문자열 하나', () => {
  it('CASE-icat-030 세 접두어를 각각 갈라 푼다', () => {
    expect(parseIconRef('phosphor:hard-drives')).toEqual({
      kind: 'phosphor',
      name: 'hard-drives',
      warning: undefined
    })
    expect(parseIconRef('pack:aws/ec2')).toEqual({
      kind: 'pack',
      pack: 'aws',
      name: 'ec2',
      warning: undefined
    })
    const data = parseIconRef('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')
    expect(data.kind).toBe('data')
  })

  it('CASE-icat-031 모르는 접두어는 기본 아이콘으로 떨어지고 경고를 남긴다(던지지 않는다)', () => {
    const r = parseIconRef('unknownpack:whatever')
    expect(r.kind).toBe('phosphor')
    expect(r.name).toBe(FALLBACK_ICON)
    expect(r.warning).toContain('unknownpack')
  })

  it('CASE-icat-031 접두어가 아예 없거나 비어 있어도 기본 아이콘으로 떨어진다', () => {
    for (const bad of ['', '   ', 'justaname', 'phosphor:', 'pack:aws']) {
      const r = parseIconRef(bad)
      expect(r.name, bad).toBe(FALLBACK_ICON)
      expect(r.warning, bad).toBeTruthy()
    }
  })
})

describe('collectIconNames — 빌드 때 쓰이는 것만 모으기', () => {
  const cat = (icons: string[]): Catalog => ({
    schemaVersion: APP_SCHEMA_VERSION,
    catalogVersion: '1',
    provider: { id: 'p', label: 'P' },
    nodeTypes: icons.map((icon, i) => ({ id: `t${i}`, label: `T${i}`, icon }))
  })

  it('CASE-icat-032 쓰인 phosphor 이름만 모은다 — 중복 제거·정렬', () => {
    const r = collectIconNames([cat(['phosphor:database', 'phosphor:cloud']), cat(['phosphor:database'])])
    expect(r).toEqual(['cloud', 'database'])
  })

  it('CASE-icat-032 팩·data URI·잘못된 참조는 phosphor 수집 대상이 아니다', () => {
    const r = collectIconNames([cat(['pack:aws/ec2', 'data:image/svg+xml;base64,AA==', 'nonsense'])])
    expect(r).toEqual([])
  })

  it('기본 아이콘은 참조가 깨진 카탈로그가 있어도 항상 포함시킬 수 있다', () => {
    const r = collectIconNames([cat(['phosphor:cloud'])], { includeFallback: true })
    expect(r).toContain(FALLBACK_ICON)
    expect(r).toContain('cloud')
  })
})
