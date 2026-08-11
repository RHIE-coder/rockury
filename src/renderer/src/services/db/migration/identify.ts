import { alignSnapshotToActual } from '../versions/align'
import { diffSnapshots, isEmptyDiff, type SchemaDiff } from '../versions/diff'
import type { VersionSnapshot } from '../versions/store'

/**
 * 버전 판정 — **"이 실 DB 는 설계의 몇 버전인가?"**
 *
 * 맵핑의 심장이다. 연결을 처음 물릴 때 우리는 그 DB 가 어느 설계의 어느 버전인지 모른다.
 * 그래서 실제를 떠서 설계의 모든 버전과 하나씩 대조하고, 차이가 0 인 버전을 찾는다.
 *
 * 이걸 안 하면 `applied_version` 이 빈 채로 시작해 "타깃 — · 적용 —" 상태에 갇힌다 —
 * 무엇과 견주어야 할지 모르는 채로 Migration 을 여는 셈이다(2026-08-10 사용자 지적).
 *
 * 판정은 **읽기만 한다.** 버전을 만들지도, 스냅샷을 덮지도 않는다 — 그건 가져오기의 몫이다.
 */

export interface VersionCandidate {
  /** 설계 버전 번호(예: v0.1.0). */
  number: string
  /** 실제와의 차이. 비어 있으면 이 버전과 일치한다. */
  diff: SchemaDiff
  /** 차이의 크기 — 가까운 순으로 줄 세우는 데 쓴다. */
  distance: number
}

export interface IdentifyResult {
  /** 실제와 정확히 일치하는 버전. 없으면 null. */
  match: string | null
  /**
   * 가까운 순으로 줄 세운 후보 전부(일치 포함). 버전이 없으면 빈 배열.
   * 화면은 대개 맨 앞 하나만 쓰지만, "그다음으로 가까운 건 뭔가"를 보여 줄 수 있게 다 넘긴다.
   */
  candidates: VersionCandidate[]
}

/**
 * 차이의 크기 — 어느 버전이 더 가까운가를 한 숫자로 재기 위한 값.
 *
 * 테이블 하나가 통째로 다른 것과 컬럼 하나가 다른 것을 같게 볼 수 없어 무게를 달리 준다.
 * 정확한 값이 중요한 게 아니라 **순서**가 중요하다 — 가장 가까운 후보를 맨 앞에 세우는 용도다.
 */
export function diffDistance(diff: SchemaDiff): number {
  const s = diff.summary
  const tables = s.tablesAdded + s.tablesRemoved + s.tablesModified
  const columns = s.columnsAdded + s.columnsRemoved + s.columnsModified
  const constraints = s.constraintsAdded + s.constraintsRemoved + s.constraintsModified
  return tables * 100 + columns * 10 + constraints
}

/** 설계 버전 하나 — 판정에 필요한 것만. */
export interface VersionLike {
  number: string
  snapshot: VersionSnapshot
}

/**
 * 실제 스냅샷을 설계 버전들과 대조한다.
 *
 * 버전 스냅샷은 설계 저작물이라 순번 id(`o1`)를 쓰고 실제는 이름 id(`t:orders`)라,
 * 대조 전에 이름 스킴으로 맞춘다(§경계 정렬) — 안 그러면 모든 버전이 "전부 다름"으로 나온다.
 *
 * 동률이면 **버전 목록에서 앞선 것**이 이긴다(호출부가 넘긴 순서를 유지) — 같은 거리라면
 * 먼저 찍힌 버전을 고르는 편이 사람의 기대에 가깝다.
 */
export function identifyVersion(actual: VersionSnapshot, versions: VersionLike[]): IdentifyResult {
  const candidates = versions.map((v): VersionCandidate => {
    const diff = diffSnapshots(alignSnapshotToActual(v.snapshot, actual), actual)
    return { number: v.number, diff, distance: diffDistance(diff) }
  })

  // 안정 정렬(Array.prototype.sort 는 ES2019 부터 안정) — 동률이면 원래 순서가 남는다.
  const sorted = [...candidates].sort((a, b) => a.distance - b.distance)
  const match = sorted.find((c) => isEmptyDiff(c.diff))?.number ?? null
  return { match, candidates: sorted }
}
