import {
  ArityError,
  DeferredError,
  UnknownFunctionError,
  callFunction,
  type FunctionEnv
} from './functions'
import type { Scope } from './resolve'
import type { ValueOrigin } from './types'

/**
 * 템플릿 치환 — `docs/spec/api-studio.md` § requests.template.
 *
 * `{{이름}}` 은 값 참조, `{{함수(...)}}` 는 내장 함수 호출이다. 사용자 코드는 실행하지 않으므로
 * 여기서 도는 것은 전부 우리가 목록으로 가진 순수 함수뿐이다(불변식 ⑤).
 *
 * **조용히 빈 값으로 치환하지 않는다.** 없는 이름·없는 함수는 문제로 모아 두고, 전송 직전
 * `assertRenderable` 이 막는다 — 빈 값이 그대로 서버에 실려 나가면 원인을 한참 찾게 된다.
 * 미리보기는 문제가 있어도 죽지 않고 원문을 남겨 **어디가 문제인지 보이게** 한다.
 */

/** 비밀 표식 값을 가릴 때 쓰는 문자열. 길이를 고정해 원문 길이가 유추되지 않게 한다. */
export const MASK = '••••'

export type IssueKind =
  | 'unknown-ref'
  | 'unknown-function'
  | 'bad-args'
  | 'syntax'
  | 'runtime'
  /** 이 환경에서 계산 못 함(렌더러의 암호 함수) — 전송을 막지 않는다. */
  | 'deferred'

export interface TemplateIssue {
  kind: IssueKind
  /** 문제가 된 표현 원문(`{{}}` 안쪽). */
  ref: string
  message: string
}

export interface UsedRef {
  name: string
  origin: ValueOrigin
  secret: boolean
}

export interface RenderOutcome {
  text: string
  used: UsedRef[]
  issues: TemplateIssue[]
}

export interface RenderContext {
  scope: Scope
  env: FunctionEnv
  /** 미리보기처럼 화면에 보이는 자리면 켠다 — 비밀 표식 값이 `MASK` 로 나간다. */
  maskSecrets?: boolean
  /**
   * 가릴 때 무엇으로 가릴지. 기본은 `MASK`.
   * curl 로 복사할 때는 `$apiKey` 처럼 **변수 이름**으로 남겨야 붙여넣고 쓸 수 있다.
   */
  maskWith?: (used: UsedRef[]) => string
  /**
   * 치환된 **값에만** 적용하는 변환(글자 그대로인 부분은 안 거친다).
   * 경로·쿼리에 URL 인코딩을 걸 때 쓴다 — 템플릿의 `/` 까지 인코딩하면 경로가 깨진다.
   */
  transform?: (value: string) => string
}

// ── 표현식 파서 ───────────────────────────────────────────────────────────
// 문법:  expr := IDENT '(' [expr (',' expr)*] ')' | IDENT | STRING | NUMBER

type Node =
  | { t: 'call'; name: string; args: Node[] }
  | { t: 'ref'; name: string }
  | { t: 'lit'; value: string }

class SyntaxError_ extends Error {}

function parseExpression(src: string): Node {
  let i = 0

  const ws = (): void => {
    while (i < src.length && /\s/.test(src[i])) i++
  }
  const fail = (msg: string): never => {
    throw new SyntaxError_(msg)
  }

  function expr(): Node {
    ws()
    if (i >= src.length) return fail('내용이 비어 있습니다.')

    const q = src[i]
    if (q === "'" || q === '"') {
      i++
      let out = ''
      while (i < src.length && src[i] !== q) {
        // 리터럴 안의 따옴표는 역슬래시로 감싼다.
        if (src[i] === '\\' && i + 1 < src.length) i++
        out += src[i++]
      }
      if (i >= src.length) return fail(`따옴표가 닫히지 않았습니다: ${src}`)
      i++
      return { t: 'lit', value: out }
    }

    if (/[0-9-]/.test(q)) {
      const m = /^-?\d+(\.\d+)?/.exec(src.slice(i))
      if (m) {
        i += m[0].length
        return { t: 'lit', value: m[0] }
      }
    }

    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (!m) return fail(`알 수 없는 표현입니다: ${src.slice(i)}`)
    const name = m[0]
    i += name.length
    ws()
    if (src[i] !== '(') return { t: 'ref', name }

    i++ // '('
    const args: Node[] = []
    ws()
    if (src[i] === ')') {
      i++
      return { t: 'call', name, args }
    }
    for (;;) {
      args.push(expr())
      ws()
      if (src[i] === ',') {
        i++
        continue
      }
      if (src[i] === ')') {
        i++
        return { t: 'call', name, args }
      }
      return fail(`괄호가 닫히지 않았습니다: ${name}(…`)
    }
  }

  const node = expr()
  ws()
  if (i < src.length) fail(`표현 뒤에 남은 글자가 있습니다: ${src.slice(i)}`)
  return node
}

