import { createConnection, type Socket } from 'node:net'
import { decodeResp, encodeCommand, isRespError, type RespValue } from './resp'

/**
 * Redis 접속 — **의존성 0.** `node:net` 위에 RESP 를 직접 태운다.
 *
 * 왜 라이브러리를 안 쓰나: 프로젝트가 네이티브 모듈을 금지하고(순수 JS 라이브러리는 후보였지만)
 * 의존성 추가는 `main` 브랜치에서 한 사람만 하기로 돼 있다. RESP2 는 접두 바이트 다섯 개짜리라
 * 직접 읽는 편이 싸고, **해독기 전체가 단위 테스트로 덮인다**(`resp.test.ts`).
 *
 * 접속을 **들고 있지 않는다** — 한 번에 붙어서 명령들을 돌리고 끊는다. 메인 프로세스에 소켓을
 * 눌러앉히면 앱이 살아 있는 동안 남의 서버에 연결이 매달려 있고, 죽은 연결을 되살리는 상태
 * 기계까지 떠안아야 한다. 콘솔은 사람이 한 번에 몇 줄 치는 도구라 그 비용을 낼 이유가 없다.
 */

export interface RedisTarget {
  host: string
  port: number
  /** 비밀번호. 없으면 `AUTH` 를 보내지 않는다. */
  password?: string
  /** Redis 6+ 의 사용자 이름(ACL). 있으면 `AUTH <user> <pass>`. */
  username?: string
  db?: number
  timeoutMs?: number
}

export interface RedisRunResult {
  ok: boolean
  /** 명령별 응답. 넣은 순서 그대로. */
  replies: RespValue[]
  /** 붙지도 못했을 때의 사유(주소 틀림·거부·시간 초과). */
  error?: string
  durationMs: number
}

const DEFAULT_TIMEOUT_MS = 5_000

/**
 * 한 번 붙어서 명령 여러 개를 순서대로 돌리고 끊는다.
 *
 * **오류를 삼키지 않는다**: 붙지 못한 것(`error`)과 서버가 거절한 것(`replies` 안의 RESP 오류)을
 * 구분해 돌려준다. 둘을 뭉개면 "주소가 틀렸다"와 "명령이 틀렸다"를 사용자가 못 가른다.
 */
export function redisRun(target: RedisTarget, commands: string[][]): Promise<RedisRunResult> {
  const started = Date.now()
  const timeoutMs = target.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<RedisRunResult>((resolve) => {
    // 앞에 붙는 준비 명령(인증·DB 선택)은 사용자가 넣은 명령과 **개수를 따로 세어** 응답에서 떼어 낸다.
    const prelude: string[][] = []
    if (target.password) {
      prelude.push(target.username ? ['AUTH', target.username, target.password] : ['AUTH', target.password])
    }
    if (typeof target.db === 'number' && target.db > 0) prelude.push(['SELECT', String(target.db)])

    const all = [...prelude, ...commands]
    const replies: RespValue[] = []
    let buffer: Buffer = Buffer.alloc(0)
    let settled = false

    const socket: Socket = createConnection({ host: target.host, port: target.port })
    socket.setNoDelay(true)

    const finish = (error?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      // 준비 명령의 응답은 사용자에게 보이지 않는다 — 사용자가 시킨 것만 돌려준다.
      const mine = replies.slice(prelude.length)
      const preludeError = replies.slice(0, prelude.length).find(isRespError)
      resolve({
        ok: !error && !preludeError && replies.length === all.length,
        replies: mine,
        error: error ?? (preludeError ? preludeError.error : undefined),
        durationMs: Date.now() - started
      })
    }

    const timer = setTimeout(() => finish('시간 초과'), timeoutMs)

    socket.on('connect', () => {
      socket.write(Buffer.concat(all.map(encodeCommand)))
    })

    // `setEncoding` 을 걸지 않으므로 조각은 언제나 Buffer 다(문자열로 오면 멀티바이트가 잘린다).
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      try {
        // 한 조각에 응답이 여럿 붙어 오고, 하나가 조각 사이에 걸쳐 오기도 한다.
        for (;;) {
          const got = decodeResp(buffer)
          if (!got) break
          replies.push(got.value)
          buffer = got.rest
          if (replies.length >= all.length) {
            finish()
            return
          }
        }
      } catch (e) {
        finish(e instanceof Error ? e.message : String(e))
      }
    })

    socket.on('error', (e) => finish(e.message))
    // 응답을 다 받기 전에 끊기면 그것도 실패다 — 조용히 성공으로 넘기지 않는다.
    socket.on('close', () => finish(replies.length < all.length ? '응답을 받기 전에 연결이 끊겼습니다.' : undefined))
  })
}
