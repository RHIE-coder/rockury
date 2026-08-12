import { diffSnapshots, isEmptyDiff, type SchemaDiff } from '../versions/diff'
import { diffSeeds, isEmptySeedDiff, type SeedDiff } from '../versions/seedDiff'
import type { VersionSnapshot } from '../versions/store'

/**
 * 진단 — **"지금 실 DB 와 설계가 어떻게 다른가"**.
 *
 * 견주는 짝은 하나다: **지금 DB ↔ 타깃 설계 버전**. 화면의 대조표가 그 짝을 그대로 그리고,
 * 사람은 그 표를 보고 방향을 고른다(설계로 가져오기 / 계획을 만들어 DB 를 고치기).
 *
 * 예전에는 여기에 갈래가 하나 더 있었다 — **기준선**(마지막으로 확인해 둔 DB 모습)과 지금 DB 를
 * 견줘 "남이 직접 고쳤나"를 가려내는 것. 2026-08-12 에 걷어냈다: 남이 만든 것은 설계에 없으니
 * 위 표에 이미 "사라질 것"으로 서고, 기준선이 홀로 감당하던 일은 "알고도 그냥 두기"를 기록하는
 * 것뿐이었다. 그 하나를 위해 별도의 저장소·화면·판정을 유지하는 값이 안 나왔다.
 *
 * 시드(seed)만은 **설계 버전끼리** 잰다 — 실 DB 에는 "시드 선언"이라는 것이 없어서
 * 지금 DB 와는 견줄 수가 없다.
 */

export interface AheadDelta {
  schema: SchemaDiff
  seed: SeedDiff
}

export interface Diagnosis {
  /** 설계가 앞선 것(Design[remote] ↔ Design[target]). 둘 중 하나라도 모르면 null. */
  ahead: AheadDelta | null
}

export interface DiagnoseInput {
  /** 설계에서 Remote 버전에 해당하는 스냅샷. Remote 가 맵핑 안 됐으면 null. */
  atRemote: VersionSnapshot | null
  /** 설계에서 타깃 버전에 해당하는 스냅샷. 타깃을 안 골랐으면 null. */
  atTarget: VersionSnapshot | null
}

export function diagnose({ atRemote, atTarget }: DiagnoseInput): Diagnosis {
  return {
    ahead:
      atRemote && atTarget
        ? {
            // 같은 설계 계보끼리라 id 스킴이 같다 — 경계 정렬이 필요 없다(정렬하면 rename 추적을 잃는다).
            schema: diffSnapshots(atRemote, atTarget),
            seed: diffSeeds(atRemote.seeds, atTarget.seeds)
          }
        : null
  }
}

/** 밀어야 할 것이 있나 — 스키마든 시드든 하나라도 있으면 참. */
export function hasAhead(d: Diagnosis): boolean {
  if (!d.ahead) return false
  return !isEmptyDiff(d.ahead.schema) || !isEmptySeedDiff(d.ahead.seed)
}

/** 화면이 어느 상태를 그릴지 — 이 판정 하나로 갈린다. */
export type DiagnosisState =
  /** 맵핑이 안 됐다 — Remote 가 몇 버전인지 모른다. */
  | 'unmapped'
  /** 지금 DB 가 설계와 다르다. */
  | 'different'
  /** 같다. */
  | 'synced'

/**
 * @param mapped Remote 버전을 아는가
 * @param designDiff 지금 DB ↔ 타깃 설계 버전의 차이. 못 냈으면 null.
 */
export function diagnosisState(mapped: boolean, designDiff: SchemaDiff | null): DiagnosisState {
  if (!mapped) return 'unmapped'
  if (!designDiff) return 'synced'
  return isEmptyDiff(designDiff) ? 'synced' : 'different'
}
