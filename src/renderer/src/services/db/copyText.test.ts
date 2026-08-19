import { describe, it, expect } from 'vitest'
import { columnCopyItems, constraintCopyItems, constraintText, tableCopyItems, tableText } from './copyText'
import type { Column, Constraint, TableDef } from './workspaces/definition/types'

const col = (id: string, name: string, over: Partial<Column> = {}): Column => ({
  id,
  name,
  type: 'char(36)',
  nullable: false,
  defaultValue: null,
  comment: '',
  ...over
})

const comments: TableDef = {
  id: 't1',
  designId: 'd1',
  schema: 'testdb',
  name: 'comments',
  comment: '',
  columns: [
    col('c1', 'id'),
    col('c2', 'parent_comment_id', { nullable: true }),
    col('c3', 'body', { type: 'text', comment: '본문' })
  ],
  constraints: []
}

const selfFk: Constraint = {
  id: 'k1',
  kind: 'fk',
  name: 'fk_comments_parent',
  columns: [{ columnId: 'c2' }],
  refTable: 'comments',
  refColumns: ['id'],
  onDelete: 'SET NULL'
}

const outFk: Constraint = {
  id: 'k2',
  kind: 'fk',
  name: 'fk_comments_post',
  columns: [{ columnId: 'c1' }],
  refTable: 'posts',
  refColumns: ['id'],
  onDelete: 'CASCADE'
}

const labels = (list: { label: string }[]): string[] => list.map((i) => i.label)
const valueOf = (list: { label: string; value: string }[], label: string): string | undefined =>
  list.find((i) => i.label === label)?.value

describe('constraintText', () => {
  it('FK 는 참조처와 정책 둘을 늘 담는다 — 화면이 둘 다 보이므로 복사도 둘 다', () => {
    expect(constraintText({ ...comments, constraints: [outFk] }, outFk)).toBe(
      'FK fk_comments_post (id) → posts (id) ON DELETE CASCADE ON UPDATE NO ACTION'
    )
  })

  it('자기참조면 그 표시까지 붙는다 — 화면 칩과 같은 사실', () => {
    expect(constraintText({ ...comments, constraints: [selfFk] }, selfFk)).toBe(
      'FK fk_comments_parent (parent_comment_id) → comments (id) ON DELETE SET NULL ON UPDATE NO ACTION 자기참조'
    )
  })

  it('스키마가 다르면 같은 이름이어도 자기참조로 안 적는다', () => {
    const other: Constraint = { ...selfFk, refSchema: 'other' }
    expect(constraintText({ ...comments, constraints: [other] }, other)).not.toContain('자기참조')
  })

  it('CHECK 은 조건식이 본체다', () => {
    const chk: Constraint = { id: 'k3', kind: 'check', name: 'ck_body', columns: [], expression: 'length(body) > 0' }
    expect(constraintText(comments, chk)).toBe('CHECK ck_body (length(body) > 0)')
  })

  it('컬럼이 안 걸린 제약도 이름까지는 복사된다', () => {
    const idx: Constraint = { id: 'k4', kind: 'idx', name: 'idx_none', columns: [] }
    expect(constraintText(comments, idx)).toBe('IDX idx_none')
  })
})

describe('constraintCopyItems', () => {
  it('FK 는 이름·컬럼·참조처·줄 전체를 내민다', () => {
    expect(labels(constraintCopyItems(comments, selfFk))).toEqual(['이름', '컬럼', '참조처', '줄 전체'])
  })

  it('참조 스키마가 있으면 참조처에 붙여 담는다 — 화면에 보이는 그대로', () => {
    const cross: Constraint = { ...outFk, refSchema: 'shop' }
    expect(valueOf(constraintCopyItems(comments, cross), '참조처')).toBe('shop.posts (id)')
  })

  it('FK 가 아니면 참조처 항목 자체가 없다 — 빈 값을 복사시키지 않는다', () => {
    const pk: Constraint = { id: 'k5', kind: 'pk', name: 'PRIMARY', columns: [{ columnId: 'c1' }] }
    expect(labels(constraintCopyItems(comments, pk))).toEqual(['이름', '컬럼', '줄 전체'])
  })
})

describe('columnCopyItems', () => {
  it('테이블.컬럼은 스키마까지 한정한다 — 쿼리에 그대로 붙는 값이라', () => {
    expect(valueOf(columnCopyItems(comments, comments.columns[1]), '테이블.컬럼')).toBe(
      'testdb.comments.parent_comment_id'
    )
  })

  it('줄 전체는 NULL 여부와 설명까지 담는다', () => {
    expect(valueOf(columnCopyItems(comments, comments.columns[2]), '줄 전체')).toBe('body text NOT NULL -- 본문')
  })

  it('기본값이 없으면 DEFAULT 를 지어내지 않는다', () => {
    expect(valueOf(columnCopyItems(comments, comments.columns[0]), '줄 전체')).toBe('id char(36) NOT NULL')
  })
})

describe('tableCopyItems', () => {
  it('스키마가 있으면 한정 이름을 따로 내민다', () => {
    expect(labels(tableCopyItems(comments))).toEqual(['이름', '스키마.이름', '컬럼 이름 전부', '표 전체'])
  })

  it('스키마가 없으면 같은 글자가 두 줄로 서지 않는다', () => {
    expect(labels(tableCopyItems({ ...comments, schema: undefined }))).toEqual([
      '이름',
      '컬럼 이름 전부',
      '표 전체'
    ])
  })
})

describe('tableText', () => {
  it('컬럼 다음 제약 — 통째로 붙여넣어 훑는 용도', () => {
    expect(tableText({ ...comments, constraints: [selfFk] }).split('\n')).toEqual([
      'testdb.comments',
      '  id char(36) NOT NULL',
      '  parent_comment_id char(36) NULL',
      '  body text NOT NULL -- 본문',
      '',
      '  FK fk_comments_parent (parent_comment_id) → comments (id) ON DELETE SET NULL ON UPDATE NO ACTION 자기참조'
    ])
  })

  it('제약이 없으면 빈 줄을 남기지 않는다', () => {
    expect(tableText(comments).split('\n')).toHaveLength(4)
  })
})
