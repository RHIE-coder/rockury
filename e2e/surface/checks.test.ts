import { describe, it, expect } from 'vitest'
import {
  relativeLuminance,
  contrastRatio,
  isLargeText,
  findingKey,
  runChecks,
  exitCodeFor,
  CONTRAST_MIN,
} from './checks.mjs'

// 정규화 캡처 헬퍼 — 테스트가 원하는 요소만 얹는다.
const cap = (elements, extra = {}) => ({
  surface: 'native-desktop',
  target: 'test',
  formFactor: { label: 'mid', w: 1200, h: 800, unit: 'px' },
  status: 'ok',
  capture: '',
  errors: [],
  elements,
  meta: { adapter: 'test', adapterVersion: '0', caveats: [] },
  ...extra,
})
const textEl = (fg, bg, over = {}) => ({
  role: 'text', text: 'hello', fg, bg, bounds: { x: 10, y: 10, w: 100, h: 20 },
  states: [], interactive: false, truncated: false, essential: true, fontSize: 14, bold: false, ...over,
})

describe('상대휘도·대비비 (WCAG 2.2)', () => {
  it('흑백 극단', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5)
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5)
  })
  it('대비비: 검정/흰색 = 21, 동색 = 1', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 2)
    expect(contrastRatio([120, 120, 120], [120, 120, 120])).toBeCloseTo(1, 5)
  })
  it('대비비는 순서 무관', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(contrastRatio([255, 255, 255], [0, 0, 0]), 6)
  })
  it('토큰 ink(#17202b) on canvas(#fff) 는 본문 통과', () => {
    expect(contrastRatio([0x17, 0x20, 0x2b], [255, 255, 255])).toBeGreaterThan(CONTRAST_MIN.normal)
  })
})

describe('isLargeText', () => {
  it('24px 이상은 큼', () => expect(isLargeText(24, false)).toBe(true))
  it('18.66px + bold 는 큼, non-bold 는 아님', () => {
    expect(isLargeText(19, true)).toBe(true)
    expect(isLargeText(19, false)).toBe(false)
  })
  it('fontSize 없으면 false', () => expect(isLargeText(undefined, true)).toBe(false))
})

describe('runChecks — 검사 카탈로그', () => {
  it('충분한 대비는 통과(ok, exit 0)', () => {
    const r = runChecks([cap([textEl([0x23, 0x2b, 0x34], [255, 255, 255])])])
    expect(r.status).toBe('ok')
    expect(r.blockingCount).toBe(0)
    expect(exitCodeFor(r.status)).toBe(0)
  })
  it('낮은 대비는 차단(block, exit 1)', () => {
    const r = runChecks([cap([textEl([200, 200, 200], [255, 255, 255])])])
    expect(r.status).toBe('block')
    expect(r.findings.some((f) => f.check === 'contrast' && f.severity === 'block')).toBe(true)
    expect(exitCodeFor(r.status)).toBe(1)
  })
  it('큰 텍스트는 완화 임계값(3.0) 적용', () => {
    // 대비 ~3.35 인 색쌍: 본문(4.5)엔 걸리고 큰 텍스트(3.0)엔 통과.
    const fg = [140, 140, 140]
    const small = runChecks([cap([textEl(fg, [255, 255, 255], { fontSize: 14 })])])
    const large = runChecks([cap([textEl(fg, [255, 255, 255], { fontSize: 30 })])])
    expect(small.blockingCount).toBe(1)
    expect(large.blockingCount).toBe(0)
  })
  it('essential && truncated 는 차단', () => {
    const r = runChecks([cap([textEl([0, 0, 0], [255, 255, 255], { truncated: true })])])
    expect(r.findings.some((f) => f.check === 'truncation')).toBe(true)
  })
  it('가로 넘침은 차단, 세로 넘침은 무시', () => {
    const wide = runChecks([cap([textEl([0, 0, 0], [255, 255, 255], { bounds: { x: 10, y: 10, w: 1300, h: 20 } })])])
    const tall = runChecks([cap([textEl([0, 0, 0], [255, 255, 255], { bounds: { x: 10, y: 900, w: 100, h: 20 } })])])
    expect(wide.findings.some((f) => f.check === 'fits')).toBe(true)
    expect(tall.findings.some((f) => f.check === 'fits')).toBe(false)
  })
  it('상호작용 요소 겹침은 차단', () => {
    const a = { role: 'button', text: 'A', fg: null, bg: null, bounds: { x: 0, y: 0, w: 100, h: 40 }, states: [], interactive: true, truncated: false, essential: false }
    const b = { ...a, role: 'button', text: 'B', bounds: { x: 50, y: 0, w: 100, h: 40 } }
    const r = runChecks([cap([a, b])])
    expect(r.findings.some((f) => f.check === 'overlap')).toBe(true)
  })
  it('cannot-verify 캡처는 검증불가로 전파(exit 2)', () => {
    const r = runChecks([{ status: 'cannot-verify', formFactor: { label: 'mid' } }])
    expect(r.status).toBe('cannot-verify')
    expect(exitCodeFor(r.status)).toBe(2)
  })
  it('render-ok: 에러가 있으면 차단', () => {
    const r = runChecks([cap([], { errors: ['Uncaught TypeError: x'] })])
    expect(r.findings.some((f) => f.check === 'render-ok' && f.severity === 'block')).toBe(true)
  })
})

describe('기준선 diff', () => {
  it('기준선에 있던 finding 은 차단에서 관찰로 강등', () => {
    const bad = cap([textEl([200, 200, 200], [255, 255, 255])])
    const first = runChecks([bad])
    expect(first.blockingCount).toBe(1)
    const second = runChecks([bad], { baseline: first.findings })
    expect(second.blockingCount).toBe(0)
    expect(second.findings.every((f) => f.severity === 'observe')).toBe(true)
  })
  it('findingKey 는 같은 finding 에 안정적', () => {
    const f = { check: 'contrast', formFactor: 'mid', role: 'text', text: 'hello', bounds: { x: 10, y: 10, w: 100, h: 20 } }
    expect(findingKey(f)).toBe(findingKey({ ...f }))
  })
  it('기준선 매칭은 bounds 흔들림을 무시(위치만 바뀐 같은 finding 은 여전히 수용)', () => {
    const first = runChecks([cap([textEl([200, 200, 200], [255, 255, 255])])])
    const moved = cap([textEl([200, 200, 200], [255, 255, 255], { bounds: { x: 500, y: 400, w: 100, h: 20 } })])
    const second = runChecks([moved], { baseline: first.findings })
    expect(second.blockingCount).toBe(0)
  })
})
