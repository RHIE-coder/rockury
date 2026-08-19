import { describe, it, expect } from 'vitest'
import { planImport, checkImportNumber, defaultImportDesignName, scopeTableIds } from './importSchema'
import type { TableDef } from '../workspaces/definition/types'

describe('planImport', () => {
  it('설계가 없으면 새 설계 부트스트랩(첫 버전)', () => {
    expect(planImport({ hasDesign: false, latestVersionNumber: null })).toEqual({
      mode: 'new-design',
      suggestedNumber: 'v0.1.0'
    })
  })
  it('설계는 있으나 버전이 없으면 첫 버전 컷(version-up)', () => {
    expect(planImport({ hasDesign: true, latestVersionNumber: null })).toEqual({
      mode: 'version-up',
      suggestedNumber: 'v0.1.0'
    })
  })
  it('설계+버전이 있으면 다음 번호(기본 patch)로 버전업', () => {
    expect(planImport({ hasDesign: true, latestVersionNumber: 'v0.3.14' })).toEqual({
      mode: 'version-up',
      suggestedNumber: 'v0.3.15'
    })
  })
  it('bump 레벨을 반영한다', () => {
    expect(planImport({ hasDesign: true, latestVersionNumber: 'v0.3.14' }, 'minor').suggestedNumber).toBe('v0.4.0')
  })
})

describe('checkImportNumber', () => {
  it('정규형은 그대로 통과', () => {
    expect(checkImportNumber('v0.2.0', ['v0.1.0'])).toEqual({ number: 'v0.2.0', error: null })
  })
  it('축약형·공백은 정규형으로 고쳐 통과 — 사람이 적은 대로 저장하지 않는다', () => {
    expect(checkImportNumber('0.2', [])).toEqual({ number: 'v0.2.0', error: null })
    expect(checkImportNumber(' v2 ', [])).toEqual({ number: 'v2.0.0', error: null })
  })
  it('형식이 아니면 막는다', () => {
    expect(checkImportNumber('최종본', []).error).toBe('v0.1.0 형태여야 합니다')
    expect(checkImportNumber('v1.2.3.4', []).number).toBeNull()
  })
  it('비었으면 사유가 다르다 — 아직 안 적은 것과 잘못 적은 것', () => {
    expect(checkImportNumber('', []).error).toBe('버전 번호 필요')
    expect(checkImportNumber('   ', []).error).toBe('버전 번호 필요')
  })
  it('이미 있는 번호는 막는다 — 고친 뒤의 번호로 견준다', () => {
    expect(checkImportNumber('0.1', ['v0.1.0']).error).toBe('이미 있는 번호')
  })
  it('최신보다 낮으면 막는다 — 번호는 뒤로 안 간다', () => {
    expect(checkImportNumber('v0.1.5', ['v0.1.0', 'v0.2.0']).error).toBe('v0.2.0 보다 높아야 합니다')
    expect(checkImportNumber('v0.2.1', ['v0.1.0', 'v0.2.0']).error).toBeNull()
  })
  it('견줄 것이 없으면 아무 번호나 첫 컷이 된다', () => {
    expect(checkImportNumber('v9.9.9', []).error).toBeNull()
  })
})

describe('defaultImportDesignName', () => {
  it('연결 이름에서 파생', () => {
    expect(defaultImportDesignName('운영 DB')).toBe('운영 DB (imported)')
  })
  it('빈 이름은 imported 로 폴백', () => {
    expect(defaultImportDesignName('')).toBe('imported')
    expect(defaultImportDesignName('   ')).toBe('imported')
  })
})

describe('scopeTableIds', () => {
  const tables: TableDef[] = [
    {
      id: 't:users',
      designId: 'x',
      name: 'users',
      comment: '',
      columns: [
        { id: 'c:users.id', name: 'id', type: 'BIGINT', nullable: false, defaultValue: null, comment: '' },
        { id: 'c:users.email', name: 'email', type: 'VARCHAR(255)', nullable: false, defaultValue: null, comment: '' }
      ],
      constraints: [
        { id: 'k:users.pk', kind: 'pk', name: 'pk_users', columns: [{ columnId: 'c:users.id' }] },
        {
          id: 'k:users.fk', kind: 'fk', name: 'fk_users_org', columns: [{ columnId: 'c:users.email' }],
          refTable: 'orgs', refColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'RESTRICT'
        }
      ]
    }
  ]

  it('테이블·컬럼·제약 id 에 접두를 붙인다', () => {
    const out = scopeTableIds(tables, 'shop')
    expect(out[0].id).toBe('shop:t:users')
    expect(out[0].columns.map((c) => c.id)).toEqual(['shop:c:users.id', 'shop:c:users.email'])
    expect(out[0].constraints.map((k) => k.id)).toEqual(['shop:k:users.pk', 'shop:k:users.fk'])
  })

  it('제약의 컬럼 참조(columnId)를 같은 매핑으로 갱신한다', () => {
    const out = scopeTableIds(tables, 'shop')
    expect(out[0].constraints[0].columns[0].columnId).toBe('shop:c:users.id')
    expect(out[0].constraints[1].columns[0].columnId).toBe('shop:c:users.email')
  })

  it('FK 의 refTable/refColumns(이름)는 그대로 둔다', () => {
    const out = scopeTableIds(tables, 'shop')
    expect(out[0].constraints[1].refTable).toBe('orgs')
    expect(out[0].constraints[1].refColumns).toEqual(['id'])
  })

  it('서로 다른 접두는 전역 유일 id 를 만든다(설계 간 충돌 방지)', () => {
    const a = scopeTableIds(tables, 'shopA')
    const b = scopeTableIds(tables, 'shopB')
    expect(a[0].id).not.toBe(b[0].id)
  })

  it('원본을 변형하지 않는다(순수)', () => {
    scopeTableIds(tables, 'shop')
    expect(tables[0].id).toBe('t:users')
    expect(tables[0].columns[0].id).toBe('c:users.id')
  })
})
