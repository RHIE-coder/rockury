import type { DialectId } from '../dialects'

/**
 * Connection 폼 순수 검증(§CLAUDE.md 테스트 의무). Connection 은 설계 무관이라
 * dbType 은 폼에서 자유 선택 — 설계 방언과의 결합이 없다(그건 Migration 바인딩에서만).
 * sqlite 는 파일 경로(database)만 필수, 나머지는 host/port/user 도 필수.
 */
export type ConnDbType = DialectId

export const DEFAULT_PORTS: Record<ConnDbType, number> = {
  postgresql: 5432,
  mysql: 3306,
  mariadb: 3306,
  sqlite: 0
}

export function defaultPort(dbType: ConnDbType): number {
  return DEFAULT_PORTS[dbType]
}

export function isFileBased(dbType: ConnDbType): boolean {
  return dbType === 'sqlite'
}

export interface ConnFormValues {
  name: string
  dbType: ConnDbType
  host: string
  port: number
  database: string
  user: string
}

export type FieldErrors = Partial<Record<'name' | 'host' | 'port' | 'database' | 'user', string>>

export interface ValidateResult {
  errors: FieldErrors
  ok: boolean
}

export function validateConnForm(v: ConnFormValues): ValidateResult {
  const errors: FieldErrors = {}
  if (!v.name.trim()) errors.name = '이름을 입력하세요'

  if (isFileBased(v.dbType)) {
    if (!v.database.trim()) errors.database = 'DB 파일 경로를 입력하세요'
  } else {
    if (!v.host.trim()) errors.host = '호스트를 입력하세요'
    if (!Number.isInteger(v.port) || v.port < 1 || v.port > 65535)
      errors.port = '포트는 1~65535 사이여야 합니다'
    if (!v.database.trim()) errors.database = '데이터베이스명을 입력하세요'
    if (!v.user.trim()) errors.user = '사용자를 입력하세요'
  }
  return { errors, ok: Object.keys(errors).length === 0 }
}
