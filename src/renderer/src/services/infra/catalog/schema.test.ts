import { describe, it, expect } from 'vitest'
import { parseCatalog, serializeCatalog } from './schema'
import { APP_SCHEMA_VERSION, type Catalog } from './types'

/** 최소한으로 올바른 카탈로그 — 각 케이스가 여기서 한 군데만 망가뜨린다. */
const good = (): unknown => ({
  schemaVersion: APP_SCHEMA_VERSION,
  catalogVersion: '2026.07.1',
  provider: { id: 'demo', label: 'Demo' },
  credentials: [{ id: 'token', label: '토큰' }],
  nodeTypes: [
    {
      id: 'zone',
      label: '존',
      icon: 'phosphor:globe'
    },
    {
      id: 'server',
      label: '가상서버',
      icon: 'phosphor:hard-drives',
      canNestIn: ['zone'],
      discover: {
        call: { type: 'cli', cmd: 'demo', args: ['list', '--token', '{{cred.token}}'] },
        list: 'items',
        map: { externalId: 'id', name: 'displayname', status: 'state' },
        statusMap: { Running: 'ok', Stopped: 'stopped' }
      }
    }
  ]
})

describe('parseCatalog', () => {
  it('CASE-icat-001 정상 카탈로그를 통과시키고 노드 종류를 다 담는다', () => {
    const r = parseCatalog(good())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.catalog.nodeTypes.map((t) => t.id)).toEqual(['zone', 'server'])
    expect(r.catalog.provider.label).toBe('Demo')
  })

  it('CASE-icat-002 canNestIn 이 없는 종류를 가리키면 실패하고 어느 필드인지 알린다', () => {
    const raw = good() as Catalog
    raw.nodeTypes[1].canNestIn = ['region']
    const r = parseCatalog(raw)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join('\n')).toContain('canNestIn')
    expect(r.errors.join('\n')).toContain('region')
  })

  it('CASE-icat-002 canLinkTo 도 같은 검사를 받는다', () => {
    const raw = good() as Catalog
    raw.nodeTypes[1].canLinkTo = ['nope']
    const r = parseCatalog(raw)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join('\n')).toContain('canLinkTo')
  })

  it('CASE-icat-003 선언 안 된 자격증명을 참조하면 거부한다', () => {
    const raw = good() as Catalog
    raw.nodeTypes[1].discover!.call = {
      type: 'cli',
      cmd: 'demo',
      args: ['list', '--token', '{{cred.missing}}']
    }
    const r = parseCatalog(raw)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join('\n')).toContain('missing')
  })

  it('CASE-icat-003 자격증명 값이 박혀 있으면 거부한다 (AWS 키·Bearer·개인키)', () => {
    for (const secret of [
      'AKIAIOSFODNN7EXAMPLE',
      'Bearer sk-abcdefghijklmnopqrstuvwxyz012345',
      '-----BEGIN RSA PRIVATE KEY-----'
    ]) {
      const raw = good() as Catalog
      raw.nodeTypes[1].discover!.call = { type: 'cli', cmd: 'demo', args: ['list', secret] }
      const r = parseCatalog(raw)
      expect(r.ok, secret).toBe(false)
      if (r.ok) continue
      expect(r.errors.join('\n')).toContain('자격증명')
    }
  })

  it('CASE-icat-004 앱이 아는 것보다 높은 schemaVersion 은 통째로 거부한다(부분 적재 없음)', () => {
    const raw = good() as Catalog
    raw.schemaVersion = APP_SCHEMA_VERSION + 1
    const r = parseCatalog(raw)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join('\n')).toContain('schemaVersion')
    // 부분 결과가 새어 나오지 않는다 — 실패 결과에는 catalog 자체가 없다.
    expect('catalog' in r).toBe(false)
  })

  it('CASE-icat-005 탐침 없는 종류(프리셋)도 유효하다', () => {
    const r = parseCatalog({
      schemaVersion: APP_SCHEMA_VERSION,
      catalogVersion: '1',
      provider: { id: 'preset', label: '프리셋' },
      nodeTypes: [{ id: 'grafana', label: 'Grafana', icon: 'phosphor:chart-line' }]
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.catalog.nodeTypes[0].discover).toBeUndefined()
  })

  it('CASE-icat-007 한 종류가 틀리면 전부 실패다 — 성한 종류만 살아남지 않는다', () => {
    const raw = good() as Catalog
    raw.nodeTypes[1].canNestIn = ['없는것']
    const r = parseCatalog(raw)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect('catalog' in r).toBe(false)
  })

  it('종류 id 가 중복이면 거부한다 — 뒤엣것이 조용히 덮이는 것을 막는다', () => {
    const raw = good() as Catalog
    raw.nodeTypes.push({ ...raw.nodeTypes[0] })
    const r = parseCatalog(raw)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join('\n')).toContain('zone')
  })

  it('필수 필드가 빠지면 어느 필드인지 알린다', () => {
    const r = parseCatalog({ schemaVersion: APP_SCHEMA_VERSION, catalogVersion: '1' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join('\n')).toContain('provider')
  })
})

describe('serializeCatalog', () => {
  it('CASE-icat-006 내보낸 문자열 어디에도 자격증명 값이 없다', () => {
    const r = parseCatalog(good())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const text = serializeCatalog(r.catalog)
    expect(text).toContain('{{cred.token}}')
    expect(text).not.toContain('AKIA')
    // 다시 읽어도 통과한다(왕복 안전).
    expect(parseCatalog(JSON.parse(text)).ok).toBe(true)
  })

  it('CASE-icat-006 값이 박힌 카탈로그는 내보내기 단계에서 막힌다', () => {
    const bad = {
      ...(good() as Catalog),
      nodeTypes: [
        {
          id: 'x',
          label: 'X',
          icon: 'phosphor:box',
          discover: {
            call: { type: 'cli' as const, cmd: 'demo', args: ['--key', 'AKIAIOSFODNN7EXAMPLE'] },
            list: 'items',
            map: { externalId: 'id' }
          }
        }
      ]
    }
    expect(() => serializeCatalog(bad as Catalog)).toThrow(/자격증명/)
  })
})

describe('canContain — 부모 쪽 허가', () => {
  it('CASE-icat-008 없는 종류를 가리키면 실패한다', () => {
    const raw = good() as Catalog
    raw.nodeTypes[0].canContain = ['없는종류']
    const r = parseCatalog(raw)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join('\n')).toContain('canContain')
  })

  it('CASE-icat-008 `"*"`(무엇이든)는 실재하는 종류가 아니어도 통과한다', () => {
    const raw = good() as Catalog
    raw.nodeTypes[0].canContain = ['*']
    expect(parseCatalog(raw).ok).toBe(true)
  })

  it('CASE-icat-008 실재하는 종류를 가리키면 통과한다', () => {
    const raw = good() as Catalog
    raw.nodeTypes[0].canContain = ['server']
    expect(parseCatalog(raw).ok).toBe(true)
  })
})
