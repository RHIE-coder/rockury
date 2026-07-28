import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setDbPath } from './db'
import {
  assertRequestsConsistent,
  createSpec,
  createVersion,
  deleteSpec,
  getSpec,
  listSpecs,
  listVersions,
  replaceRequests,
  requireKind,
  updateSpec
} from './apiSpecs'
import type { RequestDef } from '../../shared/api/types'

/**
 * API 명세 저장소 — 데이터 규칙이 **화면이 아니라 여기 한 곳**에서 강제되는지 본다.
 * 화면·IPC·MCP 세 진입 경로가 있으므로 규칙이 화면에 있으면 나머지 둘이 우회한다.
 */

beforeAll(() => {
  // 실 사용자 DB 를 절대 안 건드린다 — 임시 파일에만 쓴다(AGENTS.md 불변식 1).
  setDbPath(join(mkdtempSync(join(tmpdir(), 'rockury-api-')), 'test.db'))
})

const req = (name: string, over: Partial<RequestDef> = {}): RequestDef => ({
  id: `r_${name}`,
  name,
  folder: '',
  shape: 'unary',
  params: [],
  request: { method: 'GET', path: `/${name}` },
  responses: [],
  docs: '',
  ...over
})

describe('명세 CRUD', () => {
  it('만들고 목록에 뜬다 — id 는 이름 슬러그, 충돌하면 뒤에 번호가 붙는다', () => {
    const a = createSpec({ name: 'Billing API', kind: 'rest' })
    const b = createSpec({ name: 'Billing API', kind: 'graphql' })
    expect(a.id).toBe('billing-api')
    expect(b.id).toBe('billing-api-2')
    expect(listSpecs().map((s) => s.id)).toContain('billing-api')
  })

  it('인터페이스 종류는 표기 흔들림을 정규화해 받고, 모르는 값은 선택지와 함께 거부한다', () => {
    expect(requireKind('  REST ')).toBe('rest')
    expect(() => requireKind('soap')).toThrow(/graphql/)
    expect(() => createSpec({ name: 'x', kind: '' })).toThrow(/허용/)
  })

  it('이름·설명은 고쳐지고 종류는 입력 표면에 없다', () => {
    const s = createSpec({ name: 'Edit Me', kind: 'rest' })
    const after = updateSpec(s.id, { name: '고친 이름', description: '설명' })
    expect(after.name).toBe('고친 이름')
    expect(after.kind).toBe('rest')
  })

  it('없는 명세를 고치려 하면 알린다', () => {
    expect(() => updateSpec('없음', { name: 'x', description: '' })).toThrow(/없습니다/)
  })

  it('삭제하면 소속 요청·버전도 함께 사라진다', () => {
    const s = createSpec({ name: 'Doomed', kind: 'rest' })
    replaceRequests(s.id, [req('a')])
    createVersion(s.id, 'v0.1.0')
    deleteSpec(s.id)
    expect(getSpec(s.id)).toBeUndefined()
    expect(listVersions(s.id)).toEqual([])
  })
})

