import { create } from 'zustand'
import { useActiveDesign, useDesignsStore } from '../../designs/store'
import { autoIncrementToken } from '../../typeCatalog'
import { isReadOnlyLens, useVersionLens, useVersionsStore } from '../../versions/store'
import { changedDesignIds, mergeDesignTables, reconcileActiveTable, toTableDef } from './designScope'
import type { Column, Constraint, ConstraintKind, TableDef } from './types'
// 순환 참조 주의: definition → {designs, versions} 방향만 존재(역방향 import 없음).

type Form = 'table' | 'sql'
let seq = 1

interface DefinitionState {
  form: Form
  /** 저장소(SQLite) 하이드레이션 완료 여부. write-through 는 이 이후에만 발동. */
  loaded: boolean
  activeTableId: string
  /** 전체 테이블(설계 무관) — 화면은 활성 Design 으로 스코프해 읽는다(useDesignTables). */
  tables: TableDef[]
  /** 현재 편집 중인 텍스트 셀 키 (예: "col:o1:name", "table:name"). */
  editing: string | null
  /** 인라인 에디터가 펼쳐진 제약 id. */
  openConstraintId: string | null
  /** FK 바로가기로 점프한 경우, 되돌아갈 이전 테이블 (오버레이 표시용). */
  returnTo: { tableId: string; tableName: string } | null

  setForm: (form: Form) => void
  /** 저장소에서 테이블 전체를 불러와 채운다(앱 시작 시 1회). */
  init: () => Promise<void>
  setActiveTable: (id: string) => void
  setEditing: (key: string | null) => void
  setOpenConstraint: (id: string | null) => void
  /** FK 바로가기 — 이동하면서 returnTo 를 남긴다. */
  jumpToTable: (id: string) => void
  returnBack: () => void
  clearReturnTo: () => void

  // ── Column CRUD ──
  addColumn: () => void
  updateColumn: (colId: string, patch: Partial<Column>) => void
  toggleNullable: (colId: string) => void
  moveColumn: (colId: string, dir: -1 | 1) => void
  reorderColumns: (activeColId: string, overColId: string) => void
  deleteColumn: (colId: string) => void

  // ── 퀵 키 토글 (제약을 통해 동작) ──
  togglePk: (colId: string) => void
  toggleUnique: (colId: string) => void
  toggleIndex: (colId: string) => void

  // ── Constraint CRUD ──
  addConstraint: (kind: ConstraintKind) => void
  updateConstraint: (id: string, patch: Partial<Constraint>) => void
  deleteConstraint: (id: string) => void

  // ── Table CRUD ──
  addTable: (designId: string) => void
  /** 뷰 신설 — 본문 SELECT 는 비운 채 만들고 사람이 채운다(컬럼도 사람이 적는다). */
  addView: (designId: string) => void
  updateTable: (patch: Partial<Pick<TableDef, 'name' | 'comment' | 'viewSql'>>) => void
  /** 활성 대상의 테이블 ↔ 뷰 전환. 뷰로 바꾸면 제약은 뜻이 없어 비운다. */
  toggleView: () => void
  deleteTable: (id: string) => void
}

function patchActive(
  s: Pick<DefinitionState, 'tables' | 'activeTableId'>,
  map: (t: TableDef) => TableDef
): Pick<DefinitionState, 'tables'> {
  return { tables: s.tables.map((t) => (t.id === s.activeTableId ? map(t) : t)) }
}

/** 컬럼 keys 성격 제약(pk/uk/idx/fk)이 비면 제거. check 는 컬럼 무관이라 유지. */
function pruneEmpty(cons: Constraint[]): Constraint[] {
  return cons.filter((k) => k.kind === 'check' || k.columns.length > 0)
}

