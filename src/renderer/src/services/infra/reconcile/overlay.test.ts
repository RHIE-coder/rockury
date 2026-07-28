import { describe, it, expect } from 'vitest'
import { docQueue, verdictByNode } from './overlay'
import type { DiffRow } from './diff'
import type { DesignNode } from '../design/types'
import { EMPTY_DOC, type NodeDoc } from '../catalog/types'

const node = (over: Partial<DesignNode> & { id: string; name: string }): DesignNode => ({
  designId: 'd1',
  typeId: null,
  parentId: null,
  x: 0,
  y: 0,
  w: 200,
  h: 60,
  doc: EMPTY_DOC,
  ...over
})

const row = (verdict: DiffRow['verdict'], designNode?: DesignNode): DiffRow => ({
  verdict,
  designNode,
  resources: [],
  fields: [],
  unknownType: false
})

describe('verdictByNode — 설계 노드마다 어떤 배지가 붙나', () => {
  it('CASE-iarch-091 판정을 설계 노드 id 로 찾을 수 있게 편다', () => {
    const a = node({ id: 'a', name: 'a' })
    const b = node({ id: 'b', name: 'b' })
    const m = verdictByNode([row('missing', a), row('drift', b)])
    expect(m).toEqual({ a: 'missing', b: 'drift' })
  })

  it('설계 노드가 없는 줄(미등록 실물)은 배지 대상이 아니다 — 그릴 노드가 없다', () => {
    expect(verdictByNode([row('unregistered')])).toEqual({})
  })

  it("'일치'도 담는다 — 배지를 켠 사용자는 '확인됨'을 보고 싶어 한다", () => {
    const a = node({ id: 'a', name: 'a' })
    expect(verdictByNode([row('ok', a)])).toEqual({ a: 'ok' })
  })

  it("'대조 안 함'을 '미구축'과 다른 배지로 남긴다 — 둘을 섞으면 지우러 간다", () => {
    const a = node({ id: 'a', name: 'a' })
    expect(verdictByNode([row('not-checked', a)])).toEqual({ a: 'not-checked' })
  })

  it('줄이 없으면 빈 지도(대조 전에도 캔버스가 산다)', () => {
    expect(verdictByNode([])).toEqual({})
  })
})

const filled: NodeDoc = { ...EMPTY_DOC, role: '있음' }

describe('docQueue — 흡수 초안 뒤 무엇부터 채우나', () => {
  it('CASE-iarch-092 문서가 빈 노드만 줄을 세운다', () => {
    const nodes = [
      node({ id: 'a', name: '빈 것' }),
      node({ id: 'b', name: '채운 것', doc: filled })
    ]
    expect(docQueue(nodes).map((n) => n.id)).toEqual(['a'])
  })

  it('CASE-iarch-092 담는 상자를 안의 것보다 먼저 세운다 — 큰 그림부터 적어야 안쪽이 쉬워진다', () => {
    const nodes = [
      node({ id: 'child', name: '자식', parentId: 'box' }),
      node({ id: 'box', name: '상자' })
    ]
    expect(docQueue(nodes).map((n) => n.id)).toEqual(['box', 'child'])
  })

  it('같은 깊이면 자식을 많이 담은 것이 먼저다 — 파급이 큰 것부터', () => {
    const nodes = [
      node({ id: 'small', name: '작은 상자' }),
      node({ id: 'big', name: '큰 상자' }),
      node({ id: 'k1', name: 'k1', parentId: 'big', doc: filled }),
      node({ id: 'k2', name: 'k2', parentId: 'big', doc: filled })
    ]
    expect(docQueue(nodes).map((n) => n.id)).toEqual(['big', 'small'])
  })

  it('깊이·자식 수가 같으면 이름 순 — 순서가 실행마다 흔들리지 않는다', () => {
    const nodes = [node({ id: '2', name: 'b' }), node({ id: '1', name: 'a' })]
    expect(docQueue(nodes).map((n) => n.id)).toEqual(['1', '2'])
  })

  it('전부 채워져 있으면 빈 목록 — 다 했으면 잔소리하지 않는다', () => {
    expect(docQueue([node({ id: 'a', name: 'a', doc: filled })])).toEqual([])
  })

  it('부모 참조가 끊겨 있어도 크래시하지 않는다', () => {
    const nodes = [node({ id: 'x', name: 'x', parentId: '없는부모' })]
    expect(docQueue(nodes).map((n) => n.id)).toEqual(['x'])
  })
})
