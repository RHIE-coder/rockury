import { format } from 'sql-formatter'
import type { TableDef } from '../../workspaces/definition/types'
import type { DialectId } from '../../dialects'

/**
 * Query 에디터 지원 순수 유틸(§ops 향상 — Query).
 * introspection TableDef[] → CodeMirror lang-sql 스키마 맵(자동완성), sql-formatter 정형화.
 * 순수 함수 → 테스트 의무 대상.
 */

/** 테이블명 → 컬럼명[] (lang-sql schema 옵션 형식). */
export function buildSchemaMap(tables: TableDef[]): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const t of tables) map[t.name] = t.columns.map((c) => c.name)
  return map
}

const FMT_LANG: Record<DialectId, 'postgresql' | 'mysql' | 'mariadb' | 'sqlite'> = {
  postgresql: 'postgresql',
  mysql: 'mysql',
  mariadb: 'mariadb',
  sqlite: 'sqlite'
}

/** SQL 정형화. 실패(구문 오류 등) 시 원본 그대로 반환(사용자 입력을 잃지 않도록). */
export function formatSql(sql: string, dialect: DialectId): string {
  try {
    return format(sql, { language: FMT_LANG[dialect], keywordCase: 'upper' })
  } catch {
    return sql
  }
}
