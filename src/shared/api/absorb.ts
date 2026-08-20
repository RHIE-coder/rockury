import { diffSpecs, type DiffResult } from './breaking'
import { shapeOfBody } from './observed'
import type { FieldDef, RunRecord, SpecDef } from './types'

/**
 * 판정 결과를 명세로 흡수
 *
 * **더하기만 한다.** 이미 선언된 것은 타입도 필수여부도 손대지 않는다 —
 * 실제가 옳다고 단정할 근거가 없기 때문이다(서버가 버그일 수도 있다).
 * 그래서 흡수는 `server-only`(서버에만 있음)만 대상이고, `spec-only`·`different` 는
 * **고칠 목록**으로 따로 나간다(코드를 고쳐야 하는 쪽이다).
 *
 * 결과는 항상 **미리보기**다 — 수락하기 전에는 Draft 가 안 바뀐다.
 */

export interface AbsorbChange {
  /** `요청.상태` 또는 `요청.상태.필드경로` */
  path: string
  detail: string
}

export interface AbsorbPreview {
  /** 흡수를 적용한 **사본**. 수락하기 전에는 이걸 저장하지 않는다. */
  spec: SpecDef
  changes: AbsorbChange[]
  /**
   * 흡수가 깨지는 변경을 만드는가.
   * 버전 diff 와 **같은 함수**로 판정한다 — 규칙이 두 곳에 갈라지면 한쪽만 고쳐진다.
   */
  diff: DiffResult
}

/** 관측된 필드 중 선언에 없는 것만 골라 더한다(재귀). 선언된 것은 건드리지 않는다. */
function mergeFields(
  declared: FieldDef[],
  observed: FieldDef[],
  base: string,
  changes: AbsorbChange[]
): FieldDef[] {
  const out = declared.map((d) => ({ ...d }))
  for (const o of observed) {
    const existing = out.find((d) => d.name === o.name)
    if (!existing) {
      out.push(structuredClone(o))
      changes.push({
        path: `${base}.${o.name}`,
        detail: `응답 필드 '${o.name}' (${o.type}) 을(를) 명세에 더합니다.`
      })
      continue
    }
    // 타입이 다르면 흡수 대상이 아니다 — 그건 '다름'이고 사람이 판단할 몫이다.
    if (existing.type !== o.type) continue
    if (o.fields?.length) {
      existing.fields = mergeFields(existing.fields ?? [], o.fields, `${base}.${o.name}`, changes)
    }
  }
  return out
}

export interface AbsorbInput {
  spec: SpecDef
  runs: readonly RunRecord[]
  /** 흡수할 요청 이름. 비어 있으면 전부. */
  requestNames?: readonly string[]
}

export function previewAbsorb({ spec, runs, requestNames }: AbsorbInput): AbsorbPreview {
  const next: SpecDef = structuredClone(spec)
  const changes: AbsorbChange[] = []
  const wanted = requestNames && requestNames.length > 0 ? new Set(requestNames) : null

  for (const request of next.requests) {
    if (wanted && !wanted.has(request.name)) continue

    const latest = runs
      .filter((r) => r.requestName === request.name && r.response !== null)
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0]
    if (!latest) continue

    const parsed = shapeOfBody(latest.response!.body)
    if (!parsed.json) continue

    const status = String(latest.response!.status)
    const declared = request.responses.find((r) => r.status === status)
    if (!declared) {
      request.responses.push({ status, fields: structuredClone(parsed.shape) })
      changes.push({
        path: `${request.name}.${status}`,
        detail: `상태 ${status} 선언을 새로 만들고 관측된 필드 ${parsed.shape.length}개를 담습니다.`
      })
      continue
    }
    declared.fields = mergeFields(declared.fields, parsed.shape, `${request.name}.${status}`, changes)
  }

  return { spec: next, changes, diff: diffSpecs(spec, next) }
}
