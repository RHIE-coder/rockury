import { describe, expect, it } from 'vitest'
import type { ModuleArea } from '../nav/types'
import { areaAccent } from './areaAccent'

/**
 * 회귀 가드 — **운영 화면에 설계 색이 켜지지 않는다**(2026-08-01 피드백).
 *
 * 사고 모양: 활성 강조가 `accent`(설계 시안) 한 색으로 고정돼 있어 Remote(운영)를 보는 중에도
 * 탭이 설계 색으로 켜졌다. 눈으로만 보이는 종류라 타입검사·빌드가 못 잡는다 —
 * 부서 색이 섞이는 순간 여기서 깨진다.
 */

const USES = ['tab', 'gate', 'strip'] as const
const AREAS: ModuleArea[] = ['design', 'ops', 'common']

/** 클래스 문자열에서 쓰인 색 토큰만 뽑는다 — `data-[state=active]:bg-accent-2` → `accent-2`. */
function tokensOf(classes: string): string[] {
  return [...classes.matchAll(/(?:bg|text|border)-([a-z][a-z0-9-]*)/g)].map((m) => m[1])
}

const isOpsColor = (t: string): boolean => t === 'accent-2' || t.startsWith('accent-2-')
const isDesignColor = (t: string): boolean =>
  !isOpsColor(t) && (t === 'accent' || t.startsWith('accent-'))

function tokens(area: ModuleArea, split = true): string[] {
  return USES.flatMap((use) => tokensOf(areaAccent(area, split)[use]))
}

describe('areaAccent — 부서로 갈린 서비스(DB)', () => {
  it('운영 구획은 설계 색(시안)을 한 군데도 쓰지 않는다', () => {
    expect(tokens('ops').filter(isDesignColor)).toEqual([])
  })

  it('설계 구획은 운영 색(테라코타)을 한 군데도 쓰지 않는다', () => {
    expect(tokens('design').filter(isOpsColor)).toEqual([])
  })

  it('공통(Reference)은 어느 부서 색도 빌리지 않는다 — 시안이면 설계부로 오인된다', () => {
    const used = tokens('common')
    expect(used.filter(isDesignColor)).toEqual([])
    expect(used.filter(isOpsColor)).toEqual([])
  })

  it('세 구획이 서로 다른 색으로 켜진다 — 같으면 색으로 부서를 못 가른다', () => {
    for (const use of USES) {
      const distinct = new Set(AREAS.map((a) => areaAccent(a, true)[use]))
      expect(distinct.size).toBe(AREAS.length)
    }
  })
})

describe('areaAccent — 구획을 안 쓰는 서비스(uiux·ai)', () => {
  // 이 둘은 이번 변경을 요청한 적이 없다. 부서색이 여기까지 번지면 화면이 통째로 물든다.
  it('강조색은 예전 그대로다 — 앱 1차 강조(시안)', () => {
    for (const use of ['tab', 'gate'] as const) {
      expect(areaAccent('common', false)[use]).toBe(areaAccent('design', true)[use])
    }
  })

  it('뷰 탭 줄에 부서색을 깔지 않는다 — 중립 회색이다', () => {
    const strip = areaAccent('common', false).strip
    expect(tokensOf(strip).filter(isDesignColor)).toEqual([])
    expect(tokensOf(strip).filter(isOpsColor)).toEqual([])
    expect(strip).toContain('bg-panel')
  })

  it('구획 없는 모듈도 같은 자리로 떨어진다 — `Module.area` 는 선택 항목이다', () => {
    expect(areaAccent(undefined, false)).toBe(areaAccent('common', false))
  })
})

describe('areaAccent — 뷰 탭 줄 바탕(strip)', () => {
  it('부서마다 바탕과 테두리를 함께 준다 — 하나만 있으면 줄이 반쪽만 색을 입는다', () => {
    for (const area of AREAS) {
      const strip = areaAccent(area, true).strip
      expect(strip, `${area}: 바탕`).toMatch(/(?:^|\s)bg-/)
      expect(strip, `${area}: 테두리`).toMatch(/(?:^|\s)border-/)
    }
  })

  it('어느 경우에도 흰 바탕은 아니다 — 활성 탭이 흰 카드로 떠오르므로 줄이 희면 안 보인다', () => {
    for (const split of [true, false]) {
      for (const area of AREAS) {
        expect(areaAccent(area, split).strip, `${area}/split=${split}`).not.toContain('bg-canvas')
      }
    }
  })

  it('연한 부서색은 흰색과 섞어 깐다 — 원색 그대로면 흐린 글자가 AA 대비에 미달한다', () => {
    // 실측: `text-muted`(#626d79) on `accent-2-soft`(#f6e6dd) = 4.34:1 → AA(4.5) 미달.
    //       `/60` 으로 섞으면 4.65:1.
    for (const area of ['design', 'ops'] as const) {
      expect(areaAccent(area, true).strip).toMatch(/-soft\/60\b/)
    }
  })
})

describe('areaAccent — 공통', () => {
  it('쓰임마다 클래스가 비어 있지 않다 — 빈 문자열이면 그 자리가 조용히 무색이 된다', () => {
    for (const split of [true, false]) {
      for (const area of AREAS) {
        for (const use of USES) {
          expect(areaAccent(area, split)[use].trim().length).toBeGreaterThan(0)
        }
      }
    }
  })
})
