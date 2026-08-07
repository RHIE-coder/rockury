import type { DialectId } from '../../dialects'
import { quoteTable } from './sqlBuilder'
import type { TableRef } from '../../schemaRef'

/**
 * "이 표 진짜 없나"를 **DB 에게 직접 묻는다**(§db-remote.data.saved-filter AC-5).
 *
 * 왜 필요한가: 역설계 목록에 없다는 것만으로 저장 필터를 지우면, 계정 권한이 바뀌어 표가
 * 목록에서 빠진 경우까지 **되돌릴 수 없이** 지운다. 앱 입장에서 "권한에 가려짐"과 "없음"은
 * 똑같이 보이기 때문이다. 그래서 짐작하지 않고 한 번 더 물어본다 — 답이 "그런 표 없다"일
 * 때만 지운다.
 */

/** 존재만 확인하는 문 — 행을 하나도 안 읽는다(`WHERE 1=0`). 없으면 그 자리에서 오류가 난다. */
export function buildExistsProbe(dialect: DialectId, table: TableRef): string {
  return `SELECT 1 FROM ${quoteTable(dialect, table)} WHERE 1=0`
}

/**
 * 표가 **없어서** 난 오류인가. 확실할 때만 참 — 모르면 거짓이다(모르면 안 지운다).
 *
 * 일부러 안 잡는 것들: 권한 거부(표는 있다) · 접속 오류(아직 모른다) ·
 * 데이터베이스/스키마 없음(그 안의 표 존재 여부는 별개다) · 컬럼 없음(표는 있다).
 */
export function isTableMissingError(raw: string | null | undefined): boolean {
  const text = (raw ?? '').trim()
  if (!text) return false

  // 표가 아닌 것이 없다는 말은 먼저 걸러 낸다 — 아래 "does not exist" 에 같이 걸리기 때문.
  if (/\b(database|schema|catalog|column)\b[^.]{0,40}(does not exist|doesn't exist|not found)/i.test(text)) return false
  if (/Unknown (database|column|schema)/i.test(text)) return false

  return (
    /Table\s+\S*\s*(doesn't|does not) exist/i.test(text) || // MySQL/MariaDB
    /ER_NO_SUCH_TABLE/i.test(text) ||
    /relation\s+"[^"]*"\s+does not exist/i.test(text) || // PostgreSQL
    /undefined_table|42P01/i.test(text) ||
    /no such table/i.test(text) // SQLite
  )
}