export const useDefinitionStore = create<DefinitionState>()((set) => ({
  form: 'table',
  loaded: false,
  activeTableId: '',
  tables: [],
  editing: null,
  openConstraintId: null,
  returnTo: null,

  setForm: (form) => set({ form }),
  init: async () => {
    const recs = await window.rockury.tables.list()
    const tables = recs.map(toTableDef)
    // 앱 생성 id(-N 접미) 재사용 충돌 방지 — 로드된 최대 번호 위로 seq 를 올린다.
    let max = 0
    const scan = (id: string): void => {
      const m = /-(\d+)$/.exec(id)
      if (m) max = Math.max(max, Number(m[1]))
    }
    for (const t of tables) {
      scan(t.id)
      t.columns.forEach((c) => scan(c.id))
      t.constraints.forEach((k) => scan(k.id))
    }
    seq = max + 1
    set({ tables, loaded: true })
  },
  // 수동 이동(사이드바)은 returnTo 를 지운다 — 오버레이는 바로가기 점프에만.
  setActiveTable: (activeTableId) =>
    set({ activeTableId, editing: null, openConstraintId: null, returnTo: null }),
  setEditing: (editing) => set({ editing }),
  setOpenConstraint: (openConstraintId) => set({ openConstraintId }),

  jumpToTable: (id) =>
    set((s) => {
      if (id === s.activeTableId) return {}
      const cur = s.tables.find((t) => t.id === s.activeTableId)
      return {
        activeTableId: id,
        editing: null,
        openConstraintId: null,
        returnTo: cur ? { tableId: cur.id, tableName: cur.name } : null
      }
    }),
  returnBack: () =>
    set((s) => {
      const target = s.returnTo && s.tables.find((t) => t.id === s.returnTo!.tableId)
      return target
        ? { activeTableId: target.id, returnTo: null, editing: null, openConstraintId: null }
        : { returnTo: null }
    }),
  clearReturnTo: () => set({ returnTo: null }),

  // ── Column ──
  addColumn: () =>
    set((s) =>
      patchActive(s, (t) => ({
        ...t,
        columns: [
          ...t.columns,
          {
            id: `col-${seq++}`,
            name: '',
            type: 'VARCHAR(255)',
            nullable: true,
            defaultValue: null,
            comment: ''
          }
        ]
      }))
    ),
  updateColumn: (colId, patch) =>
    set((s) =>
      patchActive(s, (t) => ({
        ...t,
        columns: t.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c))
      }))
    ),
  toggleNullable: (colId) =>
    set((s) =>
      patchActive(s, (t) => ({
        ...t,
        columns: t.columns.map((c) => (c.id === colId ? { ...c, nullable: !c.nullable } : c))
      }))
    ),
  moveColumn: (colId, dir) =>
    set((s) =>
      patchActive(s, (t) => {
        const i = t.columns.findIndex((c) => c.id === colId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= t.columns.length) return t
        const columns = [...t.columns]
        ;[columns[i], columns[j]] = [columns[j], columns[i]]
        return { ...t, columns }
      })
    ),
  reorderColumns: (activeColId, overColId) =>
    set((s) =>
      patchActive(s, (t) => {
        const from = t.columns.findIndex((c) => c.id === activeColId)
        const to = t.columns.findIndex((c) => c.id === overColId)
        if (from < 0 || to < 0 || from === to) return t
        const columns = [...t.columns]
        const [moved] = columns.splice(from, 1)
        columns.splice(to, 0, moved)
        return { ...t, columns }
      })
    ),
  deleteColumn: (colId) =>
    set((s) =>
      patchActive(s, (t) => ({
        ...t,
        columns: t.columns.filter((c) => c.id !== colId),
        constraints: pruneEmpty(
          t.constraints.map((k) => ({
            ...k,
            columns: k.columns.filter((r) => r.columnId !== colId)
          }))
        )
      }))
    ),

  // ── 퀵 키 토글 ──
  togglePk: (colId) =>
    set((s) =>
      patchActive(s, (t) => {
        const pk = t.constraints.find((k) => k.kind === 'pk')
        if (!pk) {
          return {
            ...t,
            constraints: [
              ...t.constraints,
              { id: `con-${seq++}`, kind: 'pk', name: `pk_${t.name}`, columns: [{ columnId: colId }] }
            ]
          }
        }
        const has = pk.columns.some((r) => r.columnId === colId)
        const columns = has
          ? pk.columns.filter((r) => r.columnId !== colId)
          : [...pk.columns, { columnId: colId }]
        return {
          ...t,
          constraints: pruneEmpty(
            t.constraints.map((k) => (k.id === pk.id ? { ...k, columns } : k))
          )
        }
      })
    ),
  toggleUnique: (colId) =>
    set((s) =>
      patchActive(s, (t) => {
        const existing = t.constraints.find(
          (k) => k.kind === 'uk' && k.columns.length === 1 && k.columns[0].columnId === colId
        )
        if (existing) {
          return { ...t, constraints: t.constraints.filter((k) => k.id !== existing.id) }
        }
        const colName = t.columns.find((c) => c.id === colId)?.name ?? 'col'
        return {
          ...t,
          constraints: [
            ...t.constraints,
            { id: `con-${seq++}`, kind: 'uk', name: `uq_${t.name}_${colName}`, columns: [{ columnId: colId }] }
          ]
        }
      })
    ),
  toggleIndex: (colId) =>
    set((s) =>
      patchActive(s, (t) => {
        const existing = t.constraints.find(
          (k) => k.kind === 'idx' && k.columns.length === 1 && k.columns[0].columnId === colId
        )
        if (existing) {
          return { ...t, constraints: t.constraints.filter((k) => k.id !== existing.id) }
        }
        const colName = t.columns.find((c) => c.id === colId)?.name ?? 'col'
        return {
          ...t,
          constraints: [
            ...t.constraints,
            { id: `con-${seq++}`, kind: 'idx', name: `idx_${t.name}_${colName}`, columns: [{ columnId: colId }] }
          ]
        }
      })
    ),

  // ── Constraint ──
  addConstraint: (kind) =>
    set((s) => {
      const t = s.tables.find((x) => x.id === s.activeTableId)
      if (!t) return {}
      // PK 는 테이블당 하나 — 이미 있으면 그 에디터를 연다.
      if (kind === 'pk') {
        const pk = t.constraints.find((k) => k.kind === 'pk')
        if (pk) return { openConstraintId: pk.id }
      }
      const id = `con-${seq++}`
      const n = t.constraints.filter((k) => k.kind === kind).length + 1
      const base: Constraint = { id, kind, name: '', columns: [] }
      switch (kind) {
        case 'pk':
          base.name = `pk_${t.name}`
          break
        case 'uk':
          base.name = `uq_${t.name}_${n}`
          break
        case 'idx':
          base.name = `idx_${t.name}_${n}`
          break
        case 'check':
          base.name = `chk_${t.name}_${n}`
          base.expression = ''
          break
        case 'fk':
          base.name = `fk_${t.name}_${n}`
          base.refTable = ''
          base.refColumns = []
          base.onDelete = 'RESTRICT'
          base.onUpdate = 'RESTRICT'
          break
      }
      return {
        ...patchActive(s, (x) => ({ ...x, constraints: [...x.constraints, base] })),
        openConstraintId: id
      }
    }),
  updateConstraint: (id, patch) =>
    set((s) =>
      patchActive(s, (t) => ({
        ...t,
        constraints: t.constraints.map((k) => (k.id === id ? { ...k, ...patch } : k))
      }))
    ),
  deleteConstraint: (id) =>
    set((s) => ({
      ...patchActive(s, (t) => ({ ...t, constraints: t.constraints.filter((k) => k.id !== id) })),
      openConstraintId: null
    })),

  // ── Table ──
  addTable: (designId) =>
    set((s) => {
      const id = `tbl-${seq++}`
      const colId = `col-${seq++}`
      // 새 테이블 PK 템플릿은 설계 방언의 네이티브 타입·자동증가 토큰으로.
      // (자동증가 토큰은 ddl.ts 가 셋 다 인식해 방언별 구문으로 출력)
      const dialect =
        useDesignsStore.getState().designs.find((d) => d.id === designId)?.dialect ?? 'mysql'
      const idType =
        dialect === 'postgresql' ? 'BIGINT' : dialect === 'sqlite' ? 'INTEGER' : 'BIGINT UNSIGNED'
      const table: TableDef = {
        id,
        designId,
        name: `new_table_${seq}`,
        comment: '',
        columns: [
          { id: colId, name: 'id', type: idType, nullable: false, defaultValue: autoIncrementToken(dialect), comment: '' }
        ],
        constraints: [
          { id: `con-${seq++}`, kind: 'pk', name: `pk_new_table`, columns: [{ columnId: colId }] }
        ]
      }
      return { tables: [...s.tables, table], activeTableId: id, editing: null, openConstraintId: null }
    }),
  addView: (designId) =>
    set((s) => {
      const id = `tbl-${seq++}`
      // 뷰는 PK 템플릿이 없다 — 결과 컬럼은 본문 SELECT 를 쓰면서 사람이 채운다.
      const view: TableDef = {
        id,
        designId,
        name: `new_view_${seq++}`,
        comment: '',
        columns: [],
        constraints: [],
        isView: true,
        viewSql: ''
      }
      return { tables: [...s.tables, view], activeTableId: id, editing: null, openConstraintId: null }
    }),
  updateTable: (patch) => set((s) => patchActive(s, (t) => ({ ...t, ...patch }))),
  toggleView: () =>
    set((s) =>
      patchActive(s, (t) =>
        t.isView
          ? { ...t, isView: false, viewSql: '' }
          : // 뷰에는 PK·FK·인덱스를 걸 수 없다 — 남겨 두면 DDL 에도 Diagram 관계에도 거짓이 된다.
            { ...t, isView: true, constraints: [], viewSql: t.viewSql ?? '' }
      )
    ),
  deleteTable: (id) =>
    set((s) => {
      const victim = s.tables.find((t) => t.id === id)
      const tables = s.tables.filter((t) => t.id !== id)
      // 같은 설계의 남은 첫 테이블로 폴백 — 설계의 마지막 테이블 삭제도 허용(빈 상태로).
      const activeTableId =
        s.activeTableId === id
          ? (tables.find((t) => t.designId === victim?.designId)?.id ?? '')
          : s.activeTableId
      return { tables, activeTableId, editing: null, openConstraintId: null, returnTo: null }
    })
}))

