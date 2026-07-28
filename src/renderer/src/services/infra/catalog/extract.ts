import { search } from '@jmespath-community/jmespath'
import { toStatus } from './status'
import type { Discover, NodeStatus, ResponseFormat } from './types'

/** 지금 아는 표현식 문법. 접두어를 두는 덕에 나중에 더해도 카탈로그 형식이 안 바뀐다. */
const KNOWN_PREFIXES = new Set(['jmespath'])

/**
 * 접두어 판정 — 맨 앞이 `이름:` 꼴일 때만 접두어로 본다.
 * JMESPath 에도 `:` 가 나오지만(슬라이스 `[1:2]`, 다중선택 `{a: b}`) 그건 전부 `[`·`{` 뒤라
 * 이 정규식에 걸리지 않는다.
 */
const PREFIX_RE = /^([A-Za-z][A-Za-z0-9_-]*):([\s\S]*)$/

/**
 * 표현식 하나를 평가해 값을 꺼낸다.
 *
 * 표현식은 **코드가 아니라 데이터**다 — 임의 코드를 실행하는 경로가 없어야 가져온 카탈로그를
 * 믿을 수 있다(신뢰 경계). 그래서 JMESPath 를 쓴다.
 */
export function evalExpr(expr: string, data: unknown): unknown {
  const text = String(expr ?? '').trim()
  if (!text) return null

  let body = text
  const m = PREFIX_RE.exec(text)
  if (m) {
    const prefix = m[1]
    if (!KNOWN_PREFIXES.has(prefix)) {
      throw new Error(`모르는 표현식 접두어 '${prefix}' — 지금은 'jmespath' 만 압니다.`)
    }
    body = m[2].trim()
  }
  return search(data as never, body)
}

/** JMESPath 가 따옴표 없이 받아 주는 식별자 — 그 외(한글·하이픈·숫자 시작)는 감싸야 한다. */
const BARE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * 클릭으로 집은 경로(`['Reservations', 0, 'Instances', 0, 'InstanceId']`)를 표현식으로 바꾼다.
 *
 * 탐침 편집기의 "출력에서 클릭하면 표현식이 자동으로 채워진다"가 이 함수 위에 선다.
 * 따옴표 규칙을 사용자가 알 필요 없게 하는 것이 목적이다 — 한글 키·하이픈 키는 그냥 이으면
 * 문법 오류가 나는데, 그걸 사람이 배워서 피하게 만들면 편집기가 있으나 마나다.
 *
 * `wildcardArrays` 는 "목록"을 집을 때 쓴다 — `[0]` 을 `[]` 로 일반화해 전체를 순회하게 한다.
 */
