import { z } from 'zod'
import type { TableRecord } from '../store/tables'

/**
 * 스키마 부분 수정 엔진 — 연산 목록을 현재 스키마에 차례로 적용하는 **순수 함수**.
 *
 * 왜 필요한가: 저장이 문서형이라 반영 경로(`tables:replaceForDesign`)는 설계 단위 통째
 * 교체다. 그래서 도구도 `set_schema` 하나뿐이었고, 주석 한 줄을 고치려도 에이전트가
 * 스키마 전체를 다시 만들어 보내야 했다(수십~수백 KB 왕복 + 그 과정에서 새 오타를 심을 위험).
 * → 조준은 여기서 하고(이름 기준 연산), 저장은 기존 교체 경로 그대로 쓴다. 저장 계층은 안 건드린다.
 *
 * 원자성: 연산 하나라도 실패하면 throw — 호출자는 저장을 시작조차 하지 않는다(부분 반영 없음).
 * 조준 기준은 **이름**이다(id 아님) — 에이전트가 아는 건 이름이고, id 는 앱 내부 값이라
 * 왕복해 읽어와야만 알 수 있기 때문.
 */

// ── 레코드 작업형 ────────────────────────────────────────────────────────────
// TableRecord.columns/constraints 는 저장 경계에서 unknown[] 이다(문서형 블롭).
// 이 모듈 안에서만 구조를 확정해 다룬다.

export interface ColumnRecord {
  id: string
  name: string
  type: string
  nullable: boolean
  defaultValue: string | null
  comment: string
  [k: string]: unknown
}

export interface ConstraintRecord {
  id: string
  kind: 'pk' | 'uk' | 'fk' | 'check' | 'idx'
  name: string
  columns: Array<{ columnId: string; direction?: 'ASC' | 'DESC' }>
  refTable?: string
  refColumns?: string[]
  onDelete?: string
  onUpdate?: string
  expression?: string
  [k: string]: unknown
}

const colsOf = (t: TableRecord): ColumnRecord[] => t.columns as ColumnRecord[]
const kaysOf = (t: TableRecord): ConstraintRecord[] => t.constraints as ConstraintRecord[]

// ── 연산 어휘 ────────────────────────────────────────────────────────────────
// 제약의 컬럼 참조는 **컬럼 이름**으로 받는다 — 내부 columnId 변환은 이 모듈이 한다.

const FK_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'NO ACTION'] as const

const columnInput = z.looseObject({
  id: z.string().optional(),
  name: z.string().min(1, '컬럼 name 은 비울 수 없습니다'),
  type: z.string().min(1, '컬럼 type 은 비울 수 없습니다'),
  nullable: z.boolean().optional(),
  defaultValue: z.string().nullable().optional(),
  comment: z.string().optional()
})

const constraintInput = z.looseObject({
  kind: z.enum(['pk', 'uk', 'fk', 'check', 'idx']),
  name: z.string().optional(),
  columns: z.array(z.string()).optional().describe('대상 컬럼 이름 배열(id 아님)'),
  refTable: z.string().optional(),
  refColumns: z.array(z.string()).optional(),
  onDelete: z.enum(FK_ACTIONS).optional(),
  onUpdate: z.enum(FK_ACTIONS).optional(),
  expression: z.string().optional()
})

export const patchOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_table'),
    table: z.string().min(1),
    comment: z.string().optional(),
    columns: z.array(columnInput).min(1, '새 테이블에는 컬럼이 최소 1개 필요합니다'),
    constraints: z.array(constraintInput).optional()
  }),
  z.object({ op: z.literal('drop_table'), table: z.string().min(1) }),
  z.object({ op: z.literal('rename_table'), table: z.string().min(1), newName: z.string().min(1) }),
  z.object({ op: z.literal('set_table_comment'), table: z.string().min(1), comment: z.string() }),
  z.object({
    op: z.literal('add_column'),
    table: z.string().min(1),
    column: columnInput,
    after: z.string().optional().describe('이 컬럼 뒤에 넣는다(생략 시 맨 뒤)')
  }),
  z.object({
    op: z.literal('update_column'),
    table: z.string().min(1),
    column: z.string().min(1),
    set: z
      .object({
        name: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        nullable: z.boolean().optional(),
        defaultValue: z.string().nullable().optional(),
        comment: z.string().optional()
      })
      .refine((s) => Object.keys(s).length > 0, 'set 에 바꿀 필드를 최소 1개 넣으세요')
  }),
  z.object({ op: z.literal('drop_column'), table: z.string().min(1), column: z.string().min(1) }),
  z.object({ op: z.literal('add_constraint'), table: z.string().min(1), constraint: constraintInput }),
  z.object({ op: z.literal('drop_constraint'), table: z.string().min(1), name: z.string().min(1) })
])

