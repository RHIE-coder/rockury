import type { ActionDef, ProbeCall } from './types'

/**
 * 액션 버튼의 **순수 계산** — 인자 검사 · 잠금 판정 · 치환값 만들기 · 명령 미리보기.
 *
 * 왜 버튼인가(D9): 노드에 "접근"하는 일의 대부분은 정해진 명령 한 줄이다. 터미널을 붙이면
 * 네이티브 모듈(PTY)이 필요하고 프로젝트 규칙과 부딪힌다. 그리고 Supabase·Vercel·Cloudflare 처럼
 * **셸에 붙을 기계가 아예 없는** 대상은 버튼이 유일한 길이다.
 *
 * 실행은 메인(`infra:runAction`)이 한다. 잠금은 **여기서 판정하고 메인에서 다시 강제한다** —
 * 화면에서만 막으면 그건 잠금이 아니라 권유다.
 */

/** 실행에 필요한 실물 정보 — 액션 명령의 `{{node.*}}` 가 여기서 채워진다. */
export interface ActionTarget {
  externalId: string
  name: string
  typeId: string
}

export type ArgCheck =
  | { ok: true; values: Record<string, string> }
  | { ok: false; missing: string[] }

/**
 * 폼 값이 인자 스키마를 만족하나.
 *
 * **스키마에 없는 값은 버린다** — 카탈로그가 선언한 것만 명령에 들어가야 한다.
 * 선택 인자는 비어도 통과시키되 **빈 문자열로 채운다**: 자리표시자에 값이 아예 없으면
 * 치환기가 던지므로(의도된 동작), 선택 인자를 안 채웠다는 이유로 실행이 막히면 안 된다.
 */
export function checkArgs(action: ActionDef, raw: Record<string, string>): ArgCheck {
  const schema = action.args ?? []
  const missing: string[] = []
  const values: Record<string, string> = {}
  for (const a of schema) {
    const v = (raw[a.id] ?? '').trim()
    if (!v && a.required) missing.push(a.label)
    values[a.id] = v
  }
  return missing.length ? { ok: false, missing } : { ok: true, values }
}

/**
 * 이 액션을 지금 못 돌리는 이유. 돌릴 수 있으면 `null`.
 *
 * 읽기 전용 표시는 **보조선**이다(진짜 통제는 클라우드 쪽 권한 설정) — 그래도 표시해 둔 연결에서
 * 위험한 액션이 그냥 눌리면 그 표시는 장식이 된다.
 */
export function actionBlockReason(
  action: ActionDef,
  provider: { readOnly: boolean } | null
): string | null {
  if (!provider) return '먼저 공급자 연결을 고르세요 — 어디에 대고 돌릴지가 없습니다.'
  if (action.danger && provider.readOnly) {
    return '이 연결은 읽기 전용으로 표시돼 있어 실물을 바꾸는 액션이 잠겨 있습니다.'
  }
  return null
}

/**
 * 명령에 채워질 값들. **`node` 와 `arg` 를 따로 둔다** —
 * 한 바구니에 담으면 폼에 `name` 을 넣는 순간 실물 이름을 덮어써, 엉뚱한 대상에 명령이 나간다.
 */
export function actionVars(
  target: ActionTarget,
  args: Record<string, string>
): { node: Record<string, string>; arg: Record<string, string> } {
  return {
    node: { externalId: target.externalId, name: target.name, typeId: target.typeId },
    arg: { ...args }
  }
}

/** 실행 전에 보여 줄 명령 한 줄. 자격증명은 참조 그대로 남는다(치환 전 형태). */
export function describeAction(action: ActionDef): string {
  const call: ProbeCall = action.call
  if (call.type === 'cli') return [call.cmd, ...call.args].join(' ')
  if (call.type === 'http') return `${call.method} ${call.url}`
  return `내장 어댑터 ${call.adapter}.${call.op}`
}
