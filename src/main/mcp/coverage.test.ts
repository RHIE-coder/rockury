import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MCP_EXCLUDED_CHANNELS, MCP_TOOL_CHANNELS } from './coverage'
import { TOOL_NAMES } from './tools'

/**
 * MCP 스테일 방지 핀(기계 강제 — AGENTS.md 불변식) — isolation.test.ts 와 같은 소스 검사 패턴.
 * src/main/ipc/*.ts 의 ipcMain 채널 전수를 노출/제외 지도와 대조한다:
 *  · 새 채널이 지도에 없으면 실패 → 앱 능력이 늘 때 MCP 갱신(또는 의식적 제외)을 강제
 *  · 지도에 남았는데 코드에서 사라진 채널(유령 등재)도 실패 → 지도 자체의 스테일 방지
 *  · 지도의 도구 키 집합 ≠ 실제 등록 도구(TOOL_NAMES) 여도 실패
 */

const IPC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ipc')

/** 소스에서 실제 IPC 채널 전수를 수집 — ipcMain.handle('X')·ipcMain.on('X') 리터럴만 인정. */
function scanIpcChannels(): Set<string> {
  const channels = new Set<string>()
  for (const f of readdirSync(IPC_DIR)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue
    const src = readFileSync(join(IPC_DIR, f), 'utf8')
    for (const m of src.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)) channels.add(m[1])
  }
  return channels
}

describe('MCP 커버리지 핀', () => {
  const actual = scanIpcChannels()
  const exposed = new Set(Object.values(MCP_TOOL_CHANNELS).flat())
  const excluded = new Set(Object.keys(MCP_EXCLUDED_CHANNELS))

  it('IPC 채널 스캔이 동작한다(빈 결과는 스캐너 고장)', () => {
    expect(actual.size).toBeGreaterThan(10)
  })

  it('모든 IPC 채널은 MCP 노출 또는 제외(사유 포함)로 등재된다 — 새 채널을 만들었으면 coverage.ts 를 갱신하라', () => {
    const missing = [...actual].filter((ch) => !exposed.has(ch) && !excluded.has(ch))
    expect(missing, `MCP 노출/제외 미등재 채널: ${missing.join(', ')} → src/main/mcp/coverage.ts 에 도구 대응 또는 제외 사유를 등재하세요`).toEqual([])
  })

  it('지도에 유령 채널이 없다 — 코드에서 지운 채널은 지도에서도 지워라', () => {
    const ghosts = [...exposed, ...excluded].filter((ch) => !actual.has(ch))
    expect(ghosts, `코드에 없는 채널이 지도에 남음: ${ghosts.join(', ')}`).toEqual([])
  })

  it('한 채널이 노출과 제외에 동시 등재되지 않는다', () => {
    const both = [...exposed].filter((ch) => excluded.has(ch))
    expect(both).toEqual([])
  })

  it('지도의 도구 키 = 실제 등록된 MCP 도구(TOOL_NAMES)', () => {
    expect(new Set(Object.keys(MCP_TOOL_CHANNELS))).toEqual(new Set(TOOL_NAMES))
  })

  it('제외 사유는 비어 있지 않다 — "왜 노출 안 하는지"를 반드시 적는다', () => {
    for (const [ch, reason] of Object.entries(MCP_EXCLUDED_CHANNELS)) {
      expect(reason.trim().length, `${ch} 제외 사유 비었음`).toBeGreaterThan(4)
    }
  })

  // CASE-mcp-063 — 삭제류 미노출 핀: "파괴적 조작은 사람이 앱에서만"(spec tools.write AC-7)을
  // 문서가 아니라 테스트가 지킨다. 삭제 채널이 노출 지도에 오르면 실패.
  it('삭제류는 노출되지 않는다 — 파괴 채널은 확정 사유와 함께 제외 지도에만', () => {
    const deletion = [...actual].filter((ch) => /:(delete|clear)|delete[A-Z]/.test(ch))
    expect(deletion.length).toBeGreaterThan(0) // 스캐너 고장 방지
    for (const ch of deletion) {
      expect(exposed.has(ch), `파괴 채널 ${ch} 이 MCP 도구로 노출됨 — 명세 위반`).toBe(false)
    }
    for (const ch of ['designs:delete', 'versions:delete']) {
      expect(MCP_EXCLUDED_CHANNELS[ch], `${ch} 는 확정 사유로 남아야 한다`).toMatch(/사람이 앱에서만/)
    }
    // 도구 이름에도 삭제류가 없다(list/get/create/update/set 만).
    expect(TOOL_NAMES.filter((n) => /delete|remove|drop/.test(n))).toEqual([])
  })
})
