import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { createMcpServer } from './tools'
import { gateRequest } from './security'

/**
 * MCP HTTP 리스너 — Electron **메인 프로세스 안**에서 돈다(별도 프로세스 없음).
 * 그래서 생명주기가 앱과 한몸이다: 앱 시작=서버 시작, 앱 종료(강제 포함)=서버 종료,
 * "앱은 사는데 서버만 죽는" 경우는 프로세스가 아니라 리스너 예외뿐 → 아래 재바인딩으로 복구.
 *
 * 전송: MCP Streamable HTTP (127.0.0.1 전용). 인증·Origin 검증은 security.gateRequest.
 * 접속 정보(주소·키)는 디스크에 남기지 않는다 — 앱 AI 화면(상태 IPC)과 GET /health 가 정본.
 * 토큰은 주입된 저장소(앱=키체인 암호화)에서 로드, 설치당 1회 생성 후 고정 —
 * 재시작마다 바뀌면 에이전트 클라이언트 설정이 깨진다.
 *
 * electron 을 import 하지 않는다(db.ts 와 같은 테스트 seam) — 경로·버전은 호출자가 주입.
 */

const DEFAULT_PORT = 41729
const PORT_TRIES = 10
const MCP_PATH = '/mcp'
const RETRY_MS = 30_000
const MAX_SESSIONS = 64

/** 토큰 영속 저장소 — 앱은 OS 키체인 암호화(tokenStore.ts)를 주입하고, 테스트는 평문 파일 폴백을 쓴다. */
export interface TokenStore {
  load(): string | null
  save(token: string): void
}

export interface StartMcpOptions {
  /** 기본 토큰 저장소(평문 파일)를 둘 디렉터리 — 앱에선 userData(키체인 저장소 주입 시 레거시 정리에만 사용). */
  dir: string
  appVersion: string
  /** 기본: env ROCKURY_MCP_PORT → 41729. 0 이면 OS 가 빈 포트 배정(e2e 격리용). */
  port?: number
  /** 토큰 저장소 — 미지정 시 dir 안 평문 파일(Electron 밖 테스트용). */
  tokenStore?: TokenStore
}

export interface McpInfo {
  port: number
  url: string
  token: string
}

interface Runtime {
  server: Server
  info: McpInfo
  transports: Map<string, StreamableHTTPServerTransport>
}

let runtime: Runtime | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let activeTokenStore: TokenStore | null = null

/** 기본 토큰 저장소 — dir 안 평문 파일(0600). Electron 밖(테스트)용; 앱은 키체인 저장을 주입한다. */
function plainFileTokenStore(dir: string): TokenStore {
  const file = join(dir, 'mcp-token')
  return {
    load() {
      try {
        return existsSync(file) ? readFileSync(file, 'utf8').trim() : null
      } catch {
        return null
      }
    },
    save(token) {
      writeFileSync(file, token, { mode: 0o600 })
    }
  }
}

/**
 * 토큰 로드/생성 — 저장소에 유효한 토큰이 있으면 재사용(클라이언트 설정 안정성).
 * 토큰은 저장소(앱=키체인 암호화)에만 산다 — 디스크에 평문을 남기지 않는다.
 *
 * 보안 메모(감사 M-1, 수용): 토큰은 재발급 전까지 고정이고 포트는 점유 시 폴백 이동한다.
 * 멀티유저 머신에서 앱 미기동 틈에 다른 UID 가 기본 포트를 선점(가짜 리스너)하면, 포트를
 * 하드코딩해 캐시한 클라이언트의 토큰이 그쪽으로 새어 나갈 수 있다. 위협 모델(단일 사용자
 * 로컬 데스크탑)상 수용하되, 클라이언트 등록은 앱 AI 화면이 보여주는 현재 url 로 하고,
 * 유출 의심 시 같은 화면의 "재발급"으로 즉시 무효화한다.
 */
function loadOrCreateToken(store: TokenStore): string {
  const existing = store.load()
  if (typeof existing === 'string' && existing.length >= 32) return existing
  const next = randomBytes(32).toString('hex')
  store.save(next)
  return next
}

