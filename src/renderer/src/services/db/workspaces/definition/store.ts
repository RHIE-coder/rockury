import { create } from 'zustand'
import { useActiveDesign, useDesignsStore } from '../../designs/store'
import { designSchemas, scopedTables } from '../../scope'
import { autoIncrementToken } from '../../typeCatalog'
import { isReadOnlyLens, useVersionLens, useVersionsStore } from '../../versions/store'
import {
  changedDesignIds,
  draftTablesFromSnapshot,
  mergeDesignTables,
  newTableSchema,
  nextNewName,
  reconcileActiveTable,
  toTableDef,
  toTableRecord
} from './designScope'
import { enforcePkNotNull } from './derive'
import type { Column, Constraint, ConstraintKind, TableDef } from './types'
// 순환 참조 주의: definition → {designs, versions} 방향만 존재(역방향 import 없음).

type Form = 'table' | 'sql'
let seq = 1

/**
 * 새 id 발급 — **번호 권한은 이 모듈 하나**다. 저장소 `tables` 의 PK 는 설계 무관 전역 id 라
 * 밖에서 따로 번호를 지어내면 언젠가 겹친다(`init` 이 로드된 최대 번호 위로 `seq` 를 올려 둔다).
 * 복제 같은 바깥 계산은 이 함수를 받아 쓴다.
 */
export function mintDefinitionId(prefix: 'tbl' | 'col' | 'con'): string {
  return `${prefix}-${seq++}`
}

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
  /** 만들어진 테이블을 그대로 이어 붙인다(다른 설계에서 복제해 온 것). id 는 부르는 쪽이 발급한다. */
  insertTables: (tables: TableDef[]) => void
  /** 이미 있는 표들을 **id 로 찾아 통째로 갈아끼운다**(컬럼을 여러 표에 한 번에 넣을 때). */
  applyTables: (tables: TableDef[]) => void
  updateTable: (patch: Partial<Pick<TableDef, 'name' | 'schema' | 'comment' | 'viewSql'>>) => void
  /**
   * 한 스키마의 **표 전부**를 다른 스키마 이름으로 옮긴다 — 스키마 이름 바꾸기의 실체.
   * `from` 이 빈 문자열이면 "이름 없는 표들"을 옮긴다(선언 기능 이전 데이터를 거둘 때 쓴다).
   */
  moveSchema: (designId: string, from: string, to: string) => void
  /** 활성 대상의 테이블 ↔ 뷰 전환. 뷰로 바꾸면 제약은 뜻이 없어 비운다. */
  toggleView: () => void
  deleteTable: (id: string) => void
}

/**
 * 활성 테이블 한 장만 바꾼다 — **모든 편집이 지나는 한 곳**이라 도메인 불변식을 여기서 지킨다.
 *
 * `enforcePkNotNull` 을 걸어 두면 PK 를 켜는 길이 몇 갈래든(퀵 토글·제약 에디터·컬럼 삭제로
 * PK 가 줄어드는 경우까지) NULL 이 살아남지 못한다. 갈래마다 따로 적으면 한 곳은 반드시 빠진다.
 */
function patchActive(
  s: Pick<DefinitionState, 'tables' | 'activeTableId'>,
  map: (t: TableDef) => TableDef
): Pick<DefinitionState, 'tables'> {
  return {
    tables: s.tables.map((t) => (t.id === s.activeTableId ? enforcePkNotNull(map(t)) : t))
  }
}

/** 컬럼 keys 성격 제약(pk/uk/idx/fk)이 비면 제거. check 는 컬럼 무관이라 유지. */
function pruneEmpty(cons: Constraint[]): Constraint[] {
  return cons.filter((k) => k.kind === 'check' || k.columns.length > 0)
}

