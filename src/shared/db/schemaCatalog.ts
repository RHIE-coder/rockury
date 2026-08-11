import type { DialectId } from '../dialects'

/**
 * **설계가 선언한 스키마들** — 설계 단계에서 이름을 정하고 늘리는 일의 순수 규칙.
 *
 * `@shared` 에 있는 이유: 사람이 화면에서 하는 일과 에이전트가 MCP 로 하는 일이 **같은 규칙**을
 * 따라야 한다. 렌더러에만 두었더니 화면으로는 뚫린 막힘이 MCP 쪽엔 그대로 남았다
 * (2026-08-11 사용자 지적: "MCP를 통해서도 만들 수 있는거지?"). 이름 검사·기본값·목록 연산이
 * 두 벌이 되면 한쪽만 고쳐져 조용히 어긋난다.
 *
 * 왜 필요한가: 예전에는 설계가 자기 스키마 이름을 몰랐다. 스키마를 적는 곳이 "표마다 있는
 * 자유 입력 칸" 하나뿐이라 **없는 스키마는 만들 수가 없었고**, 이름을 안 적은 표는 읽을 때
 * `public` 으로 채워졌다. 그래서 MySQL 설계가 있지도 않은 `public` 을 들고 있었고
 * (2026-08-11 사용자 지적: "MySQL에는 public이라는 스키마가 있을리가 없지 않아?"),
 * 실 DB 를 물리지 않으면 설계를 시작할 수도 없었다.
 *
 * **방언 사이의 층 맞춤**(중요 — 여기서 한 번 틀리면 화면 전체가 틀린다):
 * PostgreSQL 의 `schema` 와 MySQL 의 `database` 는 **같은 자리**다. 한 서버 안에 여럿 있고,
 * 연결 하나가 자유롭게 넘나들며 조인·FK 도 건다. 하나 늘리는 무게도 같다
 * (`CREATE SCHEMA auth;` ↔ `CREATE DATABASE app2;`). PostgreSQL 에만 그 **위층**(database)이
 * 하나 더 있는데 그건 연결을 갈아타야 하는 층이라 여기서 다루지 않는다.
 * 그래서 pg·mysql·mariadb 는 **같은 모델**이고, 층 자체가 없는 sqlite 만 예외다.
 */

/** 스키마 층을 선언·편집할 수 있는 방언인가. sqlite 는 층이 없다(`main` 하나로 고정). */
export function supportsSchemas(dialect: DialectId): boolean {
  return dialect !== 'sqlite'
}

/**
 * 새 설계가 처음 들 이름의 **미리 채움값**.
 *
 * PostgreSQL 은 새 데이터베이스에 `public` 이 이미 있으니 그걸 쓴다. sqlite 는 `main` 이
 * 파일 자체를 가리키는 고정 이름이다. MySQL 계열은 정해진 기본 이름이 **없다** — 그래서
 * 설계 이름에서 따온다(2026-08-11 사용자 결정: 미리 채우고 고칠 수 있게).
 */
export function suggestSchemaName(dialect: DialectId, designName: string): string {
  if (dialect === 'postgresql') return 'public'
  if (dialect === 'sqlite') return 'main'
  return toIdentifier(designName) || 'app'
}

/**
 * 사람이 읽는 이름 → 식별자.
 *
 * MySQL 의 데이터베이스 이름은 **디스크의 폴더 이름**이 되어서 `/ \ .` 이 금지되고 64자가
 * 상한이다. 그래서 설계 이름을 그대로 쓸 수 없다("쇼핑몰 코어" · "test-mysql-1"). 한글은
 * utf8mb4 에서 legal 이라 지우지 않고 남긴다 — 지우면 이름이 통째로 사라지는 사용자가 생긴다.
 */
export function toIdentifier(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s.\-/\\]+/g, '_')
    .replace(/[^\p{L}\p{N}_$]/gu, '')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

export interface NameCheck {
  ok: boolean
  /** 사람에게 보일 이유. `ok` 면 빈 문자열. */
  reason: string
}

/** 이 이름을 스키마 이름으로 쓸 수 있나 — 화면이 확인 버튼을 잠그는 근거. */
export function checkSchemaName(name: string, existing: readonly string[]): NameCheck {
  const n = name.trim()
  if (!n) return { ok: false, reason: '이름을 적으세요' }
  if (n.length > 64) return { ok: false, reason: '64자까지' }
  // 폴더 이름이 되는 자리라 이것들은 엔진이 거부한다.
  if (/[.\s/\\]/.test(n)) return { ok: false, reason: '공백과 . / \\ 는 쓸 수 없습니다' }
  if (existing.some((s) => s.toLowerCase() === n.toLowerCase()))
    return { ok: false, reason: '이미 있는 이름' }
  return { ok: true, reason: '' }
}

