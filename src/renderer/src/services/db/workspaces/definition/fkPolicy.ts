import type { Constraint, FkAction } from './types'

/**
 * 외래키(FK) 표기의 **단일 정본** — 설계부(Studio)와 운영부(Console)가 같은 문자열·같은 규칙으로
 * FK 를 그리도록 여기 한 곳에서만 만든다(순수 함수 → 테스트 의무).
 *
 * 통일 규칙:
 *  1. 참조 대상은 `테이블 (컬럼[, 컬럼])` 한 형태로만 쓴다(`users.id` 식 축약 금지).
 *  2. ON DELETE / ON UPDATE 는 **항상 둘 다** 보인다 — 안 보이면 "제약이 없는 것"으로 오독된다.
 *  3. 값이 없으면 SQL 기본값 NO ACTION 을 채우되 `implicit` 로 표시해 흐리게 그린다.
 *     (설계부가 미지정을 RESTRICT 로 보여주던 표기는 DDL 생성 결과와 어긋나 폐기 —
 *      ddl.ts 는 값이 없으면 절을 아예 안 쓰므로 실제로는 DB 기본값 NO ACTION 이 걸린다.)
 *  4. 흐림만으로는 "값이 빠졌다"로 오독된다 → 흐린 칩에는 **왜 흐린지 `note` 를 눈에 보이게** 붙인다.
 *     `미지정`(설계부에서 아직 안 고름) / `기본값`(값은 있고 그게 DB 기본 동작)로 나눈다.
 *     운영부(Console)는 카탈로그가 "안 썼음"과 "NO ACTION 이라 썼음"을 구분해 저장하지 않으므로
 *     (postgres `confupdtype='a'`, mysql `NO ACTION`) 항상 `기본값` 쪽이다 — 미지정이라 단정하지 않는다.
 */

/** FK 정책을 명시하지 않았을 때 DB 가 적용하는 값. */
export const IMPLIED_FK_ACTION: FkAction = 'NO ACTION'

export type FkPolicyKind = 'ON DELETE' | 'ON UPDATE'

export interface FkPolicyChip {
  kind: FkPolicyKind
  value: FkAction
  /** 화면에 그대로 찍는 문자열 — `ON DELETE CASCADE`. */
  label: string
  /** 제약에 값이 없거나 NO ACTION 이라 "특별한 정책이 아님" — 흐리게 그린다. */
  implicit: boolean
  /** 제약에 값 자체가 없다(설계부에서 아직 안 고름). 운영부는 카탈로그가 채워 주므로 항상 false. */
  unset: boolean
  /** 흐린 이유를 화면에 같이 찍는 짧은 꼬리표 — `미지정` / `기본값`. 흐리지 않으면 없음. */
  note?: string
  /** 마우스를 올렸을 때의 설명(쉬운 말). */
  hint: string
}

const HINT: Record<FkPolicyKind, Record<FkAction, string>> = {
  'ON DELETE': {
    'NO ACTION': '부모 행을 지우려 하면 막습니다(기본 동작).',
    RESTRICT: '자식 행이 있으면 부모 행 삭제를 막습니다.',
    CASCADE: '부모 행을 지우면 자식 행도 같이 지웁니다.',
    'SET NULL': '부모 행을 지우면 자식의 이 값을 NULL 로 바꿉니다.',
    'SET DEFAULT': '부모 행을 지우면 자식의 이 값을 기본값으로 바꿉니다.'
  },
  'ON UPDATE': {
    'NO ACTION': '부모 키를 바꾸려 하면 막습니다(기본 동작).',
    RESTRICT: '자식 행이 있으면 부모 키 변경을 막습니다.',
    CASCADE: '부모 키가 바뀌면 자식 값도 같이 바꿉니다.',
    'SET NULL': '부모 키가 바뀌면 자식의 이 값을 NULL 로 바꿉니다.',
    'SET DEFAULT': '부모 키가 바뀌면 자식의 이 값을 기본값으로 바꿉니다.'
  }
}

const chip = (kind: FkPolicyKind, raw: FkAction | undefined): FkPolicyChip => {
  const value = raw ?? IMPLIED_FK_ACTION
  const unset = raw == null
  const implicit = unset || value === IMPLIED_FK_ACTION
  return {
    kind,
    value,
    label: `${kind} ${value}`,
    implicit,
    unset,
    note: unset ? '미지정' : implicit ? '기본값' : undefined,
    hint: unset
      ? `지정하지 않았습니다 — DB 기본값 ${value} 이 적용됩니다. ${HINT[kind][value]}`
      : implicit
        ? `${HINT[kind][value]} 특별히 다른 정책을 건 게 아닙니다.`
        : HINT[kind][value]
  }
}

/** FK 의 두 정책 칩(ON DELETE, ON UPDATE) — 순서 고정. fk 가 아니면 빈 배열. */
export function fkPolicyChips(con: Constraint): FkPolicyChip[] {
  if (con.kind !== 'fk') return []
  return [chip('ON DELETE', con.onDelete), chip('ON UPDATE', con.onUpdate)]
}

/** 참조 대상 표기 — `users (id)` / `orders (org_id, no)`. 대상이 없으면 `?`. */
export function fkTargetLabel(con: Constraint): string {
  if (con.kind !== 'fk') return ''
  const cols = (con.refColumns ?? []).filter(Boolean)
  const table = con.refTable || '?'
  return cols.length > 0 ? `${table} (${cols.join(', ')})` : `${table} (?)`
}

/**
 * 한 줄 텍스트 표기 — 목록처럼 컴포넌트를 못 쓰는 좁은 자리용.
 * `withPolicies` 면 정책까지 붙인다: `→ users (id) · ON DELETE CASCADE · ON UPDATE NO ACTION`.
 */
export function fkRefText(con: Constraint, withPolicies = false): string | undefined {
  if (con.kind !== 'fk' || !con.refTable) return undefined
  const head = `→ ${fkTargetLabel(con)}`
  if (!withPolicies) return head
  return [head, ...fkPolicyChips(con).map((p) => p.label)].join(' · ')
}
