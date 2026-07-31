import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  SERVICE_IDS,
  SHELL_KEY,
  loadBaseline,
  serviceOf,
  splitByService,
  writeBaseline
} from './baseline.mjs'

/**
 * TestPlan: parallel-dev · Scenario S5 (CASE-pdev-040 ~ 041)
 *
 * 화면 품질 기준선을 서비스별 파일로 쪼갠 뒤에도 같은 판정을 내는지 본다.
 * 기준선은 **생성물**이라 손으로 병합할 수 없다 — 쪼개기·합치기가 무손실이 아니면
 * 회귀가 조용히 수용되거나(놓침) 멀쩡한 화면이 차단된다.
 */

const BASELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'baseline')

const sample = [
  { check: 'contrast', formFactor: 'boot', text: 'A' },
  { check: 'contrast', formFactor: 'db/remote/query', text: 'B' },
  { check: 'contrast', formFactor: 'uiux/canvas', text: 'C' },
  { check: 'tap-target', formFactor: 'db/design/seed', text: 'D' },
  { check: 'contrast', formFactor: 'infra/cloud', text: 'E' }
]

describe('화면 기준선 서비스별 분할', () => {
  it('formFactor 첫 마디로 소유 서비스를 정한다', () => {
    expect(serviceOf('db/remote/query')).toBe('db')
    expect(serviceOf('uiux/canvas')).toBe('uiux')
    expect(serviceOf('ai/agents')).toBe('ai')
    // 서비스 이름이 아니면 공용 — 부팅 화면은 어느 서비스 것도 아니다.
    expect(serviceOf('boot')).toBe(SHELL_KEY)
    expect(serviceOf('')).toBe(SHELL_KEY)
    expect(serviceOf(undefined)).toBe(SHELL_KEY)
  })

  it('CASE-pdev-040 쪼갠 뒤 합치면 원래 findings 와 같은 집합이 된다 (누락·중복 0)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rockury-baseline-'))
    writeBaseline(dir, sample)
    const merged = loadBaseline(dir)
    expect(merged.length).toBe(sample.length)
    const key = (f: unknown): string => JSON.stringify(f)
    expect(merged.map(key).sort()).toEqual(sample.map(key).sort())
  })

  it('CASE-pdev-041 서비스별 파일에 자기 것만 담긴다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rockury-baseline-'))
    writeBaseline(dir, sample)
    for (const name of readdirSync(dir)) {
      const service = name.replace(/\.json$/, '')
      const list = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { formFactor: string }[]
      for (const f of list) {
        expect(serviceOf(f.formFactor), `${name} 에 남의 finding 이 들어 있다`).toBe(service)
      }
    }
  })

  it('CASE-pdev-041 빈 서비스도 파일을 남긴다 (내 파일이 어디인지 보이게)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rockury-baseline-'))
    writeBaseline(dir, [])
    expect(readdirSync(dir).sort()).toEqual([SHELL_KEY, ...SERVICE_IDS].sort().map((s) => `${s}.json`))
  })

  it('쓰기→읽기→쓰기 가 안정적이다 (재실행이 파일을 흔들지 않음)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rockury-baseline-'))
    writeBaseline(dir, sample)
    const first = readdirSync(dir).map((n) => readFileSync(join(dir, n), 'utf8'))
    writeBaseline(dir, loadBaseline(dir))
    const second = readdirSync(dir).map((n) => readFileSync(join(dir, n), 'utf8'))
    expect(second).toEqual(first)
  })

  it('기준선 없음(폴더 부재)은 빈 배열 — 첫 실행에서 터지지 않는다', () => {
    expect(loadBaseline(join(tmpdir(), 'rockury-baseline-does-not-exist'))).toEqual([])
  })

  it('실제 기준선 폴더가 서비스별로 정합하다', () => {
    const real = loadBaseline(BASELINE_DIR)
    // 안전핀: 폴더가 비면 모든 회귀가 조용히 통과한다 — 기준선이 날아간 상태를 실패로 본다.
    expect(real.length).toBeGreaterThan(0)
    const groups = splitByService(real)
    for (const [service, list] of Object.entries(groups)) {
      for (const f of list as { formFactor: string }[]) {
        expect(serviceOf(f.formFactor)).toBe(service)
      }
    }
  })
})
