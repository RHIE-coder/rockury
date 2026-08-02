import { create } from 'zustand'
import { errorMessage } from '@shared/errorMessage'
import { restoreDraftFromSnapshot, useDefinitionStore } from '../workspaces/definition/store'
import { alignSnapshotToActual } from './align'
import { diffSnapshots, type SchemaDiff } from './diff'
import { backupVersionNote, backupVersionNumber } from './restorePlan'
import { DRAFT_LENS, useVersionsStore, type VersionDef, type VersionSnapshot } from './store'

/**
 * 버전 → Draft 되돌리기.
 *
 * Draft 는 **되살릴 길이 없던 유일한 상태**였다: 실 DB 는 다시 읽으면 되고 버전은 스냅샷이 남지만,
 * Draft 가 상하면 끝이었다(2026-08-03 실측). 그래서 세 가지를 한 벌로 갖춘다 —
 * ⑴ 무엇이 바뀌는지 미리 보이고 ⑵ 덮기 전 지금 Draft 를 버전으로 남겨 ⑶ 한 단계 물러설 수 있게.
 */
interface RestoreState {
  open: boolean
  designId: string | null
  /** 되돌릴 대상 버전. */
  target: VersionDef | null
  /** 지금 Draft → 대상 스냅샷으로 갈 때의 변경. 미리보기용. */
  diff: SchemaDiff | null
  /** 덮기 전 지금 Draft 를 버전으로 남길까(= 되돌리기 취소용 안전줄). */
  keepBackup: boolean
  running: boolean
  error: string | null

  openRestore: (designId: string, target: VersionDef) => void
  close: () => void
  setKeepBackup: (v: boolean) => void
  execute: () => Promise<void>
}

/** 지금 Draft 를 스냅샷 모양으로 — 미리보기·보관 양쪽이 같은 값을 봐야 한다. */
function draftSnapshot(designId: string): VersionSnapshot {
  return { tables: useDefinitionStore.getState().tables.filter((t) => t.designId === designId) }
}

export const useRestoreStore = create<RestoreState>()((set, get) => ({
  open: false,
  designId: null,
  target: null,
  diff: null,
  keepBackup: true,
  running: false,
  error: null,

  openRestore: (designId, target) => {
    const current = draftSnapshot(designId)
    // id 체계가 서로 다르다 — Draft 는 설계 접두(`<설계>:t:…`)나 손으로 지은 id, 스냅샷은 실 DB
    // 이름 기반. 이름으로 짝을 맞춰야 "전부 갈아엎음"으로 뻥튀기되지 않는다(§경계 정렬).
    const aligned = alignSnapshotToActual(current, target.snapshot)
    set({
      open: true,
      designId,
      target,
      diff: diffSnapshots(aligned, target.snapshot),
      keepBackup: true,
      running: false,
      error: null
    })
  },

  close: () => set({ open: false, error: null }),

  setKeepBackup: (v) => set({ keepBackup: v }),

  execute: async () => {
    const { designId, target, keepBackup } = get()
    if (!designId || !target) return
    set({ running: true, error: null })
    try {
      if (keepBackup) {
        // 덮기 **전에** 남긴다 — 여기서 실패하면 되돌리기 자체를 하지 않는다(물러설 길이 먼저다).
        const versions = useVersionsStore.getState().byDesign[designId] ?? []
        await useVersionsStore.getState().cut({
          designId,
          number: backupVersionNumber(versions.map((v) => v.number)),
          note: backupVersionNote(target.number),
          snapshot: draftSnapshot(designId)
        })
      }
      restoreDraftFromSnapshot(designId, target.snapshot.tables)
      // 되돌린 결과를 바로 보게 — 읽기 전용 렌즈에 머물면 방금 한 일이 화면에 안 뜬다.
      useVersionsStore.getState().setLens(DRAFT_LENS)
      set({ open: false, running: false })
    } catch (e) {
      set({ running: false, error: errorMessage(e, '되돌리지 못했습니다.') })
    }
  }
}))