/**
 * 활성 Design 스코프의 테이블 목록.
 * Studio 렌즈(도구줄 시점 손잡이)가 'draft'면 편집 가능한 작업본,
 * 커밋 버전이면 그 스냅샷(읽기 전용)을 반환한다. 설계 미선택이면 빈 배열.
 */
export function useDesignTables(): TableDef[] {
  const design = useActiveDesign()
  const lens = useVersionLens()
  const draft = useDefinitionStore((s) => s.tables)
  const snapshotTables = useVersionsStore((s) =>
    design && isReadOnlyLens(lens)
      ? s.byDesign[design.id]?.find((v) => v.number === lens)?.snapshot.tables
      : undefined
  )
  if (!design) return []
  if (snapshotTables) return snapshotTables
  return draft.filter((t) => t.designId === design.id)
}

/** Studio 가 읽기 전용인가 — 커밋된 버전을 렌즈로 보고 있으면 true. */
export function useStudioReadOnly(): boolean {
  return isReadOnlyLens(useVersionLens())
}

/** 현재 활성 테이블 — 활성 Design 스코프. 스코프 밖이면 첫 테이블로 폴백, 없으면 undefined. */
export function useActiveTable(): TableDef | undefined {
  const scoped = useDesignTables()
  const activeId = useDefinitionStore((s) => s.activeTableId)
  return scoped.find((t) => t.id === activeId) ?? scoped[0]
}

