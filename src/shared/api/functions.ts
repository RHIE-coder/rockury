/**
 * 내장 함수 정본
 *
 * 값 가공은 **이 목록으로만** 한다(불변식 ⑤). 사용자 코드를 실행하지 않으므로
 * Electron 에 임의 JS 실행 표면이 생기지 않고, 목록 전체가 순수 함수라 테스트로 덮인다.
 *
 * 비결정 함수(now·timestamp·isoDate·uuid·random)와 암호 함수는 **주입받는다**(`FunctionEnv`).
 * 전역을 직접 부르면 테스트가 불가능해지고 불변식 ⑤의 "전부 테스트로 덮인다"가 거짓이 된다.
 * 암호 함수를 주입으로 뺀 두 번째 이유: `node:crypto` 는 렌더러에 없다 — 화면은 미리보기에서
 * "전송 시 계산"으로 남기고, 실제 계산은 메인이 한다.
 */

export const HASH_ALGOS = ['md5', 'sha1', 'sha256'] as const
export type HashAlgo = (typeof HASH_ALGOS)[number]

/**
 * 실패의 갈래를 타입으로 가른다 — 템플릿이 "전송을 막을 문제"와 "미뤄도 되는 것"을
 * 문자열 비교로 구분하면 문구를 고칠 때마다 조용히 깨진다.
 */
export class UnknownFunctionError extends Error {}
export class ArityError extends Error {}
/** 이 환경에서는 계산할 수 없고 전송할 때 메인이 계산한다 — 오류가 아니다. */
export class DeferredError extends Error {}

export interface FunctionEnv {
  /** epoch 밀리초. */
  now: () => number
  /** 0 이상 1 미만. */
  random: () => number
  uuid: () => string
  hash: (algo: HashAlgo, data: string) => string
  hmac: (algo: HashAlgo, key: string, data: string) => string
}

export interface FunctionDef {
  name: string
  group: '시각' | '식별자·난수' | '인코딩' | '해시·서명' | '문자열'
  /** 허용 인자 개수 [최소, 최대]. */
  arity: [number, number]
  /** 편집기 도움말에 그대로 보이는 사용법. 반드시 `이름(` 으로 시작한다. */
  usage: string
  blurb: string
  call: (args: string[], env: FunctionEnv) => string
}

// ── 시각 포맷 ─────────────────────────────────────────────────────────────
// UTC 고정. 로컬 시간대를 쓰면 같은 요청이 기계마다 다른 값을 만들어 관측 기록이 어긋난다.

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

const TIME_TOKENS: [string, (d: Date) => string][] = [
  ['YYYY', (d) => pad(d.getUTCFullYear(), 4)],
  ['SSS', (d) => pad(d.getUTCMilliseconds(), 3)],
  ['MM', (d) => pad(d.getUTCMonth() + 1)],
  ['DD', (d) => pad(d.getUTCDate())],
  ['HH', (d) => pad(d.getUTCHours())],
  ['mm', (d) => pad(d.getUTCMinutes())],
  ['ss', (d) => pad(d.getUTCSeconds())]
]

const TOKEN_LIST = TIME_TOKENS.map(([t]) => t).join(' · ')

/**
 * 토큰을 치환한다. `[...]` 안은 글자 그대로 둔다(dayjs 관례).
 * 모르는 글자 뭉치는 **조용히 흘려보내지 않고 거부**한다 — 오타가 그대로 요청에 실리면
 * 서버가 이상한 값을 받고 원인을 한참 찾게 된다.
 */
function formatTime(d: Date, fmt: string): string {
  let out = ''
  let i = 0
  outer: while (i < fmt.length) {
    if (fmt[i] === '[') {
      const end = fmt.indexOf(']', i)
      if (end === -1) throw new Error(`포맷의 '[' 가 닫히지 않았습니다: ${fmt}`)
      out += fmt.slice(i + 1, end)
      i = end + 1
      continue
    }
    for (const [token, render] of TIME_TOKENS) {
      if (fmt.startsWith(token, i)) {
        out += render(d)
        i += token.length
        continue outer
      }
    }
    if (/[A-Za-z]/.test(fmt[i])) {
      const run = /^[A-Za-z]+/.exec(fmt.slice(i))![0]
      throw new Error(
        `모르는 포맷 토큰 '${run}' — 지원: ${TOKEN_LIST}. 글자 그대로 쓰려면 대괄호로 감싸세요(예: [T]).`
      )
    }
    out += fmt[i]
    i += 1
  }
  return out
}

