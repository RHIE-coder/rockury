import type { Column, TableDef } from './types'

/**
 * 컬럼을 **여러 테이블에 한 번에 넣는** 순수 계산 (2026-08-20 사용자 요청:
 * "동일 컬럼을 여러 테이블에 추가할 때… 일일이 하나씩 다 입력해야 한다").
 *
 * 어려운 곳은 둘이고, 둘 다 "오류 없이 결과만 틀리는" 종류라 여기 모아 검사로 못 박는다:
 *  1. **id** — 컬럼 id 는 설계 안에서 유일해야 한다. 제약이 컬럼을 이름이 아니라 **id 로**
 *     가리키기 때문(`columns[].columnId`). 같은 id 를 두 테이블에 넣으면 A 의 PK 가 B 의
 *     컬럼을 가리키는 꼴이 된다. → 대상마다 새로 발급한다.
 *  2. **덮어쓰기** — 이미 있는 이름을 덮을 때 **id 는 그대로 둔다.** id 를 갈면 그 컬럼에
 *     걸려 있던 PK·FK·인덱스가 통째로 허공을 가리킨다. 그래서 덮는 것은 값뿐이다.
 */

/** 이미 같은 이름이 있을 때 — 손 안 대거나(skip), 값만 갈아끼우거나(overwrite). */
export type ColumnCollision = 'skip' | 'overwrite'

export interface ColumnCopyInput {
  /** 넣을 컬럼 — 출처 테이블에서 고른 것. */
  columns: readonly Column[]
  /** 넣을 대상 테이블들. */
  targets: readonly TableDef[]
  onCollision: ColumnCollision
  /** 새 컬럼 id 발급기 — 번호 권한은 definition 스토어에 있다. */
  mintId: () => string
}

/** 대상 한 곳의 결과 — 화면이 미리보기로 그대로 그린다. */
export interface ColumnCopyRow {
  tableId: string
  tableName: string
  schema?: string
  /** 새로 들어간 컬럼 이름. */
  added: string[]
  /** 값만 갈아끼운 컬럼 이름. */
  overwritten: string[]
  /** 이미 있어서 손 안 댄 컬럼 이름. */
  skipped: string[]
}

export interface ColumnCopyResult {
  rows: ColumnCopyRow[]
  /** **실제로 바뀐 표만.** 안 바뀐 표까지 돌려주면 저장이 괜히 흔들린다. */
  tables: TableDef[]
}

/**
 * 덮어쓸 때 갈아끼우는 값 — **이름과 id 는 빼고** 나머지.
 * `drift`(운영에서 흡수됐다는 표식)도 안 옮긴다 — 복제본에 붙으면 거짓말이 된다.
 */
const valuesOf = (c: Column): Pick<Column, 'type' | 'nullable' | 'defaultValue' | 'comment'> => ({
  type: c.type,
  nullable: c.nullable,
  defaultValue: c.defaultValue,
  comment: c.comment
})

export function buildColumnCopy(input: ColumnCopyInput): ColumnCopyResult {
  const { columns, targets, onCollision, mintId } = input
  const rows: ColumnCopyRow[] = []
  const tables: TableDef[] = []

  for (const target of targets) {
    const added: string[] = []
    const overwritten: string[] = []
    const skipped: string[] = []
    // 이번 대상에서 자라나는 목록 — 넣을 컬럼 둘이 같은 이름이어도 뒤엣것이 앞엣것과 겹친다.
    let next = [...target.columns]

    for (const col of columns) {
      const at = next.findIndex((c) => c.name === col.name)
      if (at < 0) {
        next.push({ ...col, id: mintId(), drift: undefined })
        added.push(col.name)
        continue
      }
      if (onCollision === 'skip') {
        skipped.push(col.name)
        continue
      }
      // id 유지 — 이 컬럼에 걸린 제약이 id 로 매달려 있다.
      next = next.map((c, i) => (i === at ? { ...c, ...valuesOf(col) } : c))
      overwritten.push(col.name)
    }

    rows.push({ tableId: target.id, tableName: target.name, schema: target.schema, added, overwritten, skipped })
    if (added.length > 0 || overwritten.length > 0) tables.push({ ...target, columns: next })
  }

  return { rows, tables }
}

/** 미리보기 한 줄로 요약 — 화면이 대상마다 옆에 붙인다. 아무것도 안 하면 빈 문자열. */
export function rowSummary(row: ColumnCopyRow): string {
  const parts: string[] = []
  if (row.added.length > 0) parts.push(`+${row.added.join(', ')}`)
  if (row.overwritten.length > 0) parts.push(`덮어씀 ${row.overwritten.join(', ')}`)
  if (row.skipped.length > 0) parts.push(`이미 있음 ${row.skipped.join(', ')}`)
  return parts.join(' · ')
}
