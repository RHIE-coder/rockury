import { describe, expect, it } from 'vitest'
import type { TableDef } from '../../workspaces/definition/types'
import { generateMigration } from '../../migration/ddlDiff'
import { buildFkPatch } from '../../workspaces/diagram/fk'
import * as m from './mutations'

/** introspection 형태의 baseline 테이블(id 는 이름 기반 c:/t:/k:). */
const users = (): TableDef => ({
  id: 't:users',
  designId: 'conn',
  name: 'users',
  comment: '',
  columns: [
    { id: 'c:users.id', name: 'id', type: 'BIGINT', nullable: false, defaultValue: null, comment: '' },
    { id: 'c:users.email', name: 'email', type: 'VARCHAR(255)', nullable: true, defaultValue: null, comment: '' }
  ],
  constraints: [{ id: 'k:users.pk', kind: 'pk', name: 'pk_users', columns: [{ columnId: 'c:users.id' }] }]
})

describe('mutations — 컬럼', () => {
  it('addColumn 은 new: 접두 id 로 컬럼을 붙인다', () => {
    const out = m.addColumn([users()], 't:users', 'new:col:1')
    const cols = out[0].columns
    expect(cols).toHaveLength(3)
    expect(cols[2].id).toBe('new:col:1')
    expect(cols[2].nullable).toBe(true)
  })

  it('updateColumn 은 patch 를 병합', () => {
    const out = m.updateColumn([users()], 't:users', 'c:users.email', { nullable: false, type: 'TEXT' })
    const email = out[0].columns.find((c) => c.id === 'c:users.email')!
    expect(email.nullable).toBe(false)
    expect(email.type).toBe('TEXT')
  })

  it('deleteColumn 은 컬럼 + 참조 제약을 정리(빈 제약 제거)', () => {
    const out = m.deleteColumn([users()], 't:users', 'c:users.id')
    expect(out[0].columns.map((c) => c.id)).toEqual(['c:users.email'])
    // pk 는 id 만 참조 → 비어서 제거
    expect(out[0].constraints).toHaveLength(0)
  })

  it('moveColumn 경계 밖은 무시', () => {
    expect(m.moveColumn([users()], 't:users', 'c:users.id', -1)[0].columns[0].id).toBe('c:users.id')
  })

  it('reorderColumns 는 위치 교체', () => {
    const out = m.reorderColumns([users()], 't:users', 'c:users.email', 'c:users.id')
    expect(out[0].columns.map((c) => c.id)).toEqual(['c:users.email', 'c:users.id'])
  })
})

describe('mutations — 키 토글/제약', () => {
  it('toggleUnique 추가 후 재토글로 제거', () => {
    const added = m.toggleUnique([users()], 't:users', 'c:users.email', 'new:con:1')
    expect(added[0].constraints.some((k) => k.kind === 'uk')).toBe(true)
    const removed = m.toggleUnique(added, 't:users', 'c:users.email', 'new:con:2')
    expect(removed[0].constraints.some((k) => k.kind === 'uk')).toBe(false)
  })

  it('addConstraint pk 는 이미 있으면 중복 생성 안 함', () => {
    const out = m.addConstraint([users()], 't:users', 'pk', 'new:con:1')
    expect(out[0].constraints.filter((k) => k.kind === 'pk')).toHaveLength(1)
  })

  it('addConstraint fk 는 refTable/actions 기본값을 채운다', () => {
    const out = m.addConstraint([users()], 't:users', 'fk', 'new:con:9')
    const fk = out[0].constraints.find((k) => k.id === 'new:con:9')!
    expect(fk.kind).toBe('fk')
    expect(fk.onDelete).toBe('RESTRICT')
  })

  it('deleteConstraint 제거', () => {
    const out = m.deleteConstraint([users()], 't:users', 'k:users.pk')
    expect(out[0].constraints).toHaveLength(0)
  })
})

