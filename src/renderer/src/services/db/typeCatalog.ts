import type { DialectId } from './dialects'

/**
 * 방언별 타입/디폴트 카탈로그 — 셀 자동완성 제안 + advisory 검증용.
 *
 * 원칙: 카탈로그는 "돕기만 하고 막지 않는다".
 *  - 제안: 편집 중 입력에 매칭되는 항목을 보여준다(대표 파라미터 포함).
 *  - 검증: 카탈로그 밖 타입은 ⚠ 표시만 한다 — extension·domain 등 사용자 정의
 *    타입이 정상일 수 있으므로 차단하지 않는다(advisory).
 */
export interface Suggestion {
  /** 선택 시 셀에 삽입되는 텍스트 (예: 'VARCHAR(255)'). */
  insert: string
  /** 우측에 흐리게 붙는 설명. */
  hint?: string
  /** 권장 항목 — 동순위 매칭에서 상단 정렬 + '권장' 표기. */
  recommended?: boolean
}

// ── 타입 제안 목록 (방언 네이티브 표기) ─────────────────────────────────────

const MYSQL_TYPES: Suggestion[] = [
  { insert: 'BIGINT', hint: '8바이트 정수' },
  { insert: 'BIGINT UNSIGNED', hint: '부호 없는 8바이트 정수 · PK 관례' },
  { insert: 'INT', hint: '4바이트 정수' },
  { insert: 'INT UNSIGNED', hint: '부호 없는 4바이트 정수' },
  { insert: 'SMALLINT', hint: '2바이트 정수' },
  { insert: 'TINYINT', hint: '1바이트 정수' },
  { insert: 'TINYINT(1)', hint: '불리언 관례' },
  { insert: 'DECIMAL(12,2)', hint: '고정 소수점 · 금액' },
  { insert: 'DOUBLE', hint: '8바이트 부동소수점' },
  { insert: 'FLOAT', hint: '4바이트 부동소수점' },
  { insert: 'VARCHAR(255)', hint: '가변 문자열' },
  { insert: 'CHAR(3)', hint: '고정 문자열 · 코드값' },
  { insert: 'TEXT', hint: '~64KB 문자열' },
  { insert: 'MEDIUMTEXT', hint: '~16MB 문자열' },
  { insert: 'LONGTEXT', hint: '~4GB 문자열' },
  { insert: 'DATETIME', hint: '날짜+시각 (타임존 무관)' },
  { insert: 'TIMESTAMP', hint: '날짜+시각 (UTC 저장)' },
  { insert: 'DATE', hint: '날짜만' },
  { insert: 'TIME', hint: '시각만' },
  { insert: 'YEAR', hint: '연도만' },
  { insert: 'JSON', hint: 'JSON 문서' },
  { insert: "ENUM('a','b')", hint: '열거형' },
  { insert: "SET('a','b')", hint: '집합형' },
  { insert: 'BINARY(16)', hint: '고정 바이너리 · UUID 저장 관례' },
  { insert: 'VARBINARY(255)', hint: '가변 바이너리' },
  { insert: 'BLOB', hint: '바이너리 대용량' }
]

// MariaDB 11 — MySQL 호환 + 네이티브 UUID(10.7+)
const MARIADB_TYPES: Suggestion[] = [
  { insert: 'UUID', hint: '네이티브 UUID (10.7+)' },
  ...MYSQL_TYPES
]

const PG_TYPES: Suggestion[] = [
  { insert: 'BIGINT', hint: '8바이트 정수 · PK 관례' },
  { insert: 'INTEGER', hint: '4바이트 정수' },
  { insert: 'SMALLINT', hint: '2바이트 정수' },
  { insert: 'NUMERIC(12,2)', hint: '고정 소수점 · 금액' },
  { insert: 'DOUBLE PRECISION', hint: '8바이트 부동소수점' },
  { insert: 'REAL', hint: '4바이트 부동소수점' },
  { insert: 'BOOLEAN', hint: '참/거짓' },
  { insert: 'VARCHAR(255)', hint: '가변 문자열(상한)' },
  { insert: 'CHAR(3)', hint: '고정 문자열 · 코드값' },
  { insert: 'TEXT', hint: '길이 무제한 문자열', recommended: true },
  { insert: 'TIMESTAMPTZ', hint: '타임존 포함 시각', recommended: true },
  { insert: 'TIMESTAMP', hint: '타임존 없음' },
  { insert: 'DATE', hint: '날짜만' },
  { insert: 'TIME', hint: '시각만' },
  { insert: 'TIMETZ', hint: '타임존 포함 시각만' },
  { insert: 'INTERVAL', hint: '기간' },
  { insert: 'UUID', hint: '고유 식별자' },
  { insert: 'JSONB', hint: '바이너리 JSON · 인덱싱 가능', recommended: true },
  { insert: 'JSON', hint: '텍스트 JSON' },
  { insert: 'BYTEA', hint: '바이너리' },
  { insert: 'INET', hint: 'IPv4/IPv6 주소' },
  { insert: 'CIDR', hint: '네트워크 대역' },
  { insert: 'MACADDR', hint: 'MAC 주소' },
  { insert: 'TEXT[]', hint: '문자열 배열 (모든 타입 + [])' }
]

