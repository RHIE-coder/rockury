import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

/**
 * e2e 안전 불변식 가드(재발 방지) — 앱 구동 스크립트가 **실 앱 DB 를 절대 건드리지 못하게** 강제한다.
 * 과거 smoke.mjs 가 `~/Library/Application Support/Rockury/rockury.db` 를 rmSync 해
 * 사용자 연결을 파괴한 사고가 있었다. 그 회귀가 재도입되면 `npm test` 가 여기서 실패한다.
 *
 * 스모크가 러너(smoke.mjs) + 하네스(lib/) + 스위트(suites/)로 쪼개졌으므로 **e2e 하위 모든 .mjs**
 * 를 훑는다 — 파일을 나눠서 가드를 빠져나가는 일이 없게(가드 우회 차단이 이 테스트의 요점).
 */
const E2E = dirname(fileURLToPath(import.meta.url))

function collectMjs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...collectMjs(p))
    else if (name.endsWith('.mjs')) out.push(p)
  }
  return out
}

const files = collectMjs(E2E).map((p) => ({ path: relative(E2E, p), src: readFileSync(p, 'utf8') }))

describe('e2e 격리 불변식', () => {
  it('스캔 대상이 비지 않는다(가드가 헛돌지 않게)', () => {
    // 러너 + 하네스 + 스위트 12개 + surface 어댑터 → 넉넉히 10개 이상.
    expect(files.length).toBeGreaterThanOrEqual(10)
    expect(files.map((f) => f.path)).toContain('smoke.mjs')
  })

  it('실 앱 userData 경로(Application Support/Rockury)를 참조하지 않는다', () => {
    for (const f of files) expect(f.src, f.path).not.toMatch(/Application Support/)
  })

  it('실 DB 파일을 삭제(rmSync)하지 않는다 — 임시 userData 만 정리', () => {
    for (const f of files) {
      // rmSync 는 임시 userData(USER_DATA) 정리에만 쓰여야 한다.
      const rmCalls = f.src.match(/rmSync\([^)]*\)/g) ?? []
      for (const call of rmCalls) expect(call, f.path).toMatch(/USER_DATA/)
    }
  })

  it('앱을 띄우는 파일은 격리된 임시 userData 를 쓴다(--user-data-dir + mkdtemp)', () => {
    const launchers = files.filter((f) => f.src.includes('electron.launch'))
    expect(launchers.length).toBeGreaterThan(0)
    for (const f of launchers) {
      expect(f.src, f.path).toMatch(/--user-data-dir=/)
      expect(f.src, f.path).toMatch(/mkdtempSync/)
    }
  })
})
