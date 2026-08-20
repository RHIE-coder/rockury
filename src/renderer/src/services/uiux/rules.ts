import type { Rule, SurfaceContent } from './types'

/**
 * 규칙을 사람 말로.
 *
 * 규칙은 **구조화 데이터**로 저장한다(쿼리·비교·검증이 되어야 하니까). 그런데 구조 그대로 보이면
 * `{ constraints: { maxLength: 254, format: "email" } }` 같은 것이 화면에 뜬다 — 비개발자는 못
 * 읽고, 개발자도 한눈에 안 들어온다. 그래서 **읽는 층에서만** 문장으로 바꾼다.
 *
 * 어휘는 열려 있다(`format` 은 문자열) — 모르는 값은 **그대로 보인다**. 지어낸 말로 바꾸거나
 * 감추면 무엇이 걸린 규칙인지 알 수 없게 된다.
 */

const FORMAT_LABEL: Record<string, string> = {
  email: '이메일 주소',
  url: '주소(URL)',
  number: '숫자',
  tel: '전화번호',
  date: '날짜',
  password: '비밀번호'
}

const WHEN_LABEL: Record<string, string> = {
  change: '입력하는 동안',
  blur: '칸을 벗어날 때',
  submit: '보낼 때'
}

/**
 * 규칙 하나를 문장 목록으로. 빈 규칙이면 빈 배열(부르는 쪽이 "규칙 없음"을 정한다).
 * 문장을 한 덩어리로 잇지 않는 이유: 화면마다 줄바꿈·묶음이 다르고, 목록이면 세기도 쉽다.
 */
export function describeRule(rule: Rule | undefined): string[] {
  if (!rule) return []
  const out: string[] = []
  const c = rule.constraints

  if (c?.format) out.push(`${FORMAT_LABEL[c.format] ?? c.format} 형식이어야 해요`)
  if (c?.minLength !== undefined && c?.maxLength !== undefined) {
    out.push(`${c.minLength}~${c.maxLength}자`)
  } else if (c?.minLength !== undefined) {
    out.push(`${c.minLength}자 이상`)
  } else if (c?.maxLength !== undefined) {
    out.push(`${c.maxLength}자까지`)
  }
  if (c?.pattern) out.push(`정해진 형태와 맞아야 해요 (${c.pattern})`)

  if (rule.validation?.on) {
    const when = WHEN_LABEL[rule.validation.on] ?? rule.validation.on
    out.push(rule.validation.message ? `${when} 알려요: "${rule.validation.message}"` : `${when} 확인해요`)
  } else if (rule.validation?.message) {
    out.push(`어긋나면 "${rule.validation.message}"`)
  }

  const enabled = rule.enabled
  if (enabled?.default === 'disabled') out.push('처음엔 꺼져 있어요')
  if (enabled?.requires === 'all-required') out.push('필수 칸이 다 채워지면 켜져요')
  else if (enabled?.requires === 'valid') out.push('입력이 모두 맞으면 켜져요')
  else if (Array.isArray(enabled?.requires) && enabled.requires.length > 0) {
    out.push(`${enabled.requires.join(' · ')} 가 채워지면 켜져요`)
  }
  if (enabled?.when?.description) out.push(`조건: ${enabled.when.description}`)

  if (rule.note) out.push(rule.note)
  return out
}

/** 규칙이 실제로 무언가를 말하고 있는가 — 빈 껍데기를 목록에 올리지 않기 위한 판정. */
export function hasRule(rule: Rule | undefined): boolean {
  return describeRule(rule).length > 0
}

export interface RuleEntry {
  surfaceId: string
  surfaceName: string
  address: string
  componentId: string
  componentLabel: string
  componentType: string
  rule: Rule
  lines: string[]
}

/**
 * 화면 하나에서 규칙이 붙은 요소를 모은다. **빈 규칙은 빼고** 실제로 말하는 것만 — 빈 껍데기가
 * 목록을 채우면 "규칙이 많다"는 착시가 생긴다.
 */
export function collectRules(
  content: SurfaceContent,
  meta: { surfaceId: string; surfaceName: string; address: string }
): RuleEntry[] {
  const out: RuleEntry[] = []
  for (const section of content.sections ?? []) {
    for (const component of section.components ?? []) {
      const lines = describeRule(component.rule)
      if (lines.length === 0) continue
      out.push({
        ...meta,
        componentId: component.id,
        componentLabel: component.label || component.type,
        componentType: component.type,
        rule: component.rule as Rule,
        lines
      })
    }
  }
  return out
}
