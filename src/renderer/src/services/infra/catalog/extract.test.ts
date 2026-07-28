import { describe, it, expect } from 'vitest'
import { evalExpr, extractNodes, linkParents, parseResponse, pathToExpr } from './extract'
import type { Discover } from './types'

const response = {
  serverList: {
    server: [
      { id: 'vm-001', displayname: '웹서버-1', state: 'Running', zone: 'z1' },
      { id: 'vm-002', displayname: '배치서버', state: 'Stopped', zone: 'z1' }
    ]
  }
}

const discover = (patch: Partial<Discover> = {}): Discover => ({
  call: { type: 'cli', cmd: 'demo', args: [] },
  list: 'serverList.server',
  map: { externalId: 'id', name: 'displayname', status: 'state', parentExternalId: 'zone' },
  statusMap: { Running: 'ok', Stopped: 'stopped' },
  ...patch
})

describe('evalExpr — 값의 위치를 가리키는 주소', () => {
  it('CASE-icat-010 단순 경로로 값을 뽑는다', () => {
    expect(evalExpr('serverList.server[0].displayname', response)).toBe('웹서버-1')
  })

  it('CASE-icat-011 배열 속 조건부 값을 뽑는다 — 점 표기로는 못 하는 경우', () => {
    const withTags = { tags: [{ key: 'role', value: 'web' }, { key: 'name', value: '웹서버-1' }] }
    expect(evalExpr("tags[?key=='name'].value | [0]", withTags)).toBe('웹서버-1')
  })

  it('CASE-icat-012 접두어가 없으면 JMESPath 로 읽는다(기본값)', () => {
    expect(evalExpr('serverList.server[1].id', response)).toBe('vm-002')
    expect(evalExpr('jmespath:serverList.server[1].id', response)).toBe('vm-002')
  })

  it('CASE-icat-012 모르는 접두어는 던진다 — 조용히 다른 문법으로 읽지 않는다', () => {
    expect(() => evalExpr('xpath://a/b', response)).toThrow(/xpath/)
  })

  it('CASE-icat-015 코드처럼 생긴 입력이 평가되지 않는다', () => {
    // 표현식이 코드였다면 아래가 뭔가를 실행했을 것이다. JMESPath 는 데이터라 문법 오류로 끝난다.
    expect(() => evalExpr('process.exit(1)', response)).toThrow()
    expect(evalExpr('nope', response)).toBeNull()
  })

  it('한글·하이픈이 든 키는 따옴표로 감싸야 읽힌다 (JMESPath 식별자 규칙)', () => {
    const odd = { '서버목록': { '서버-1': 'ok' } }
    expect(() => evalExpr('서버목록.서버-1', odd)).toThrow()
    expect(evalExpr('"서버목록"."서버-1"', odd)).toBe('ok')
  })
})

describe('pathToExpr — 클릭으로 집은 경로를 표현식으로', () => {
  it('CASE-icat-074 평범한 키는 그대로 잇는다', () => {
    expect(pathToExpr(['Reservations', 0, 'Instances', 0, 'InstanceId'])).toBe(
      'Reservations[0].Instances[0].InstanceId'
    )
  })

  it('CASE-icat-074 따옴표가 필요한 키는 감싼다 — 한글·하이픈·숫자로 시작', () => {
    expect(pathToExpr(['서버목록', '서버'])).toBe('"서버목록"."서버"')
    expect(pathToExpr(['my-key'])).toBe('"my-key"')
    expect(pathToExpr(['a', '1st'])).toBe('a."1st"')
  })

  it('CASE-icat-074 목록을 집으면 배열 인덱스가 전체 순회로 일반화된다', () => {
    expect(pathToExpr(['Reservations', 0, 'Instances', 0], { wildcardArrays: true })).toBe(
      'Reservations[].Instances[]'
    )
  })

  it('만들어진 표현식이 실제로 그 값을 가리킨다(왕복)', () => {
    const expr = pathToExpr(['serverList', 'server', 0, 'displayname'])
    expect(evalExpr(expr, response)).toBe('웹서버-1')
  })

  it('따옴표·역슬래시가 든 키도 탈출시켜 깨지지 않는다', () => {
    const weird = { 'a"b': 1 }
    const expr = pathToExpr(['a"b'])
    expect(evalExpr(expr, weird)).toBe(1)
  })
})

