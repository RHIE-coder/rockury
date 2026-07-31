/**
 * 컬럼 타입 → 셀 에디터 종류(§ops 향상 — Data). 순수 → 테스트 의무 대상.
 * 실 DB 네이티브 타입 문자열(varchar(255)/jsonb/timestamptz/tinyint(1)/uuid…)을 분류한다.
 */
export type CellKind = 'json' | 'boolean' | 'date' | 'uuid' | 'number' | 'text'

export function columnKind(type: string): CellKind {
  const t = type.toLowerCase()
  if (/json/.test(t)) return 'json'
  if (/^(bool|boolean|bit)\b/.test(t) || /^tinyint\(1\)/.test(t)) return 'boolean'
  if (/uuid/.test(t)) return 'uuid'
  if (/(date|time|timestamp|year)/.test(t)) return 'date'
  if (/(int|serial|decimal|numeric|real|float|double|money)/.test(t)) return 'number'
  return 'text'
}
