import { describe, expect, it } from 'vitest'
import {
  buildRequestTree,
  canMoveFolder,
  folderPaths,
  isAncestor,
  moveFolder,
  moveRequest,
  normalizeFolder,
  renameFolder,
  type TreeFolder
} from './tree'
import type { RequestDef } from './types'

/** TestPlan: api-studio · CASE-apistudio-050·051 (requests.tree). */

const r = (name: string, folder = ''): RequestDef => ({
  id: name,
  name,
  folder,
  shape: 'unary',
  params: [],
  request: {},
  responses: [],
  docs: ''
})

const names = (nodes: ReturnType<typeof buildRequestTree>): string[] =>
  nodes.map((n) => (n.t === 'folder' ? `[${n.name}]` : n.request.name))

describe('폴더 경로 다듬기', () => {
  it('빈 조각·앞뒤 공백을 정리한다', () => {
    expect(normalizeFolder(' 결제 / / 환불 ')).toBe('결제/환불')
    expect(normalizeFolder('///')).toBe('')
    expect(normalizeFolder('')).toBe('')
  })
})

describe('트리 조립', () => {
  it('폴더가 없으면 평평한 목록 그대로다', () => {
    expect(names(buildRequestTree([r('a'), r('b')]))).toEqual(['a', 'b'])
  })

  it('폴더로 묶이고 중첩까지 들어간다', () => {
    const tree = buildRequestTree([r('pay', '결제'), r('refund', '결제/환불'), r('ping')])
    expect(names(tree)).toEqual(['[결제]', 'ping'])
    const 결제 = tree[0] as TreeFolder
    expect(names(결제.children)).toEqual(['pay', '[환불]'])
    expect(names((결제.children[1] as TreeFolder).children)).toEqual(['refund'])
  })

  it('중간 폴더가 비어 있어도 경로가 이어진다 — 빈 폴더를 저장할 필요가 없다', () => {
    const tree = buildRequestTree([r('deep', 'a/b/c')])
    const a = tree[0] as TreeFolder
    const b = a.children[0] as TreeFolder
    expect(a.path).toBe('a')
    expect(b.path).toBe('a/b')
    expect(names((b.children[0] as TreeFolder).children)).toEqual(['deep'])
  })

  it('**요청의 원래 순서를 지킨다** — 알파벳으로 다시 정렬하면 사람이 정한 의도가 사라진다', () => {
    expect(names(buildRequestTree([r('z'), r('a')]))).toEqual(['z', 'a'])
  })

  it('폴더는 처음 등장한 자리에 선다', () => {
    expect(names(buildRequestTree([r('first'), r('inFolder', 'F'), r('last')]))).toEqual([
      'first',
      '[F]',
      'last'
    ])
  })
})

describe('폴더 목록', () => {
  it('중간 단계도 폴더로 센다', () => {
    expect(folderPaths([r('x', 'a/b')])).toEqual(['a', 'a/b'])
  })

  it('중복은 한 번만 나온다', () => {
    expect(folderPaths([r('x', 'a'), r('y', 'a')])).toEqual(['a'])
  })
})

describe('조상 판정', () => {
  it('경계에서 안 헷갈린다 — `a` 는 `a/b` 의 조상이지만 `ab` 의 조상은 아니다', () => {
    expect(isAncestor('a', 'a/b')).toBe(true)
    expect(isAncestor('a', 'ab')).toBe(false)
    expect(isAncestor('a', 'a')).toBe(true)
    // 최상위는 모두의 조상이다.
    expect(isAncestor('', 'anything')).toBe(true)
  })
})

describe('드롭 방지 (CASE-apistudio-051)', () => {
  it('**폴더를 자기 자손 안으로 못 옮긴다** — 트리가 고리가 된다', () => {
    const c = canMoveFolder('a', 'a/b')
    expect(c.ok).toBe(false)
    expect(c.reason).toContain('자기 안')
  })

  it('자기 자신에게도 못 옮긴다', () => {
    expect(canMoveFolder('a', 'a').ok).toBe(false)
  })

  it('이미 그 자리면 막고 이유를 준다 — 조용히 무시하면 "왜 안 되지" 가 된다', () => {
    expect(canMoveFolder('a/b', 'a').reason).toContain('이미 그 자리')
  })

  it('남의 가지로는 옮길 수 있다', () => {
    expect(canMoveFolder('a/b', 'c')).toEqual({ ok: true, reason: null })
  })

  it('최상위로 올리는 것도 된다', () => {
    expect(canMoveFolder('a/b', '').ok).toBe(true)
  })

  it('막힌 이동은 목록을 안 바꾼다', () => {
    const src = [r('x', 'a/b')]
    expect(moveFolder(src, 'a', 'a/b').map((q) => q.folder)).toEqual(['a/b'])
  })
})

describe('옮기기', () => {
  it('요청 하나의 소속을 바꾼다 — 목록 순서는 안 바꾼다', () => {
    const out = moveRequest([r('a'), r('b')], 'b', '결제')
    expect(out.map((q) => q.name)).toEqual(['a', 'b'])
    expect(out[1].folder).toBe('결제')
  })

  it('폴더를 옮기면 자손 경로가 함께 따라간다', () => {
    const out = moveFolder([r('x', 'a'), r('y', 'a/b'), r('z', 'other')], 'a', 'top')
    expect(out.map((q) => q.folder)).toEqual(['top/a', 'top/a/b', 'other'])
  })

  it('폴더 이름을 바꾸면 자손 경로도 갈린다', () => {
    const out = renameFolder([r('x', 'a'), r('y', 'a/b'), r('z', 'ab')], 'a', '결제')
    // `ab` 는 `a` 의 자손이 아니다 — 접두어만 같다고 갈아 끼우면 남의 폴더가 망가진다.
    expect(out.map((q) => q.folder)).toEqual(['결제', '결제/b', 'ab'])
  })

  it('이름에 슬래시를 넣어 계층을 몰래 만들 수 없다', () => {
    expect(renameFolder([r('x', 'a')], 'a', 'b/c').map((q) => q.folder)).toEqual(['a'])
  })
})
