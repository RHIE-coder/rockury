import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setDbPath } from '../store/db'
import { rotateMcpToken, startMcp, stopMcp, type McpInfo } from './http'

/**
 * MCP HTTP 서버 통합 테스트 — Electron 없이 실제 리스너를 띄워(포트 0·임시 DB·임시 dir)
 * 에이전트 클라이언트 관점의 프로토콜 흐름(initialize→tools/list→tools/call)과
 * 보안 거부 경로·토큰 영속·정지를 검증한다. `npm test` 마다 도는 프로토콜 회귀 핀.
 */

let tmp: string
let info: McpInfo

const accept = 'application/json, text/event-stream'
const post = (body: unknown, sid?: string | null): Promise<Response> =>
  fetch(info.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept,
      authorization: `Bearer ${info.token}`,
      ...(sid ? { 'mcp-session-id': sid } : {})
    },
    body: JSON.stringify(body)
  })

/** initialize 핸드셰이크 → 세션 id. */
async function initSession(): Promise<string> {
  const res = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vitest', version: '0' } }
  })
  const sid = res.headers.get('mcp-session-id')
  const json = (await res.json()) as { result?: { serverInfo?: { name?: string } } }
  expect(json.result?.serverInfo?.name).toBe('rockury')
  expect(sid).toBeTruthy()
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid)
  return sid!
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'rockury-mcp-http-'))
  setDbPath(join(tmp, 'test.db'))
  const started = await startMcp({ dir: tmp, appVersion: '0.0.0-test', port: 0 })
  expect(started).not.toBeNull()
  info = started!
})

afterAll(async () => {
  await stopMcp()
})

