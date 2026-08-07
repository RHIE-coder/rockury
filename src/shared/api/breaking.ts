import type { FieldDef, ParamDef, RequestDef, ResponseDef, SpecDef } from './types'

/**
 * 깨지는 변경 판정 — `docs/spec/api-studio.md` § versions.diff.
 *
 * 판정의 전부는 한 문장이다: **기존 호출자가 깨지는가.**
 * 거기서 요청과 응답의 방향이 갈린다 —
 *
 *   요청: 서버가 **더 요구하면** 기존 호출이 거부된다        → 깨짐
 *         (필수 추가 · 선택→필수 · 타입 변경 · enum 축소)
 *   응답: 서버가 **덜 주면** 기존 호출자가 기대한 걸 못 받는다 → 깨짐
 *         (필드 제거 · 타입 변경 · 필수→nullable · 상태 제거)
 *
 * 반대쪽은 전부 안전하다(경고도 아니다). 이 비대칭을 뒤집으면 CASE-apistudio-043 이 실패한다.
 *
 * 이 판정은 버전 컷(versions.diff)과 판정 흡수(contract.accept) **두 곳이 같은 함수를 쓴다** —
 * 규칙이 갈라지면 한쪽만 고쳐진다(CASE-apicontract-033).
 */

export type Direction = 'request' | 'response'
export type Severity = 'breaking' | 'safe'

export interface Change {
  kind: string
  direction: Direction
  /** `요청이름.자리` — 응답은 `요청이름.상태.필드경로`. */
  path: string
  severity: Severity
  detail: string
}

export interface DiffResult {
  changes: Change[]
  breaking: Change[]
  /**
   * 필수여부가 `unknown`(모름)이라 **필수여부 판정에서 뺀** 필드 수.
   * 모르는 것을 안전으로 치지 않기 위해 개수를 결과에 실어 보낸다(spec versions.diff AC-5).
   */
  skippedUnknown: number
}

interface Ctx {
  changes: Change[]
  skippedUnknown: number
}

const add = (
  ctx: Ctx,
  direction: Direction,
  kind: string,
  path: string,
  severity: Severity,
  detail: string
): void => {
  ctx.changes.push({ kind, direction, path, severity, detail })
}