/**
 * 선언 목록에 더한다. **순서가 뜻을 갖는다** — 첫째가 새 표가 태어날 자리다.
 * 이미 있으면 그대로 둔다(같은 이름을 두 번 만들지 않는다).
 */
export function addSchema(list: readonly string[], name: string): string[] {
  const n = name.trim()
  if (!n || list.some((s) => s.toLowerCase() === n.toLowerCase())) return [...list]
  return [...list, n]
}

/**
 * 이름을 바꾼다 — 목록에서의 **자리를 지킨다**(기본 스키마가 갑자기 딴 것이 되면 안 된다).
 * 목록에 없는 이름을 바꾸라고 하면 아무것도 안 한다.
 */
export function renameSchema(list: readonly string[], from: string, to: string): string[] {
  const t = to.trim()
  if (!t) return [...list]
  return list.map((s) => (s === from ? t : s))
}

/** 목록에서 뺀다. 표가 남아 있는지는 부르는 쪽이 먼저 본다(`schemaTableCounts`). */
export function removeSchema(list: readonly string[], name: string): string[] {
  return list.filter((s) => s !== name)
}

/** 스키마마다 표가 몇 개 앉아 있나 — 지우기를 막고, 목록에 개수를 적는 근거. */
export function schemaTableCounts(
  tables: readonly { schema?: string }[]
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const t of tables) {
    const key = t.schema ?? ''
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * **선언 목록을 확정한다** — 저장된 선언과 표에 실제로 붙어 있는 이름을 합친다.
 *
 * 둘을 합치는 이유: 선언은 표 없이도 존재할 수 있고(방금 만든 빈 스키마), 표는 선언 없이도
 * 존재할 수 있다(가져오기로 들어온 것, 선언 기능 이전 데이터). 어느 한쪽만 보면 화면에서
 * 스키마가 사라진다. 순서는 **선언 먼저**(사람이 정한 순서), 그 뒤에 표에서 발견된 것.
 */
export function resolveSchemas(
  declared: readonly string[],
  tables: readonly { schema?: string }[]
): string[] {
  const out = [...declared]
  const seen = new Set(declared.map((s) => s.toLowerCase()))
  for (const t of tables) {
    const s = t.schema
    if (!s || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    out.push(s)
  }
  return out
}

/**
 * **이 방언에서 말이 안 되는 이름**을 찾는다.
 *
 * 지금 걸리는 것은 하나다: MySQL/MariaDB 설계가 `public` 을 들고 있는 경우. `public` 은
 * PostgreSQL 의 기본 스키마 이름이라 MySQL 서버에는 그런 데이터베이스가 없다. 이 상태로
 * 두면 Migration 이 짝을 하나도 못 찾아 "실 DB 전부 삭제 + 설계 전부 신규"를 계획한다.
 * 옛 기본값(`DEFAULT_SCHEMA = 'public'`)이 방언을 안 보고 채운 흔적이라 앱이 낸 손해다 —
 * 그래서 조용히 두지 않고 화면에서 이름을 고치라고 말한다.
 */
export function schemaIssues(dialect: DialectId, schemas: readonly string[]): string[] {
  if (dialect !== 'mysql' && dialect !== 'mariadb') return []
  return schemas.filter((s) => s.toLowerCase() === 'public')
}

/**
 * **나가는 SQL 에 스키마 이름을 붙일 것인가.**
 *
 * 예전 규칙은 "스키마가 둘 이상일 때만 붙인다"였다. 하나뿐이면 안 붙이는 편이 예전 출력과
 * 글자까지 같아서였는데, 그러면 나간 문이 `ALTER TABLE \`users\`` 라 **어느 데이터베이스에
 * 떨어지는지가 세션 상태(그때 USE 된 DB)에 달린다.** 이름이 확실해진 지금은 붙인다 —
 * 어느 DB 로 가는지가 SQL 자체에 적혀야 엉뚱한 곳에 반영되지 않는다
 * (2026-08-11 사용자 결정). sqlite 는 붙일 층이 없어 언제나 안 붙인다.
 */
export function shouldQualify(
  dialect: DialectId,
  tables: readonly { schema?: string }[]
): boolean {
  if (!supportsSchemas(dialect)) return false
  // 이름을 모르는 표가 섞여 있으면 붙이지 않는다 — 반쯤 한정된 SQL 이 가장 나쁘다
  // (일부는 명시된 DB 로, 나머지는 세션이 붙어 있는 DB 로 흩어진다).
  return tables.length > 0 && tables.every((t) => !!t.schema)
}
