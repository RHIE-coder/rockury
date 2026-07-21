import type { DialectId } from '../dialects'

/**
 * Environment 폼 순수 검증 로직(§CLAUDE.md 테스트 의무 대상 — 입력→출력 결정적).
 *
 * 핵심 불변식: **Environment.dbType 은 소속 Design.dialect 와 일치해야 한다**(§IA 결정
 * "dialect ⊂ Design" — 전 환경 동일 벤더가 구조적으로 보장, Env 생성 시 벤더 일치 검증이 공짜).
 * sqlite 는 파일 경로(database)만 필수고 host/port/user 는 무의미하다.
 */
export type EnvDbType = DialectId

/** 벤더 기본 포트. sqlite 는 파일 기반이라 포트 없음(0). */
export const DEFAULT_PORTS: Record<EnvDbType, number> = {
  postgresql: 5432,
  mysql: 3306,
  mariadb: 3306,
  sqlite: 0
}

export function defaultPort(dbType: EnvDbType): number {
  return DEFAULT_PORTS[dbType]
}

/** 파일 기반(네트워크 접속 필드 무의미) 벤더인가. */
export function isFileBased(dbType: EnvDbType): boolean {
  return dbType === 'sqlite'
}

export interface EnvFormValues {
  name: string
  dbType: EnvDbType
  host: string
  port: number
  database: string
  user: string
}

/** 필드별 에러 메시지 (필드명 → 메시지). 비어 있으면 유효. */
export type FieldErrors = Partial<Record<'name' | 'dbType' | 'host' | 'port' | 'database' | 'user', string>>

export interface ValidateResult {
  errors: FieldErrors
  ok: boolean
}

/**
 * 환경 폼 검증. `designDialect` 를 주면 벤더 일치 불변식을 함께 검사한다.
 */
export function validateEnvForm(
  v: EnvFormValues,
  opts: { designDialect?: EnvDbType } = {}
): ValidateResult {
  const errors: FieldErrors = {}

  if (!v.name.trim()) errors.name = '이름을 입력하세요'

  if (opts.designDialect && v.dbType !== opts.designDialect) {
    errors.dbType = `이 설계의 벤더(${opts.designDialect})와 일치해야 합니다`
  }

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
