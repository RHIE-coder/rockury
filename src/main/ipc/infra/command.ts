import { execFile } from 'node:child_process'

/**
 * 명령 조립과 실행.
 *
 * **셸을 거치지 않는다.** 명령과 인자를 배열로 넘겨 `execFile` 로 띄우므로, 치환된 값에
 * `;`·`&&`·따옴표가 들어 있어도 그저 문자열 하나일 뿐 명령이 되지 못한다. 문자열을 이어 붙여
 * 셸에 던지는 방식이었다면 카탈로그 하나가 곧 임의 명령 실행 통로가 된다 —
 * 남이 만든 카탈로그를 가져올 수 있게 설계한 이상 이건 타협 대상이 아니다.
 */

/** 자리표시자에 채울 값들. `cred` 만 비밀이고 나머지는 화면·이력에 보여도 된다. */
export interface SubstContext {
  cred?: Record<string, string>
  node?: Record<string, string>
  arg?: Record<string, string>
}

export interface PreparedCommand {
  cmd: string
  /** 실제로 실행할 인자 — 자격증명이 채워져 있다. **이력에 남기지 않는다.** */
  args: string[]
  /** 화면·이력용 — 자격증명은 참조 그대로 남고, 비밀이 아닌 값만 채워져 있다. */
  display: string[]
}

const PLACEHOLDER_RE = /\{\{([a-z]+)\.([A-Za-z0-9_-]+)\}\}/g

/**
 * 우리 자리표시자의 이름공간. **이 셋만 우리 것이다.**
 *
 * 왜 이렇게 좁혔나: `{{…}}` 는 우리만 쓰는 문법이 아니다. 도커의 출력 서식이
 * `--format {{json .Names}}` 처럼 같은 괄호를 쓴다. 모든 `{{x.y}}` 를 우리 것으로 보고 던지면
 * 정상적인 도커·kubectl 명령을 카탈로그에 못 적는다(실제로 도커 카탈로그를 쓰다 부딪혔다).
 * 그래서 **우리 이름공간이 아니면 손대지 않고 그대로 흘려보낸다.**
 * "조용한 통과"는 여기서 안 생긴다 — 우리 이름공간이면 값이 없을 때 반드시 던지기 때문이다.
 */
const OURS = new Set(['cred', 'node', 'arg'])

function substitute(text: string, ctx: SubstContext, keepCred: boolean): string {
  return text.replace(PLACEHOLDER_RE, (whole, ns: string, key: string) => {
    if (!OURS.has(ns)) return whole // 우리 것이 아니다(예: 도커 출력 서식) — 그대로 둔다
    if (ns === 'cred' && keepCred) return whole // 이력·화면용: 참조 그대로 둔다
    const bag = (ctx as unknown as Record<string, Record<string, string> | undefined>)[ns] ?? {}
    const value = bag[key]
    if (value === undefined) {
      // 빈 문자열로 밀어 넣으면 `--profile` 뒤가 비어 엉뚱한 명령이 조용히 실행된다.
      throw new Error(`자리표시자 '${whole}' 에 넣을 값이 없습니다.`)
    }
    return value
  })
}

/** CLI 호출 하나를 실행 가능한 형태로 만든다. 값이 없으면 던진다 — 조용히 넘어가지 않는다. */
export function prepareCommand(
  call: { cmd: string; args: string[] },
  ctx: SubstContext
): PreparedCommand {
  return {
    cmd: call.cmd,
    args: call.args.map((a) => substitute(a, ctx, false)),
    display: call.args.map((a) => substitute(a, ctx, true))
  }
}

/**
 * 공급자가 **되뱉은** 자격증명을 참조 표기(`{{cred.<id>}}`)로 바꾼다.
 *
 * 왜 필요한가: 우리는 명령을 만들 때 비밀을 화면·이력에서 빼 두지만(`display`), 그건 우리가
 * 만든 문자열에만 통한다. **상대편이 자기 오류 메시지에 값을 실어 돌려보내면 그 길로 샌다** —
 * 실측: AWS CLI 는 `The config profile (<값>) could not be found` 라고 답한다.
 * 그러면 "실패 사유를 그대로 보인다"(providers.credentials AC-4)와
 * "평문은 어디에도 안 나온다"(AC-3)가 부딪힌다. 답은 **가리되 자리는 남기는 것**이다 —
 * 통째로 지우면 무엇이 틀렸는지 못 읽고, 그대로 두면 비밀이 샌다.
 *
 * 프로세스 경계를 **넘기 전에**(메인에서) 지운다. 렌더러는 평문을 아예 받지 못한다.
 * 표준 출력에도 적용한다 — 응답 본문에 값이 섞여 오는 경우까지 덮기 위해서다.
 * 그 대가로 응답에 자격증명과 똑같은 문자열이 있으면 그것도 가려지는데,
 * **덜 가려 새는 쪽보다 더 가려 눈에 띄는 쪽이 낫다.**
 */
export function redactSecrets(text: string, creds: Record<string, string>): string {
  if (!text) return text
  // 긴 값부터 — 짧은 값이 긴 값의 일부일 때 반쪽만 가려지는 것을 막는다.
  const entries = Object.entries(creds)
    .filter(([, v]) => v)
    .sort((a, b) => b[1].length - a[1].length)
  let out = text
  for (const [id, value] of entries) out = out.split(value).join(`{{cred.${id}}}`)
  return out
}

export interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  /** 명령 자체를 못 띄웠을 때(없는 명령·권한 없음)의 사유. */
  error?: string
}

/** 출력 상한 — 잘못된 명령이 기가바이트를 뱉어 메인 프로세스를 죽이는 것을 막는다. */
const MAX_BUFFER = 8 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * 준비된 명령을 실행한다. 실패해도 던지지 않고 결과로 돌려준다 —
 * **종료 코드와 표준 오류를 그대로 보여주기 위해서다.** "실패했습니다" 로 뭉개면
 * 사용자는 없는 명령인지 권한 문제인지 알 수 없다.
 */
export function runCli(
  prepared: Pick<PreparedCommand, 'cmd' | 'args'>,
  opts: { timeoutMs?: number; cwd?: string } = {}
): Promise<RunResult> {
  const started = Date.now()
  return new Promise<RunResult>((resolve) => {
    execFile(
      prepared.cmd,
      prepared.args,
      {
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        cwd: opts.cwd,
        shell: false, // 명시 — 이 한 줄이 명령 주입을 막는다
        windowsHide: true
      },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - started
        const e = err as (Error & { code?: number | string; killed?: boolean; signal?: string }) | null
        const timedOut = Boolean(e && (e.killed || e.signal === 'SIGTERM'))
        const spawnFailed = Boolean(e && typeof e.code === 'string')
        resolve({
          ok: !e,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          exitCode: e && typeof e.code === 'number' ? e.code : e ? null : 0,
          durationMs,
          timedOut,
          error: e ? (spawnFailed || timedOut ? e.message : undefined) : undefined
        })
      }
    )
  })
}