function sameSet(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

// ── 요청(파라미터) ────────────────────────────────────────────────────────

function diffParams(ctx: Ctx, reqName: string, before: ParamDef[], after: ParamDef[]): void {
  const beforeBy = new Map(before.map((p) => [p.name, p]))
  const afterBy = new Map(after.map((p) => [p.name, p]))

  for (const p of after) {
    const path = `${reqName}.${p.name}`
    const prev = beforeBy.get(p.name)
    if (!prev) {
      // 필수를 새로 요구하면 기존 호출이 전부 거부된다. 선택이면 아무도 안 깨진다.
      p.required && p.defaultValue === undefined
        ? add(ctx, 'request', 'param-added-required', path, 'breaking', `필수 파라미터 '${p.name}' 이(가) 새로 생겼습니다.`)
        : add(ctx, 'request', 'param-added-optional', path, 'safe', `선택 파라미터 '${p.name}' 이(가) 추가됐습니다.`)
      continue
    }
    if (prev.type !== p.type) {
      add(ctx, 'request', 'param-type-changed', path, 'breaking', `타입이 ${prev.type} → ${p.type} 로 바뀌었습니다.`)
    }
    if (!prev.required && p.required && p.defaultValue === undefined) {
      add(ctx, 'request', 'param-required-tightened', path, 'breaking', '선택에서 필수로 바뀌었습니다.')
    } else if (prev.required && !p.required) {
      add(ctx, 'request', 'param-required-loosened', path, 'safe', '필수에서 선택으로 바뀌었습니다.')
    }
    if (p.type === 'enum' && prev.type === 'enum' && !sameSet(prev.enumValues, p.enumValues)) {
      const removed = (prev.enumValues ?? []).filter((v) => !(p.enumValues ?? []).includes(v))
      removed.length > 0
        ? add(ctx, 'request', 'param-enum-narrowed', path, 'breaking', `허용 값이 사라졌습니다: ${removed.join(', ')}`)
        : add(ctx, 'request', 'param-enum-widened', path, 'safe', '허용 값이 늘었습니다.')
    }
  }

  for (const p of before) {
    if (afterBy.has(p.name)) continue
    // 서버가 덜 요구하는 쪽이다 — 기존 호출은 여분 값을 보낼 뿐 그대로 통과한다.
    add(ctx, 'request', 'param-removed', `${reqName}.${p.name}`, 'safe', `파라미터 '${p.name}' 이(가) 없어졌습니다.`)
  }
}

// ── 응답(필드) ────────────────────────────────────────────────────────────

function diffFields(ctx: Ctx, base: string, before: FieldDef[], after: FieldDef[]): void {
  const beforeBy = new Map(before.map((f) => [f.name, f]))
  const afterBy = new Map(after.map((f) => [f.name, f]))

  for (const f of after) {
    const path = `${base}.${f.name}`
    const prev = beforeBy.get(f.name)
    if (!prev) {
      add(ctx, 'response', 'field-added', path, 'safe', `응답 필드 '${f.name}' 이(가) 추가됐습니다.`)
      continue
    }
    if (prev.type !== f.type) {
      // 필수여부를 몰라도 타입이 바뀐 건 안다 — 제외는 필수여부에만 걸린다.
      add(ctx, 'response', 'field-type-changed', path, 'breaking', `타입이 ${prev.type} → ${f.type} 로 바뀌었습니다.`)
    }
    if (prev.requiredness === 'unknown' || f.requiredness === 'unknown') {
      ctx.skippedUnknown += 1
    } else if (prev.requiredness === 'required' && f.requiredness === 'nullable') {
      add(ctx, 'response', 'field-loosened', path, 'breaking', '늘 있던 값이 없을 수도 있게 바뀌었습니다.')
    } else if (prev.requiredness === 'nullable' && f.requiredness === 'required') {
      add(ctx, 'response', 'field-tightened', path, 'safe', '없을 수도 있던 값이 늘 있게 됐습니다.')
    }
    if (!sameSet(prev.enumValues, f.enumValues)) {
      // 응답에서 값이 늘든 줄든 호출자는 여전히 문자열을 받는다 — spec AC-4.
      add(ctx, 'response', 'field-enum-changed', path, 'safe', '응답 값 목록이 바뀌었습니다.')
    }
    diffFields(ctx, path, prev.fields ?? [], f.fields ?? [])
  }

  for (const f of before) {
    if (afterBy.has(f.name)) continue
    add(ctx, 'response', 'field-removed', `${base}.${f.name}`, 'breaking', `응답 필드 '${f.name}' 이(가) 사라졌습니다.`)
  }
}

function diffResponses(ctx: Ctx, reqName: string, before: ResponseDef[], after: ResponseDef[]): void {
  const beforeBy = new Map(before.map((r) => [r.status, r]))
  const afterBy = new Map(after.map((r) => [r.status, r]))

  for (const r of after) {
    const prev = beforeBy.get(r.status)
    if (!prev) {
      add(ctx, 'response', 'status-added', `${reqName}.${r.status}`, 'safe', `상태 ${r.status} 가 추가됐습니다.`)
      continue
    }
    diffFields(ctx, `${reqName}.${r.status}`, prev.fields, r.fields)
  }
  for (const r of before) {
    if (afterBy.has(r.status)) continue
    add(ctx, 'response', 'status-removed', `${reqName}.${r.status}`, 'breaking', `상태 ${r.status} 가 사라졌습니다.`)
  }
}

// ── 명세 전체 ─────────────────────────────────────────────────────────────

export function diffSpecs(before: SpecDef, after: SpecDef): DiffResult {
  const ctx: Ctx = { changes: [], skippedUnknown: 0 }
  const beforeBy = new Map(before.requests.map((r) => [r.name, r]))
  const afterBy = new Map(after.requests.map((r) => [r.name, r]))

  for (const r of after.requests) {
    const prev = beforeBy.get(r.name)
    if (!prev) {
      add(ctx, 'request', 'request-added', r.name, 'safe', `요청 '${r.name}' 이(가) 추가됐습니다.`)
      continue
    }
    diffParams(ctx, r.name, prev.params, r.params)
    diffResponses(ctx, r.name, prev.responses, r.responses)
    if (prev.docs !== r.docs) {
      add(ctx, 'request', 'docs-changed', r.name, 'safe', '문서가 바뀌었습니다.')
    }
  }
  for (const r of before.requests) {
    if (afterBy.has(r.name)) continue
    add(ctx, 'request', 'request-removed', r.name, 'breaking', `요청 '${r.name}' 이(가) 없어졌습니다.`)
  }

  return {
    changes: ctx.changes,
    breaking: ctx.changes.filter((c) => c.severity === 'breaking'),
    skippedUnknown: ctx.skippedUnknown
  }
}

export function hasBreaking(d: DiffResult): boolean {
  return d.breaking.length > 0
}

/** 사람 승인 게이트에 보일 요약 한 줄 — 무엇이 왜 깨지는지가 항목별로 필요하다(불변식 ⑧). */
export function breakingSummary(d: DiffResult): string {
  if (d.breaking.length === 0) return '깨지는 변경 없음'
  return `깨지는 변경 ${d.breaking.length}건 — ${d.breaking.map((c) => c.path).join(', ')}`
}

interface RequestLike extends Pick<RequestDef, 'name' | 'params' | 'responses' | 'docs'> {}
/** 요청 하나만 비교하고 싶을 때(판정 흡수 미리보기). */
export function diffRequest(before: RequestLike, after: RequestLike): DiffResult {
  const wrap = (r: RequestLike): SpecDef => ({
    id: 's',
    name: 's',
    description: '',
    docs: '',
    kind: 'rest',
    requests: [{ id: r.name, folder: '', shape: 'unary', request: {}, ...r }]
  })
  return diffSpecs(wrap(before), wrap(after))
}
