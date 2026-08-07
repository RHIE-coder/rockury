import type { SavedFilterRecord } from '@shared/db/savedFilter'
import { sameTable, type TableRef } from '../../schemaRef'

/**
 * 저장 필터 판정(§db-remote.data.saved-filter AC-4/AC-5) — 순수 함수.
 *
 * 두 가지를 가른다: ⑴ 지금 표에 **적용할 수 있나**(컬럼이 그대로 있나) ⑵ 표가 사라져
 * **지워야 하나**. 둘 다 조용히 지우지 않는 쪽으로 기운다 — 필터는 사용자가 만든 것이고,
 * 잘못 지우면 되돌릴 방법이 없다.
 */

export type SavedFilterStatus = { ok: true } | { ok: false; missing: string[] }

/**
 * 저장된 조건이 쓰는 컬럼이 지금 표에 다 있나. 없으면 그 이름들을 함께 돌려준다 —
 * 왜 못 쓰는지 안 밝히면 사용자는 저장이 깨졌다고만 안다. 값이 필요 없는 연산자
 * (`IS NULL`)도 컬럼은 있어야 하므로 연산자로 가르지 않는다.
 */
export function savedFilterStatus(
  saved: Pick<SavedFilterRecord, 'filters'>,
  columns: readonly string[]
): SavedFilterStatus {
  const have = new Set(columns)
  const missing: string[] = []
  for (const f of saved.filters) {
    if (!f.column || have.has(f.column) || missing.includes(f.column)) continue
    missing.push(f.column)
  }
  return missing.length ? { ok: false, missing } : { ok: true }
}

/**
 * 표가 사라졌을 **가능성이 있는** 저장 필터의 id 들 — 곧바로 지울 목록이 아니라 **물어볼 후보**다.
 *
 * "역설계 목록에 없다"는 삭제 말고도 여러 뜻이다(범위를 좁혔거나, 권한이 빠졌거나, 목록이
 * 낡았거나). 그래서 여기서는 아무것도 결정하지 않는다 — 마지막 판정은 `tableGone` 이 **그 표에
 * 직접 물어** 내린다.
 *
 * 예전엔 여기에 "읽은 스키마 안에 있는 것만"이라는 조건이 하나 더 있었다. 목록만 보고 지우던
 * 시절의 안전장치인데, 확인 질의가 생긴 뒤로는 **틀린 답을 막는 게 아니라 맞는 답을 막았다** —
 * 그 접속의 표를 전부 지우면 읽은 스키마를 알 길이 없어 후보가 0이 됐고, 필터가 영영 남았다
 * (2026-08-08 실측). DB 가 "그런 표 없다"고 답했으면 어느 스키마를 보고 있든 없는 것이다.
 */
export function orphanedFilterIds(
  saved: readonly SavedFilterRecord[],
  liveTables: readonly TableRef[]
): string[] {
  return saved
    .filter((s) => !liveTables.some((t) => sameTable(t, { schema: s.schema || undefined, name: s.table })))
    .map((s) => s.id)
}
