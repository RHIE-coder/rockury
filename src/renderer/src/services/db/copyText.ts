import { isSelfRef } from '@shared/db/tableRef'
import { qualifiedName } from './schemaRef'
import { fkPolicyChips } from './workspaces/definition/fkPolicy'
import { resolveColumns } from './workspaces/definition/derive'
import type { Column, Constraint, TableDef } from './workspaces/definition/types'

/**
 * **클립보드로 나가는 글자를 만드는 유일한 곳** — 우클릭 복사 메뉴가 내미는 항목들.
 *
 * 왜 순수 함수로 뽑았나: 같은 "제약 한 줄"을 Definition·Diagram 상세·제약 목록·대조표가 각각
 * 그린다. 복사 글자를 화면마다 만들면 어느 화면에서 복사했느냐에 따라 결과가 달라지고,
 * 그 어긋남은 붙여넣은 뒤에야 드러난다. 그리는 모양은 화면 사정을 타도 **복사되는 값은 하나**다.
 *
 * 규칙 둘:
 *  - **빈 값은 항목 자체를 안 만든다.** "복사했는데 빈 문자열"은 고장으로 읽힌다.
 *  - 이름은 화면에 보이는 그대로 담는다(스키마가 붙어 보이면 붙여서). 눌러서 나온 글자가
 *    눈에 보이던 글자와 다르면 사람이 다시 확인해야 한다.
 */
export interface CopyItem {
  /** 메뉴에 보일 말 — 무엇을 복사하는지. */
  label: string
  /** 실제로 클립보드에 담기는 글자. */
  value: string
}

/** 빈 값을 걸러 항목을 만든다 — 만드는 쪽이 매번 `if` 를 쓰지 않게. */
const items = (pairs: [string, string | null | undefined][]): CopyItem[] =>
  pairs.flatMap(([label, value]) => (value && value.trim() !== '' ? [{ label, value }] : []))

/** 테이블 — 이름 · 한정 이름 · 컬럼 이름 전부 · 표 전체. */
export function tableCopyItems(table: TableDef): CopyItem[] {
  const qualified = qualifiedName(table)
  return items([
    ['이름', table.name],
    // 한정 이름은 이름과 다를 때만 — 스키마가 없으면 같은 항목이 두 줄로 서게 된다.
    [`스키마.이름`, qualified === table.name ? undefined : qualified],
    ['컬럼 이름 전부', table.columns.map((c) => c.name).join(', ')],
    ['표 전체', tableText(table)]
  ])
}

/** 컬럼 한 줄 — 이름 · `테이블.컬럼` · 타입 · 줄 전체. */
export function columnCopyItems(table: TableDef, col: Column): CopyItem[] {
  return items([
    ['이름', col.name],
    ['테이블.컬럼', `${qualifiedName(table)}.${col.name}`],
    ['타입', col.type],
    ['줄 전체', columnText(col)]
  ])
}

/** 제약 한 줄 — 이름 · 걸린 컬럼 · 참조처 · 줄 전체. */
export function constraintCopyItems(table: TableDef, con: Constraint): CopyItem[] {
  const cols = resolveColumns(table, con).map((c) => c.name)
  return items([
    ['이름', con.name],
    ['컬럼', cols.join(', ')],
    ['참조처', con.kind === 'fk' ? refText(con) : undefined],
    ['조건식', con.kind === 'check' ? con.expression : undefined],
    ['줄 전체', constraintText(table, con)]
  ])
}

/** `users (id)` — 참조 대상 한정 이름 + 대상 컬럼. */
function refText(con: Constraint): string | undefined {
  if (!con.refTable) return undefined
  const target = con.refSchema ? `${con.refSchema}.${con.refTable}` : con.refTable
  const cols = (con.refColumns ?? []).filter(Boolean)
  return cols.length > 0 ? `${target} (${cols.join(', ')})` : target
}

/** 컬럼 한 줄 텍스트 — 화면 열 순서(이름 · 타입 · NULL · 기본값 · 설명) 그대로. */
export function columnText(col: Column): string {
  const parts = [col.name, col.type, col.nullable ? 'NULL' : 'NOT NULL']
  if (col.defaultValue != null && col.defaultValue !== '') parts.push(`DEFAULT ${col.defaultValue}`)
  if (col.comment) parts.push(`-- ${col.comment}`)
  return parts.join(' ')
}

/**
 * 제약 한 줄 텍스트 — 화면이 그리는 것과 **같은 순서, 같은 내용**.
 * FK 는 정책 두 개를 늘 붙인다(화면 규칙과 같다 — 안 쓴 쪽도 보인다), 자기참조면 그 표시까지.
 */
export function constraintText(table: TableDef, con: Constraint): string {
  const cols = resolveColumns(table, con).map((c) => c.name)
  const head = `${con.kind.toUpperCase()} ${con.name}`
  if (con.kind === 'check') return con.expression ? `${head} (${con.expression})` : head
  const body = cols.length > 0 ? `${head} (${cols.join(', ')})` : head
  if (con.kind !== 'fk') return body
  const parts = [body]
  const ref = refText(con)
  if (ref) parts.push(`→ ${ref}`)
  parts.push(...fkPolicyChips(con).map((p) => p.label))
  if (isSelfRef(table, con)) parts.push('자기참조')
  return parts.join(' ')
}

/** 표 전체 — 컬럼 다음 제약. 어딘가에 통째로 붙여넣어 훑을 때 쓴다. */
export function tableText(table: TableDef): string {
  const lines = [qualifiedName(table), ...table.columns.map((c) => `  ${columnText(c)}`)]
  if (table.constraints.length > 0) {
    lines.push('', ...table.constraints.map((con) => `  ${constraintText(table, con)}`))
  }
  return lines.join('\n')
}
