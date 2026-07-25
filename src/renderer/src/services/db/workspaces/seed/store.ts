import { create } from 'zustand'
import { useNav } from '@renderer/nav/useNav'
import { useActiveDesign, useDesignsStore } from '../../designs/store'
import { useVersionsStore } from '../../versions/store'
import { changedDesignIds } from '../definition/designScope'
import type { TableDef } from '../definition/types'
import { createSeedSet, toggleIgnoredColumn, toggleNaturalKeyColumn } from './seedSet'
import type { SeedRow, SeedSet, SeedStrength } from './types'
// 순환 참조 주의: seed → {designs, versions, definition/designScope} 방향만 존재.

let rowSeq = 1

/** 세트 식별 키 — 테이블 이름은 설계 안에서만 유일하므로 설계 id 와 묶어 쓴다. */
export const setKey = (s: Pick<SeedSet, 'designId' | 'tableName'>): string => `${s.designId}::${s.tableName}`

interface SeedState {
  /** 저장소 하이드레이션 완료 여부 — write-through 는 이 이후에만 발동. */
  loaded: boolean
  /** 전체 시드 세트(설계 무관) — 화면은 활성 Design 으로 스코프해 읽는다(useDesignSeedSets). */
  sets: SeedSet[]
  /** 활성 세트 키(`designId::tableName`). */
  activeKey: string
  /** 편집 중인 셀 키(`<rowId>::<column>`). */
  editing: string | null

  init: () => Promise<void>
  setActive: (key: string) => void
  setEditing: (key: string | null) => void

  addSet: (t: TableDef) => void
  removeSet: (key: string) => void
  toggleKeyColumn: (column: string) => void
  toggleIgnored: (column: string) => void
  setStrength: (strength: SeedStrength) => void

  addRow: () => void
  updateCell: (rowId: string, column: string, value: string | null) => void
  deleteRow: (rowId: string) => void
}

/** 활성 세트 하나만 갈아끼운다(다른 세트 객체는 참조 그대로 → 저장 스코프 판정이 정확해진다). */
function patchActive(s: Pick<SeedState, 'sets' | 'activeKey'>, map: (set: SeedSet) => SeedSet): Pick<SeedState, 'sets'> {
  return { sets: s.sets.map((x) => (setKey(x) === s.activeKey ? map(x) : x)) }
}

export const useSeedStore = create<SeedState>()((set) => ({
  loaded: false,
  sets: [],
  activeKey: '',
  editing: null,

  init: async () => {
    const recs = await window.rockury.seedSets.list()
    const sets: SeedSet[] = recs.map((r) => ({
      designId: r.designId,
      tableName: r.tableName,
      naturalKey: r.naturalKey ?? [],
      ignoredColumns: r.ignoredColumns ?? [],
      strength: r.strength === 'authoritative' ? 'authoritative' : 'ensure',
      rows: (r.rows ?? []) as SeedRow[]
    }))
    // 행 로컬 id 재사용 충돌 방지 — 불러온 최대 번호 위로 seq 를 올린다.
    let max = 0
    for (const s of sets) {
      for (const r of s.rows) {
        const m = /^row-(\d+)$/.exec(r.id)
        if (m) max = Math.max(max, Number(m[1]))
      }
    }
    rowSeq = max + 1
    set({ sets, loaded: true })
  },

  setActive: (activeKey) => set({ activeKey, editing: null }),
  setEditing: (editing) => set({ editing }),

  addSet: (t) => {
    const next = createSeedSet(t)
    set((s) => ({ sets: [...s.sets, next], activeKey: setKey(next), editing: null }))
  },
  removeSet: (key) =>
    set((s) => {
      const sets = s.sets.filter((x) => setKey(x) !== key)
      return { sets, activeKey: s.activeKey === key ? '' : s.activeKey, editing: null }
    }),

  toggleKeyColumn: (column) => set((s) => patchActive(s, (x) => toggleNaturalKeyColumn(x, column))),
  toggleIgnored: (column) => set((s) => patchActive(s, (x) => toggleIgnoredColumn(x, column))),
  setStrength: (strength) => set((s) => patchActive(s, (x) => ({ ...x, strength }))),

  addRow: () =>
    set((s) => patchActive(s, (x) => ({ ...x, rows: [...x.rows, { id: `row-${rowSeq++}`, values: {} }] }))),
  updateCell: (rowId, column, value) =>
    set((s) =>
      patchActive(s, (x) => ({
        ...x,
        rows: x.rows.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, [column]: value } } : r))
      }))
    ),
  deleteRow: (rowId) =>
    set((s) => patchActive(s, (x) => ({ ...x, rows: x.rows.filter((r) => r.id !== rowId) })))
}))