// ── 인코딩 (Buffer 를 쓰지 않는다 — 렌더러에는 없다) ───────────────────────

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(s: string): string {
  let bin: string
  try {
    bin = atob(s)
  } catch {
    throw new Error(`base64 형식이 아닙니다: ${s.slice(0, 40)}`)
  }
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

function requireAlgo(v: string): HashAlgo {
  if ((HASH_ALGOS as readonly string[]).includes(v)) return v as HashAlgo
  throw new Error(`지원하지 않는 알고리즘 '${v}' — 허용: ${HASH_ALGOS.join(', ')}`)
}

// ── 목록 ──────────────────────────────────────────────────────────────────

export const BUILTIN_FUNCTIONS: FunctionDef[] = [
  {
    name: 'now',
    group: '시각',
    arity: [0, 1],
    usage: "now() · now('YYYY-MM-DD')",
    blurb: `현재 시각(UTC). 포맷 토큰: ${TOKEN_LIST}`,
    call: (a, env) => formatTime(new Date(env.now()), a[0] ?? 'YYYY-MM-DD HH:mm:ss')
  },
  {
    name: 'timestamp',
    group: '시각',
    arity: [0, 0],
    usage: 'timestamp()',
    blurb: '현재 시각의 epoch 밀리초',
    call: (_a, env) => String(env.now())
  },
  {
    name: 'isoDate',
    group: '시각',
    arity: [0, 0],
    usage: 'isoDate()',
    blurb: 'ISO 8601 문자열 (예: 2026-07-28T09:05:03.042Z)',
    call: (_a, env) => new Date(env.now()).toISOString()
  },
  {
    name: 'uuid',
    group: '식별자·난수',
    arity: [0, 0],
    usage: 'uuid()',
    blurb: '무작위 UUID v4',
    call: (_a, env) => env.uuid()
  },
  {
    name: 'random',
    group: '식별자·난수',
    arity: [2, 2],
    usage: 'random(min, max)',
    blurb: '두 정수 사이의 난수 (양 끝 포함)',
    call: (a, env) => {
      const min = Number(a[0])
      const max = Number(a[1])
      if (!Number.isFinite(min) || !Number.isFinite(max))
        throw new Error(`random 의 인자는 숫자여야 합니다: random(${a[0]}, ${a[1]})`)
      if (min > max) throw new Error(`random 의 min 이 max 보다 큽니다: min=${min}, max=${max}`)
      const span = Math.floor(max) - Math.ceil(min) + 1
      return String(Math.min(Math.ceil(min) + Math.floor(env.random() * span), Math.floor(max)))
    }
  },
  {
    name: 'base64',
    group: '인코딩',
    arity: [1, 1],
    usage: 'base64(값)',
    blurb: 'base64 로 인코딩',
    call: (a) => toBase64(a[0])
  },
  {
    name: 'base64decode',
    group: '인코딩',
    arity: [1, 1],
    usage: 'base64decode(값)',
    blurb: 'base64 를 원래 글자로',
    call: (a) => fromBase64(a[0])
  },
  {
    name: 'urlencode',
    group: '인코딩',
    arity: [1, 1],
    usage: 'urlencode(값)',
    blurb: 'URL 에 안전한 형태로',
    call: (a) => encodeURIComponent(a[0])
  },
  {
    name: 'urldecode',
    group: '인코딩',
    arity: [1, 1],
    usage: 'urldecode(값)',
    blurb: 'URL 인코딩을 원래 글자로',
    call: (a) => decodeURIComponent(a[0])
  },
  {
    name: 'json',
    group: '인코딩',
    arity: [1, 1],
    usage: 'json(값)',
    blurb: 'JSON 본문에 그대로 꽂을 수 있게 따옴표까지 붙여 이스케이프',
    call: (a) => JSON.stringify(a[0])
  },
  {
    name: 'md5',
    group: '해시·서명',
    arity: [1, 1],
    usage: 'md5(값)',
    blurb: 'MD5 해시(16진)',
    call: (a, env) => env.hash('md5', a[0])
  },
  {
    name: 'sha1',
    group: '해시·서명',
    arity: [1, 1],
    usage: 'sha1(값)',
    blurb: 'SHA-1 해시(16진)',
    call: (a, env) => env.hash('sha1', a[0])
  },
  {
    name: 'sha256',
    group: '해시·서명',
    arity: [1, 1],
    usage: 'sha256(값)',
    blurb: 'SHA-256 해시(16진)',
    call: (a, env) => env.hash('sha256', a[0])
  },
  {
    name: 'hmac',
    group: '해시·서명',
    arity: [3, 3],
    usage: "hmac('sha256', 키, 값)",
    // 이 한 줄이 불변식 ⑤ 를 가능하게 한다 — 사용자 코드가 필요한 거의 유일한 사례가 서명 계산이다.
    blurb: `HMAC 서명(16진). 알고리즘: ${HASH_ALGOS.join(' · ')}`,
    call: (a, env) => env.hmac(requireAlgo(a[0]), a[1], a[2])
  },
  {
    name: 'upper',
    group: '문자열',
    arity: [1, 1],
    usage: 'upper(값)',
    blurb: '대문자로',
    call: (a) => a[0].toUpperCase()
  },
  {
    name: 'lower',
    group: '문자열',
    arity: [1, 1],
    usage: 'lower(값)',
    blurb: '소문자로',
    call: (a) => a[0].toLowerCase()
  },
  {
    name: 'trim',
    group: '문자열',
    arity: [1, 1],
    usage: 'trim(값)',
    blurb: '앞뒤 공백 제거',
    call: (a) => a[0].trim()
  },
  {
    name: 'replace',
    group: '문자열',
    arity: [3, 3],
    usage: 'replace(값, 찾을것, 바꿀것)',
    blurb: '모든 자리를 바꾼다 (정규식이 아니라 글자 그대로)',
    call: (a) => a[0].split(a[1]).join(a[2])
  }
]

const BY_NAME = new Map(BUILTIN_FUNCTIONS.map((f) => [f.name, f]))

export function findFunction(name: string): FunctionDef | undefined {
  return BY_NAME.get(name)
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

/** 오타로 보이는 이름에 가장 가까운 함수. 억지 제안을 막으려고 거리 3 을 넘으면 포기한다. */
export function suggestFunction(name: string): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const f of BUILTIN_FUNCTIONS) {
    const d = distance(name, f.name)
    if (d < bestD) {
      bestD = d
      best = f.name
    }
  }
  return bestD <= 3 ? best : null
}

