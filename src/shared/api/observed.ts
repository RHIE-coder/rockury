import type { FieldDef, FieldType } from './types'

/**
 * 관측된 응답에서 **모양**만 뽑는다 — `docs/spec/api-studio.md` § requests.response AC-3,
 * `api-mcp.md` § tools.read AC-3.
 *
 * 왜 본문이 아니라 모양이냐: 응답 본문에는 토큰·개인정보가 들어 있을 수 있다. 사람은 앱에서
 * 본문을 그대로 보지만, **AI 에게 나가는 것은 모양까지**다.
 *
 * 필수여부를 함부로 못 박지 않는다. 한 번 관측한 것으로는
 *   · 값이 `null` 이었다      → 없을 수 있다(`nullable`) — 이건 안다
 *   · 값이 있었다             → **늘 있는지는 모른다**(`unknown`)
 * 모르는 것을 `required` 로 적으면 그 거짓이 그대로 판정 기준이 된다(불변식 ①).
 */

export function typeOf(v: unknown): FieldType {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  const t = typeof v
  if (t === 'number' || t === 'boolean' || t === 'string') return t
  return 'object'
}

function fieldOf(name: string, v: unknown): FieldDef {
  const type = typeOf(v)
  const def: FieldDef = {
    name,
    type,
    // null 을 본 것은 "없을 수 있다"는 관측이다. 나머지는 모른다.
    requiredness: v === null ? 'nullable' : 'unknown'
  }
  const nested = observedShape(v)
  if (nested.length > 0) def.fields = nested
  return def
}

/** 배열 원소들의 키를 합친다 — 첫 원소만 보면 뒤에서 늘어난 필드를 놓친다. */
function mergeElements(items: unknown[]): FieldDef[] {
  const out: FieldDef[] = []
  for (const item of items.slice(0, 50)) {
    for (const f of observedShape(item)) {
      const prev = out.find((x) => x.name === f.name)
      if (!prev) {
        out.push(f)
        continue
      }
      // 원소마다 타입이 다르면 하나로 못 박지 않는다 — null 을 봤다는 사실만 남긴다.
      if (prev.type !== f.type && f.type === 'null') prev.requiredness = 'nullable'
    }
  }
  return out
}

export function observedShape(value: unknown): FieldDef[] {
  if (Array.isArray(value)) {
    const inner = mergeElements(value)
    return inner.length > 0 ? [{ name: '[]', type: 'array', requiredness: 'unknown', fields: inner }] : []
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => fieldOf(k, v))
  }
  return []
}

export interface ParsedBody {
  /** JSON 으로 읽혔나. 아니면 모양을 못 뽑는다(빈 모양과 "JSON 아님"은 다른 뜻이다). */
  json: boolean
  shape: FieldDef[]
}

export function shapeOfBody(body: string): ParsedBody {
  try {
    return { json: true, shape: observedShape(JSON.parse(body)) }
  } catch {
    return { json: false, shape: [] }
  }
}
