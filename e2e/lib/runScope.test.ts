import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — 러너 쪽 모듈은 .mjs(타입 선언 없음). 순수 함수라 그대로 불러 검증한다.
import { FULL_ENV, FULL_FLAG, blockedMessage, resolveScope } from './runScope.mjs'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 전체 e2e 는 커밋 훅의 몫이라는 규칙을 **기계가 강제**하는지 본다.
 * 문서에만 적어 뒀을 땐 안 지켜졌다(2026-07-30 사용자 지적, 두 번째) — 그래서 러너가 막는다.
 */
describe('runScope — 전체 실행은 명시적으로 요청해야만 열린다', () => {
  it('인자 없이 부르면 막는다', () => {
    expect(resolveScope({ argv: [], env: {} }).mode).toBe('blocked')
  })

  it('--no-db 같은 다른 플래그만으로는 안 열린다', () => {
    expect(resolveScope({ argv: ['--no-db', '--continue'], env: {} }).mode).toBe('blocked')
  })

  it('--only 는 그 스위트만 돌린다', () => {
    const s = resolveScope({ argv: ['--only=03-a, 04-b ,'], env: {} })
    expect(s.mode).toBe('only')
    expect(s.only).toEqual(['03-a', '04-b'])
  })

  it('빈 --only= 는 전체로 새지 않고 막힌다', () => {
    expect(resolveScope({ argv: ['--only='], env: {} }).mode).toBe('blocked')
  })

  it(`${FULL_FLAG} 또는 ${FULL_ENV}=1 이면 전체가 열린다`, () => {
    expect(resolveScope({ argv: [FULL_FLAG], env: {} }).mode).toBe('full')
    expect(resolveScope({ argv: [], env: { [FULL_ENV]: '1' } }).mode).toBe('full')
  })

  it('E2E_FULL 이 비었거나 0/false 면 안 열린다 — 훅이 빈 변수를 넘겨도 안전하게', () => {
    for (const v of ['', '0', 'false', 'FALSE']) {
      expect(resolveScope({ argv: [], env: { [FULL_ENV]: v } }).mode).toBe('blocked')
    }
  })

  it('막을 때 다음 수(--only · --list · --all)를 다 알려준다', () => {
    const msg = blockedMessage()
    expect(msg).toContain('--only=')
    expect(msg).toContain('--list')
    expect(msg).toContain(FULL_FLAG)
  })
})

/**
 * 2026-07-30 사용자 지시: "내가 따로 명시적으로 e2e 테스트를 지시하기 전까지는 이제 하지마."
 * 그전엔 훅이 src/·e2e/ 변경 커밋마다 전체 한 바퀴를 돌렸다 — 그 자동 실행을 뗐고,
 * **다시 붙는 것을 이 테스트가 막는다**(문서에만 적어 두면 되돌아간다는 걸 이미 겪었다).
 */
describe('커밋 훅은 e2e 를 지시 없이 돌리지 않는다', () => {
  const hook = (): string => fs.readFileSync(path.join(APP, 'scripts/git-hooks/pre-commit'), 'utf8')
  const OPT_IN = 'RUN_E2E'

  it('e2e 호출은 옵트인 변수 뒤에만 있다 — 조건 없이 부르면 실패', () => {
    const text = hook()
    const lines = text.split('\n')
    const callIdx = lines.findIndex((l) => l.includes('npm run e2e') && !l.trimStart().startsWith('#'))
    if (callIdx === -1) return // 훅이 e2e 를 아예 안 부르면 그것도 지시 없이 안 도는 상태다
    const guardIdx = lines.findIndex((l) => !l.trimStart().startsWith('#') && l.includes(OPT_IN) && l.includes('if '))
    expect(guardIdx, `pre-commit 의 e2e 호출이 ${OPT_IN} 조건 밖에 있습니다`).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(callIdx)
  })

  it('돌리는 방법이 훅 안에 적혀 있다 — 지시가 왔을 때 바로 쓴다', () => {
    expect(hook()).toContain(`${OPT_IN}=1`)
  })

  it('정본(AGENTS.md)과 훅이 같은 변수를 말한다', () => {
    const canon = fs.readFileSync(path.join(APP, 'AGENTS.md'), 'utf8')
    expect(canon).toContain(OPT_IN)
    // 자동 실행 시절의 건너뛰기 열쇠 — 남아 있으면 없는 손잡이를 안내하는 셈이다.
    expect(canon).not.toContain('SKIP_E2E')
  })
})
