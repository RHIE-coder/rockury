import { alignSnapshotToActual } from '../versions/align'
import { diffSnapshots, isEmptyDiff, type SchemaDiff } from '../versions/diff'
import { diffSeeds, isEmptySeedDiff, type SeedDiff } from '../versions/seedDiff'
import type { VersionSnapshot } from '../versions/store'

/**
 * 진단 — **"Design vX 와 Remote vY 사이에 무엇이 있나"** 를 두 갈래로 가른다.
 *
 * 갈래가 둘인 이유는 대응이 정반대이기 때문이다:
 *  - **설계가 앞선 것** — 내가 아직 안 민 것. 할 일은 반영(Run).
 *  - **DB 가 샌 것** — 남이 실 DB 를 직접 고친 것. 할 일은 흡수(설계로 들이기)나 원복.
 *
 * 한 덩어리로 보여 주면 이 둘이 섞여, 무엇을 밀어야 하고 무엇을 되찾아야 하는지 알 수 없다
 * (예전 화면이 Drift 탭과 Plan 탭으로 갈라 놓아 매번 두 곳을 오가야 했다).
 *
 * **비교 짝을 고른 근거:**
 *  - 앞선 것은 **설계 버전끼리**(Design[remote] ↔ Design[target]) 잰다. 실 DB 를 끼우면
 *    드리프트가 섞여 들어와 "설계가 얼마나 앞섰나"라는 질문의 답이 흐려진다. 설계끼리라야
 *    시드(seed)도 함께 잴 수 있다 — 실 DB 에는 "시드 선언"이라는 것이 없다.
 *  - 샌 것은 **기준선 ↔ 실제**로 잰다. 기준선이 "우리가 마지막에 남긴 실제 모습"이라서다.
 *
 * 실행 SQL 은 이 진단으로 만들지 않는다 — 그건 실제 ↔ 타깃으로 따로 뽑는다(계획).
 * 진단은 사람에게 보여 주는 값이고, 계획은 DB 에 나가는 값이라 근거가 달라야 한다.
 */

export interface AheadDelta {
  schema: SchemaDiff
  seed: SeedDiff
}

export interface Diagnosis {
  /** 설계가 앞선 것. Remote 버전을 모르거나 타깃이 없으면 null. */
  ahead: AheadDelta | null
  /** DB 가 샌 것. 기준선이 없으면 null(견줄 대상이 없다). */
  drift: SchemaDiff | null
}

export interface DiagnoseInput {
  /** 설계에서 Remote 버전에 해당하는 스냅샷. Remote 가 맵핑 안 됐으면 null. */
  atRemote: VersionSnapshot | null
  /** 설계에서 타깃 버전에 해당하는 스냅샷. 타깃을 안 골랐으면 null. */
  atTarget: VersionSnapshot | null
  /** 마지막으로 남긴 실제 모습. 없으면 null. */
  baseline: VersionSnapshot | null
  /** 방금 읽은 실제. */
  actual: VersionSnapshot
}

export function diagnose({ atRemote, atTarget, baseline, actual }: DiagnoseInput): Diagnosis {
  return {
    ahead:
      atRemote && atTarget
        ? {
            // 같은 설계 계보끼리라 id 스킴이 같다 — 경계 정렬이 필요 없다(정렬하면 rename 추적을 잃는다).
            schema: diffSnapshots(atRemote, atTarget),
            seed: diffSeeds(atRemote.seeds, atTarget.seeds)
          }
        : null,
    drift: baseline
      ? // 기준선이 설계 저작 스냅샷(순번 id)일 수 있어 이름 스킴으로 맞춘 뒤 비교(§경계 정렬).
        diffSnapshots(alignSnapshotToActual(baseline, actual), actual)
      : null
  }
}

/** 밀어야 할 것이 있나 — 스키마든 시드든 하나라도 있으면 참. */
export function hasAhead(d: Diagnosis): boolean {
  if (!d.ahead) return false
  return !isEmptyDiff(d.ahead.schema) || !isEmptySeedDiff(d.ahead.seed)
}

/** DB 가 샜나 — 기준선이 있고 실제가 그와 다를 때만 참. */
export function hasDrift(d: Diagnosis): boolean {
  return !!d.drift && !isEmptyDiff(d.drift)
}

/** 화면이 어느 상태를 그릴지 — 이 판정 하나로 갈린다. */
export type DiagnosisState =
  /** 맵핑이 안 됐다 — Remote 가 몇 버전인지 모른다. */
  | 'unmapped'
  /** DB 가 샜다 — 반영보다 이쪽을 먼저 처리해야 한다. */
  | 'drifted'
  /** 밀 것이 있다. */
  | 'ahead'
  /** 일치한다. */
  | 'synced'

export function diagnosisState(d: Diagnosis, mapped: boolean): DiagnosisState {
  if (!mapped) return 'unmapped'
  // 샌 것이 먼저다 — 그 상태로 밀면 남의 변경을 덮는다.
  if (hasDrift(d)) return 'drifted'
  return hasAhead(d) ? 'ahead' : 'synced'
}