describe('extractNodes — 응답을 노드로 옮기기', () => {
  it('CASE-icat-010 목록·id·이름·상태를 뽑아 노드를 만든다', () => {
    const r = extractNodes(discover(), response)
    expect(r.nodes).toHaveLength(2)
    expect(r.nodes[0]).toMatchObject({
      externalId: 'vm-001',
      name: '웹서버-1',
      status: 'ok',
      rawStatus: 'Running',
      parentExternalId: 'z1'
    })
    expect(r.nodes[1].status).toBe('stopped')
  })

  it('CASE-icat-013 externalId 가 비면 노드로 만들지 않고 왜 버렸는지 남긴다', () => {
    const bad = { serverList: { server: [{ displayname: '이름만' }, { id: 'ok-1' }] } }
    const r = extractNodes(discover(), bad)
    expect(r.nodes.map((n) => n.externalId)).toEqual(['ok-1'])
    expect(r.dropped).toHaveLength(1)
    expect(r.dropped[0].reason).toContain('externalId')
  })

  it('CASE-icat-014 부모 참조는 뽑기 단계에서 끊지 않는다 — 부모는 다른 탐침 결과에 있을 수 있다', () => {
    const r = extractNodes(discover(), response)
    // 이 목록 안에 'z1' 이라는 노드는 없지만, VPC 탐침이 따로 가져올 수 있으므로 참조를 남긴다.
    expect(r.nodes[0].parentExternalId).toBe('z1')
  })

  it('CASE-icat-021 사전에 없는 상태는 모름으로 떨어지고 목록으로 보고된다', () => {
    const odd = { serverList: { server: [{ id: 'a', state: 'Rebooting' }] } }
    const r = extractNodes(discover(), odd)
    expect(r.nodes[0].status).toBe('unknown')
    expect(r.nodes[0].rawStatus).toBe('Rebooting')
    expect(r.unknownStatuses).toEqual(['Rebooting'])
  })

  it('목록 표현식이 배열을 못 가리키면 빈 결과 + 이유를 낸다(던지지 않는다)', () => {
    const r = extractNodes(discover({ list: 'nowhere.here' }), response)
    expect(r.nodes).toEqual([])
    expect(r.error).toContain('목록')
  })

  it('목록 표현식 자체가 문법 오류여도 던지지 않고 이유를 낸다', () => {
    const r = extractNodes(discover({ list: 'a b c(' }), response)
    expect(r.nodes).toEqual([])
    expect(r.error).toBeTruthy()
  })

  it('CASE-icat-014 합친 뒤 부모가 어디에도 없으면 최상위로 올린다 — 노드가 증발하지 않는다', () => {
    const { nodes, danglingParents } = linkParents([
      { externalId: 'a', status: 'ok', rawStatus: '', parentExternalId: 'none' }
    ])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].parentExternalId).toBeUndefined()
    expect(danglingParents).toEqual(['none'])
  })

  it('CASE-icat-014 합친 목록에 부모가 있으면 이어진다 — 다른 탐침이 가져온 부모도 포함', () => {
    const { nodes, danglingParents } = linkParents([
      { externalId: 'z1', status: 'ok', rawStatus: '' },
      { externalId: 'vm-1', status: 'ok', rawStatus: '', parentExternalId: 'z1' }
    ])
    expect(nodes[1].parentExternalId).toBe('z1')
    expect(danglingParents).toEqual([])
  })

  it('designNodeRef 를 뽑아 대조 1순위 근거로 넘긴다', () => {
    const tagged = {
      serverList: { server: [{ id: 'a', tags: [{ key: 'rockury:node', value: 'n-1' }] }] }
    }
    const d = discover()
    d.map.designNodeRef = "tags[?key=='rockury:node'].value | [0]"
    const r = extractNodes(d, tagged)
    expect(r.nodes[0].designNodeRef).toBe('n-1')
  })
})

describe('parseResponse — 응답 본문 읽기', () => {
  it('CASE-icat-017 통짜 JSON 을 읽는다(기본값)', () => {
    expect(parseResponse('{"a":1}').data).toEqual({ a: 1 })
    expect(parseResponse('{"a":1}', 'json').data).toEqual({ a: 1 })
  })

  it('CASE-icat-017 줄마다 JSON(ndjson)을 배열로 묶는다 — 도커가 이렇게 뱉는다', () => {
    const out = parseResponse('{"ID":"a"}\n{"ID":"b"}\n', 'ndjson')
    expect(out.data).toEqual([{ ID: 'a' }, { ID: 'b' }])
    expect(out.error).toBeUndefined()
  })

  it('CASE-icat-017 ndjson 의 깨진 줄은 **몇 번째 줄인지** 알린다', () => {
    const out = parseResponse('{"ID":"a"}\n망가진 줄\n', 'ndjson')
    expect(out.data).toBeUndefined()
    expect(out.error).toContain('2번째 줄')
  })

  it('CASE-icat-018 통짜로 읽다 실패하면 ndjson 을 권한다 — 도커에서 늘 겪는 실수', () => {
    const out = parseResponse('{"ID":"a"}\n{"ID":"b"}')
    expect(out.data).toBeUndefined()
    expect(out.error).toContain('ndjson')
  })

  it('빈 출력은 비었다고 말한다(던지지 않는다)', () => {
    expect(parseResponse('').error).toContain('비어')
    expect(parseResponse('   \n  ', 'ndjson').error).toContain('비어')
  })

  it('ndjson 의 빈 줄은 건너뛴다 — 마지막 줄바꿈이 오류가 되지 않게', () => {
    expect(parseResponse('{"a":1}\n\n{"a":2}\n\n', 'ndjson').data).toEqual([{ a: 1 }, { a: 2 }])
  })
})
