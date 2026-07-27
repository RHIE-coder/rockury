import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

/**
 * e2e 안전 불변식 가드(재발 방지) — 스모크가 **실 앱 DB 를 절대 건드리지 못하게** 강제한다.
 * 과거 smoke.mjs 가 `~/Library/Application Support/Rockury/rockury.db` 를 rmSync 해
 * 사용자 연결을 파괴한 사고가 있었다. 그 회귀가 재도입되면 `npm test` 가 여기서 실패한다.
 *
 * 흐름이 서비스별 파일(`e2e/flows/<서비스>.mjs`)로 갈라진 뒤로는 **e2e 폴더 전체**를 훑는다 —
 * 한 파일만 보면 새 서비스 흐름이 가드를 그냥 지나친다(TestPlan parallel-dev S1).
 */

const E2E_DIR = dirname(fileURLToPath(import.meta.url))

/** e2e 아래 모든 실행 스크립트(.mjs)를 재귀로 모은다 — 파일 목록을 하드코딩하지 않는다. */
function collectScripts(dir: string = E2E_DIR): { path: string; src: string }[] {
  const out: { path: string; src: string }[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...collectScripts(p))
      continue
    }
    if (!e.name.endsWith('.mjs')) continue
    out.push({ path: relative(E2E_DIR, p), src: readFileSync(p, 'utf8') })
  }
  return out
}

const scripts = collectScripts()
const flows = scripts.filter((s) => s.path.startsWith('flows/'))

describe('e2e 격리 불변식', () => {
  it('검사 대상 스크립트를 실제로 찾았다 — 0건이면 글롭이 깨진 것(통과가 아니라 실패)', () => {
    // 안전핀: 수집이 비면 아래 검사가 전부 "위반 없음"으로 조용히 통과한다.
    expect(scripts.length).toBeGreaterThan(5)
    expect(scripts.map((s) => s.path)).toContain('smoke.mjs')
  })

  it('서비스별 흐름 파일이 전부 검사 대상에 들어온다 — 등록 없이 자동 포함', () => {
    // 다섯 서비스의 흐름 파일이 최소한 잡혀야 한다. **정확히 이 목록**이라고 못박지는 않는다 —
    // 그러면 새 흐름 파일을 놓을 때마다 이 공용 테스트를 고쳐야 해서, 병렬 개발에서
    // 없애려던 공용 파일 충돌이 되살아난다. 수집은 재귀 글롭이라 새 파일도 자동으로 덮인다.
    const names = flows.map((f) => f.path)
    for (const s of ['uiux', 'api', 'db', 'infra', 'ai']) {
      expect(names, `${s} 흐름 파일이 검사 대상에 없다`).toContain(`flows/${s}.mjs`)
    }
  })

  it('실 앱 userData 경로(Application Support/Rockury)를 참조하지 않는다', () => {
    for (const { path: p, src } of scripts) {
      expect(src, `${p} 가 실 앱 userData 경로를 참조한다`).not.toMatch(/Application Support/)
    }
  })

  it('실 DB 파일을 삭제(rmSync)하지 않는다 — 임시 userData 만 정리', () => {
    // rmSync 는 임시 userData(USER_DATA) 정리에만 쓰여야 한다.
    for (const { path: p, src } of scripts) {
      const rmCalls = src.match(/rmSync\([^)]*\)/g) ?? []
      for (const call of rmCalls) {
        expect(call, `${p} 의 rmSync 가 임시 userData 대상이 아니다`).toMatch(/USER_DATA/)
      }
    }
  })

  it('격리된 임시 userData 로 앱을 띄운다(--user-data-dir + mkdtemp)', () => {
    // 앱을 띄우는 곳은 러너(smoke.mjs)와 화면 검증기(surface/verify.mjs) 두 곳이다.
    const launchers = scripts.filter((s) => s.src.includes('electron.launch'))
    expect(launchers.length).toBeGreaterThan(0)
    for (const { path: p, src } of launchers) {
      expect(src, `${p} 가 --user-data-dir 없이 앱을 띄운다`).toMatch(/--user-data-dir=/)
      expect(src, `${p} 가 임시 디렉터리(mkdtempSync)를 쓰지 않는다`).toMatch(/mkdtempSync/)
    }
  })
})
