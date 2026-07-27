import { columnKind } from '../../console/data/cellKind'
import type { Column } from '../definition/types'
import { isVariableCell, naturalKeyLabel } from './seedRows'
import type { SeedRow, SeedSet } from './types'

/**
 * 시드가 정하는 PK 값 만들기(순수) — spec `db-studio.seed.apply-contract` AC-2.
 *
 * **결정적이어야 한다**(같은 입력 → 항상 같은 값). 랜덤이면 반영을 두 번 돌릴 때 값이 달라져
 * 같은 행이 두 벌 생기고, 세 환경을 같은 PK 로 맞추는 목적도 깨진다. 그래서 여기엔
 * `Math.random`·`Date.now` 가 들어오지 않는다.
 */

/**
 * 템플릿 자리표시자 설명 — 화면 안내와 정본이 같은 문구를 쓰도록 여기 둔다.
 * `what` 은 **화면에 그대로 보이는 문장**이다(툴팁이 아니라 본문) — 내부 용어 대신 쉬운 말로 쓴다.
 */
export const PK_TEMPLATE_TOKENS: { token: string; what: string }[] = [
  { token: '{uuid}', what: '이 행만의 UUID — 몇 번 돌려도 같은 값' },
  { token: '{key}', what: '짝짓기 기준 값 — 하이픈으로 이음' },
  { token: '{alias}', what: '그 행의 별칭' },
  { token: '{table}', what: '테이블 이름' }
]

/**
 * 문자열 → 128비트 해시(FNV-1a 를 4개 오프셋으로 굴려 채운다).
 * 왜 표준 UUIDv5(SHA-1)가 아닌가: 렌더러에서 동기 SHA-1 을 쓸 수 없고(WebCrypto 는 비동기),
 * 계획 생성은 순수·동기 함수여야 테스트와 미리보기가 성립한다. **RFC 4122 v5 가 아니라 이 도구의
 * 결정적 UUID** 이며, 목적(환경 간 같은 값·재실행 안정)에는 충분하다. 값 형태만 UUID 를 따른다.
 */
function hash128(input: string): string {
  const offsets = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]
  const parts = offsets.map((seed) => {
    let h = seed >>> 0
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    // 마지막 확산 — 짧은 입력에서 앞자리가 몰리는 것을 줄인다.
    h ^= h >>> 15
    h = Math.imul(h, 0x2545f491) >>> 0
    h ^= h >>> 13
    return (h >>> 0).toString(16).padStart(8, '0')
  })
  return parts.join('')
}

