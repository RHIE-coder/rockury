/** SQL 카드가 보여 주는 범위 — 고른 테이블 하나 / 스키마 전체 스크립트. */
export type SqlScope = 'table' | 'schema'

/** 파일 이름에 못 쓰는 글자들(Windows 기준이 가장 좁다) + 저장을 실패시키는 제어문자. */
const FORBIDDEN = /[\\/:*?"<>|\x00-\x1f]/g

/**
 * 파일 이름으로 쓸 수 없는 글자를 걷어낸다.
 * 설계·연결 이름은 사람이 자유롭게 적는 값이라 `/`·`:` 가 섞일 수 있고, 그대로 내려받기 이름에
 * 넣으면 OS 마다 다르게 깨진다(경로로 읽히거나 저장이 실패). 비면 부르는 쪽 기본값으로 넘긴다.
 */
export function safeFileName(name: string): string {
  return (
    name
      .replace(FORBIDDEN, '-')
      .replace(/\s+/g, ' ')
      // 앞의 점은 숨김 파일이 되고, 뒤의 점은 Windows 에서 저장이 실패한다.
      .replace(/^[.\s]+/, '')
      .replace(/[.\s]+$/, '')
  )
}

/** SQL 카드 머리·내려받기에 쓰는 파일 이름. 전체 범위면 설계/연결 이름을 쓴다. */
export function sqlFileName(scope: SqlScope, tableName: string, schemaName?: string): string {
  const base =
    scope === 'schema' ? safeFileName(schemaName ?? '') || 'schema' : safeFileName(tableName) || 'table'
  return `${base}.sql`
}