/** 새 표·뷰가 태어날 스키마 — 판정은 `newTableSchema`(순수), 여기선 그 입력만 모은다. */
function schemaForNew(tables: TableDef[], designId: string): string {
  const design = useDesignsStore.getState().designs.find((d) => d.id === designId)
  const mine = tables.filter((t) => t.designId === designId)
  return newTableSchema({
    scope: design?.schemas ?? [],
    declared: design?.declaredSchemas ?? [],
    used: designSchemas(mine),
    dialect: design?.dialect ?? 'postgresql',
    designName: design?.name ?? ''
  })
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
        // 스키마를 안 채우면 범위를 켠 설계에서 **화면에 안 뜬다**(`newTableSchema` 주석).
        schema: schemaForNew(s.tables, designId),
        name: nextNewName(s.tables, designId, 'new_table'),
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
        schema: schemaForNew(s.tables, designId),
        name: nextNewName(s.tables, designId, 'new_view'),
        comment: '',
        columns: [],
        constraints: [],
        isView: true,
        viewSql: ''
      }
      return { tables: [...s.tables, view], activeTableId: id, editing: null, openConstraintId: null }
    }),
  insertTables: (incoming) =>
    set((s) =>
      incoming.length === 0
        ? {}
        : {
            tables: [...s.tables, ...incoming],
            activeTableId: incoming[0].id,
            editing: null,
            openConstraintId: null
          }
    ),
  applyTables: (changed) =>
    set((s) => {
      if (changed.length === 0) return {}
      // id 로 갈아끼운다 — 배열 자리(index)로 찾으면 다른 설계 표가 섞인 목록에서 어긋난다.
      const byId = new Map(changed.map((t) => [t.id, t]))
      return { tables: s.tables.map((t) => byId.get(t.id) ?? t) }
    }),
  updateTable: (patch) => set((s) => patchActive(s, (t) => ({ ...t, ...patch }))),
  moveSchema: (designId, from, to) =>
    set((s) => ({
      /**
       * `schema` 만 고친다 — id(`t:public.users`)는 그대로 둔다.
       *
       * id 를 다시 매기면 제약이 컬럼을 가리키는 참조(`columnId`)까지 줄줄이 갈아야 하고, 한
       * 군데만 놓치면 제약이 조용히 끊긴다. 설계 안에서 id 는 유일하기만 하면 되는 손잡이이고,
       * 실 DB 와 견줄 때는 `align.ts` 가 (스키마, 이름)으로 id 를 **다시 계산**하므로 낡은 id 가
       * 비교를 틀리게 하지 않는다.
       */
      tables: s.tables.map((t) =>
        t.designId === designId && (t.schema ?? '') === from ? { ...t, schema: to || undefined } : t
      )
    })),
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
 * Design 렌즈(도구줄 시점 손잡이)가 'draft'면 편집 가능한 작업본,
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

/**
 * **화면에 뿌릴** 테이블 목록 — 설계 범위(스키마 손잡이)까지 걸러 준다.
 *
 * `useDesignTables` 와 갈라 두는 이유: 범위는 **보는 일**에만 걸린다. FK 가 가리키는 상대나
 * 이름 충돌 검사는 범위 밖 테이블까지 봐야 한다 — 거기에도 범위를 먹이면 범위를 좁힌 순간
 * 멀쩡한 FK 가 "대상 없음"으로 보이고 이름 충돌 검사가 뚫린다.
 */
export function useScopedDesignTables(): TableDef[] {
  const tables = useDesignTables()
  const design = useActiveDesign()
  return scopedTables(tables, design?.schemas ?? [])
}

/** Design 이 읽기 전용인가 — 커밋된 버전을 렌즈로 보고 있으면 true. */
export function useDesignReadOnly(): boolean {
  return isReadOnlyLens(useVersionLens())
}

/**
 * 현재 활성 테이블 — 범위 안에서 고른다. 범위 밖이면 첫 테이블로 폴백, 없으면 undefined.
 * (목록에서 사라진 테이블의 상세가 오른쪽에 남아 있으면 "왜 이게 보이지"가 된다.)
 */
export function useActiveTable(): TableDef | undefined {
  const scoped = useScopedDesignTables()
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
/**
 * 커밋된 버전 스냅샷으로 **Draft 를 통째로 되돌린다**(그 설계 몫만). 되돌린 결과는 다른 편집과
 * 똑같이 write-through 로 저장된다 — `rehydrateDesignTables` 와 달리 여기서는 저장을 막지 않는다.
 *
 * 왜 필요한가: Draft 는 실 DB 로도 버전으로도 되살릴 수 없는 유일한 상태였다. 스냅샷은 온전한데
 * Draft 만 상한 경우(2026-08-03 실측: 저장 매핑이 스키마를 흘려 전부 `public` 으로 뭉갰다)
 * 되돌릴 길이 없어, 이미 최신인 설계는 "가져올 변경이 없다"는 이유로 다시 가져오지도 못했다.
 */
export function restoreDraftFromSnapshot(designId: string, snapshotTables: readonly TableDef[]): void {
  const incoming = draftTablesFromSnapshot(snapshotTables, designId)
  useDefinitionStore.setState((s) => {
    const tables = mergeDesignTables(s.tables, designId, incoming)
    const active = reconcileActiveTable(s.activeTableId, tables, incoming)
    return {
      tables,
      activeTableId: active.changed ? active.activeTableId : s.activeTableId,
      editing: null,
      openConstraintId: null,
      returnTo: null
    }
  })
}

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
        snapshot.filter((t) => t.designId === designId).map(toTableRecord)
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
