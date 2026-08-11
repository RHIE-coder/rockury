import type { DialectId } from '../dialects'
import type { VersionSnapshot } from '../versions/store'
import { generateMigration, type MigrationPlan, type MigrationStatement } from './ddlDiff'

/**
 * 되돌리기 SQL — 반영을 물리는 반대 방향 문.
 *
 * **왜 "롤백"이라 부르지 않나:** MySQL 은 DDL 이 즉시 커밋된다(트랜잭션 밖으로 새어 나간다).
 * 그래서 반영 뒤에 진짜 롤백은 불가능하고, 우리가 할 수 있는 것은 **반대 방향 SQL 을 만들어
 * 실행하는 것**뿐이다. 이름이 다르면 기대도 다르다 — 화면은 이것을 "되돌리기"라 부른다.
 *
 * 생성은 간단하다: 적용이 `base → target` 이면 되돌리기는 `target → base` 다.
 * 어려운 건 **되돌려도 원래대로 안 되는 것을 가려내는 일**이다(아래).
 */

export interface RevertPlan extends MigrationPlan {
  /**
   * 되돌려도 데이터가 안 돌아오는 문들. SQL 은 성공하지만 내용은 빈 채로 남는다.
   * 이걸 안 밝히면 "되돌리기가 있으니 안전하다"는 잘못된 믿음을 준다.
   */
  lossy: MigrationStatement[]
}

/**
 * 되돌려도 원래대로 안 되는 문인가.
 *
 * 판정 기준은 **"구조는 되살아나도 내용은 안 되살아나는가"** 다.
 *  - 적용이 DROP TABLE 이었으면 되돌리기는 CREATE TABLE — 빈 테이블이 생긴다. 행은 사라진 채다.
 *  - 적용이 컬럼 삭제였으면 되돌리기는 컬럼 추가 — 값은 전부 NULL/기본값이다.
 * 즉 **적용 쪽이 파괴적이었던 자리**가 곧 되돌려도 못 되찾는 자리다.
 */
function isLossy(revertStatement: MigrationStatement, appliedWasDestructive: boolean): boolean {
  // create 로 되살아나는 것은 껍데기뿐 — 적용이 지운 것이었다면 내용은 못 돌아온다.
  return appliedWasDestructive && (revertStatement.kind === 'create' || revertStatement.kind === 'alter')
}

/**
 * 적용 계획의 짝이 되는 되돌리기 계획을 만든다.
 *
 * @param base   반영 전 모습(= 되돌아갈 곳)
 * @param target 반영 후 모습
 */
export function generateRevert(
  base: VersionSnapshot,
  target: VersionSnapshot,
  dialect: DialectId
): RevertPlan {
  const applied = generateMigration(base, target, dialect)
  const reverted = generateMigration(target, base, dialect)

  // 적용 쪽에서 파괴적이었던 **테이블**을 표시해 둔다 — 되돌리기의 같은 테이블 문이 곧 손실 자리다.
  const destroyedTables = new Set(
    applied.statements.filter((s) => s.destructive).map((s) => s.table)
  )

  const lossy = reverted.statements.filter((s) => isLossy(s, destroyedTables.has(s.table)))

  return { ...reverted, lossy }
}