/** 요청 본문 상한 — 로컬이라도 폭주 본문으로 메모리를 밀어내지 못하게. */
const MAX_BODY_BYTES = 4 * 1024 * 1024

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const settle = (v: unknown): void => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        settle(undefined)
        req.destroy() // 초과분 수신 중단
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        settle(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        settle(undefined)
      }
    })
    req.on('error', () => settle(undefined))
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** 포트 후보에 차례로 listen 시도. port=0 은 OS 배정(폴백 불필요). */
function listenWithFallback(server: Server, basePort: number): Promise<number> {
  const candidates = basePort === 0 ? [0] : Array.from({ length: PORT_TRIES }, (_, i) => basePort + i)
  return new Promise((resolve, reject) => {
    const tryAt = (idx: number): void => {
      if (idx >= candidates.length) {
        reject(new Error(`MCP 포트 바인딩 실패 (${candidates[0]}~${candidates[candidates.length - 1]} 모두 사용 중)`))
        return
      }
      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener('error', onError)
        if (err.code === 'EADDRINUSE') tryAt(idx + 1)
        else reject(err)
      }
      server.once('error', onError)
      server.listen(candidates[idx], '127.0.0.1', () => {
        server.removeListener('error', onError)
        const addr = server.address()
        resolve(typeof addr === 'object' && addr ? addr.port : candidates[idx])
      })
    }
    tryAt(0)
  })
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rt: Runtime,
  appVersion: string
): Promise<void> {
  const url = (req.url ?? '').split('?')[0]

  // 헬스체크 — 인증 불필요("떠 있나"+버전만, pid 등 프로세스 정보는 무인증 노출 안 함 — 감사 L-1).
  if (req.method === 'GET' && url === '/health') {
    sendJson(res, 200, { name: 'rockury', version: appVersion })
    return
  }

  if (url !== MCP_PATH) {
    sendJson(res, 404, { error: 'not found' })
    return
  }

  const gate = gateRequest(
    { authorization: req.headers.authorization, origin: req.headers.origin, host: req.headers.host },
    rt.info.token
  )
  if (!gate.ok) {
    // 상세 사유는 로그로만 — 응답은 일반화(어느 방어에 걸렸는지 오라클 제공 금지, 감사 L-3).
    console.warn(`[mcp] 요청 거부(${gate.status}): ${gate.reason}`)
    sendJson(res, gate.status, { error: gate.status === 401 ? 'unauthorized' : 'forbidden' })
    return
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined

  if (req.method === 'POST') {
    const body = await readJsonBody(req)

    // 기존 세션 계속 — 사용 시 Map 뒤로 이동(삽입 순서 = 최근 사용 순 → 상한 축출이 LRU 가 됨, 감사 M-2)
    if (sessionId && rt.transports.has(sessionId)) {
      const t = rt.transports.get(sessionId)!
      rt.transports.delete(sessionId)
      rt.transports.set(sessionId, t)
      await t.handleRequest(req, res, body)
      return
    }

    // 새 세션 — initialize 요청만 허용
    if (!sessionId && isInitializeRequest(body)) {
      // 세션 누적 상한 — DELETE 없이 버려진 세션이 무한히 쌓이지 않게 LRU(가장 오래 안 쓴 것)부터 정리.
      if (rt.transports.size >= MAX_SESSIONS) {
        const lru = rt.transports.keys().next().value
        if (lru) {
          const t = rt.transports.get(lru)!
          rt.transports.delete(lru)
          void t.close().catch(() => {})
        }
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true, // POST 응답을 평문 JSON 으로 — SSE 파싱 없는 단순 클라이언트(스모크 포함)도 호출 가능
        onsessioninitialized: (id) => {
          rt.transports.set(id, transport)
        }
      })
      transport.onclose = () => {
        if (transport.sessionId) rt.transports.delete(transport.sessionId)
      }
      await createMcpServer(appVersion).connect(transport)
      await transport.handleRequest(req, res, body)
      return
    }

    sendJson(res, 400, {
      jsonrpc: '2.0',
      error: { code: -32000, message: '세션 없음 — initialize 부터 시작하세요.' },
      id: null
    })
    return
  }

  // GET(SSE 알림 스트림)·DELETE(세션 종료)는 기존 세션에만 위임 — 역시 LRU 갱신
  if ((req.method === 'GET' || req.method === 'DELETE') && sessionId && rt.transports.has(sessionId)) {
    const t = rt.transports.get(sessionId)!
    rt.transports.delete(sessionId)
    if (req.method === 'GET') rt.transports.set(sessionId, t) // DELETE 는 종료라 재등록 안 함(onclose 와 무관하게 제거 확정)
    await t.handleRequest(req, res)
    return
  }

  sendJson(res, 405, { error: 'method not allowed' })
}

