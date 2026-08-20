import type { ParamDef } from './types'

/**
 * 파라미터 시그니처
 *
 * **요청은 함수다.** 이 시그니처가 실행 화면의 입력칸을 만들고, 그대로 MCP 응답에 실려
 * AI 가 구현할 때 읽는 문서가 된다(spec §6-J). 그래서 검증도 화면이 아니라 여기 한 곳에
 * 있어야 한다 — 화면마다 흩어지면 새 진입 경로(MCP·재실행)가 규칙을 우회한다.
 */

export interface ParamProblem {
  name: string
  reason: string
}

/** 파라미터 **정의 자체**의 오류(값이 아니라 선언이 잘못된 것). */
export function validateParamDefs(params: ParamDef[]): ParamProblem[] {
  const problems: ParamProblem[] = []
  const seen = new Set<string>()
  for (const p of params) {
    if (!p.name.trim()) {
      problems.push({ name: p.name, reason: '이름이 비어 있습니다.' })
      continue
    }
    if (seen.has(p.name)) {
      problems.push({ name: p.name, reason: `이름 '${p.name}' 이(가) 두 번 선언됐습니다.` })
      continue
    }
    seen.add(p.name)
    if (p.type === 'enum' && (p.enumValues ?? []).length === 0) {
      problems.push({
        name: p.name,
        reason: 'enum 인데 허용 값이 비어 있습니다 — 어떤 값도 통과할 수 없습니다.'
      })
    }
  }
  return problems
}

function typeProblem(p: ParamDef, raw: string): string | null {
  switch (p.type) {
    case 'string':
      return null
    case 'number':
      return Number.isFinite(Number(raw)) && raw.trim() !== '' ? null : `숫자여야 합니다: '${raw}'`
    case 'boolean':
      return raw === 'true' || raw === 'false' ? null : `true 또는 false 여야 합니다: '${raw}'`
    case 'enum': {
      const allowed = p.enumValues ?? []
      return allowed.includes(raw) ? null : `허용 값이 아닙니다: '${raw}' — 허용: ${allowed.join(', ')}`
    }
    case 'object':
    case 'array': {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return `JSON 형식이 아닙니다: '${raw.slice(0, 40)}'`
      }
      const isArray = Array.isArray(parsed)
      if (p.type === 'array' && !isArray) return 'JSON 배열이어야 합니다.'
      if (p.type === 'object' && (isArray || parsed === null || typeof parsed !== 'object'))
        return 'JSON 객체여야 합니다.'
      return null
    }
  }
}

/**
 * 호출 값 검증. 비어 있으면 통과 —
 * **빈 문자열은 "안 넣음"이 아니다.** 일부러 빈 값을 보내는 것과 값을 안 넣은 것은 다른 뜻이다.
 */
export function validateCall(params: ParamDef[], call: Record<string, string>): ParamProblem[] {
  const problems: ParamProblem[] = []
  const known = new Set(params.map((p) => p.name))

  for (const p of params) {
    const raw = call[p.name]
    if (raw === undefined) {
      if (p.required && p.defaultValue === undefined) {
        problems.push({ name: p.name, reason: '필수 파라미터인데 값이 없습니다.' })
      }
      continue
    }
    const reason = typeProblem(p, raw)
    if (reason) problems.push({ name: p.name, reason })
  }

  // 오타가 조용히 무시되면 "왜 안 먹지"로 한참 헤맨다.
  for (const name of Object.keys(call)) {
    if (!known.has(name)) {
      problems.push({ name, reason: `이 요청의 파라미터가 아닙니다 — 허용: ${[...known].join(', ') || '(없음)'}` })
    }
  }
  return problems
}

/** MCP·문서용 직렬화. 빈 칸은 키 자체를 넣지 않는다 — AI 가 읽을 때 잡음이 된다. */
export interface SignatureDoc {
  name: string
  type: string
  required: boolean
  defaultValue?: string
  description?: string
  enumValues?: string[]
}

export function describeSignature(params: ParamDef[]): SignatureDoc[] {
  return params.map((p) => {
    const doc: SignatureDoc = { name: p.name, type: p.type, required: p.required }
    if (p.defaultValue !== undefined) doc.defaultValue = p.defaultValue
    if (p.description) doc.description = p.description
    if (p.type === 'enum' && p.enumValues) doc.enumValues = p.enumValues
    return doc
  })
}
