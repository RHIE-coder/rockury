import type { SchemaDiff } from '../versions/diff'

/**
 * 드리프트를 **글로** 남기기 위한 순수 변환 — 기준선을 덮기 전에 로그에 적을 문장을 만든다.
 *
 * 왜 필요한가: 기준선을 갱신하면 비교 대상이 사라져 "무엇이 달랐나"를 되짚을 수 없다.
 * 갱신은 되돌릴 수 없는 행위이므로 그 직전의 사실을 문장으로 굳혀 둔다.
 */

/** 로그 한 줄용 요약 — "테이블 2개 추가 · 컬럼 1개 변경". 변화가 없으면 빈 문자열. */
export function summarizeDrift(diff: SchemaDiff): string {
  const s = diff.summary
  const parts: string[] = []
  const add = (label: string, n: number): void => {
    if (n > 0) parts.push(`${label} ${n}개`)
  }
  add('테이블 추가', s.tablesAdded)
  add('테이블 삭제', s.tablesRemoved)
  add('테이블 변경', s.tablesModified)
  add('컬럼 추가', s.columnsAdded)
  add('컬럼 삭제', s.columnsRemoved)
  add('컬럼 변경', s.columnsModified)
  add('제약 추가', s.constraintsAdded)
  add('제약 삭제', s.constraintsRemoved)
  add('제약 변경', s.constraintsModified)
  return parts.join(' · ')
}

export interface DriftGroup {
  label: string
  added: number
  removed: number
  modified: number
}

/**
 * 화면용 묶음 — 같은 사실을 **종류별 세 숫자**로 접는다.
 *
 * `summarizeDrift` 는 로그 한 줄용이라 아홉 항목을 그대로 잇는데, 그 문자열을 화면에 그대로
 * 뒀더니 "테이블 추가 6개 · 테이블 변경 18개 · 컬럼 추가 4개 · …" 스물몇 낱말이 한 줄로 흘러
 * 아무도 안 읽었다(2026-08-10 사용자: "저렇게 계속 나열하면 누가 알아"). 화면은 종류마다
 * `+/−/~` 세 칸으로 접어 눈이 숫자만 훑게 한다.
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

const MARK: Record<string, string> = { added: '+', removed: '-', modified: '~' }

/**
 * 로그 상세용 — 어느 테이블이 어떻게 달랐는지. 요약만 남기면 나중에
 * "무슨 테이블이었더라"를 못 되짚는다(그래서 이름을 적는다).
 *
 * 테이블이 아주 많이 틀어졌을 때를 위해 상한을 둔다 — 로그 한 줄이 화면을 다 먹지 않게.
 */
export function detailDrift(diff: SchemaDiff, limit = 40): string {
  const names = diff.tables.map((t) => `${MARK[t.status] ?? '?'}${t.name}`)
  if (names.length <= limit) return names.join(' ')
  return `${names.slice(0, limit).join(' ')} … 외 ${names.length - limit}개`
}