describe('MCP HTTP 서버', () => {
  it('접속 정보 파일(mcp.json)을 만들지 않는다 — 상태는 IPC·/health 가 정본', () => {
    expect(existsSync(join(tmp, 'mcp.json'))).toBe(false)
  })

  it('GET /health — 무인증 헬스체크', async () => {
    const health = (await (await fetch(`http://127.0.0.1:${info.port}/health`)).json()) as Record<string, unknown>
    expect(health.name).toBe('rockury')
    expect(health.version).toBe('0.0.0-test')
  })

  it('initialize → tools/list — 읽기 4종 + 쓰기 5종 노출, 삭제류 부재 (CASE-mcp-011)', async () => {
    const sid = await initSession()
    const json = (await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid)).json()) as {
      result: { tools: Array<{ name: string }> }
    }
    const names = json.result.tools.map((t) => t.name)
    for (const n of [
      'list_designs', 'get_schema', 'list_versions', 'get_version',
      'create_design', 'update_design', 'set_schema', 'patch_schema', 'create_version'
    ]) expect(names).toContain(n)
    // 파괴적 조작은 사람이 앱에서만 — 삭제류 도구가 생기면 명세(tools.write AC-7) 위반.
    expect(names.filter((n) => /delete|remove|drop/.test(n))).toEqual([])
  })

  it('tools/call — list_designs 가 시드 설계를, get_schema 가 테이블을 반환', async () => {
    const sid = await initSession()
    const ld = (await (
      await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_designs', arguments: {} } }, sid)
    ).json()) as { result: { content: Array<{ text: string }> } }
    expect(ld.result.content[0].text).toContain('commerce-core')

    const gs = (await (
      await post(
        { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_schema', arguments: { designId: 'commerce-core' } } },
        sid
      )
    ).json()) as { result: { content: Array<{ text: string }> } }
    expect(gs.result.content[0].text).toContain('"orders"')
  })

  it('tools/call — 미상 설계는 isError + 안내(프로토콜 오류 아님)', async () => {
    const sid = await initSession()
    const bad = (await (
      await post(
        { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_schema', arguments: { designId: 'nope' } } },
        sid
      )
    ).json()) as { result: { isError?: boolean; content: Array<{ text: string }> } }
    expect(bad.result.isError).toBe(true)
    expect(bad.result.content[0].text).toContain('list_designs')
  })

  it('보안 거부 — 무토큰 401 · 악성 Origin 403 · 세션 없는 요청 400', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' })
    const noAuth = await fetch(info.url, { method: 'POST', headers: { 'content-type': 'application/json', accept }, body })
    expect(noAuth.status).toBe(401)

    const evil = await fetch(info.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept, authorization: `Bearer ${info.token}`, origin: 'https://evil.example.com' },
      body
    })
    expect(evil.status).toBe(403)

    const noSession = await post({ jsonrpc: '2.0', id: 11, method: 'tools/list' })
    expect(noSession.status).toBe(400)
  })

  it('본문 상한(4MB) 초과 요청은 처리하지 않는다', async () => {
    const huge = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', pad: 'x'.repeat(4 * 1024 * 1024 + 1024) })
    // 상한 초과 시 서버가 수신을 끊는다 — 연결 리셋(reject) 또는 400, 어느 쪽이든 처리 거부면 통과.
    const outcome = await post(JSON.parse(huge)).then(
      (r) => r.status,
      () => 'rejected'
    )
    expect(outcome === 'rejected' || (typeof outcome === 'number' && outcome >= 400)).toBe(true)
  })

  it('세션 상한(64) 초과 시 가장 오래 안 쓴 세션부터 정리된다', async () => {
    const first = await initSession()
    // 상한을 넘길 만큼 새 세션을 만든다(안 쓴 first 가 밀려나도록)
    for (let i = 0; i < 64; i++) await initSession()
    const res = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, first)
    expect(res.status).toBe(400) // 밀려난 세션 — "세션 없음"
  })

  it('상한 축출은 LRU — 최근에 쓴 세션은 살아남고 유휴 세션이 밀려난다 (감사 M-2 회귀)', async () => {
    const active = await initSession()
    const idle = await initSession()
    // 상한까지 채운 뒤 active 만 한 번 사용 → LRU 순서상 idle 이 앞으로
    for (let i = 0; i < 62; i++) await initSession()
    const touch = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, active)
    expect(touch.status).toBe(200)
    await initSession() // 상한 초과 → LRU(idle) 축출
    const aliveRes = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, active)
    expect(aliveRes.status).toBe(200) // 최근 사용 세션은 생존
    const evictedRes = await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, idle)
    expect(evictedRes.status).toBe(400) // 유휴 세션이 축출됨
  })

  it('접속 키 재발급 — 즉시 적용(구 키 401), 저장소 영속', async () => {
    const oldToken = info.token
    const rotated = rotateMcpToken()
    expect(rotated.token).not.toBe(oldToken)
    // 구 키 → 즉시 401
    const oldRes = await fetch(info.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept, authorization: `Bearer ${oldToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 30, method: 'tools/list' })
    })
    expect(oldRes.status).toBe(401)
    // 새 키로 즉시 동작 (이후 테스트도 새 키 사용)
    info = { ...info, token: rotated.token }
    const sid = await initSession()
    expect(sid).toBeTruthy()
    // 기본 저장소(평문 파일)에 영속 — 재시작 시 재사용될 값
    expect(readFileSync(join(tmp, 'mcp-token'), 'utf8').trim()).toBe(rotated.token)
  })

  it('재시작해도 토큰이 유지된다(클라이언트 설정 안정) · 레거시 mcp.json 정리 · 정지 후 접속 불가', async () => {
    await stopMcp()
    // 과거 버전이 남긴 발견 파일(평문 토큰 포함 가능) — 시작 시 정리돼야 한다
    writeFileSync(join(tmp, 'mcp.json'), '{"token":"legacy-secret"}')
    const again = await startMcp({ dir: tmp, appVersion: '0.0.0-test', port: 0 })
    expect(again!.token).toBe(info.token)
    expect(existsSync(join(tmp, 'mcp.json'))).toBe(false)
    await stopMcp()
    const alive = await fetch(`http://127.0.0.1:${again!.port}/health`).then(
      () => true,
      () => false
    )
    expect(alive).toBe(false)
    // 후속 테스트 없음 — afterAll 의 stopMcp 는 no-op
  })
})
