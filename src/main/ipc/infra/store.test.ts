import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setDbPath } from '../../store/db'
import {
  appendRun,
  countSnapshots,
  createDesign,
  deleteCatalog,
  deleteDesign,
  deleteProvider,
  getCatalog,
  latestSnapshot,
  listCatalogs,
  listDesigns,
  listEdges,
  listNodes,
  listProviders,
  listRuns,
  replaceGraph,
  saveCatalog,
  saveProvider,
  saveSnapshot,
  type NodeRow,
  type ProbeOutcomeRow,
  type ResourceRow
} from './store'

// 실 사용자 DB 를 절대 건드리지 않는다 — 임시 파일에만 붙는다(절대 불변식 1).
beforeAll(() => {
  setDbPath(join(mkdtempSync(join(tmpdir(), 'rockury-infra-')), 'test.db'))
})

const node = (p: Partial<NodeRow> & { id: string }): Omit<NodeRow, 'designId'> => ({
  typeId: null,
  name: p.id,
  parentId: null,
  x: 0,
  y: 0,
  w: 200,
  h: 60,
  doc: '{}',
  catalogVersion: null,
  ...p
})

describe('카탈로그 저장', () => {
  it('CASE-icat-050 넣고·고치고·지운다. 출처가 보존된다', () => {
    const saved = saveCatalog({
      source: 'mine',
      providerId: 'ktcloud',
      schemaVersion: 1,
      catalogVersion: '1',
      body: '{"a":1}'
    })
    expect(saved.source).toBe('mine')
    expect(listCatalogs().some((c) => c.id === saved.id)).toBe(true)

    saveCatalog({ ...saved, catalogVersion: '2', body: '{"a":2}' })
    expect(getCatalog(saved.id)?.catalogVersion).toBe('2')

    deleteCatalog(saved.id)
    expect(getCatalog(saved.id)).toBeNull()
  })

  it('CASE-icat-050 내장 카탈로그는 고치거나 지울 수 없다 — 복제해서 편집한다', () => {
    const builtin = saveCatalog({
      source: 'builtin',
      providerId: 'aws',
      schemaVersion: 1,
      catalogVersion: '2026.07.1',
      body: '{}'
    })
    expect(() => saveCatalog({ ...builtin, body: '{"hacked":1}' })).toThrow(/내장/)
    expect(() => deleteCatalog(builtin.id)).toThrow(/내장/)
    expect(getCatalog(builtin.id)?.body).toBe('{}')
  })

  it('가져온 카탈로그는 가져온 시각이 남는다', () => {
    const imported = saveCatalog({
      source: 'imported',
      providerId: 'x',
      schemaVersion: 1,
      catalogVersion: '1',
      body: '{}',
      approvedAt: '2026-07-28T00:00:00.000Z'
    })
    expect(imported.importedAt).toBeTruthy()
    expect(imported.approvedAt).toBe('2026-07-28T00:00:00.000Z')
  })
})

describe('공급자 연결', () => {
  it('CASE-icat-051 자격증명은 암호문 컬럼에만 들어간다 — 평문 컬럼이 없다', () => {
    const p = saveProvider({
      catalogId: 'c1',
      name: 'prod',
      credEncrypted: 'BASE64CIPHERTEXT',
      readOnly: true
    })
    expect(p.credEncrypted).toBe('BASE64CIPHERTEXT')
    expect(Object.keys(p)).not.toContain('credentials')
    expect(JSON.stringify(p)).not.toContain('"password"')
  })

  it('CASE-icat-052 공급자를 지워도 설계본은 남는다 — 설계는 실물과 독립이다', () => {
    const design = createDesign({ name: '독립 설계' })
    replaceGraph(design.id, [node({ id: 'n1' })], [])
    const p = saveProvider({ catalogId: 'c1', name: '지울것', credEncrypted: 'x', readOnly: true })

    deleteProvider(p.id)

    expect(listProviders().some((x) => x.id === p.id)).toBe(false)
    expect(listDesigns().some((d) => d.id === design.id)).toBe(true)
    expect(listNodes(design.id)).toHaveLength(1)
  })
})

describe('설계본·그래프 저장', () => {
  it('CASE-iarch-060 노드·간선·좌표가 그대로 오간다', () => {
    const d = createDesign({ name: '설계1', description: '설명' })
    replaceGraph(
      d.id,
      [
        node({ id: 'p', x: 10, y: 20, w: 400, h: 300 }),
        node({ id: 'c', parentId: 'p', x: 30, y: 40, typeId: 'ec2' })
      ],
      [{ id: 'e1', sourceId: 'p', targetId: 'c', label: '호출', kind: 'calls' }]
    )
    const nodes = listNodes(d.id)
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({ id: 'p', x: 10, y: 20, w: 400, h: 300 })
    expect(nodes[1]).toMatchObject({ id: 'c', parentId: 'p', typeId: 'ec2' })
    expect(listEdges(d.id)).toHaveLength(1)
  })

  it('CASE-iarch-060 저장은 그 설계에만 미친다 — 다른 설계를 건드리지 않는다', () => {
    const a = createDesign({ name: 'A' })
    const b = createDesign({ name: 'B' })
    replaceGraph(a.id, [node({ id: 'a1' })], [])
    replaceGraph(b.id, [node({ id: 'b1' })], [])

    replaceGraph(a.id, [node({ id: 'a2' })], [])

    expect(listNodes(a.id).map((n) => n.id)).toEqual(['a2'])
    expect(listNodes(b.id).map((n) => n.id)).toEqual(['b1'])
  })

  it('CASE-iarch-061 카탈로그에서 사라진 종류를 가리켜도 노드는 살아남는다', () => {
    const d = createDesign({ name: '유령종류' })
    replaceGraph(d.id, [node({ id: 'n', typeId: '없어진종류', catalogVersion: '2026.01.1' })], [])
    const [n] = listNodes(d.id)
    expect(n.typeId).toBe('없어진종류')
    // 언제 기준의 무엇이었는지가 남는다 — 그래서 지우지 않아도 된다.
    expect(n.catalogVersion).toBe('2026.01.1')
  })

  it('설계를 지우면 그 노드·간선도 같이 사라진다', () => {
    const d = createDesign({ name: '지울 설계' })
    replaceGraph(d.id, [node({ id: 'x' })], [{ id: 'e', sourceId: 'x', targetId: 'x', label: '', kind: 'calls' }])
    deleteDesign(d.id)
    expect(listNodes(d.id)).toHaveLength(0)
    expect(listEdges(d.id)).toHaveLength(0)
  })

  it('노드 순서가 저장·복원을 넘겨도 유지된다', () => {
    const d = createDesign({ name: '순서' })
    replaceGraph(d.id, [node({ id: 'z' }), node({ id: 'a' }), node({ id: 'm' })], [])
    expect(listNodes(d.id).map((n) => n.id)).toEqual(['z', 'a', 'm'])
  })
})

