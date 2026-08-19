import { describe, expect, it } from 'vitest'
import { seedLensView, seedRestoreAction } from './seedLens'
import type { SeedSet } from './types'

const set = (designId: string, tableName: string, rows = 0): SeedSet => ({
  designId,
  tableName,
  naturalKey: ['code'],
  ignoredColumns: [],
  strength: 'ensure',
  rows: Array.from({ length: rows }, (_, i) => ({ id: `row-${i + 1}`, values: { code: String(i) } }))
})

describe('seedLensView — 시드를 버전 렌즈로 읽는다', () => {
  const draft = [set('d1', 'roles', 2), set('d1', 'users', 1), set('d2', 'codes', 3)]

  it('Draft 렌즈면 그 설계의 작업본만 준다', () => {
    const v = seedLensView({ designId: 'd1', readOnly: false, snapshotSeeds: undefined, draft })
    expect(v.source).toBe('draft')
    expect(v.sets.map((s) => s.tableName)).toEqual(['roles', 'users'])
  })

  it('설계를 안 골랐으면 빈 목록', () => {
    expect(seedLensView({ designId: null, readOnly: false, snapshotSeeds: undefined, draft }).sets).toEqual([])
  })

  it('버전 렌즈면 그 버전이 담은 시드를 준다', () => {
    const snapshotSeeds = [set('d1', 'roles', 5)]
    const v = seedLensView({ designId: 'd1', readOnly: true, snapshotSeeds, draft })
    expect(v.source).toBe('version')
    expect(v.sets).toBe(snapshotSeeds)
  })

  it('버전이 시드를 0개로 담았으면 그대로 0개다(Draft 로 새지 않는다)', () => {
    const v = seedLensView({ designId: 'd1', readOnly: true, snapshotSeeds: [], draft })
    expect(v.source).toBe('version')
    expect(v.sets).toEqual([])
  })

  // 회귀: 시드 기록이 없는 옛 버전을 보면 Draft 시드가 "이 버전의 시드"인 척 보였다.
  it('시드를 담은 적 없는 버전이면 Draft 로 흘려보내지 않고 "기록 없음"으로 알린다', () => {
    const v = seedLensView({ designId: 'd1', readOnly: true, snapshotSeeds: undefined, draft })
    expect(v.source).toBe('unrecorded')
    expect(v.sets).toEqual([])
  })
})

describe('seedRestoreAction — 되돌리기가 시드에 할 일', () => {
  it('버전이 시드를 담았으면 그것으로 갈아끼운다', () => {
    const a = seedRestoreAction([set('d1', 'roles', 2)], 'd1')
    expect(a).toEqual({ kind: 'replace', sets: [set('d1', 'roles', 2)] })
  })

  it('시드를 0개로 담은 버전으로 되돌리면 Draft 시드도 비운다', () => {
    expect(seedRestoreAction([], 'd1')).toEqual({ kind: 'replace', sets: [] })
  })

  // 회귀: 기록 없음을 "0개"로 읽으면 옛 버전을 눌러 보는 것만으로 시드가 통째로 날아간다.
  it('시드 기록이 없는 버전이면 Draft 시드를 건드리지 않는다', () => {
    expect(seedRestoreAction(undefined, 'd1')).toEqual({ kind: 'keep' })
  })

  it('스냅샷이 다른 설계 id 를 달고 있으면 되돌리는 설계 소유로 다시 적는다', () => {
    const a = seedRestoreAction([set('imported', 'roles', 1)], 'd1')
    expect(a.kind === 'replace' && a.sets.every((s) => s.designId === 'd1')).toBe(true)
  })
})
