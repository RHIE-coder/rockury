import type { FunctionEnv } from './functions'
import { buildScope, type Scope } from './resolve'
import { validateCall } from './signature'
import { blockingIssues, renderTemplate, type UsedRef } from './template'
import { interfaceMeta, type EnvironmentDef, type InterfaceKind, type RequestDef } from './types'

/**
 * 요청 조립 — `docs/spec/api-runner.md` § send.compose.
 *
 * 여기서 세 가지가 한꺼번에 결정된다:
 *   ① 최종 요청(주소·헤더·본문)      ② **값마다 어디서 왔는지**      ③ 보낼 수 있는가
 *
 * ②·③ 이 화면이 아니라 여기 있는 이유: 실행 경로가 화면·재실행·기록 재현 셋인데, 화면에
 * 두면 나머지가 규칙을 우회한다. 특히 ③ 은 PROD 오조작을 막는 마지막 선이다.
 *
 * **막혀도 미리보기는 만든다.** 어디가 문제인지 눈으로 보여야 고칠 수 있다.
 */

export interface ComposeInput {
  kind: InterfaceKind
  request: RequestDef
  /** 아직 안 골랐으면 null — 고르기 전에는 못 보낸다(spec guard AC-1). */
  env: EnvironmentDef | null
  call: Record<string, string>
  functions: FunctionEnv
  /** 화면 미리보기면 켠다 — 비밀 표식 값이 가려진다. */
  maskSecrets?: boolean
}

export type BlockKind = 'no-environment' | 'param' | 'template'

export interface ComposeBlock {
  kind: BlockKind
  /** 문제가 된 이름(파라미터명·참조명) 또는 자리. */
  where: string
  message: string
}

export interface Composed {
  method: string
  url: string
  headers: Record<string, string>
  body: string
  /** 셸에 붙여 쓸 수 있는 형태 — 비밀은 실값 대신 `$이름` 으로 남는다. */
  curl: { url: string; headers: Record<string, string>; body: string }
  /** 쓴 값마다 출처(기본값/환경/호출). 중복 없이 한 번씩. */
  origins: UsedRef[]
  blocking: ComposeBlock[]
  canSend: boolean
}

const enc = encodeURIComponent

