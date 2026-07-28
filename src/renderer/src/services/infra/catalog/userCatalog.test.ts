import { describe, it, expect } from 'vitest'
import { cloneAsMine, commandsOf, newUserCatalog, upsertNodeType } from './userCatalog'
import { parseCatalog } from './schema'
import { APP_SCHEMA_VERSION, type Catalog, type NodeTypeDef } from './types'

const type = (id: string, cmd = 'demo'): NodeTypeDef => ({
  id,
  label: id,
  icon: 'phosphor:cube',
  discover: {
    call: { type: 'cli', cmd, args: ['list', '--output', 'json'] },
    list: 'items',
    map: { externalId: 'id' }
  }
})

describe('newUserCatalog — 빈 사용자 카탈로그', () => {
  it('CASE-icat-090 만들자마자 형식 검증을 통과한다', () => {
    const c = newUserCatalog('ktcloud', 'KT Cloud', [type('ktcloud.server')])
    expect(parseCatalog(c).ok).toBe(true)
    expect(c.schemaVersion).toBe(APP_SCHEMA_VERSION)
    expect(c.provider).toEqual({ id: 'ktcloud', label: 'KT Cloud' })
  })

  it('CASE-icat-090 종류가 하나도 없으면 만들 수 없다 — 검증기가 막는 것을 미리 막는다', () => {
    expect(() => newUserCatalog('x', 'X', [])).toThrow(/종류/)
  })

  it('공급자 id 가 비면 거부한다', () => {
    expect(() => newUserCatalog('  ', 'X', [type('a')])).toThrow(/공급자/)
  })
})

describe('upsertNodeType — 종류 추가·덮어쓰기', () => {
  const base = (): Catalog => newUserCatalog('p', 'P', [type('p.a')])

  it('CASE-icat-091 새 종류는 뒤에 붙는다', () => {
    const c = upsertNodeType(base(), type('p.b'))
    expect(c.nodeTypes.map((t) => t.id)).toEqual(['p.a', 'p.b'])
    expect(parseCatalog(c).ok).toBe(true)
  })

  it('CASE-icat-091 같은 id 는 자리를 지키며 덮어쓴다 — 순서가 흔들리지 않는다', () => {
    const c = upsertNodeType(upsertNodeType(base(), type('p.b')), {
      ...type('p.a'),
      label: '고친 이름'
    })
    expect(c.nodeTypes.map((t) => t.id)).toEqual(['p.a', 'p.b'])
    expect(c.nodeTypes[0].label).toBe('고친 이름')
  })

  it('CASE-icat-091 원본을 건드리지 않는다', () => {
    const original = base()
    upsertNodeType(original, type('p.b'))
    expect(original.nodeTypes).toHaveLength(1)
  })
})

describe('cloneAsMine — 내장 카탈로그 복제', () => {
  it('CASE-icat-092 내용을 그대로 복사하고 공급자 id 만 새로 받는다', () => {
    const builtin = newUserCatalog('aws', 'AWS', [type('aws.ec2')])
    const mine = cloneAsMine(builtin, 'aws-copy', 'AWS (내 사본)')
    expect(mine.provider).toEqual({ id: 'aws-copy', label: 'AWS (내 사본)' })
    expect(mine.nodeTypes).toEqual(builtin.nodeTypes)
    expect(parseCatalog(mine).ok).toBe(true)
  })
})

describe('commandsOf — 가져오기 전에 보여 줄 "실행될 명령" 목록', () => {
  it('CASE-icat-093 이 파일이 돌릴 모든 명령을 종류와 함께 낸다', () => {
    const c = newUserCatalog('p', 'P', [type('p.a', 'aws'), type('p.b', 'docker')])
    const rows = commandsOf(c)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ typeId: 'p.a', kind: '탐침' })
    expect(rows[0].command).toBe('aws list --output json')
    expect(rows[1].command).toContain('docker')
  })

  it('CASE-icat-093 액션 명령도 빠짐없이 나온다 — 위험한 것은 그렇다고 표시한다', () => {
    const c = newUserCatalog('p', 'P', [
      {
        ...type('p.a'),
        actions: [
          {
            id: 'restart',
            label: '재시작',
            danger: true,
            call: { type: 'cli', cmd: 'aws', args: ['ec2', 'reboot-instances'] }
          }
        ]
      }
    ])
    const rows = commandsOf(c)
    const action = rows.find((r) => r.kind === '액션')
    expect(action?.command).toBe('aws ec2 reboot-instances')
    expect(action?.danger).toBe(true)
  })

  it('CASE-icat-093 탐침 없는 종류(프리셋)는 명령이 없으므로 목록에 안 뜬다', () => {
    const c: Catalog = {
      schemaVersion: APP_SCHEMA_VERSION,
      catalogVersion: '1',
      provider: { id: 'p', label: 'P' },
      nodeTypes: [{ id: 'p.x', label: 'X', icon: 'phosphor:cube' }]
    }
    expect(commandsOf(c)).toEqual([])
  })

  it('CASE-icat-093 HTTP·내장 호출도 사람이 읽을 수 있게 낸다', () => {
    const c = newUserCatalog('p', 'P', [
      {
        id: 'p.h',
        label: 'H',
        icon: 'phosphor:cube',
        discover: {
          call: { type: 'http', method: 'GET', url: 'https://api.example.com/v1/things' },
          list: 'items',
          map: { externalId: 'id' }
        }
      }
    ])
    expect(commandsOf(c)[0].command).toBe('GET https://api.example.com/v1/things')
  })
})