describe('mutations — 테이블', () => {
  it('addTable 은 방언 PK 템플릿 + 새 활성 id', () => {
    const { tables, activeTableId } = m.addTable([users()], 'postgresql', {
      tableId: 'new:tbl:1',
      colId: 'new:col:1',
      conId: 'new:con:1'
    })
    expect(tables).toHaveLength(2)
    expect(activeTableId).toBe('new:tbl:1')
    expect(tables[1].columns[0].type).toBe('BIGINT')
  })

  it('updateTable 이름/코멘트', () => {
    const out = m.updateTable([users()], 't:users', { name: 'members', comment: '회원' })
    expect(out[0].name).toBe('members')
    expect(out[0].comment).toBe('회원')
  })

  it('deleteTable 은 남은 첫 테이블로 폴백', () => {
    const two = [users(), { ...users(), id: 't:roles', name: 'roles' }]
    const { tables, activeTableId } = m.deleteTable(two, 't:users')
    expect(tables.map((t) => t.id)).toEqual(['t:roles'])
    expect(activeTableId).toBe('t:roles')
  })
})

// ── 파이프라인 통합: 편집 → generateMigration 이 올바른 DDL 을 낸다(핵심 계약) ──
describe('편집 → generateMigration DDL (통합)', () => {
  const plan = (base: TableDef[], draft: TableDef[]) =>
    generateMigration({ tables: base }, { tables: draft }, 'mysql')

  it('컬럼 추가 → ADD COLUMN (new: id 라 "추가"로 잡힘)', () => {
    const base = [users()]
    let draft = m.addColumn(base, 't:users', 'new:col:1')
    draft = m.updateColumn(draft, 't:users', 'new:col:1', { name: 'phone', type: 'VARCHAR(20)' })
    const p = plan(base, draft)
    expect(p.statements.some((s) => /ALTER TABLE `users` ADD COLUMN `phone`/.test(s.sql))).toBe(true)
    expect(p.destructiveCount).toBe(0)
  })

  it('컬럼 삭제 → DROP COLUMN (파괴적)', () => {
    const base = [users()]
    const draft = m.deleteColumn(base, 't:users', 'c:users.email')
    const p = plan(base, draft)
    expect(p.statements.some((s) => /DROP COLUMN `email`/.test(s.sql) && s.destructive)).toBe(true)
    expect(p.destructiveCount).toBe(1)
  })

  it('기존 컬럼 수정 → MODIFY (id 보존이라 "변경")', () => {
    const base = [users()]
    const draft = m.updateColumn(base, 't:users', 'c:users.email', { nullable: false })
    const p = plan(base, draft)
    expect(p.statements.some((s) => /MODIFY COLUMN `email`/.test(s.sql))).toBe(true)
  })

  it('테이블 이름 변경 → RENAME', () => {
    const base = [users()]
    const draft = m.updateTable(base, 't:users', { name: 'members' })
    const p = plan(base, draft)
    expect(p.statements.some((s) => /RENAME TO `members`/.test(s.sql))).toBe(true)
  })

  it('편집 없음 → 빈 계획', () => {
    const base = [users()]
    expect(plan(base, [users()]).statements).toHaveLength(0)
  })

  it('Diagram 드래그 FK(buildFkPatch + addConstraint/updateConstraint) → ADD FOREIGN KEY REFERENCES', () => {
    const roles: TableDef = {
      id: 't:roles',
      designId: 'conn',
      name: 'roles',
      comment: '',
      columns: [{ id: 'c:roles.id', name: 'id', type: 'BIGINT', nullable: false, defaultValue: null, comment: '' }],
      constraints: [{ id: 'k:roles.pk', kind: 'pk', name: 'pk_roles', columns: [{ columnId: 'c:roles.id' }] }]
    }
    const base = [users(), roles]
    // users 에 role_id 컬럼 추가 후, 그 컬럼 핸들을 roles 로 끌어 FK 생성
    let draft = m.addColumn(base, 't:users', 'new:col:1')
    draft = m.updateColumn(draft, 't:users', 'new:col:1', { name: 'role_id', type: 'BIGINT' })
    draft = m.addConstraint(draft, 't:users', 'fk', 'new:con:1')
    const src = draft.find((t) => t.id === 't:users')!
    const patch = buildFkPatch(src, 'new:col:1', roles)!
    draft = m.updateConstraint(draft, 't:users', 'new:con:1', patch)
    const p = plan(base, draft)
    expect(p.statements.some((s) => /FOREIGN KEY \(`role_id`\) REFERENCES `roles` \(`id`\)/.test(s.sql))).toBe(true)
  })
})