/** baseUrl 과 경로를 슬래시 하나로 잇는다. 경로가 이미 절대 주소면 그대로 쓴다. */
function joinUrl(base: string, pathPart: string): string {
  if (/^https?:\/\//i.test(pathPart)) return pathPart
  const b = base.replace(/\/+$/, '')
  const p = pathPart.replace(/^\/+/, '')
  return p ? `${b}/${p}` : b
}

export function composeRequest(input: ComposeInput): Composed {
  const { kind, request, env, call, functions, maskSecrets } = input
  const meta = interfaceMeta(kind)
  const scope: Scope = buildScope({ params: request.params, env, call })

  const origins: UsedRef[] = []
  const blocking: ComposeBlock[] = []
  const collect = (used: UsedRef[]): void => {
    for (const u of used) if (!origins.some((x) => x.name === u.name)) origins.push(u)
  }

  /** 한 자리를 세 벌로 만든다: 전송용 · 화면용(가림) · curl 용($이름). */
  const render = (text: string, where: string, transform?: (v: string) => string) => {
    const shown = renderTemplate(text, { scope, env: functions, maskSecrets, transform })
    collect(shown.used)
    for (const i of blockingIssues(shown)) {
      // 같은 이름을 여러 자리에서 써도 문제는 한 번만 올린다 — 목록이 시끄러우면 안 읽는다.
      const name = i.kind === 'unknown-ref' ? i.ref.trim() : where
      if (!blocking.some((b) => b.kind === 'template' && b.where === name)) {
        blocking.push({ kind: 'template', where: name, message: i.message })
      }
    }
    const curl = renderTemplate(text, {
      scope,
      env: functions,
      maskSecrets: true,
      maskWith: (used) => `$${used.find((u) => u.secret)?.name ?? 'secret'}`,
      transform
    })
    return { shown: shown.text, curl: curl.text }
  }

  // ── 파라미터 검증 (필수 누락·타입·오타) ──
  for (const p of validateCall(request.params, call)) {
    blocking.push({ kind: 'param', where: p.name, message: p.reason })
  }
  if (!env) {
    blocking.push({
      kind: 'no-environment',
      where: '환경',
      message: '환경을 먼저 고르세요 — 어디로 보낼지 정해지지 않았습니다.'
    })
  }

  const base = env?.baseUrl ?? ''
  const has = (f: (typeof meta.fields)[number]): boolean => meta.fields.includes(f)

  // ── 주소 ──
  const pathField = has('path') ? (request.request.path ?? '') : (request.request.connectUrl ?? '')
  const path = render(pathField, has('path') ? '경로' : '접속 주소', enc)

  const queryPairs = Object.entries(request.request.query ?? {})
  const query = queryPairs.map(([k, v]) => {
    const r = render(v, `쿼리 ${k}`, enc)
    return { k: enc(k), shown: r.shown, curl: r.curl }
  })
  const qs = (pick: 'shown' | 'curl'): string =>
    query.length === 0 ? '' : '?' + query.map((q) => `${q.k}=${q[pick]}`).join('&')

  // ── 헤더 ──
  const headers: Record<string, string> = {}
  const curlHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(request.request.headers ?? {})) {
    const r = render(v, `헤더 ${k}`)
    headers[k] = r.shown
    curlHeaders[k] = r.curl
  }

  // ── 본문 · 메서드 (인터페이스마다 다르다) ──
  let bodySource = ''
  let method = ''
  if (kind === 'rest') {
    method = (request.request.method ?? 'GET').toUpperCase()
    bodySource = request.request.body ?? ''
  } else if (kind === 'graphql') {
    method = 'POST'
    bodySource = JSON.stringify({
      query: request.request.graphqlQuery ?? '',
      variables: request.request.graphqlVariables ?? ''
    })
  } else if (kind === 'jsonrpc') {
    method = 'POST'
    bodySource = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: request.request.rpcMethod ?? '',
      params: request.request.rpcParams ?? ''
    })
  } else if (kind === 'grpc') {
    bodySource = request.request.body ?? ''
  }
  const body = bodySource ? render(bodySource, '본문') : { shown: '', curl: '' }

  return {
    method,
    url: joinUrl(base, path.shown) + qs('shown'),
    headers,
    body: body.shown,
    curl: { url: joinUrl(base, path.curl) + qs('curl'), headers: curlHeaders, body: body.curl },
    origins,
    blocking,
    canSend: blocking.length === 0
  }
}

/** 셸에서 안전하게 감싼다 — 값 안의 작은따옴표가 명령을 깨뜨리지 않게. */
function shq(s: string): string {
  return `'${s.split("'").join(`'\\''`)}'`
}

/**
 * 붙여넣어 바로 쓸 수 있는 curl.
 * **비밀은 실값이 아니라 `$이름` 으로 나간다** — 복사한 명령이 채팅·이슈에 붙는 순간
 * 실값이면 그대로 유출된다(spec send.execute AC-5).
 */
export function toCurl(c: Composed): string {
  const parts = [`curl -X ${c.method || 'GET'} ${shq(c.curl.url)}`]
  for (const [k, v] of Object.entries(c.curl.headers)) parts.push(`  -H ${shq(`${k}: ${v}`)}`)
  if (c.curl.body) parts.push(`  --data ${shq(c.curl.body)}`)
  return parts.join(' \\\n')
}

/** 브라우저·Node 에 붙여 쓸 수 있는 fetch. 비밀 처리는 curl 과 같다. */
export function toFetch(c: Composed): string {
  const init: Record<string, unknown> = { method: c.method || 'GET' }
  if (Object.keys(c.curl.headers).length > 0) init.headers = c.curl.headers
  if (c.curl.body) init.body = c.curl.body
  return `await fetch(${JSON.stringify(c.curl.url)}, ${JSON.stringify(init, null, 2)})`
}