/** 결정적 UUID — 형태는 UUID(8-4-4-4-12), 버전 자리는 `8`(사용자 정의)로 둔다. */
export function deterministicUuid(input: string): string {
  const h = hash128(input)
  const v = `8${h.slice(13, 16)}` // 버전 자리 고정 — 랜덤 v4 와 구별된다
  const n = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${v}-${n}-${h.slice(20, 32)}`
}

/** 이 행의 결정적 씨앗 — 설계·테이블·행 정체성으로 만든다(다른 설계와 값이 겹치지 않게). */
export function pkSeedString(set: Pick<SeedSet, 'designId' | 'tableName' | 'naturalKey'>, row: SeedRow): string {
  const identity = (row.alias ?? '').trim() || naturalKeyLabel(row, set.naturalKey) || row.id
  return `${set.designId}:${set.tableName}:${identity}`
}

/**
 * 템플릿을 값으로 펼친다. 알 수 없는 자리표시자는 **그대로 남긴다** — 조용히 지우면
 * 잘못된 PK 가 만들어지고, 남아 있으면 미리보기에서 사람이 바로 알아본다.
 */
export function renderPkTemplate(
  template: string,
  set: Pick<SeedSet, 'designId' | 'tableName' | 'naturalKey'>,
  row: SeedRow
): string {
  const key = naturalKeyLabel(row, set.naturalKey).replace(/\s*·\s*/g, '-')
  return template
    .replace(/\{uuid\}/g, deterministicUuid(pkSeedString(set, row)))
    .replace(/\{key\}/g, key)
    .replace(/\{alias\}/g, (row.alias ?? '').trim())
    .replace(/\{table\}/g, set.tableName)
}

/**
 * 이 행에 넣을 PK 값들 — `db` 면 아무것도 주지 않는다(DB 가 채운다).
 * `seed` 인데 템플릿이 없으면 셀에 쓴 값을 쓰고, 그 값도 없으면 빈 결과(계획 단계에서 막힌다).
 * PK 가 복합인데 템플릿을 쓰면 **첫 PK 컬럼에만** 적용한다 — 복합 PK 를 한 규칙으로 만드는 건
 * 뜻이 모호해서 허용하지 않는다(나머지는 셀 값).
 */
export function seedPkValues(
  set: Pick<SeedSet, 'designId' | 'tableName' | 'naturalKey' | 'pkStrategy' | 'pkTemplate'>,
  row: SeedRow,
  pkColumns: string[]
): Record<string, string> {
  if ((set.pkStrategy ?? 'db') === 'db') return {}
  const out: Record<string, string> = {}
  const tpl = (set.pkTemplate ?? '').trim()

  pkColumns.forEach((col, i) => {
    const cell = row.values[col]
    if (tpl && i === 0) {
      out[col] = renderPkTemplate(tpl, set, row)
      return
    }
    if (cell != null && cell.trim() !== '') out[col] = cell
  })
  return out
}

/**
 * 규칙에 **모르는 자리표시자**가 있나 — `{uuidd}` 같은 오타를 찾아낸다.
 * `renderPkTemplate` 이 모르는 것을 그대로 남기므로 결과만 보면 사람이 알아채기 어렵다
 * (`{uuidd}` 가 값으로 들어간다). 저작 중에 그 자리에서 알리려고 따로 판정한다.
 */
export function unknownPkTokens(template: string): string[] {
  const known = new Set(PK_TEMPLATE_TOKENS.map((t) => t.token))
  const found = template.match(/\{[^{}]*\}/g) ?? []
  // 중복 제거 — 같은 오타를 여러 번 써도 한 번만 알린다.
  return [...new Set(found.filter((t) => !known.has(t)))]
}

/** 규칙 고르기 목록의 한 줄. `value` 가 곧 저장되는 규칙 문자열(빈 문자열 = 셀에 쓴 값). */
export interface PkRuleOption {
  value: string
  label: string
}

/** 규칙을 손으로 쓰겠다는 선택 — 값이 아니라 **모드**라서 규칙 문자열과 겹치지 않는 키를 쓴다. */
export const PK_RULE_CUSTOM = '__custom__'

/**
 * 이 PK 컬럼에 **고를 수 있는 규칙**(순수) — 자유 입력 대신 목록으로 주기 위한 판정.
 *
 * 왜 목록인가: 실제로 유효한 규칙은 몇 개뿐인데 자유 문자열로 받으면 오타·타입 불일치·상수 규칙
 * (= 모든 행이 같은 PK 가 되어 반영이 터진다) 세 가지 사고가 다 열린다. **고를 수 없게 하는 것**이
 * 고른 뒤 경고하는 것보다 낫다. 여기 있는 규칙은 전부 **행마다 값이 달라진다** — 상수 규칙은
 * 목록에 없다.
 *
 * 타입으로 거른다: 숫자·날짜 PK 에는 문자열을 만들어 줄 규칙이 없으므로 셀 값만 남긴다.
 * `{uuid}` 는 36자라 그보다 짧게 선언된 컬럼에는 내놓지 않는다.
 */
export function pkRuleOptions(column: Column | undefined): PkRuleOption[] {
  const cell: PkRuleOption = { value: '', label: '그리드 셀에 직접 쓴 값' }
  if (!column) return [cell]

  const kind = columnKind(column.type)
  // 문자로 담을 수 있는 PK 에만 규칙이 성립한다(숫자·날짜·불리언·JSON 은 셀 값뿐).
  if (kind !== 'text' && kind !== 'uuid') return [cell]

  const max = declaredLength(column.type)
  const out = [cell]
  if (max == null || max >= 36) out.push({ value: '{uuid}', label: '{uuid} — 이 행만의 UUID' })
  out.push(
    { value: '{key}', label: '{key} — 짝짓기 기준 값' },
    { value: '{alias}', label: '{alias} — 행 별칭' },
    { value: '{table}-{alias}', label: '{table}-{alias} — 테이블 이름 + 별칭' }
  )
  return out
}

/**
 * 규칙이 **행마다 달라지나** — `{uuid}`·`{key}`·`{alias}` 중 하나라도 있어야 한다.
 * `role-fixed` 나 `{table}` 처럼 상수면 모든 행이 같은 PK 를 받아 두 번째 INSERT 부터 터진다.
 * (`{table}` 은 세트 안에서 언제나 같은 값이라 변하는 조각으로 치지 않는다.)
 */
export function pkRuleVariesPerRow(template: string): boolean {
  return /\{(uuid|key|alias)\}/.test(template)
}

/** PK 값이 어디서 오는가 — 규칙 / 그리드 셀 / 아직 아무 데도 없음. */
export type PkValueSource = 'template' | 'cell' | 'none'

export interface PkPreview {
  /** 값이 들어갈 컬럼 — 규칙은 **첫 PK 컬럼**에만 적용된다. */
  column: string
  from: PkValueSource
  /** 실제로 들어갈 값(`from='none'` 이면 빈 문자열). */
  value: string
  /** 규칙에 남은 모르는 자리표시자(오타 신호). */
  unknown: string[]
  /** 값이 컬럼 타입에 안 맞을 때의 안내 문장(맞으면 `null`). */
  typeIssue: string | null
}

/** `char(36)`·`varchar(50)` 처럼 길이가 선언된 문자 타입의 길이. 없으면 `null`. */
function declaredLength(type: string): number | null {
  const m = /\(\s*(\d+)\s*\)/.exec(type)
  return m ? Number(m[1]) : null
}

/**
 * 만들어진 PK 값이 **그 컬럼에 실제로 들어갈 수 있나**(순수).
 *
 * 왜 여기서 미리 보나: 안 맞으면 실패가 반영 단계(트랜잭션 안)에서야 터진다 — 규칙을 쓰는 순간
 * 알려주는 편이 훨씬 싸다. 대표 사고가 `bigint` PK 에 `{uuid}` 를 넣는 것이다.
 * 확실한 것만 잡는다(오탐이 나면 사람이 안내를 안 믿게 된다) — 숫자 컬럼에 숫자가 아닌 값,
 * 그리고 선언된 길이를 넘는 문자열. 변수(`{{NAME}}`)는 반영할 때 채워지므로 판정하지 않는다.
 */
export function pkValueTypeIssue(column: Column | undefined, value: string): string | null {
  if (!column || value === '' || isVariableCell(value)) return null
  const kind = columnKind(column.type)

  if (kind === 'number' && !/^-?\d+(\.\d+)?$/.test(value))
    return `${column.name} 는 숫자 컬럼(${column.type})인데 값이 숫자가 아니에요 — 반영할 때 INSERT 가 실패합니다`

  if (kind === 'text' || kind === 'uuid') {
    const max = declaredLength(column.type)
    if (max != null && value.length > max)
      return `값이 ${value.length}자인데 ${column.name} 는 ${max}자까지예요(${column.type}) — 잘리거나 실패합니다`
  }
  return null
}

/**
 * 저작 화면용 **미리보기**(순수) — 이 행의 PK 에 무엇이 들어가는지 반영 전에 보여준다.
 *
 * 왜 필요한가: 규칙은 자유 문자열이라 화면에 결과가 안 보이면 사용자가 무엇을 만들고 있는지 알 수 없다.
 * 계산은 반영 계획과 **같은 함수**(`seedPkValues`)를 쓴다 — 미리보기와 실제가 갈라지면 미리보기가
 * 거짓말이 된다. `pkStrategy='db'` 면 시드가 PK 를 담지 않으니 `null`(보여줄 것이 없음).
 *
 * `columns` 는 타입 판정용(설계의 컬럼들). 안 주면 타입 검사를 건너뛴다.
 */
export function pkPreview(
  set: Pick<SeedSet, 'designId' | 'tableName' | 'naturalKey' | 'pkStrategy' | 'pkTemplate'>,
  row: SeedRow,
  pkColumns: string[],
  columns: Column[] = []
): PkPreview | null {
  if ((set.pkStrategy ?? 'db') === 'db') return null
  const column = pkColumns[0]
  if (!column) return null

  const tpl = (set.pkTemplate ?? '').trim()
  const value = seedPkValues(set, row, pkColumns)[column] ?? ''
  const from: PkValueSource = value === '' ? 'none' : tpl ? 'template' : 'cell'
  return {
    column,
    from,
    value,
    unknown: tpl ? unknownPkTokens(tpl) : [],
    typeIssue: pkValueTypeIssue(
      columns.find((c) => c.name === column),
      value
    )
  }
}