// SQLite — 타입 어피니티(느슨한 타입). 대표 5종만 제안.
const SQLITE_TYPES: Suggestion[] = [
  { insert: 'INTEGER', hint: '정수 · PK 관례' },
  { insert: 'REAL', hint: '부동소수점' },
  { insert: 'TEXT', hint: '문자열' },
  { insert: 'BLOB', hint: '바이너리' },
  { insert: 'NUMERIC', hint: '수치 어피니티' }
]

export const TYPE_CATALOG: Record<DialectId, Suggestion[]> = {
  mysql: MYSQL_TYPES,
  mariadb: MARIADB_TYPES,
  postgresql: PG_TYPES,
  sqlite: SQLITE_TYPES
}

// ── 디폴트 제안 목록 (자동증가는 방언 네이티브 토큰) ─────────────────────────

const MYSQL_DEFAULTS: Suggestion[] = [
  { insert: 'AUTO_INCREMENT', hint: '자동 증가 · PK', recommended: true },
  { insert: 'CURRENT_TIMESTAMP', hint: '현재 시각' },
  { insert: '(UUID())', hint: 'UUID 생성 · 8.0 식 디폴트' },
  { insert: 'NULL', hint: '명시적 NULL' }
]

const MARIADB_DEFAULTS: Suggestion[] = [
  { insert: 'AUTO_INCREMENT', hint: '자동 증가 · PK', recommended: true },
  { insert: 'CURRENT_TIMESTAMP', hint: '현재 시각' },
  { insert: 'UUID()', hint: 'UUID 생성' },
  { insert: 'NULL', hint: '명시적 NULL' }
]

const PG_DEFAULTS: Suggestion[] = [
  { insert: 'IDENTITY', hint: '자동 증가 — GENERATED AS IDENTITY', recommended: true },
  { insert: 'now()', hint: '현재 시각 (타임존 포함)' },
  { insert: 'gen_random_uuid()', hint: 'UUID 생성' },
  { insert: "'{}'", hint: '빈 배열/JSON 리터럴' },
  { insert: 'NULL', hint: '명시적 NULL' }
]

const SQLITE_DEFAULTS: Suggestion[] = [
  { insert: 'AUTOINCREMENT', hint: '자동 증가 — INTEGER PK', recommended: true },
  { insert: 'CURRENT_TIMESTAMP', hint: '현재 시각 (UTC 텍스트)' },
  { insert: 'NULL', hint: '명시적 NULL' }
]

export const DEFAULT_CATALOG: Record<DialectId, Suggestion[]> = {
  mysql: MYSQL_DEFAULTS,
  mariadb: MARIADB_DEFAULTS,
  postgresql: PG_DEFAULTS,
  sqlite: SQLITE_DEFAULTS
}

/** 방언별 자동증가 토큰 — 새 테이블 템플릿 등에 쓰인다(ddl.ts 가 셋 다 인식). */
export function autoIncrementToken(d: DialectId): string {
  if (d === 'postgresql') return 'IDENTITY'
  if (d === 'sqlite') return 'AUTOINCREMENT'
  return 'AUTO_INCREMENT'
}

// ── 매칭/정렬 ────────────────────────────────────────────────────────────────

/** 순위: 접두 일치 > 부분 일치, 동순위에선 recommended 우선 → 카탈로그 순. */
function rank(s: Suggestion, q: string): number | null {
  if (!q) return s.recommended ? 0 : 1
  const i = s.insert.toUpperCase().indexOf(q.toUpperCase())
  if (i < 0) return null
  return (i === 0 ? 0 : 10) + (s.recommended ? 0 : 1)
}

