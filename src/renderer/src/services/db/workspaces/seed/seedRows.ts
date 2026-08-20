import { extractKeywords } from '../../remote/query/keywords'
import type { SeedRow } from './types'

/**
 * 시드 **행** 판정(순수) — 자연키 구성·행 검증·변수 추출·행 짝짓기.
 *
 * 변수 문법(`{{NAME}}`)은 저장쿼리 파라미터화와 **같은 정본**(`remote/query/keywords`)을 쓴다 —
 * 사용자가 두 문법을 따로 배우지 않게. bare `{{x}}` 만 변수, `'{{x}}'` 는 리터럴.
 */

/**
 * 자연키 값 — 선언 순서대로 이어 하나의 키 문자열로 만든다.
 * JSON 배열로 인코딩하는 이유: 구분자를 값에 끼워 넣는 방식(`a|b`)은 값 안에 구분자가 있으면
 * 서로 다른 행이 같은 키가 된다. NULL 과 빈 문자열도 이 인코딩에서 구별된다.
 */
export function naturalKeyOf(row: SeedRow, naturalKey: string[]): string {
  return JSON.stringify(naturalKey.map((c) => row.values[c] ?? null))
}

/** 자연키 값들을 사람이 읽는 한 줄로(행 라벨). 빈 값은 `∅`. */
export function naturalKeyLabel(row: SeedRow, naturalKey: string[]): string {
  if (naturalKey.length === 0) return ''
  return naturalKey
    .map((c) => {
      const v = row.values[c]
      return v == null || v === '' ? '∅' : v
    })
    .join(' · ')
}

export type SeedRowIssueKind = 'empty-key' | 'duplicate-key'

export interface SeedRowIssue {
  kind: SeedRowIssueKind
  message: string
}

/**
 * 행 검증 — 행 id → 문제. 자연키 값이 비었거나 다른 행과 겹치는 행을 지목한다
 * (겹치면 **양쪽 다** 지목: 어느 하나만 붉히면 사용자가 어느 쪽을 고쳐야 할지 모른다).
 * 자연키가 선언되지 않은 세트는 판정 근거가 없어 아무 문제도 내지 않는다(세트 자체가 `비교 불가`).
 */
export function validateSeedRows(rows: SeedRow[], naturalKey: string[]): Record<string, SeedRowIssue> {
  const out: Record<string, SeedRowIssue> = {}
  if (naturalKey.length === 0) return out

  const byKey = new Map<string, string[]>()
  for (const r of rows) {
    const empty = naturalKey.some((c) => {
      const v = r.values[c]
      return v == null || v.trim() === ''
    })
    if (empty) {
      out[r.id] = { kind: 'empty-key', message: '짝짓기 기준 값이 비었어요' }
      continue
    }
    const k = naturalKeyOf(r, naturalKey)
    const ids = byKey.get(k)
    if (ids) ids.push(r.id)
    else byKey.set(k, [r.id])
  }
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue
    for (const id of ids) out[id] = { kind: 'duplicate-key', message: '짝짓기 기준 값이 다른 행과 겹쳐요' }
  }
  return out
}

/** 셀 값이 비었는가 — NULL·빈 문자열·공백만. */
const isBlank = (v: string | null | undefined): boolean => v == null || v.trim() === ''

/**
 * 필수 컬럼(NOT NULL·기본값 없음)이 비어 있는 셀 — 행 id → 컬럼 이름들.
 * 이걸 안 보이면 반영 단계에서야 INSERT 가 실패한다(그때는 원인이 어느 행인지도 흐려진다).
 * 변수 자리표시자(`{{X}}`)는 값이 들어올 자리이므로 **채운 것으로 본다**.
 */
export function missingRequiredCells(rows: SeedRow[], required: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (required.length === 0) return out
  for (const r of rows) {
    const missing = required.filter((c) => isBlank(r.values[c]))
    if (missing.length) out[r.id] = missing
  }
  return out
}

/** 셀 값이 통째로 변수 하나면 그 이름, 아니면 null. */
export function variableNameOf(v: string | null): string | null {
  if (typeof v !== 'string') return null
  const m = /^\s*\{\{\s*(\w+)\s*\}\}\s*$/.exec(v)
  return m ? m[1] : null
}

/** 셀 값 하나가 통째로 변수인지 — 그리드가 변수 표식을 달 때 쓴다. */
export function isVariableCell(v: string | null): boolean {
  return variableNameOf(v) !== null
}

/** 세트의 모든 셀에서 변수 이름을 뽑아 중복 없이 **이름순**으로. */
export function seedVariables(rows: SeedRow[]): string[] {
  const names = new Set<string>()
  for (const r of rows) {
    for (const v of Object.values(r.values)) {
      if (typeof v !== 'string') continue
      for (const n of extractKeywords(v)) names.add(n)
    }
  }
  return [...names].sort()
}

export interface SeedRowMatch {
  key: string
  /** 왼쪽(이전)에만 있으면 target 이 null, 오른쪽(이후)에만 있으면 base 가 null. */
  base: SeedRow | null
  target: SeedRow | null
}

/**
 * 자연키로 두 행 목록을 짝짓는다. 순서는 base 순 → target 에만 있는 행 순.
 * 같은 키가 한 목록에 여럿이면 **첫 행만** 쓴다(중복 자연키는 `validateSeedRows` 가 오류로 지목하는 상태).
 */
export function matchSeedRows(base: SeedRow[], target: SeedRow[], naturalKey: string[]): SeedRowMatch[] {
  const firstBy = (rows: SeedRow[]): Map<string, SeedRow> => {
    const m = new Map<string, SeedRow>()
    for (const r of rows) {
      const k = naturalKeyOf(r, naturalKey)
      if (!m.has(k)) m.set(k, r)
    }
    return m
  }
  const b = firstBy(base)
  const t = firstBy(target)
  const out: SeedRowMatch[] = []
  for (const [key, row] of b) out.push({ key, base: row, target: t.get(key) ?? null })
  for (const [key, row] of t) if (!b.has(key)) out.push({ key, base: null, target: row })
  return out
}
