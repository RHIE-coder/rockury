import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * e2e 안전 불변식 가드(재발 방지) — 스모크가 **실 앱 DB 를 절대 건드리지 못하게** 강제한다.
 * 과거 smoke.mjs 가 `~/Library/Application Support/Rockury/rockury.db` 를 rmSync 해
 * 사용자 연결을 파괴한 사고가 있었다. 그 회귀가 재도입되면 `npm test` 가 여기서 실패한다.
 */
const smoke = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'smoke.mjs'), 'utf8')

describe('e2e 격리 불변식', () => {
  it('실 앱 userData 경로(Application Support/Rockury)를 참조하지 않는다', () => {
    expect(smoke).not.toMatch(/Application Support/)
  })

  it('실 DB 파일을 삭제(rmSync)하지 않는다 — 임시 userData 만 정리', () => {
    // rmSync 는 임시 userData(USER_DATA) 정리에만 쓰여야 한다.
    const rmCalls = smoke.match(/rmSync\([^)]*\)/g) ?? []
    for (const call of rmCalls) expect(call).toMatch(/USER_DATA/)
  })

  it('격리된 임시 userData 로 앱을 띄운다(--user-data-dir + mkdtemp)', () => {
    expect(smoke).toMatch(/--user-data-dir=/)
    expect(smoke).toMatch(/mkdtempSync/)
  })
})