function suggestFrom(list: Suggestion[], query: string, limit: number): Suggestion[] {
  const q = query.trim()
  return list
    .map((s, idx) => ({ s, r: rank(s, q), idx }))
    .filter((x): x is { s: Suggestion; r: number; idx: number } => x.r != null)
    .sort((a, b) => a.r - b.r || a.idx - b.idx)
    .slice(0, limit)
    .map((x) => x.s)
}

export function typeSuggestions(d: DialectId, query: string, limit = 8): Suggestion[] {
  return suggestFrom(TYPE_CATALOG[d], query, limit)
}

export function defaultSuggestions(d: DialectId, query: string, limit = 8): Suggestion[] {
  return suggestFrom(DEFAULT_CATALOG[d], query, limit)
}

// ── advisory 검증 — 카탈로그 밖 타입 판정 ───────────────────────────────────

/** 별칭 포함 "알려진 베이스 타입" 집합 (advisory 전용 — 완전성보다 오탐 억제). */
const KNOWN_BASE: Record<Exclude<DialectId, 'sqlite'>, Set<string>> = {
  mysql: new Set([
    'TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT', 'DECIMAL', 'NUMERIC',
    'FLOAT', 'DOUBLE', 'DOUBLE PRECISION', 'BIT', 'BOOLEAN', 'BOOL',
    'CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
    'BINARY', 'VARBINARY', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
    'ENUM', 'SET', 'DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR', 'JSON',
    'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON'
  ]),
  mariadb: new Set([
    'TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT', 'DECIMAL', 'NUMERIC',
    'FLOAT', 'DOUBLE', 'DOUBLE PRECISION', 'BIT', 'BOOLEAN', 'BOOL',
    'CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
    'BINARY', 'VARBINARY', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
    'ENUM', 'SET', 'DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'YEAR', 'JSON',
    'UUID', 'INET4', 'INET6', 'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON'
  ]),
  postgresql: new Set([
    'SMALLINT', 'INTEGER', 'INT', 'INT2', 'INT4', 'INT8', 'BIGINT',
    'NUMERIC', 'DECIMAL', 'REAL', 'FLOAT', 'FLOAT4', 'FLOAT8', 'DOUBLE PRECISION', 'MONEY',
    'SMALLSERIAL', 'SERIAL', 'BIGSERIAL', 'BOOLEAN', 'BOOL',
    'CHAR', 'CHARACTER', 'VARCHAR', 'CHARACTER VARYING', 'TEXT',
    'DATE', 'TIME', 'TIMETZ', 'TIMESTAMP', 'TIMESTAMPTZ',
    'TIME WITH TIME ZONE', 'TIME WITHOUT TIME ZONE',
    'TIMESTAMP WITH TIME ZONE', 'TIMESTAMP WITHOUT TIME ZONE', 'INTERVAL',
    'UUID', 'JSON', 'JSONB', 'BYTEA', 'INET', 'CIDR', 'MACADDR', 'MACADDR8',
    'XML', 'TSVECTOR', 'TSQUERY', 'POINT', 'LINE', 'BOX', 'CIRCLE', 'PATH', 'POLYGON',
    'INT4RANGE', 'INT8RANGE', 'NUMRANGE', 'TSRANGE', 'TSTZRANGE', 'DATERANGE'
  ])
}

/** 파라미터/배열/수식어를 걷어낸 베이스 타입명. */
export function normalizeBaseType(type: string): string {
  return type
    .trim()
    .toUpperCase()
    .replace(/\[\s*\]/g, '') // 배열 접미사 (PG)
    .replace(/\([^)]*\)/g, '') // 길이/정밀도/ENUM 값
    .replace(/\s+(UNSIGNED|ZEROFILL)\b/g, '') // MySQL 수식어
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 카탈로그에 알려진 타입인가 — advisory 전용.
 * SQLite 는 타입 어피니티라 어떤 이름도 유효 → 항상 true.
 */
export function isKnownType(d: DialectId, type: string): boolean {
  if (!type.trim()) return true // 빈 값은 별도 UX(placeholder)로 처리
  if (d === 'sqlite') return true
  return KNOWN_BASE[d].has(normalizeBaseType(type))
}