export type PatchOp = z.infer<typeof patchOpSchema>

export interface PatchResult {
  tables: TableRecord[]
  /** 무엇이 바뀌었는지 사람이 읽는 한 줄씩 — 도구 응답에 그대로 실린다. */
  changes: string[]
  /** 막을 정도는 아니지만 알려야 하는 것(예: CHECK 식 안의 옛 컬럼 이름). */
  warnings: string[]
}

// ── 조회 도우미 ──────────────────────────────────────────────────────────────

function findTable(tables: TableRecord[], name: string): TableRecord {
  const t = tables.find((x) => x.name === name)
  if (!t)
    throw new Error(
      `테이블 "${name}" 이 없습니다 — 이 설계의 테이블: ${tables.map((x) => x.name).join(', ') || '(없음)'}`
    )
  return t
}

function findColumn(table: TableRecord, name: string): ColumnRecord {
  const c = colsOf(table).find((x) => x.name === name)
  if (!c)
    throw new Error(
      `테이블 "${table.name}" 에 컬럼 "${name}" 이 없습니다 — 이 테이블의 컬럼: ${colsOf(table)
        .map((x) => x.name)
        .join(', ')}`
    )
  return c
}

/** 제약 입력(컬럼 이름) → 저장 형태(columnId). 없는 컬럼을 가리키면 즉시 거부. */
function toConstraintRecord(
  table: TableRecord,
  input: z.infer<typeof constraintInput>,
  newId: () => string
): ConstraintRecord {
  const columns = (input.columns ?? []).map((colName) => ({ columnId: findColumn(table, colName).id }))
  const { columns: _drop, ...rest } = input
  return { ...rest, id: newId(), name: input.name ?? '', columns } as ConstraintRecord
}

/** 다른 테이블에서 이 테이블을 가리키는 FK 들 — 삭제·개명 시 함께 손봐야 하는 대상. */
const referencingFks = (tables: TableRecord[], tableName: string) =>
  tables.flatMap((t) =>
    kaysOf(t)
      .filter((k) => k.kind === 'fk' && k.refTable === tableName)
      .map((k) => ({ table: t, constraint: k }))
  )

// ── 정합 검증 (set_schema · patch_schema 공용) ───────────────────────────────

const GUIDE =
  'get_schema 결과 형태를 참고하세요 — 제약이 참조할 새 컬럼은 columns[].id 를 직접 정해 columnId 로 가리키면 됩니다.'

/**
 * 저장 직전 마지막 관문 — 화면 편집기가 능동적으로 지키는 불변식을 저장 경로에서도 강제한다.
 * 이름 유일성(설계 안 테이블·테이블 안 컬럼), id 유일성, 제약의 컬럼 참조 실재성.
 */
export function assertTablesConsistent(tables: TableRecord[]): void {
  const tableNames = new Set<string>()
  const ids = new Set<string>()
  const claim = (id: string, what: string): void => {
    if (ids.has(id)) throw new Error(`중복 id "${id}"(${what}) — 각 테이블·컬럼 id 는 유일해야 합니다. ${GUIDE}`)
    ids.add(id)
  }

  for (const t of tables) {
    if (tableNames.has(t.name))
      throw new Error(`중복 테이블 이름 "${t.name}" — 한 설계 안에서 테이블 이름은 유일해야 합니다.`)
    tableNames.add(t.name)

    const colNames = new Set<string>()
    for (const c of colsOf(t)) {
      if (colNames.has(c.name))
        throw new Error(`테이블 "${t.name}" 에 중복 컬럼 이름 "${c.name}" — 컬럼 이름은 테이블 안에서 유일해야 합니다.`)
      colNames.add(c.name)
      claim(c.id, `테이블 ${t.name}.${c.name}`)
    }

    const validColIds = new Set(colsOf(t).map((c) => c.id))
    for (const k of kaysOf(t)) {
      for (const ref of k.columns ?? []) {
        if (!validColIds.has(ref.columnId))
          throw new Error(
            `테이블 "${t.name}" 의 ${k.kind.toUpperCase()} 제약이 없는 컬럼 "${ref.columnId}" 를 참조합니다. ${GUIDE}`
          )
      }
      claim(k.id, `테이블 ${t.name} 제약`)
    }
    claim(t.id, '테이블')
  }
}

