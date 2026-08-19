import { describe, expect, it } from 'vitest'
import { extractUsage, wantsHelp } from './usage.cjs'

/** 머리 주석 = 사용법이라는 규약이 조용히 깨지지 않게 잡는다. */
describe('extractUsage', () => {
  it('shebang 을 건너뛰고 머리 주석만 뽑는다', () => {
    const src = ['#!/usr/bin/env node', '// 첫 줄', '// 둘째 줄', "import x from 'y'", '// 본문 주석'].join('\n')
    expect(extractUsage(src)).toBe('첫 줄\n둘째 줄')
  })

  it('첫 코드 줄에서 멈춘다 — 아래 주석은 사용법이 아니다', () => {
    expect(extractUsage(['// 설명', 'const a = 1', '// 딴 얘기'].join('\n'))).toBe('설명')
  })

  it('주석 안의 빈 줄은 문단 구분이라 살리고, 꼬리 빈 줄만 떨어낸다', () => {
    const src = ['// 제목', '//', '//   node x.mjs   준비', '//', 'code'].join('\n')
    expect(extractUsage(src)).toBe('제목\n\n  node x.mjs   준비')
  })

  it('머리 주석이 없으면 빈 문자열', () => {
    expect(extractUsage("import x from 'y'\n// 아래 주석")).toBe('')
  })
})

describe('wantsHelp', () => {
  it('--help · -h 를 알아본다', () => {
    expect(wantsHelp(['--help'])).toBe(true)
    expect(wantsHelp(['-h'])).toBe(true)
    expect(wantsHelp(['sync', '--help'])).toBe(true)
  })

  it('없으면 false — 도움말이 아닌 실행이다', () => {
    expect(wantsHelp([])).toBe(false)
    expect(wantsHelp(['sync', '--no-install'])).toBe(false)
  })
})
