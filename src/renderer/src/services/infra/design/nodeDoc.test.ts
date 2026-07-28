import { describe, it, expect } from 'vitest'
import { isDocEmpty, normalizeDoc, docFromTemplate, docSummaryForAgent } from './nodeDoc'
import { EMPTY_DOC, type NodeDoc } from '../catalog/types'

describe('normalizeDoc — 저장·복원', () => {
  it('CASE-iarch-050 정해진 칸 다섯 + 자유 서술이 함께 보존된다', () => {
    const doc: NodeDoc = {
      role: '결제 웹훅 수신기',
      impact: '죽으면 결제가 유실된다',
      owner: '결제팀',
      deps: '앞: ALB / 뒤: RDS',
      beforeTouch: '재시작 전 큐를 비운다',
      notes: '## 메모\n- 배포는 화요일',
      links: [{ label: '런북', url: 'https://example.com/runbook' }]
    }
    expect(normalizeDoc(doc)).toEqual(doc)
  })

  it('빠진 칸은 빈 문자열로 채워 모양을 고정한다', () => {
    const r = normalizeDoc({ role: '역할만' })
    expect(r.role).toBe('역할만')
    expect(r.impact).toBe('')
    expect(r.links).toEqual([])
  })

  it('입력이 없거나 망가져도 빈 문서를 준다(저장된 JSON 이 깨져도 화면이 산다)', () => {
    expect(normalizeDoc(undefined)).toEqual(EMPTY_DOC)
    expect(normalizeDoc(null)).toEqual(EMPTY_DOC)
    expect(normalizeDoc('문자열' as unknown)).toEqual(EMPTY_DOC)
    expect(normalizeDoc({ links: '배열아님' } as unknown)).toEqual(EMPTY_DOC)
  })

  it('링크 항목 중 모양이 깨진 것만 버리고 성한 것은 남긴다', () => {
    const r = normalizeDoc({ links: [{ label: 'ok', url: 'u' }, { label: '없음' }, 3] } as unknown)
    expect(r.links).toEqual([{ label: 'ok', url: 'u' }])
  })
})

describe('docFromTemplate — 빈 종이 앞에 앉히지 않는다', () => {
  it('CASE-iarch-051 종류의 기본 문서 틀이 새 노드에 미리 채워진다', () => {
    const r = docFromTemplate({ role: '메시지 큐', beforeTouch: '컨슈머부터 내린다' })
    expect(r.role).toBe('메시지 큐')
    expect(r.beforeTouch).toBe('컨슈머부터 내린다')
    expect(r.impact).toBe('')
  })

  it('CASE-iarch-051 틀이 없으면 빈 문서다', () => {
    expect(docFromTemplate(undefined)).toEqual(EMPTY_DOC)
  })
})

describe('isDocEmpty — "설명 없음" 판정', () => {
  it('CASE-iarch-052 정해진 칸이 전부 비고 자유 서술도 비면 설명 없음', () => {
    expect(isDocEmpty(EMPTY_DOC)).toBe(true)
    expect(isDocEmpty(normalizeDoc({ role: '   ', notes: '\n\t' }))).toBe(true)
  })

  it('CASE-iarch-052 하나라도 차 있으면 설명 없음이 아니다', () => {
    expect(isDocEmpty(normalizeDoc({ role: '역할' }))).toBe(false)
    expect(isDocEmpty(normalizeDoc({ notes: '메모' }))).toBe(false)
    expect(isDocEmpty(normalizeDoc({ links: [{ label: 'a', url: 'b' }] }))).toBe(false)
  })
})

describe('docSummaryForAgent — MCP 로 나가는 알맹이', () => {
  const doc = normalizeDoc({
    role: '결제 웹훅 수신기',
    impact: '죽으면 결제가 유실된다',
    deps: '앞: ALB / 뒤: RDS',
    owner: '결제팀'
  })

  it('CASE-iarch-053 의존과 영향이 반드시 포함된다 — 이름만 주면 에이전트도 어쩌라는 건지 모른다', () => {
    const s = docSummaryForAgent({ name: 'payment-hook', typeLabel: 'EC2', doc })
    expect(s.impact).toBe('죽으면 결제가 유실된다')
    expect(s.deps).toBe('앞: ALB / 뒤: RDS')
    expect(s.role).toBe('결제 웹훅 수신기')
    expect(s.name).toBe('payment-hook')
  })

  it('CASE-iarch-053 문서가 비었으면 비었다고 표시해 내보낸다 — 조용히 빈 값을 주지 않는다', () => {
    const s = docSummaryForAgent({ name: 'x', typeLabel: 'EC2', doc: EMPTY_DOC })
    expect(s.documented).toBe(false)
    const filled = docSummaryForAgent({ name: 'x', typeLabel: 'EC2', doc })
    expect(filled.documented).toBe(true)
  })
})