describe('실물 스냅샷', () => {
  const probe = (typeId: string, ok = true, count = 0, error = ''): ProbeOutcomeRow => ({
    typeId,
    ok,
    count,
    error
  })
  const res = (typeId: string, externalId: string, status = 'ok'): ResourceRow => ({
    typeId,
    externalId,
    name: externalId,
    status,
    rawStatus: 'running',
    parentExternalId: null,
    designNodeRef: null
  })

  it('CASE-iarch-063 회차 하나에 탐침 결과와 실물이 함께 저장된다', () => {
    const snap = saveSnapshot({
      providerId: 'p-snap-1',
      probes: [probe('docker.container', true, 2), probe('docker.image', true, 1)],
      resources: [res('docker.container', 'c1'), res('docker.container', 'c2'), res('docker.image', 'i1')]
    })
    expect(snap.ok).toBe(true)
    expect(snap.resources).toHaveLength(3)
    expect(snap.probes).toHaveLength(2)
    expect(snap.takenAt).toBeTruthy()
  })

  it('CASE-iarch-063 일부 탐침이 실패해도 성공분은 저장되고 실패는 실패로 남는다', () => {
    const snap = saveSnapshot({
      providerId: 'p-snap-2',
      probes: [probe('docker.container', true, 1), probe('docker.volume', false, 0, 'ENOENT')],
      resources: [res('docker.container', 'c1')]
    })
    expect(snap.ok).toBe(false) // 회차 전체는 "완전하지 않음"
    expect(snap.resources).toHaveLength(1) // 성공분은 살아 있다
    const failed = snap.probes.find((p) => p.typeId === 'docker.volume')
    expect(failed?.ok).toBe(false)
    expect(failed?.error).toBe('ENOENT')
  })

  it('CASE-iarch-034 0건과 못 읽음을 구분한다 — 대조의 "대조 안 함" 판정이 여기 선다', () => {
    const snap = saveSnapshot({
      providerId: 'p-snap-3',
      probes: [probe('docker.network', true, 0), probe('docker.volume', false, 0, '권한 없음')],
      resources: []
    })
    const zero = snap.probes.find((p) => p.typeId === 'docker.network')
    const failed = snap.probes.find((p) => p.typeId === 'docker.volume')
    expect(zero?.ok).toBe(true) // 읽었는데 0건
    expect(failed?.ok).toBe(false) // 못 읽었다
  })

  it('아직 읽지 않은 공급자는 최신 회차가 없다', () => {
    expect(latestSnapshot('없는공급자')).toBeNull()
  })

  it('CASE-iarch-062 오래된 회차는 정리되고 최신이 남는다', () => {
    for (let i = 0; i < 13; i++) {
      saveSnapshot({
        providerId: 'p-prune',
        probes: [probe('docker.container', true, 1)],
        resources: [res('docker.container', `c${i}`)]
      })
    }
    expect(countSnapshots('p-prune')).toBeLessThanOrEqual(10)
    expect(latestSnapshot('p-prune')?.resources[0].externalId).toBe('c12')
  })

  it('원본 상태 문자열이 사전을 거친 값과 함께 보존된다', () => {
    const snap = saveSnapshot({
      providerId: 'p-raw',
      probes: [probe('docker.container', true, 1)],
      resources: [
        {
          typeId: 'docker.container',
          externalId: 'c1',
          name: 'web',
          status: 'unknown',
          rawStatus: 'Rebooting',
          parentExternalId: null,
          designNodeRef: null
        }
      ]
    })
    expect(snap.resources[0]).toMatchObject({ status: 'unknown', rawStatus: 'Rebooting' })
  })
})

describe('실행 이력', () => {
  it('CASE-icat-043 이력에는 치환 전 인자만 남는다 — 자격증명이 안 들어간다', () => {
    appendRun({
      kind: 'probe',
      cmd: 'aws',
      displayArgs: ['ec2', 'describe-instances', '--profile', '{{cred.profile}}'],
      ok: true,
      exitCode: 0,
      durationMs: 12
    })
    const [row] = listRuns(1)
    expect(row.cmd).toBe('aws')
    expect(row.args).toContain('{{cred.profile}}')
    expect(row.ok).toBe(true)
  })

  it('실패도 종료 코드·사유와 함께 남는다', () => {
    appendRun({
      kind: 'probe',
      cmd: '없는명령',
      displayArgs: [],
      ok: false,
      exitCode: null,
      durationMs: 3,
      error: 'ENOENT'
    })
    const [row] = listRuns(1)
    expect(row.ok).toBe(false)
    expect(row.error).toBe('ENOENT')
  })
})
