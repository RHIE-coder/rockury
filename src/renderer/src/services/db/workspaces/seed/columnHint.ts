import { KIND_LABEL, typeLabel } from '../../remote/data/columnMeta'
import { checkColumnIds, keyBadgesOf } from '../definition/derive'
import { fkRefText } from '../definition/fkPolicy'
import type { Column, KeyType, TableDef } from '../definition/types'
import { isAutoIncrement } from './seedSet'

/**
 * 시드 그리드 **컬럼 머리 힌트**(순수) — 시드 행을 쓰는 자리에서 그 컬럼의 제약을 바로 보이게 한다.
 * (없으면 Definition 화면과 Seed 화면을 왕복해야 어떤 컬럼이 FK 인지·비워도 되는지 알 수 있다.)
 *
 * 표기 규칙은 서비스 공통 불변식을 따른다 — `PK`·`FK`·`UK`·`IDX`·`CHK` **텍스트 배지만**(이모지 금지),
 * 복합 제약은 위치 번호를 붙인다(`PK1`·`PK2`). 파생 로직은 Definition 의 정본
 * (`derive.keyBadgesOf`·`fkPolicy.fkRefText`·`derive.checkColumnIds`)을 재사용한다.
 */

/** 컬럼 머리 키 배지 하나 — 색은 `ui/badge` 의 종류별 variant 를 쓴다(서비스 공통 색 정본). */
export interface SeedKeyBadge {
  kind: KeyType
  /** 복합 제약에서의 1-based 위치(단일이면 undefined). */
  pos?: number
  /** 화면 표기 — `PK` · `UK1`. */
  label: string
}

export interface SeedColumnHint {
  name: string
  /** 헤더 둘째 줄 타입 라벨(소문자 정리). */
  typeLabel: string
  /** 종류·위치가 담긴 키 배지(색은 종류로 정해진다). */
  badges: SeedKeyBadge[]
  /** 어느 CHECK 라도 이 컬럼을 참조하면 true → `CHK` 마커. */
  hasCheck: boolean
  /** 시드가 **반드시 채워야 하는** 컬럼: NOT NULL + 기본값 없음 + 자동증가 아님. */
  required: boolean
  /** 마우스를 올렸을 때 보일 상세(여러 줄) — 화면을 왕복하지 않게 여기 다 담는다. */
  detail: string
}

/** NOT NULL 인데 기본값도 없고 자동증가도 아니면 시드가 값을 주지 않으면 INSERT 가 실패한다. */
export function isRequiredForSeed(col: Column): boolean {
  if (col.nullable) return false
  if (isAutoIncrement(col)) return false
  return col.defaultValue == null || col.defaultValue.trim() === ''
}

/** 시드가 반드시 채워야 하는 컬럼 이름들(설계 컬럼 순서). */
export function requiredSeedColumns(table: TableDef): string[] {
  return table.columns.filter(isRequiredForSeed).map((c) => c.name)
}

function detailOf(table: TableDef, col: Column, badges: SeedKeyBadge[], hasCheck: boolean): string {
  const lines: string[] = [`${col.name} · ${typeLabel(col.type)}`]

  const nullPart = col.nullable ? 'NULL 허용' : 'NOT NULL'
  const defPart = isAutoIncrement(col)
    ? '자동증가'
    : col.defaultValue == null || col.defaultValue.trim() === ''
      ? '기본값 없음'
      : `기본값 ${col.defaultValue}`
  lines.push(`${nullPart} · ${defPart}${isRequiredForSeed(col) ? ' → 시드가 채워야 함' : ''}`)

  if (badges.length) lines.push(`제약 ${badges.map((b) => b.label).join(' · ')}${hasCheck ? ' · CHK' : ''}`)
  else if (hasCheck) lines.push('제약 CHK')

  // FK 는 어디를 가리키는지가 핵심이다 — 정책까지 붙여 보인다(fkPolicy 정본 표기).
  for (const con of table.constraints) {
    if (con.kind !== 'fk') continue
    if (!con.columns.some((r) => r.columnId === col.id)) continue
    const ref = fkRefText(con, true)
    if (ref) lines.push(`FK ${ref}`)
  }

  for (const con of table.constraints) {
    if (con.kind !== 'check' || !con.expression) continue
    if (!checkColumnIds(table).has(col.id)) continue
    lines.push(`CHECK ${con.expression}`)
    break
  }

  if (col.comment.trim()) lines.push(`설명: ${col.comment.trim()}`)
  return lines.join('\n')
}

/** 테이블의 컬럼 순서대로 헤더 힌트를 만든다. */
export function seedColumnHints(table: TableDef): SeedColumnHint[] {
  const keyBadges = keyBadgesOf(table)
  const checkIds = checkColumnIds(table)

  return table.columns.map((col) => {
    const badges: SeedKeyBadge[] = (keyBadges.get(col.id) ?? []).map((b) => ({
      kind: b.kind,
      pos: b.pos,
      label: `${KIND_LABEL[b.kind]}${b.pos ?? ''}`
    }))
    const hasCheck = checkIds.has(col.id)
    return {
      name: col.name,
      typeLabel: typeLabel(col.type),
      badges,
      hasCheck,
      required: isRequiredForSeed(col),
      detail: detailOf(table, col, badges, hasCheck)
    }
  })
}
