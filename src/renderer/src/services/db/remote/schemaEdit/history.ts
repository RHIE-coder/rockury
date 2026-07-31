import type { MigrationPlan } from '../../migration/ddlDiff'

/**
 * Definition·Diagram 라이브 스키마 편집을 커밋에 성공했을 때 History 에 남길 항목들(순수).
 *
 * plan 의 각 DDL 문을 한 행으로 만들되, **한 번의 적용을 같은 runId 로 묶고 seq(1-base)로 순서를 박아**
 * History 에서 아코디언 그룹(= 한 번의 스키마 변경) 으로 보이게 한다 — Collection 실행 이력과 동일한
 * runId/seq 그룹핑 규약(historyGroup 참고). status 는 커밋 성공 후에만 부르므로 항상 'success'.
 */
export interface SchemaEditHistoryEntry {
  connectionId: string
  source: 'definition'
  sql: string
  /** DDL 종류(create | alter | drop | index) — Status 열에 그대로 표시된다. */
  kind: string
  status: 'success'
  runId: string
  seq: number
}

export function schemaEditHistory(
  plan: MigrationPlan,
  connectionId: string,
  runId: string
): SchemaEditHistoryEntry[] {
  return plan.statements.map((st, i) => ({
    connectionId,
    source: 'definition',
    sql: st.sql,
    kind: st.kind,
    status: 'success',
    runId,
    seq: i + 1
  }))
}