// ── 조각 나누기 ───────────────────────────────────────────────────────────

interface Segment {
  /** `{{}}` 밖의 글자면 text, 안이면 expr. */
  t: 'text' | 'expr'
  value: string
}

/**
 * `\{{` 는 글자 그대로 `{{` 를 쓰겠다는 뜻이다 — JSON 본문에 중괄호를 넣어야 할 때 필요하다.
 * 닫는 `}}` 가 없으면 그 자리부터는 그냥 글자로 본다(편집 중에는 늘 반쯤 쓰다 만 상태다).
 */
function split(text: string): Segment[] {
  const out: Segment[] = []
  let buf = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '\\' && text.startsWith('{{', i + 1)) {
      buf += '{{'
      i += 3
      continue
    }
    if (text.startsWith('{{', i)) {
      const end = text.indexOf('}}', i + 2)
      if (end !== -1) {
        if (buf) {
          out.push({ t: 'text', value: buf })
          buf = ''
        }
        out.push({ t: 'expr', value: text.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }
    buf += text[i++]
  }
  if (buf) out.push({ t: 'text', value: buf })
  return out
}

/** 검증·미리보기용으로 참조 이름만 먼저 뽑는다(중복 제거, 등장 순서 유지). */
export function collectRefs(text: string): string[] {
  const names: string[] = []
  const visit = (n: Node): void => {
    if (n.t === 'ref' && !names.includes(n.name)) names.push(n.name)
    if (n.t === 'call') n.args.forEach(visit)
  }
  for (const s of split(text)) {
    if (s.t !== 'expr') continue
    try {
      visit(parseExpression(s.value))
    } catch {
      // 편집 중의 깨진 표현은 이름을 못 뽑을 뿐, 여기서 보고하지 않는다(renderTemplate 의 몫).
    }
  }
  return names
}

// ── 렌더 ──────────────────────────────────────────────────────────────────

export function renderTemplate(text: string, ctx: RenderContext): RenderOutcome {
  const used: UsedRef[] = []
  const issues: TemplateIssue[] = []
  let out = ''

  for (const seg of split(text)) {
    if (seg.t === 'text') {
      out += seg.value
      continue
    }

    const localUsed: UsedRef[] = []
    const evaluate = (n: Node): string => {
      if (n.t === 'lit') return n.value
      if (n.t === 'ref') {
        const v = ctx.scope.get(n.name)
        if (!v) throw new UnknownRefError(n.name)
        if (!localUsed.some((u) => u.name === n.name))
          localUsed.push({ name: n.name, origin: v.origin, secret: v.secret })
        return v.value
      }
      return callFunction(
        n.name,
        n.args.map(evaluate),
        ctx.env
      )
    }

    try {
      const node = parseExpression(seg.value)
      const value = evaluate(node)
      // 비밀이 하나라도 섞였으면 그 조각 전체를 가린다 — 함수로 가공해도 원문이 새면 안 된다.
      const hasSecret = localUsed.some((u) => u.secret)
      out +=
        ctx.maskSecrets && hasSecret
          ? (ctx.maskWith ?? (() => MASK))(localUsed)
          : (ctx.transform ?? ((v: string) => v))(value)
      used.push(...localUsed.filter((u) => !used.some((x) => x.name === u.name)))
    } catch (e) {
      // 참조 이름은 실패한 조각에서도 기록해 둔다 — 화면이 "무엇을 쓰려 했나"를 보여야 한다.
      used.push(...localUsed.filter((u) => !used.some((x) => x.name === u.name)))
      issues.push({ kind: kindOf(e), ref: seg.value, message: messageOf(e) })
      out += `{{${seg.value}}}`
    }
  }

  return { text: out, used, issues }
}

class UnknownRefError extends Error {
  constructor(public readonly name: string) {
    super(
      `값 '${name}' 을(를) 찾을 수 없습니다 — 요청 파라미터나 환경 값에 없습니다. (빈 값으로 대신 채우지 않습니다.)`
    )
  }
}

function kindOf(e: unknown): IssueKind {
  if (e instanceof DeferredError) return 'deferred'
  if (e instanceof UnknownRefError) return 'unknown-ref'
  if (e instanceof UnknownFunctionError) return 'unknown-function'
  if (e instanceof ArityError) return 'bad-args'
  if (e instanceof SyntaxError_) return 'syntax'
  return 'runtime'
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 전송을 막아야 하는 문제만 고른다 — `deferred` 는 메인이 계산하므로 막지 않는다. */
export function blockingIssues(o: RenderOutcome): TemplateIssue[] {
  return o.issues.filter((i) => i.kind !== 'deferred')
}

export function assertRenderable(o: RenderOutcome): void {
  const blocking = blockingIssues(o)
  if (blocking.length === 0) return
  throw new Error(blocking.map((i) => `{{${i.ref}}} — ${i.message}`).join('\n'))
}