// ── 적용 ─────────────────────────────────────────────────────────────────────

/**
 * 연산을 순서대로 적용해 새 테이블 배열을 만든다. 입력 배열·레코드는 건드리지 않는다(복제 후 수정).
 * 실패는 throw — 호출자가 저장을 시작하기 전에 터진다.
 */
export function applyOperations(
  designId: string,
  current: TableRecord[],
  ops: PatchOp[],
  newId: () => string
): PatchResult {
  // 깊은 복제 — 원본(리하이드레이션 전 메모리 사본)을 부분 수정한 채로 남기지 않는다.
  let tables: TableRecord[] = current.map((t) => ({
    ...t,
    columns: colsOf(t).map((c) => ({ ...c })),
    constraints: kaysOf(t).map((k) => ({ ...k, columns: (k.columns ?? []).map((r) => ({ ...r })) }))
  }))
  const changes: string[] = []
  const warnings: string[] = []

  ops.forEach((op, i) => {
    const at = `연산 #${i + 1}(${op.op})`
    try {
      switch (op.op) {
        case 'add_table': {
          if (tables.some((t) => t.name === op.table))
            throw new Error(`테이블 "${op.table}" 이 이미 있습니다 — 고치려면 add_column/update_column 을 쓰세요.`)
          const columns: ColumnRecord[] = op.columns.map((c) => ({
            ...c,
            id: c.id ?? newId(),
            nullable: c.nullable ?? true,
            defaultValue: c.defaultValue ?? null,
            comment: c.comment ?? ''
          }))
          const table: TableRecord = {
            id: newId(),
            designId,
            name: op.table,
            comment: op.comment ?? '',
            columns,
            constraints: []
          }
          table.constraints = (op.constraints ?? []).map((k) => toConstraintRecord(table, k, newId))
          tables.push(table)
          changes.push(`테이블 "${op.table}" 추가 (컬럼 ${columns.length}개, 제약 ${table.constraints.length}개)`)
          break
        }

        case 'drop_table': {
          const t = findTable(tables, op.table)
          const refs = referencingFks(tables, op.table).filter((r) => r.table.name !== op.table)
          if (refs.length > 0)
            throw new Error(
              `테이블 "${op.table}" 을 가리키는 FK 가 남아 있습니다: ${refs
                .map((r) => `${r.table.name}.${r.constraint.name || r.constraint.id}`)
                .join(', ')} — drop_constraint 로 먼저 떼어내세요.`
            )
          tables = tables.filter((x) => x !== t)
          changes.push(`테이블 "${op.table}" 삭제`)
          break
        }

        case 'rename_table': {
          const t = findTable(tables, op.table)
          if (tables.some((x) => x.name === op.newName))
            throw new Error(`테이블 이름 "${op.newName}" 은 이미 쓰이고 있습니다.`)
          t.name = op.newName
          // 가리키던 FK 도 같이 옮긴다 — 안 그러면 조용히 끊긴 참조가 남는다.
          let moved = 0
          for (const { constraint } of referencingFks(tables, op.table)) {
            constraint.refTable = op.newName
            moved++
          }
          changes.push(
            `테이블 "${op.table}" → "${op.newName}" 개명${moved > 0 ? ` (가리키던 FK ${moved}개 갱신)` : ''}`
          )
          break
        }

        case 'set_table_comment': {
          const t = findTable(tables, op.table)
          t.comment = op.comment
          changes.push(`테이블 "${op.table}" 주석 변경`)
          break
        }

        case 'add_column': {
          const t = findTable(tables, op.table)
          if (colsOf(t).some((c) => c.name === op.column.name))
            throw new Error(`테이블 "${op.table}" 에 컬럼 "${op.column.name}" 이 이미 있습니다.`)
          const col: ColumnRecord = {
            ...op.column,
            id: op.column.id ?? newId(),
            nullable: op.column.nullable ?? true,
            defaultValue: op.column.defaultValue ?? null,
            comment: op.column.comment ?? ''
          }
          const list = colsOf(t)
          const pos = op.after ? list.findIndex((c) => c.name === op.after) : -1
          if (op.after && pos < 0) findColumn(t, op.after) // 안내 메시지 재사용
          list.splice(pos < 0 ? list.length : pos + 1, 0, col)
          changes.push(`테이블 "${op.table}" 에 컬럼 "${col.name}" 추가`)
          break
        }

        case 'update_column': {
          const t = findTable(tables, op.table)
          const c = findColumn(t, op.column)
          const oldName = c.name
          if (op.set.name && op.set.name !== oldName && colsOf(t).some((x) => x.name === op.set.name))
            throw new Error(`테이블 "${op.table}" 에 컬럼 이름 "${op.set.name}" 이 이미 있습니다.`)
          Object.assign(c, op.set)
          const fields = Object.keys(op.set).join(', ')
          changes.push(`테이블 "${op.table}" 컬럼 "${oldName}" 수정: ${fields}`)

          if (op.set.name && op.set.name !== oldName) {
            // 남이 이름으로 가리키는 자리(FK refColumns)는 따라 바꾸고, 손댈 수 없는 자리
            // (CHECK 의 SQL 식)는 경고로 알린다 — 조용히 깨진 채 두지 않는다.
            for (const { table, constraint } of referencingFks(tables, op.table)) {
              if (!(constraint.refColumns ?? []).includes(oldName)) continue
              constraint.refColumns = constraint.refColumns!.map((n) => (n === oldName ? op.set.name! : n))
              changes.push(`  ↳ "${table.name}" FK 의 참조 컬럼 이름도 갱신`)
            }
            for (const other of tables) {
              for (const k of kaysOf(other)) {
                if (k.kind === 'check' && k.expression?.includes(oldName))
                  warnings.push(
                    `"${other.name}" 의 CHECK 식에 옛 컬럼 이름 "${oldName}" 이 남아 있습니다: ${k.expression} — 식은 자동으로 못 바꿉니다.`
                  )
              }
            }
          }
          break
        }

        case 'drop_column': {
          const t = findTable(tables, op.table)
          const c = findColumn(t, op.column)
          const used = kaysOf(t).filter((k) => (k.columns ?? []).some((r) => r.columnId === c.id))
          if (used.length > 0)
            throw new Error(
              `컬럼 "${op.table}.${op.column}" 을 쓰는 제약이 있습니다: ${used
                .map((k) => `${k.kind.toUpperCase()} ${k.name || k.id}`)
                .join(', ')} — drop_constraint 로 먼저 떼어내세요.`
            )
          const inbound = referencingFks(tables, op.table).filter((r) => (r.constraint.refColumns ?? []).includes(op.column))
          if (inbound.length > 0)
            throw new Error(
              `컬럼 "${op.table}.${op.column}" 을 가리키는 FK 가 있습니다: ${inbound
                .map((r) => `${r.table.name}.${r.constraint.name || r.constraint.id}`)
                .join(', ')} — 먼저 떼어내세요.`
            )
          t.columns = colsOf(t).filter((x) => x !== c)
          changes.push(`테이블 "${op.table}" 컬럼 "${op.column}" 삭제`)
          break
        }

        case 'add_constraint': {
          const t = findTable(tables, op.table)
          const name = op.constraint.name ?? ''
          if (name && kaysOf(t).some((k) => k.name === name))
            throw new Error(`테이블 "${op.table}" 에 제약 이름 "${name}" 이 이미 있습니다.`)
          const rec = toConstraintRecord(t, op.constraint, newId)
          ;(t.constraints as ConstraintRecord[]).push(rec)
          changes.push(`테이블 "${op.table}" 에 ${rec.kind.toUpperCase()} 제약 "${name || rec.id}" 추가`)
          break
        }

        case 'drop_constraint': {
          const t = findTable(tables, op.table)
          const k = kaysOf(t).find((x) => x.name === op.name || x.id === op.name)
          if (!k)
            throw new Error(
              `테이블 "${op.table}" 에 제약 "${op.name}" 이 없습니다 — 이 테이블의 제약: ${kaysOf(t)
                .map((x) => x.name || x.id)
                .join(', ') || '(없음)'}`
            )
          t.constraints = kaysOf(t).filter((x) => x !== k)
          changes.push(`테이블 "${op.table}" 의 제약 "${op.name}" 삭제`)
          break
        }
      }
    } catch (e) {
      // 몇 번째 연산에서 멈췄는지 알려야 에이전트가 목록을 고칠 수 있다.
      throw new Error(`${at} 실패: ${e instanceof Error ? e.message : String(e)} (반영 0 — 앞선 연산도 저장되지 않았습니다)`)
    }
  })

  return { tables, changes, warnings }
}
