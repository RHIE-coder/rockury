import { create } from 'zustand'
import type { DialectId } from '../../dialects'
import type { Column, Constraint, ConstraintKind, TableDef } from '../../workspaces/definition/types'
import { generateMigration, type MigrationPlan } from '../../migration/ddlDiff'
import { useConsoleStore } from '../store'
import { schemaEditHistory } from './history'
import * as m from './mutations'

/**
 * Console 라이브 스키마 편집 스토어(연결 단위) — Definition·Diagram 이 **공유**한다.
 * baseline(편집 시작 시점의 introspection 스냅샷)과 draft(편집본)를 들고, 둘의 diff 를
 * `generateMigration` 으로 ALTER/CREATE/DROP DDL 로 접어 tx 게이트(`query.tx*`)로 적용한다.
 * 적용 성공 시 재역설계(useConsoleStore.load force)하고 편집을 종료한다.
 *
 * 새 엔티티 id 는 introspection id(`t:`/`c:`/`k:`)와 겹치지 않는 `new:` 접두 시퀀스로 만든다
 * → generateMigration 이 baseline 에 없는 id 를 "추가"로 본다(mutations 주석 참고).
 */
let seq = 1
const nid = (kind: string): string => `new:${kind}:${seq++}`

interface SchemaEditState {
  connId: string | null
  editing: boolean
  applying: boolean
  error: string | null
  baseline: TableDef[]
  draft: TableDef[]
  activeTableId: string

  begin: (connId: string, tables: TableDef[], activeId?: string) => void
  discard: () => void
  setActiveTable: (id: string) => void

  addColumn: () => void
  updateColumn: (colId: string, patch: Partial<Column>) => void
  toggleNullable: (colId: string) => void
  moveColumn: (colId: string, dir: -1 | 1) => void
  reorderColumns: (activeColId: string, overColId: string) => void
  deleteColumn: (colId: string) => void
  togglePk: (colId: string) => void
  toggleUnique: (colId: string) => void
  toggleIndex: (colId: string) => void
  addConstraint: (kind: ConstraintKind) => void
  updateConstraint: (conId: string, patch: Partial<Constraint>) => void
  deleteConstraint: (conId: string) => void
  /** Diagram 드래그로 FK 생성 — src 테이블에 fk 제약을 patch 로 한 번에 만든다. */
  addFk: (srcId: string, patch: Pick<Constraint, 'columns' | 'refTable' | 'refColumns'>) => void
  addTable: (dialect: DialectId) => void
  updateTable: (patch: Partial<Pick<TableDef, 'name' | 'comment'>>) => void
  deleteTable: (id: string) => void

  /** 라이브 DB 에 적용 — tx 게이트로 실행 후 커밋, 실패 시 롤백. 성공 시 재역설계 + 편집 종료. */
  apply: (dialect: DialectId) => Promise<boolean>
  dismissError: () => void
}