export function pathToExpr(
  segments: (string | number)[],
  opts: { wildcardArrays?: boolean } = {}
): string {
  let out = ''
  for (const seg of segments) {
    if (typeof seg === 'number') {
      out += opts.wildcardArrays ? '[]' : `[${seg}]`
      continue
    }
    const token = BARE_IDENT_RE.test(seg) ? seg : `"${seg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    out += out === '' ? token : `.${token}`
  }
  return out
}

export interface ParsedResponse {
  data?: unknown
  error?: string
}

/**
 * 명령 출력 본문을 값으로 읽는다.
 *
 * `ndjson`(줄마다 JSON 하나)을 따로 두는 이유: 도커가 그렇게 뱉는다. 통짜 JSON 으로 읽으면
 * 첫 줄 뒤에서 문법 오류가 나 "출력이 JSON 이 아니다"로 잘못 보고된다.
 * 실패해도 던지지 않는다 — 어디가 틀렸는지 사용자에게 보여 줘야 한다.
 */
export function parseResponse(text: string, format: ResponseFormat = 'json'): ParsedResponse {
  const body = text.trim()
  if (!body) return { error: '출력이 비어 있습니다.' }

  if (format === 'ndjson') {
    const rows: unknown[] = []
    const lines = body.split(/\r?\n/).filter((l) => l.trim())
    for (const [i, line] of lines.entries()) {
      try {
        rows.push(JSON.parse(line))
      } catch {
        return { error: `${i + 1}번째 줄이 JSON 이 아닙니다: ${line.slice(0, 80)}` }
      }
    }
    return { data: rows }
  }

  try {
    return { data: JSON.parse(body) }
  } catch (e) {
    return {
      error: `출력이 JSON 이 아닙니다(${e instanceof Error ? e.message : e}). 줄마다 JSON 이면 형식을 'ndjson' 으로 두세요.`
    }
  }
}

/** 표현식 결과를 화면·저장에 쓸 문자열로. 없으면 빈 문자열. */
function asText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
}

export interface ExtractedNode {
  externalId: string
  name?: string
  status: NodeStatus
  /** 공급자가 준 원본 상태 문자열. */
  rawStatus: string
  parentExternalId?: string
  /** 대조 1순위 근거(`rockury:node` 태그). */
  designNodeRef?: string
}

export interface ExtractResult {
  nodes: ExtractedNode[]
  /** 노드가 되지 못한 항목과 그 이유 — **조용한 누락 금지.** */
  dropped: { index: number; reason: string }[]
  /** 사전에 없어 '모름'으로 떨어진 원본 상태값들 — 사전에 추가하라는 신호. */
  unknownStatuses: string[]
  /** 목록 자체를 못 찾았을 때의 사유. 이때 nodes 는 빈 배열이다. */
  error?: string
}

const empty = (error: string): ExtractResult => ({
  nodes: [],
  dropped: [],
  unknownStatuses: [],
  error
})

/**
 * 응답 한 덩어리를 노드 목록으로 옮긴다 — 탐침 3단 중 "뽑는다 → 옮긴다".
 *
 * 버리는 항목·모르는 상태·없는 부모를 **전부 결과에 남긴다.** 조용히 빼면 지도가 거짓말을 하고,
 * 사용자는 자기 인프라가 다 보이고 있다고 믿게 된다.
 */
export function extractNodes(discover: Discover, data: unknown): ExtractResult {
  let list: unknown
  try {
    list = evalExpr(discover.list, data)
  } catch (e) {
    return empty(`목록 표현식을 평가하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!Array.isArray(list)) {
    return empty(`목록 표현식 '${discover.list}' 이 배열을 가리키지 않습니다.`)
  }

  const nodes: ExtractedNode[] = []
  const dropped: { index: number; reason: string }[] = []
  const unknown = new Set<string>()
  const { map, statusMap } = discover

  list.forEach((item, index) => {
    let externalId = ''
    try {
      externalId = asText(evalExpr(map.externalId, item)).trim()
    } catch (e) {
      dropped.push({ index, reason: `externalId 표현식 오류: ${e instanceof Error ? e.message : e}` })
      return
    }
    if (!externalId) {
      dropped.push({ index, reason: `externalId 가 비어 노드로 만들 수 없습니다` })
      return
    }

    const pick = (expr: string | undefined): string => {
      if (!expr) return ''
      try {
        return asText(evalExpr(expr, item)).trim()
      } catch {
        return ''
      }
    }

    const rawStatus = map.status ? asText(evalExpr0(map.status, item)) : ''
    const status = toStatus(rawStatus, statusMap)
    if (status.status === 'unknown' && status.raw) unknown.add(status.raw)

    const parent = pick(map.parentExternalId)
    const ref = pick(map.designNodeRef)

    nodes.push({
      externalId,
      name: pick(map.name) || undefined,
      status: status.status,
      rawStatus: status.raw,
      parentExternalId: parent || undefined,
      designNodeRef: ref || undefined
    })
  })

  // 부모 참조는 **여기서 끊지 않는다.** 부모는 대개 다른 탐침 결과에 있다
  // (VPC 는 VPC 탐침이, EC2 는 EC2 탐침이 가져온다) — 이 목록에 없다고 지우면 중첩이 통째로 사라진다.
  // 실제 잇기는 모든 탐침 결과를 합친 뒤 `linkParents` 가 한다.
  return { nodes, dropped, unknownStatuses: [...unknown] }
}

export interface LinkResult {
  nodes: ExtractedNode[]
  /** 어디에도 없는 부모를 가리킨 값들. 그 노드는 버리지 않고 최상위로 올린다. */
  danglingParents: string[]
}

/**
 * 여러 탐침 결과를 합친 뒤 부모-자식을 잇는다.
 *
 * 어디에도 없는 부모를 가리키면 **노드를 버리지 않고 최상위로 올린다** — 부모를 못 찾았다고
 * 자식까지 지우면 사용자 눈엔 리소스가 통째로 사라진 것으로 보인다. 대신 그 사실을 보고한다.
 */
export function linkParents(nodes: ExtractedNode[]): LinkResult {
  const ids = new Set(nodes.map((n) => n.externalId))
  const dangling = new Set<string>()
  const linked = nodes.map((n) => {
    if (n.parentExternalId && !ids.has(n.parentExternalId)) {
      dangling.add(n.parentExternalId)
      return { ...n, parentExternalId: undefined }
    }
    return n
  })
  return { nodes: linked, danglingParents: [...dangling] }
}

/** 상태 표현식은 실패해도 노드를 버리지 않는다 — '모름'으로 두고 넘어간다. */
function evalExpr0(expr: string, item: unknown): unknown {
  try {
    return evalExpr(expr, item)
  } catch {
    return ''
  }
}