/**
 * MCP 서버 시작. 실패해도 앱 부팅을 막지 않는다 — 로그 후 RETRY_MS 뒤 재시도 예약
 * ("부모는 사는데 MCP 만 죽는" 상태가 지속되지 않게).
 */
export async function startMcp(opts: StartMcpOptions): Promise<McpInfo | null> {
  if (runtime) return runtime.info

  try {
    const envPort = Number(process.env.ROCKURY_MCP_PORT)
    const basePort = opts.port ?? (Number.isInteger(envPort) && envPort >= 0 ? envPort : DEFAULT_PORT)
    const tokenStore = opts.tokenStore ?? plainFileTokenStore(opts.dir)
    const token = loadOrCreateToken(tokenStore)
    activeTokenStore = tokenStore

    const rt: Runtime = {
      server: createServer(),
      info: { port: 0, url: '', token },
      transports: new Map()
    }
    rt.server.on('request', (req, res) => {
      void handleRequest(req, res, rt, opts.appVersion).catch((e) => {
        console.error('[mcp] 요청 처리 오류:', e)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
      })
    })
    // listen 이후의 리스너 오류 — 메인 프로세스 크래시로 번지지 않게 삼키고 기록.
    rt.server.on('error', (e) => console.error('[mcp] 서버 오류:', e))

    const port = await listenWithFallback(rt.server, basePort)
    rt.info.port = port
    rt.info.url = `http://127.0.0.1:${port}${MCP_PATH}`
    runtime = rt

    // 레거시 정리 — 과거 버전이 남긴 발견 파일(mcp.json, 평문 토큰 포함 가능성)을 제거한다.
    // 지금은 디스크에 접속 정보 파일을 만들지 않는다(상태 IPC·/health 가 정본).
    rmSync(join(opts.dir, 'mcp.json'), { force: true })

    console.log(`[mcp] 리스닝: ${rt.info.url}`)
    return rt.info
  } catch (e) {
    console.error('[mcp] 시작 실패 — 30초 뒤 재시도:', e)
    retryTimer = setTimeout(() => {
      retryTimer = null
      void startMcp(opts)
    }, RETRY_MS)
    return null
  }
}

/** 현재 리스닝 중인 MCP 접속 정보 — AI 화면(ipc/mcp)이 조회. 꺼져 있으면 null. */
export function getMcpInfo(): McpInfo | null {
  return runtime?.info ?? null
}

/**
 * 접속 키(Bearer) 재발급 — 즉시 적용. 관문이 요청마다 runtime.info.token 을 읽으므로
 * 구 토큰은 이 호출 직후부터 401 이 된다(기존 등록 에이전트는 재등록 필요).
 */
export function rotateMcpToken(): McpInfo {
  if (!runtime || !activeTokenStore) throw new Error('MCP 서버가 꺼져 있습니다 — 재발급은 켜진 상태에서만 가능합니다.')
  const next = randomBytes(32).toString('hex')
  activeTokenStore.save(next)
  runtime.info.token = next
  return runtime.info
}

/** MCP 서버 정지 — 앱 종료(will-quit) 시 호출. 발견 파일은 남긴다(토큰 재사용). */
export async function stopMcp(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  const rt = runtime
  if (!rt) return
  runtime = null
  activeTokenStore = null
  for (const t of rt.transports.values()) {
    try {
      await t.close()
    } catch {
      // 종료 중 오류는 무시
    }
  }
  await new Promise<void>((resolve) => rt.server.close(() => resolve()))
}