/** baseline vs draft 의 반영 계획(순수) — 미리보기·적용 공용. */
export function planOf(baseline: TableDef[], draft: TableDef[], dialect: DialectId): MigrationPlan {
  return generateMigration({ tables: baseline }, { tables: draft }, dialect)
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const useSchemaEditStore = create<SchemaEditState>()((set, get) => {
  // draft 를 변형하는 액션 공통 래퍼 — 편집 중이 아니면 무시.
  const mutate = (fn: (draft: TableDef[], activeId: string) => TableDef[]): void =>
    set((s) => (s.editing ? { draft: fn(s.draft, s.activeTableId) } : {}))

  return {
    connId: null,
    editing: false,
    applying: false,
    error: null,
    baseline: [],
    draft: [],
    activeTableId: '',

    begin: (connId, tables, activeId) =>
      set({
        connId,
        editing: true,
        error: null,
        baseline: tables,
        draft: tables,
        activeTableId: activeId ?? tables[0]?.id ?? ''
      }),
    discard: () => set({ editing: false, baseline: [], draft: [], activeTableId: '', error: null }),
    setActiveTable: (activeTableId) => set({ activeTableId }),

    addColumn: () => mutate((d, a) => m.addColumn(d, a, nid('col'))),
    updateColumn: (colId, patch) => mutate((d, a) => m.updateColumn(d, a, colId, patch)),
    toggleNullable: (colId) => mutate((d, a) => m.toggleNullable(d, a, colId)),
    moveColumn: (colId, dir) => mutate((d, a) => m.moveColumn(d, a, colId, dir)),
    reorderColumns: (ac, over) => mutate((d, a) => m.reorderColumns(d, a, ac, over)),
    deleteColumn: (colId) => mutate((d, a) => m.deleteColumn(d, a, colId)),
    togglePk: (colId) => mutate((d, a) => m.togglePk(d, a, colId, nid('con'))),
    toggleUnique: (colId) => mutate((d, a) => m.toggleUnique(d, a, colId, nid('con'))),
    toggleIndex: (colId) => mutate((d, a) => m.toggleIndex(d, a, colId, nid('con'))),
    addConstraint: (kind) => mutate((d, a) => m.addConstraint(d, a, kind, nid('con'))),
    updateConstraint: (conId, patch) => mutate((d, a) => m.updateConstraint(d, a, conId, patch)),
    deleteConstraint: (conId) => mutate((d, a) => m.deleteConstraint(d, a, conId)),
    addFk: (srcId, patch) =>
      set((s) => {
        if (!s.editing) return {}
        const conId = nid('con')
        const withFk = m.addConstraint(s.draft, srcId, 'fk', conId)
        return { draft: m.updateConstraint(withFk, srcId, conId, patch), activeTableId: srcId }
      }),
    addTable: (dialect) =>
      set((s) => {
        if (!s.editing) return {}
        const r = m.addTable(s.draft, dialect, {
          tableId: nid('tbl'),
          colId: nid('col'),
          conId: nid('con')
        })
        return { draft: r.tables, activeTableId: r.activeTableId }
      }),
    updateTable: (patch) => mutate((d, a) => m.updateTable(d, a, patch)),
    deleteTable: (id) =>
      set((s) => {
        if (!s.editing) return {}
        const r = m.deleteTable(s.draft, id)
        return { draft: r.tables, activeTableId: r.activeTableId }
      }),

    apply: async (dialect) => {
      const { connId, baseline, draft } = get()
      if (!connId) return false
      const plan = planOf(baseline, draft, dialect)
      if (plan.statements.length === 0) {
        set({ editing: false, baseline: [], draft: [], activeTableId: '' })
        return true
      }
      set({ applying: true, error: null })
      let txId: string
      try {
        ;({ txId } = await window.rockury.query.txBegin(connId))
      } catch (e) {
        set({ applying: false, error: errMsg(e) })
        return false
      }
      try {
        // migration Run 과 동일하게 문자열 그대로 실행(다중문 블록은 main 이 처리).
        for (const st of plan.statements) await window.rockury.query.txExec(txId, st.sql)
        await window.rockury.query.txCommit(txId)
      } catch (e) {
        await window.rockury.query.txRollback(txId).catch(() => {})
        set({ applying: false, error: errMsg(e) })
        return false
      }
      // 적용 성공 → 이번 스키마 변경을 History 에 남긴다(한 번의 적용 = runId 로 묶인 그룹 1건).
      // 히스토리 기록 실패는 적용 자체에 영향 주지 않는다 — try/catch 로 격리.
      try {
        const runId = crypto.randomUUID()
        for (const entry of schemaEditHistory(plan, connId, runId)) {
          await window.rockury.query.historyAppend(entry)
        }
      } catch {
        // 무시.
      }
      // 성공 → 재역설계 후 편집 종료.
      await useConsoleStore.getState().load(connId, connId, true).catch(() => {})
      set({ applying: false, editing: false, baseline: [], draft: [], activeTableId: '', error: null })
      return true
    },
    dismissError: () => set({ error: null })
  }
})
