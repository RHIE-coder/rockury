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

describe('커밋 훅은 전체를 돌린다', () => {
  it('pre-commit 이 열쇠를 붙여 부른다 — 안 붙이면 커밋 게이트가 통째로 막힌다', () => {
    const hook = fs.readFileSync(path.join(APP, 'scripts/git-hooks/pre-commit'), 'utf8')
    const line = hook.split('\n').find((l) => l.includes('npm run e2e') && !l.trimStart().startsWith('#'))
    expect(line, 'pre-commit 에서 e2e 호출 줄을 못 찾았습니다').toBeTruthy()
    expect(line).toContain(FULL_FLAG)
  })
})
