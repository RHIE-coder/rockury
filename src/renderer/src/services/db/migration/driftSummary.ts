import type { SchemaDiff } from '../versions/diff'

/**
 * 지금 DB ↔ 설계의 차이를 **화면 눈금으로** 접는 순수 변환.
 *
 * 예전엔 이 파일이 로그용 문장도 만들었다(`summarizeDrift`·`detailDrift`) — 기준선을 덮기
 * 직전의 사실을 글로 굳혀 두는 자리였는데, 기준선을 걷어내면서(2026-08-12) 그 로그를 남길
 * 일이 사라져 함께 지웠다. 차이는 이제 언제든 다시 재면 된다.
 */

export interface DriftGroup {
  label: string
  added: number
  removed: number
  modified: number
}

/**
 * 화면용 묶음 — 같은 사실을 **종류별 세 숫자**로 접는다.
 *
 * 예전엔 아홉 항목을 그대로 이은 한 줄을 화면에 뒀다. "테이블 추가 6개 · 테이블 변경 18개 ·
 * 컬럼 추가 4개 · …" 스물몇 낱말이 흘러 아무도 안 읽었다(2026-08-10 사용자: "저렇게 계속
 * 나열하면 누가 알아"). 화면은 종류마다 `+/−/~` 세 칸으로 접어 눈이 숫자만 훑게 한다.
 *
 * 0 인 종류는 아예 빼서 빈 칸이 자리를 먹지 않게 한다.
 */
export function groupDrift(diff: SchemaDiff): DriftGroup[] {
  const s = diff.summary
  const groups: DriftGroup[] = [
    { label: '테이블', added: s.tablesAdded, removed: s.tablesRemoved, modified: s.tablesModified },
    { label: '컬럼', added: s.columnsAdded, removed: s.columnsRemoved, modified: s.columnsModified },
    { label: '제약', added: s.constraintsAdded, removed: s.constraintsRemoved, modified: s.constraintsModified }
  ]
  return groups.filter((g) => g.added + g.removed + g.modified > 0)
}

