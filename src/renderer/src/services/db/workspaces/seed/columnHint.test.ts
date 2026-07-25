import { describe, expect, it } from 'vitest'
import type { Constraint, TableDef } from '../definition/types'
import { isRequiredForSeed, requiredSeedColumns, seedColumnHints } from './columnHint'

/** CASE-studio-005~007 (docs/qa/db-studio.md) */

const col = (id: string, name: string, over: Partial<TableDef['columns'][number]> = {}) => ({
  id,
  name,
  type: 'VARCHAR(64)',
  nullable: false,
  defaultValue: null,
  comment: '',
  ...over
})

const table = (cols: TableDef['columns'], constraints: Constraint[] = []): TableDef => ({
  id: 't:users',
  designId: 'd1',
  name: 'users',
  comment: '',
  columns: cols,
  constraints
})

describe('CASE-studio-005 시드가 채워야 하는 컬럼 판정', () => {
  it('NOT NULL + 기본값 없음 → 필수', () => {
    expect(isRequiredForSeed(col('c', 'email'))).toBe(true)
  })

  it('NULL 허용이면 필수 아님', () => {
    expect(isRequiredForSeed(col('c', 'memo', { nullable: true }))).toBe(false)
  })

  it('기본값이 있으면 필수 아님(빈 문자열 기본값은 "없음"으로 본다)', () => {
    expect(isRequiredForSeed(col('c', 'status', { defaultValue: "'pending'" }))).toBe(false)
    expect(isRequiredForSeed(col('c', 'status', { defaultValue: '   ' }))).toBe(true)
  })

  it('자동증가면 필수 아님 — DB 가 채운다', () => {
    expect(isRequiredForSeed(col('c', 'id', { defaultValue: 'AUTO_INCREMENT' }))).toBe(false)
    expect(isRequiredForSeed(col('c', 'id', { type: 'serial' }))).toBe(false)
  })

  it('테이블 단위로 컬럼 순서대로 모은다', () => {
    const t = table([
      col('c1', 'id', { defaultValue: 'AUTO_INCREMENT' }),
      col('c2', 'email'),
      col('c3', 'memo', { nullable: true }),
      col('c4', 'code')
    ])
    expect(requiredSeedColumns(t)).toEqual(['email', 'code'])
  })
})

describe('CASE-studio-006 컬럼 머리 배지', () => {
  const pk: Constraint = { id: 'k1', kind: 'pk', name: 'PRIMARY', columns: [{ columnId: 'c1' }] }
  const fk: Constraint = {
    id: 'k2',
    kind: 'fk',
    name: 'fk_org',
    columns: [{ columnId: 'c2' }],
    refTable: 'orgs',
    refColumns: ['id'],
    onDelete: 'CASCADE'
  }
  const compositeUk: Constraint = {
    id: 'k3',
    kind: 'uk',
    name: 'uq_org_email',
    columns: [{ columnId: 'c2' }, { columnId: 'c3' }]
  }
  const check: Constraint = { id: 'k4', kind: 'check', name: 'ck_age', columns: [], expression: 'age >= 0' }

  const t = table(
    [col('c1', 'id'), col('c2', 'org_id'), col('c3', 'email'), col('c4', 'age', { type: 'INT' })],
    [pk, fk, compositeUk, check]
  )
  const hints = seedColumnHints(t)
  const byName = (n: string) => hints.find((h) => h.name === n)!

  it('PK·FK 를 텍스트 배지로 준다(이모지 없음)', () => {
    expect(byName('id').badges).toEqual(['PK'])
    expect(byName('org_id').badges).toEqual(['FK', 'UK1'])
  })

  it('복합 제약은 위치 번호를 붙인다', () => {
    expect(byName('email').badges).toEqual(['UK2'])
  })

  it('CHECK 이 참조하는 컬럼은 CHK 로 표시한다', () => {
    expect(byName('age').hasCheck).toBe(true)
    expect(byName('id').hasCheck).toBe(false)
  })

  it('타입 라벨은 소문자로 정리된다', () => {
    expect(byName('age').typeLabel).toBe('int')
  })

  it('컬럼 순서를 그대로 유지한다', () => {
    expect(hints.map((h) => h.name)).toEqual(['id', 'org_id', 'email', 'age'])
  })
})

describe('CASE-studio-007 컬럼 상세(툴팁) — 화면 왕복 없이 다 담는다', () => {
  const t = table(
    [
      col('c1', 'id', { type: 'CHAR(36)', comment: '사용자 PK' }),
      col('c2', 'org_id'),
      col('c3', 'memo', { nullable: true, defaultValue: "'-'" }),
      col('c4', 'age', { type: 'INT', nullable: true })
    ],
    [
      { id: 'k1', kind: 'pk', name: 'PRIMARY', columns: [{ columnId: 'c1' }] },
      {
        id: 'k2',
        kind: 'fk',
        name: 'fk_org',
        columns: [{ columnId: 'c2' }],
        refTable: 'orgs',
        refColumns: ['id'],
        onDelete: 'CASCADE'
      },
      { id: 'k3', kind: 'check', name: 'ck_age', columns: [], expression: 'age >= 0' }
    ]
  )
  const hints = seedColumnHints(t)
  const byName = (n: string) => hints.find((h) => h.name === n)!

  it('타입·NULL 여부·기본값·필수 여부를 담는다', () => {
    const d = byName('id').detail
    expect(d).toContain('char(36)')
    expect(d).toContain('NOT NULL')
    expect(d).toContain('기본값 없음')
    expect(d).toContain('시드가 채워야 함')
  })

  it('기본값이 있으면 그 값을 보이고 필수 문구는 없다', () => {
    const d = byName('memo').detail
    expect(d).toContain('NULL 허용')
    expect(d).toContain("기본값 '-'")
    expect(d).not.toContain('시드가 채워야 함')
  })

  it('FK 는 어디를 가리키는지와 정책을 담는다', () => {
    const d = byName('org_id').detail
    expect(d).toContain('FK')
    expect(d).toContain('orgs')
    expect(d).toContain('ON DELETE')
  })

  it('CHECK 식과 설명을 담는다', () => {
    expect(byName('age').detail).toContain('age >= 0')
    expect(byName('id').detail).toContain('설명: 사용자 PK')
  })
})