/**
 * 함수 하나를 부른다. 실패는 전부 던진다 —
 * 조용히 빈 값을 치환하면 그 값이 그대로 서버에 실려 나간다(template AC-3).
 */
export function callFunction(name: string, args: string[], env: FunctionEnv): string {
  const f = findFunction(name)
  if (!f) {
    const near = suggestFunction(name)
    throw new UnknownFunctionError(
      `내장 함수 '${name}' 가 없습니다${near ? ` — '${near}' 를 찾으셨나요?` : ''}. 사용자 코드는 실행하지 않습니다.`
    )
  }
  const [min, max] = f.arity
  if (args.length < min || args.length > max) {
    throw new ArityError(
      `${f.usage} — 인자 ${min === max ? `${min}개` : `${min}~${max}개`}가 필요한데 ${args.length}개를 받았습니다.`
    )
  }
  return f.call(args, env)
}

/** 암호 함수를 못 쓰는 환경(렌더러)용 seam — 미리보기는 이 오류를 잡아 "전송 시 계산"으로 보인다. */
export const cryptoUnavailable = {
  hash: (): never => {
    throw new DeferredError('해시는 전송 시 계산됩니다 (화면에서는 미리 보여줄 수 없습니다).')
  },
  hmac: (): never => {
    throw new DeferredError('서명은 전송 시 계산됩니다 (화면에서는 미리 보여줄 수 없습니다).')
  }
}
