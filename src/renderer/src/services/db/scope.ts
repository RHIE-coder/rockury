import type { DialectId } from './dialects'
import type { ConnectionDef } from './connections/store'

/**
 * 범위(scope) — 한 연결에서 **지금 보고 있는 스키마들**. 그 모양이 벤더마다 다르다.
 *
 * 갈리는 기준은 UI 취향이 아니라 엔진 제약이다: **한 연결이 한 번에 볼 수 있는 범위가
 * 어느 층에 있나**.
 *  - MySQL/MariaDB — 연결 하나로 여러 database 를 넘나든다(`db1.t JOIN db2.t`, 교차 db FK 도
 *    InnoDB 는 건다). 그래서 다중 선택 대상이 **database** 이고, 그것이 PostgreSQL 의 schema 와
 *    **같은 자리**다. 위층(카탈로그)이 따로 없다.
 *  - PostgreSQL — 연결이 database 하나에 묶인다. 같은 database 안의 schema 는 조인·FK 가 자유롭고,
 *    database 를 넘는 것은 조인도 FK 도 **불가능**하다. 그래서 schema 는 다중 선택,
 *    database 는 **연결을 갈아타는 일**이다(같은 화면에 섞을 수 없다).
 *  - SQLite — 파일 하나가 database 하나. 고를 것이 없다.
 *
 * 정본: §db-remote.scope.
 */
export interface ScopeModel {
  /** 스키마 층을 고를 수 있나. SQLite 는 false — 범위 선택기를 아예 안 그린다. */
  selectable: boolean
  /** 카탈로그(database) 층이 따로 있나 — PostgreSQL 만 true. 고르면 연결을 갈아탄다. */
  hasCatalogLayer: boolean
  /** 다중 선택하는 층을 화면에서 뭐라 부르나 — 벤더가 쓰는 말 그대로. */
  schemaLabel: string
  /** 카탈로그 층의 이름. `hasCatalogLayer` 가 false 면 빈 문자열. */
  catalogLabel: string
}

export function scopeModel(dbType: DialectId): ScopeModel {
  if (dbType === 'postgresql') {
    return { selectable: true, hasCatalogLayer: true, schemaLabel: '스키마', catalogLabel: '데이터베이스' }
  }
  if (dbType === 'mysql' || dbType === 'mariadb') {
    // MySQL 은 database 와 schema 가 같은 말이다 — 화면엔 사용자가 쓰는 말(database)로 적는다.
    return { selectable: true, hasCatalogLayer: false, schemaLabel: '데이터베이스', catalogLabel: '' }
  }
  return { selectable: false, hasCatalogLayer: false, schemaLabel: '', catalogLabel: '' }
}

/**
 * 범위를 한 줄로 — 손잡이에 적을 말. **지금 보고 있는 스키마 이름**을 그대로 쓴다.
 *
 * 예전엔 아무것도 안 골랐을 때 "기본"이라고 적었는데, 사용자가 손잡이를 **못 찾았다**
 * (2026-07-30 실측: "??? 어디있다는거지?"). "기본"은 무엇을 보고 있는지도, 눌러서 뭘 하는지도
 * 안 알려 준다. 그래서 안 골랐을 때도 **실제로 읽고 있는 스키마 이름**(`public` 등)을 보인다 —
 * 아직 읽기 전이라 그것조차 모를 때만 자리 이름(`범위`)으로 둔다.
 */
export function scopeSummary(schemas: readonly string[]): string {
  if (schemas.length === 0) return '범위'
  if (schemas.length === 1) return schemas[0]
  return `${schemas[0]} 외 ${schemas.length - 1}`
}