// ── 저장소 연동 ───────────────────────────────────────────────────────────
// 시작 시 SQLite 에서 하이드레이션.
void useDefinitionStore.getState().init()

// 리하이드레이션(에이전트발 갱신 반영) 중 write-through 억제 — 방금 저장소에서 읽어온
// 값을 다시 저장소로 되쏘면 에이전트 쓰기와 저장이 꼬리를 물기 때문(spec tools.rehydration AC-3).
let rehydrating = false

/**
 * MCP 에이전트가 바꾼 설계의 테이블을 화면 상태에 반영한다 — 대상 설계 슬라이스만
 * 갈아끼우고(다른 설계의 편집 중 상태 보존) write-through 를 되쏘지 않는다.
 */
export function rehydrateDesignTables(designId: string, incoming: TableDef[]): void {
  const cur = useDefinitionStore.getState()
  if (!cur.loaded) return // 초기 하이드레이션 전이면 init 이 곧 전체를 읽는다
  const tables = mergeDesignTables(cur.tables, designId, incoming)
  // 활성 테이블이 사라졌으면(patchActive 가 조용히 no-op 되는 것 방지) 그 설계 첫 테이블로 되돌린다.
  const active = reconcileActiveTable(cur.activeTableId, tables, incoming)
  const patch = active.changed
    ? { tables, activeTableId: active.activeTableId, editing: null, openConstraintId: null }
    : { tables }
  rehydrating = true
  try {
    useDefinitionStore.setState(patch)
  } finally {
    rehydrating = false
  }
}

// tables 변경 시 저장소로 write-through(디바운스) — 바뀐 설계만 스코프 저장.
// 전량 교체는 제거됨: 설계 X 편집이 설계 Y 행을 건드리지 않는다(spec tools.write AC-4).
let saveTimer: ReturnType<typeof setTimeout> | undefined
const pendingDesignIds = new Set<string>()
useDefinitionStore.subscribe((s, prev) => {
  if (!s.loaded || s.tables === prev.tables || rehydrating) return
  for (const id of changedDesignIds(prev.tables, s.tables)) pendingDesignIds.add(id)
  if (pendingDesignIds.size === 0) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const snapshot = useDefinitionStore.getState().tables
    const ids = [...pendingDesignIds]
    pendingDesignIds.clear()
    for (const designId of ids) {
      void window.rockury.tables.replaceForDesign(
        designId,
        snapshot
          .filter((t) => t.designId === designId)
          .map((t) => ({
            id: t.id,
            designId: t.designId,
            name: t.name,
            comment: t.comment,
            columns: t.columns,
            constraints: t.constraints,
            isView: t.isView ?? false,
            viewSql: t.viewSql ?? ''
          }))
      )
    }
  }, 250)
})

// 설계가 삭제되면 그 설계의 테이블도 렌더러 상태에서 정리한다(저장소는 이미 cascade 삭제).
// designs 하이드레이션 완료 후에만 판단(초기 빈 목록으로 오판 방지).
useDesignsStore.subscribe((s, prev) => {
  if (!s.loaded || s.designs === prev.designs) return
  const ids = new Set(s.designs.map((d) => d.id))
  const cur = useDefinitionStore.getState()
  if (cur.loaded && cur.tables.some((t) => !ids.has(t.designId))) {
    useDefinitionStore.setState({ tables: cur.tables.filter((t) => ids.has(t.designId)) })
  }
})