describe('요청 저장 — 규칙은 스토어가 강제한다', () => {
  it('저장한 그대로 되읽힌다 (파라미터·응답·문서 왕복)', () => {
    const s = createSpec({ name: 'RoundTrip', kind: 'rest' })
    const r = req('getUser', {
      params: [{ name: 'id', type: 'string', required: true }],
      responses: [{ status: '200', fields: [{ name: 'id', type: 'string', requiredness: 'required' }] }],
      docs: '# 주의\n폐기 예정'
    })
    replaceRequests(s.id, [r])
    expect(getSpec(s.id)!.requests).toEqual([r])
  })

  it('순서를 보존한다', () => {
    const s = createSpec({ name: 'Ordered', kind: 'rest' })
    replaceRequests(s.id, [req('c'), req('a'), req('b')])
    expect(getSpec(s.id)!.requests.map((r) => r.name)).toEqual(['c', 'a', 'b'])
  })

  it('명세 스코프 교체 — 다른 명세의 요청은 건드리지 않는다', () => {
    const one = createSpec({ name: 'Iso1', kind: 'rest' })
    const two = createSpec({ name: 'Iso2', kind: 'rest' })
    replaceRequests(one.id, [req('keep')])
    replaceRequests(two.id, [req('other')])
    replaceRequests(two.id, [])
    expect(getSpec(one.id)!.requests).toHaveLength(1)
  })

  it('요청 이름 중복을 막는다 — 이름이 버전 diff 의 조준점이라 겹치면 판정이 엉킨다', () => {
    const s = createSpec({ name: 'Dup', kind: 'rest' })
    expect(() => replaceRequests(s.id, [req('same'), req('same', { id: 'r2' })])).toThrow(/두 번/)
  })

  it('인터페이스가 안 쓰는 칸을 거부한다 (shape AC-7)', () => {
    const s = createSpec({ name: 'Wrong', kind: 'websocket' })
    expect(() => replaceRequests(s.id, [req('ws', { shape: 'duplex', request: { body: '{}' } })])).toThrow(
      /body/
    )
  })

  it('그 인터페이스에 없는 상호작용 모양을 거부한다', () => {
    const s = createSpec({ name: 'Shape', kind: 'sse' })
    expect(() => replaceRequests(s.id, [req('x', { shape: 'duplex', request: {} })])).toThrow(/duplex/)
  })

  it('파라미터 정의 오류를 저장 전에 막는다', () => {
    const s = createSpec({ name: 'BadParam', kind: 'rest' })
    expect(() =>
      replaceRequests(s.id, [req('p', { params: [{ name: 'e', type: 'enum', required: true, enumValues: [] }] })])
    ).toThrow(/허용 값/)
  })

  it('한 요청에 같은 상태를 두 번 선언하면 막는다', () => {
    const s = createSpec({ name: 'DupStatus', kind: 'rest' })
    expect(() =>
      replaceRequests(s.id, [
        req('r', { responses: [{ status: '200', fields: [] }, { status: '200', fields: [] }] })
      ])
    ).toThrow(/200/)
  })

  it('검사에 걸리면 아무것도 저장되지 않는다 (부분 반영 없음)', () => {
    const s = createSpec({ name: 'Atomic', kind: 'rest' })
    replaceRequests(s.id, [req('before')])
    expect(() => replaceRequests(s.id, [req('ok'), req('ok', { id: 'r2' })])).toThrow()
    expect(getSpec(s.id)!.requests.map((r) => r.name)).toEqual(['before'])
  })

  it('assertRequestsConsistent 는 저장 없이도 같은 규칙을 준다 (MCP 미리검사용)', () => {
    expect(() => assertRequestsConsistent('rest', [req('a')])).not.toThrow()
    expect(() => assertRequestsConsistent('webhook', [req('a', { shape: 'inbound' })])).toThrow(/method/)
  })
})

describe('버전 — 불변 스냅샷', () => {
  it('컷한 뒤 Draft 를 고쳐도 스냅샷은 안 바뀐다', () => {
    const s = createSpec({ name: 'Snap', kind: 'rest' })
    replaceRequests(s.id, [req('v1only')])
    createVersion(s.id, 'v0.1.0', '첫 컷')
    replaceRequests(s.id, [req('changed')])

    const [v] = listVersions(s.id)
    expect(v.snapshot.requests.map((r) => r.name)).toEqual(['v1only'])
    expect(getSpec(s.id)!.requests.map((r) => r.name)).toEqual(['changed'])
  })

  it('같은 번호를 다시 쓰지 못한다', () => {
    const s = createSpec({ name: 'Renum', kind: 'rest' })
    createVersion(s.id, 'v0.1.0')
    expect(() => createVersion(s.id, 'v0.1.0')).toThrow(/이미 있습니다/)
  })

  it('스냅샷 본문은 호출자가 주입하지 않는다 — 저장된 Draft 에서만 나온다', () => {
    const s = createSpec({ name: 'NoInject', kind: 'rest' })
    replaceRequests(s.id, [req('real')])
    expect(createVersion(s.id, 'v1.0.0').snapshot.requests.map((r) => r.name)).toEqual(['real'])
  })

  it('최신 버전이 명세 목록 요약에 실린다', () => {
    const s = createSpec({ name: 'Latest', kind: 'rest' })
    expect(listSpecs().find((x) => x.id === s.id)!.latestVersion).toBeNull()
    createVersion(s.id, 'v0.1.0')
    expect(listSpecs().find((x) => x.id === s.id)!.latestVersion).toBe('v0.1.0')
  })
})
