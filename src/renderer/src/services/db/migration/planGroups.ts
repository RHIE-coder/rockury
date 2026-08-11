import type { MigrationStatement } from './ddlDiff'

/**
 * 계획 SQL 을 **테이블별로 묶는다.**
 *
 * 왜: 문 84개를 낱개 상자로 늘어놓으면 화면 넉 장을 넘겨야 끝이 나고, 그 사이에 "이 테이블에
 * 무슨 일이 벌어지나"가 흩어진다(2026-08-10 사용자: "이걸 지금 나보고 보라고?"). 사람이 SQL 을
 * 확인할 때 세는 단위는 문이 아니라 **테이블**이다 — `testdb.comments` 에 문이 다섯 개 나간다는
 * 사실 하나가 그 다섯 줄을 다 읽는 것보다 먼저 필요하다.
 *
 * 순서는 원본 그대로 둔다 — 실행 순서가 곧 안전 순서(FK 를 떼고 컬럼을 지운다)라서, 보기 좋게
 * 재배열하면 화면이 실제 실행과 다른 이야기를 하게 된다. 테이블도 **처음 나온 순서**로 세운다.
 */
export interface StatementGroup {
  table: string
  statements: MigrationStatement[]
  /** 이 테이블에서 데이터가 지워질 수 있는 문의 개수. 0 이면 접힌 채로도 안심할 수 있다. */
  destructiveCount: number
}

export function groupStatements(statements: MigrationStatement[]): StatementGroup[] {
  const byTable = new Map<string, StatementGroup>()
  for (const s of statements) {
    let g = byTable.get(s.table)
    if (!g) {
      g = { table: s.table, statements: [], destructiveCount: 0 }
      byTable.set(s.table, g)
    }
    g.statements.push(s)
    if (s.destructive) g.destructiveCount += 1
  }
  return [...byTable.values()]
}