/**
 * 좁은 손잡이(두 단으로 접힌 자리)에 적을 **짧은 판** — `service1+3`.
 *
 * 처음엔 개수만 적었다(`4`). 그러면 "4개"인지 "4번"인지 애매하고, 무엇보다 **어느 스키마를
 * 보고 있나**에 답을 못 한다(2026-08-18 사용자 지적). 실측해 보니 아랫줄에는 46px 가 비어 있어
 * 이름 하나는 들어간다 — 그래서 위 손잡이의 `public 외 3` 과 **같은 문법의 짧은 판**으로 적는다.
 * 같은 값이 폭에 따라 아예 다른 모양이 되면 눈이 매번 다시 배운다.
 *
 * 이름과 나머지 수를 **따로 낸다.** 한 문자열로 합치면 이름이 길 때 말줄임이 `+3` 을 삼켜
 * 개수가 사라진다 — 화면은 이름만 줄이고 수는 늘 남긴다.
 */
export interface ScopeFace {
  /** 앞에 세울 이름. 볼 것이 하나도 없으면 자리 이름(`범위`) — `scopeSummary` 와 같은 규칙. */
  head: string
  /** 뒤에 붙는 나머지 수. 0 이면 안 붙인다. */
  rest: number
}

/**
 * @param empty 볼 것이 하나도 없을 때 세울 말. **넓은 판과 같은 낱말을 넘겨야 한다** —
 *   같은 값이 폭에 따라 `스키마`/`범위` 로 갈리면 눈이 두 낱말을 따로 배운다.
 */
export function scopeFace(schemas: readonly string[], empty = '범위'): ScopeFace {
  if (schemas.length === 0) return { head: empty, rest: 0 }
  return { head: schemas[0], rest: schemas.length - 1 }
}

/**
 * 설계 범위의 짧은 판 — 안 골랐으면 "전부"이므로 고를 수 있는 것들을 든다.
 * 빈 자리의 말은 `designScopeSummary` 와 같게 `스키마`다(운영부는 `범위`).
 */
export function designScopeFace(
  selected: readonly string[],
  available: readonly string[]
): ScopeFace {
  return scopeFace(selected.length > 0 ? selected : available, '스키마')
}

/**
 * 손잡이 tooltip 에 넣을 줄 — 짧은 판이 이름을 감추므로 **여기서 전부 밝힌다.**
 * 밝힐 것이 없으면 빈 문자열이고, 부르는 쪽이 그 줄을 아예 안 넣는다.
 */
export function scopeNamesLine(schemas: readonly string[]): string {
  return schemas.length === 0 ? '' : `보는 중: ${schemas.join(' · ')}`
}

/**
 * 고른 범위를 정리한다 — 목록에 없는 스키마(지워졌거나 권한이 빠진 것)를 떨어뜨리고,
 * 있는 것들의 순서는 **고를 수 있는 목록의 순서**로 맞춘다.
 * 저장된 범위를 그대로 믿으면 없어진 스키마를 계속 읽으려다 매번 실패한다.
 */
export function reconcileScope(saved: readonly string[], available: readonly string[]): string[] {
  return available.filter((s) => saved.includes(s))
}

/**
 * 손잡이에 보일 스키마들 — 고른 것이 있으면 그것, 없으면 **지금 화면에 실제로 올라온** 스키마들.
 * 범위를 한 번도 안 고른 연결이 대부분이라, 고른 것만 보이면 손잡이가 늘 비어 보인다.
 */
export function shownScope(selected: readonly string[], loadedTables: readonly { schema?: string }[]): string[] {
  if (selected.length > 0) return [...selected]
  const seen = new Set<string>()
  for (const t of loadedTables) if (t.schema) seen.add(t.schema)
  return [...seen].sort()
}

/**
 * 마지막 하나를 끄지 못하게 한 뒤의 다음 범위. 다 끄면 읽을 것이 없어 빈 화면이 되는데,
 * 그것을 "고장"으로 읽는다 — 마지막 하나는 눌러도 그대로 둔다.
 */
export function toggleSchema(current: readonly string[], schema: string): string[] {
  if (current.includes(schema)) {
    if (current.length <= 1) return [...current]
    return current.filter((s) => s !== schema)
  }
  return [...current, schema]
}

