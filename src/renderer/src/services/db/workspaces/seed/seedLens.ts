import type { SeedSet } from './types'

/**
 * **시드를 버전 렌즈로 읽는 규칙**(순수) — 화면·되돌리기·컷이 같은 판정을 써야 한다.
 *
 * 여기서 가르는 것은 딱 하나다: 버전 스냅샷의 `seeds` 가 **빈 목록**인가 **아예 없는가**.
 * 둘을 뭉개면 두 가지가 동시에 깨진다.
 *  · 읽기 — `seeds` 가 없다고 Draft 로 흘려보내면, 버전을 보고 있는데 지금 편집본의 시드가
 *    "컷된 버전의 시드"라는 띠를 달고 보인다(2026-08-18 사용자 제보: "버전에 귀속된 게 아니다").
 *  · 되돌리기 — 기록이 없는 것을 "시드 0개"로 읽으면, 되돌리는 순간 Draft 시드가 근거 없이 지워진다.
 *
 * `seeds` 가 없는 스냅샷은 실제로 흔하다: 시드 기능 이전에 컷된 버전, 그리고 실 DB 역설계로
 * 만든 버전(가져오기·Drift)이다 — 실 DB 에는 "시드 선언"이라는 것이 없다.
 */

/** 지금 보고 있는 시드가 어디서 왔는가. */
export type SeedSource =
  /** 편집 가능한 작업본. */
  | 'draft'
  /** 이 버전이 실제로 담아 둔 시드. */
  | 'version'
  /** 이 버전은 시드를 담은 적이 없다 — "0개"가 아니라 "모름". */
  | 'unrecorded'

export interface SeedLensView {
  sets: SeedSet[]
  source: SeedSource
}

/** 렌즈가 읽어야 할 시드 목록과 그 출처. */
export function seedLensView(input: {
  designId: string | null
  /** 커밋된 버전을 보고 있는가. */
  readOnly: boolean
  /** 그 버전 스냅샷의 시드 — `undefined` 는 "담은 적 없음". */
  snapshotSeeds: SeedSet[] | undefined
  /** 전체 Draft 시드(설계 무관). */
  draft: readonly SeedSet[]
}): SeedLensView {
  const { designId, readOnly, snapshotSeeds, draft } = input
  if (!designId) return { sets: [], source: 'draft' }
  if (!readOnly) return { sets: draft.filter((x) => x.designId === designId), source: 'draft' }
  if (!snapshotSeeds) return { sets: [], source: 'unrecorded' }
  return { sets: snapshotSeeds, source: 'version' }
}

/** 되돌리기가 Draft 시드에 할 일. */
export type SeedRestoreAction =
  /** 대상 버전의 시드로 갈아끼운다. */
  | { kind: 'replace'; sets: SeedSet[] }
  /** 대상 버전에 시드 기록이 없다 — Draft 시드는 손대지 않는다. */
  | { kind: 'keep' }

/**
 * 되돌리기의 시드 처리 판정.
 *
 * 기록이 없는 버전으로 되돌릴 때 **안 건드리는 쪽**을 고른 이유: 되돌리기가 약속하는 것은
 * "이 버전의 모습으로 되돌린다"이지 "기록에 없는 것은 지운다"가 아니다. 시드 기능 이전에
 * 컷한 버전이 아직 대부분이라, 지우는 쪽을 고르면 옛 버전을 한 번 눌러 보는 것만으로
 * 시드가 통째로 날아간다.
 *
 * 스냅샷의 시드는 **되돌리는 설계 소유로** 다시 적는다 — 스냅샷이 다른 설계 id 를 달고 있으면
 * Draft 에 앉자마자 스코프 밖으로 새어 저장에서 거부된다(`replaceSeedSetsForDesign` 의 격리 검사).
 */
export function seedRestoreAction(
  snapshotSeeds: SeedSet[] | undefined,
  designId: string
): SeedRestoreAction {
  if (!snapshotSeeds) return { kind: 'keep' }
  return {
    kind: 'replace',
    sets: snapshotSeeds.map((s) => (s.designId === designId ? s : { ...s, designId }))
  }
}
