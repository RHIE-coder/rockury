import { describe, expect, it } from 'vitest'
import { Radar } from 'lucide-react'
import type { View } from './types'
import { groupViews, hasGroupLabels } from './viewGroups'

const view = (id: string, group?: string, groupTone?: View['groupTone']): View => ({
  id,
  label: id,
  icon: Radar,
  workspace: () => null,
  group,
  groupTone
})

describe('groupViews', () => {
  it('이름표를 안 쓰면 통째로 한 묶음 — 자리를 안 쓴 모듈은 예전 그대로 그려진다', () => {
    const runs = groupViews([view('a'), view('b'), view('c')])
    expect(runs).toHaveLength(1)
    expect(runs[0].label).toBeUndefined()
    expect(runs[0].views.map((v) => v.id)).toEqual(['a', 'b', 'c'])
  })

  it('이웃한 같은 이름표끼리 묶고 등록 순서를 지킨다', () => {
    const runs = groupViews([
      view('drift', '진단'),
      view('plan', '설계 → 실제', 'design'),
      view('run', '설계 → 실제', 'design'),
      view('import', '실제 → 설계', 'ops'),
      view('compare'),
      view('logs')
    ])
    expect(runs.map((r) => [r.label, r.views.map((v) => v.id)])).toEqual([
      ['진단', ['drift']],
      ['설계 → 실제', ['plan', 'run']],
      ['실제 → 설계', ['import']],
      [undefined, ['compare', 'logs']]
    ])
  })

  it('색조는 묶음의 첫 뷰에서 가져온다', () => {
    const runs = groupViews([view('plan', '설계 → 실제', 'design'), view('run', '설계 → 실제')])
    expect(runs[0].tone).toBe('design')
  })

  it('떨어져 있는 같은 이름표는 합치지 않는다 — 합치면 줄 위의 순서가 뒤집힌다', () => {
    const runs = groupViews([view('a', 'X'), view('b', 'Y'), view('c', 'X')])
    expect(runs.map((r) => r.label)).toEqual(['X', 'Y', 'X'])
  })

  it('빈 목록은 빈 묶음', () => {
    expect(groupViews([])).toEqual([])
  })
})

describe('hasGroupLabels', () => {
  // 회귀: 2026-08-05. 이름표 없는 묶음에도 빈 줄을 세웠더니 다섯 서비스 **모든 화면**의 탭 줄이
  // 한 단씩 높아졌다(피드백 네 건이 같은 말이었다). 이름표를 안 쓰는 줄은 단이 통째로 없어야 한다.
  it('이름표를 안 쓰는 줄은 단이 안 선다 — Migration 말고 전부가 여기 걸린다', () => {
    expect(hasGroupLabels(groupViews([view('a'), view('b'), view('c')]))).toBe(false)
  })

  it('하나라도 이름표가 있으면 단이 선다', () => {
    const runs = groupViews([view('drift', '진단'), view('compare'), view('logs')])
    expect(hasGroupLabels(runs)).toBe(true)
    // 이름 없는 묶음도 그 줄 안에서는 빈 자리를 지켜야 밑선이 안 어긋난다.
    expect(runs.filter((r) => !r.label)).toHaveLength(1)
  })

  it('뷰가 하나도 없으면 단도 없다', () => {
    expect(hasGroupLabels(groupViews([]))).toBe(false)
  })
})