/**
 * ── 설계부의 범위 ──────────────────────────────────────────────────────────
 * 운영부와 **개념은 같고 기본값이 다르다.** 연결은 안 고르면 "기본 스키마 하나"만 읽지만
 * (읽어 오는 비용이 실제로 든다), 설계는 이미 손안에 있어 안 고르면 **전부 보인다**.
 * 그래서 "다 끄면 빈 화면" 같은 함정도 없다 — 다 끈 상태가 곧 안 고른 상태다.
 */

/** 이 설계에 실제로 들어 있는 스키마들 — 고를 수 있는 목록. 이름순. */
export function designSchemas(tables: readonly { schema?: string }[]): string[] {
  const seen = new Set<string>()
  for (const t of tables) if (t.schema) seen.add(t.schema)
  return [...seen].sort()
}

/** 범위로 거른 테이블 — 안 골랐으면(빈 배열) 전부. */
export function scopedTables<T extends { schema?: string }>(
  tables: readonly T[],
  schemas: readonly string[]
): T[] {
  if (schemas.length === 0) return [...tables]
  return tables.filter((t) => t.schema && schemas.includes(t.schema))
}

/**
 * 설계 범위 손잡이에 적을 말. 안 골랐으면 스키마 수를 보인다 — "전부"라고만 적으면
 * 몇 갈래가 섞여 있는지, 애초에 고를 것이 있는지가 안 보인다.
 */
export function designScopeSummary(selected: readonly string[], available: readonly string[]): string {
  if (selected.length === 0) return available.length <= 1 ? (available[0] ?? '스키마') : `전체 ${available.length}`
  return scopeSummary(selected)
}

/**
 * 설계 범위 토글 — 마지막 하나를 끄면 **빈 배열(= 전부 보기)** 로 돌아간다.
 * 운영부처럼 "마지막은 못 끈다"로 막지 않는 이유: 여기서 빈 배열은 빈 화면이 아니라 전체다.
 */
export function toggleDesignSchema(
  current: readonly string[],
  schema: string,
  available: readonly string[]
): string[] {
  // 안 고른 상태(=전부)에서 하나를 끄면 "그것만 빼고 전부"가 되어야 한다 —
  // 전부 보이던 화면에서 하나를 껐는데 그것만 남으면 정반대로 읽힌다.
  const base = current.length > 0 ? current : available
  const next = base.includes(schema) ? base.filter((s) => s !== schema) : [...base, schema]
  // 다시 전부가 됐으면 빈 배열로 접는다 — "전부"의 표현을 하나로 유지한다.
  return next.length === available.length ? [] : next
}

/**
 * 이 카탈로그(database)를 보려면 어느 연결로 가야 하나 — PostgreSQL 전용.
 * 같은 서버·같은 포트·같은 계정·같은 방언이면서 그 database 에 붙는 연결을 찾는다.
 * 없으면 `null` — 부르는 쪽이 "만들까요?"를 물어야 한다(말없이 만들지 않는다).
 */
export function findConnectionForCatalog(
  connections: readonly ConnectionDef[],
  from: ConnectionDef,
  catalog: string
): ConnectionDef | null {
  return (
    connections.find(
      (c) =>
        c.dbType === from.dbType &&
        c.host === from.host &&
        c.port === from.port &&
        c.user === from.user &&
        c.database === catalog
    ) ?? null
  )
}

/**
 * 그 카탈로그로 갈 연결이 없을 때 만들 초안 — 자격은 원래 연결에서 그대로 물려받고
 * database 만 바꾼다. 이름은 원래 이름 뒤에 카탈로그를 달아 어디서 갈라져 나왔는지 보이게 한다.
 * (비밀번호는 여기 없다 — 부르는 쪽이 원래 연결에서 꺼내 채운다.)
 */
export function catalogConnectionDraft(
  from: ConnectionDef,
  catalog: string
): Pick<ConnectionDef, 'name' | 'dbType' | 'host' | 'port' | 'database' | 'user' | 'sslEnabled' | 'sslConfig'> {
  return {
    name: `${from.name} · ${catalog}`,
    dbType: from.dbType,
    host: from.host,
    port: from.port,
    database: catalog,
    user: from.user,
    sslEnabled: from.sslEnabled,
    sslConfig: from.sslConfig
  }
}
