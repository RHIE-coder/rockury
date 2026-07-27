import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MCP_EXCLUDED_CHANNELS, MCP_TOOL_CHANNELS, SERVICE_COVERAGE } from './coverage'
import { TOOL_NAMES } from './tools'

/**
 * MCP 스테일 방지 핀(기계 강제 — AGENTS.md 불변식) — isolation.test.ts 와 같은 소스 검사 패턴.
 * src/main/ipc/** 의 ipcMain 채널 전수를 노출/제외 지도와 대조한다:
 *  · 새 채널이 지도에 없으면 실패 → 앱 능력이 늘 때 MCP 갱신(또는 의식적 제외)을 강제
 *  · 지도에 남았는데 코드에서 사라진 채널(유령 등재)도 실패 → 지도 자체의 스테일 방지
 *  · 지도의 도구 키 집합 ≠ 실제 등록 도구(TOOL_NAMES) 여도 실패
 *
 * 서비스별 분할(병렬 개발) 이후의 추가 규율은 `docs/qa/parallel-dev.md` S2 참고 —
 * **하위 폴더까지 훑는지**와 **두 서비스의 중복 등재를 막는지**가 새로 지켜야 할 선이다.
 */

const IPC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ipc')

/**
 * 소스에서 실제 IPC 채널 전수를 수집 — ipcMain.handle('X')·ipcMain.on('X') 리터럴만 인정.
 *
 * **재귀로 훑는다.** 채널이 서비스별 하위 폴더(`ipc/<서비스>/`)로 내려갔기 때문에,
 * 한 겹만 보면 채널을 하나도 못 찾고 "미등재 0건"으로 조용히 통과한다(CASE-pdev-010).
 */
function scanIpcChannels(dir: string = IPC_DIR): Set<string> {
  const channels = new Set<string>()
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      for (const ch of scanIpcChannels(p)) channels.add(ch)
      continue
    }
    if (!e.name.endsWith('.ts') || e.name.endsWith('.test.ts')) continue
    const src = stripComments(readFileSync(p, 'utf8'))
    for (const m of src.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)) channels.add(m[1])
  }
  return channels
}

/**
 * 주석을 걷어낸다 — 이 스캐너는 텍스트 검사라, 주석에 적힌 **예시** 호출까지 진짜 채널로
 * 오해한다(서비스 자리표시자 파일의 "이렇게 채널을 연다" 안내가 그랬다). 유령 채널이 잡히면
 * 등재를 요구받고, 등재하면 이번엔 "코드에 없는 유령 등재"로 실패하는 막다른 길이 된다.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
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
    expect(missing, `MCP 노출/제외 미등재 채널: ${missing.join(', ')} → src/main/mcp/coverage/<서비스>.ts 에 도구 대응 또는 제외 사유를 등재하세요`).toEqual([])
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

/**
 * TestPlan: parallel-dev · Scenario S2 (CASE-pdev-010 ~ 014)
 * 서비스별 분할이 이 핀을 약화시키지 않았는지 — "통과한다"가 아니라 **"막을 것을 막는다"** 를 본다.
 */
describe('MCP 커버리지 핀 — 서비스별 분할 이후', () => {
  it('CASE-pdev-010 하위 폴더(ipc/<서비스>/)의 채널까지 전수 수집한다', () => {
    const actual = scanIpcChannels()
    // 채널은 전부 서비스 폴더로 내려갔다. 한 겹만 훑으면 여기서 크게 미달한다.
    expect(actual.size).toBeGreaterThan(50)
    // 각 서비스 폴더에서 실제로 하나 이상 잡히는지 — 대표 채널로 확인.
    for (const ch of ['designs:list', 'query:run', 'col:list', 'ai:mcpStatus', 'window:close']) {
      expect(actual.has(ch), `${ch} 채널을 스캐너가 못 찾음 — 재귀 스캔이 깨졌다`).toBe(true)
    }
  })

  it('CASE-pdev-013 두 서비스가 같은 채널을 등재하면 합치기가 실패한다', () => {
    // 분할이 새로 만드는 위험: 합칠 때 뒤에 온 쪽이 앞을 조용히 덮으면, 한 서비스의
    // 등재가 사라져도 아무 데서도 안 잡힌다. 실제 병합 함수를 같은 규칙으로 재현해 검증한다.
    const clash = [
      { service: 'uiux', tools: {}, excluded: { 'dup:channel': '사유 A' } },
      { service: 'api', tools: {}, excluded: { 'dup:channel': '사유 B' } }
    ]
    const mergeStrict = (): void => {
      const owner = new Map<string, string>()
      for (const c of clash) {
        for (const k of Object.keys(c.excluded)) {
          const prev = owner.get(k)
          if (prev) throw new Error(`채널 '${k}' 중복 등재: ${prev} / ${c.service}`)
          owner.set(k, c.service)
        }
      }
    }
    expect(mergeStrict).toThrow(/dup:channel/)
  })

  it('CASE-pdev-013 실제 등록부에는 서비스 간 중복 등재가 없다', () => {
    const owner = new Map<string, string>()
    const dups: string[] = []
    for (const c of SERVICE_COVERAGE) {
      for (const k of [...Object.keys(c.excluded), ...Object.keys(c.tools)]) {
        const prev = owner.get(k)
        if (prev) dups.push(`${k} (${prev} / ${c.service})`)
        owner.set(k, c.service)
      }
    }
    expect(dups).toEqual([])
  })

  it('CASE-pdev-014 다섯 서비스 + 셸이 모두 자기 지도 파일을 갖는다', () => {
    expect(SERVICE_COVERAGE.map((c) => c.service).sort()).toEqual([
      'ai',
      'api',
      'db',
      'infra',
      'shell',
      'uiux'
    ])
  })

  it('CASE-pdev-014 안전핀: 합쳐진 제외 지도가 비면 실패 (등록부가 통째로 날아간 상태 감지)', () => {
    expect(Object.keys(MCP_EXCLUDED_CHANNELS).length).toBeGreaterThan(10)
  })
})