/**
 * 활성 Design 스코프의 시드 세트.
 * Version 렌즈가 'draft'(또는 미선택)면 편집 가능한 작업본, 커밋 버전이면 그 스냅샷의 시드
 * (읽기 전용)를 반환한다 — Definition 의 `useDesignTables` 와 같은 규칙.
 * 시드 개념이 없던 옛 스냅샷은 빈 목록으로 읽는다.
 */
export function useDesignSeedSets(): SeedSet[] {
  const design = useActiveDesign()
  const versionId = useNav((s) => s.contextValues['version'])
  const draft = useSeedStore((s) => s.sets)
  const snapshotSeeds = useVersionsStore((s) =>
    design && versionId && versionId !== 'draft'
      ? s.byDesign[design.id]?.find((v) => v.number === versionId)?.snapshot.seeds
      : undefined
  )
  if (!design) return []
  if (snapshotSeeds) return snapshotSeeds
  return draft.filter((x) => x.designId === design.id)
}

/** 현재 활성 세트 — 스코프 밖이면 첫 세트로 폴백, 없으면 undefined. */
export function useActiveSeedSet(): SeedSet | undefined {
  const scoped = useDesignSeedSets()
  const activeKey = useSeedStore((s) => s.activeKey)
  return scoped.find((x) => setKey(x) === activeKey) ?? scoped[0]
}

// ── 저장소 연동 ───────────────────────────────────────────────────────────
void useSeedStore.getState().init()

// sets 변경 시 write-through(디바운스) — 바뀐 설계만 스코프 저장(tables 와 같은 규칙).
let saveTimer: ReturnType<typeof setTimeout> | undefined
const pendingDesignIds = new Set<string>()
useSeedStore.subscribe((s, prev) => {
  if (!s.loaded || s.sets === prev.sets) return
  for (const id of changedDesignIds(prev.sets, s.sets)) pendingDesignIds.add(id)
  if (pendingDesignIds.size === 0) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const snapshot = useSeedStore.getState().sets
    const ids = [...pendingDesignIds]
    pendingDesignIds.clear()
    for (const designId of ids) {
      void window.rockury.seedSets.replaceForDesign(
        designId,
        snapshot
          .filter((x) => x.designId === designId)
          .map((x) => ({
            designId: x.designId,
            tableName: x.tableName,
            naturalKey: x.naturalKey,
            ignoredColumns: x.ignoredColumns,
            strength: x.strength,
            rows: x.rows
          }))
      )
    }
  }, 250)
})

// 설계가 삭제되면 그 설계의 시드도 렌더러 상태에서 정리한다(저장소는 이미 함께 삭제).
useDesignsStore.subscribe((s, prev) => {
  if (!s.loaded || s.designs === prev.designs) return
  const ids = new Set(s.designs.map((d) => d.id))
  const cur = useSeedStore.getState()
  if (cur.loaded && cur.sets.some((x) => !ids.has(x.designId))) {
    useSeedStore.setState({ sets: cur.sets.filter((x) => ids.has(x.designId)) })
  }
})
