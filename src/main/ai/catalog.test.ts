import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildToolCatalog } from './catalog'
import type { ToolDef } from './tools'
import type { ServiceCoverage } from './coverage'

/**
 * 카탈로그 조립 검증 — 입력(도구 정의 + 노출 지도)에서 출력(서비스별 목록)이 결정적으로 나오는지.
 * 앞부분은 손으로 만든 작은 입력으로 규칙만 보고, 마지막에 **실제 정본**으로 한 번 돌려
 * 화면이 기대는 가정(모든 도구가 지도에 있고 서비스가 하나씩 배정됨)이 깨지지 않았는지 본다.
 */

const def = (name: string, inputSchema: z.ZodRawShape = {}): ToolDef => ({
  name,
  description: `${name} 설명`,
  inputSchema,
  handler: () => null
})

describe('buildToolCatalog — 조립 규칙', () => {
  const defs: ToolDef[] = [
    def('list_things', {}),
    def('get_thing', { id: z.string(), fields: z.array(z.string()).optional() })
  ]
  const coverage: ServiceCoverage[] = [
    {
      service: 'demo',
      tools: { list_things: ['demo:list'], get_thing: ['demo:get', 'demo:getDetail'] },
      excluded: { 'demo:delete': '파괴적 조작은 사람이 앱에서만' }
    }
  ]

  it('서비스별로 묶고, 도구마다 설명·덮는 채널을 붙인다', () => {
    const [demo] = buildToolCatalog(defs, coverage)
    expect(demo.service).toBe('demo')
    expect(demo.tools.map((t) => t.name)).toEqual(['list_things', 'get_thing'])
    expect(demo.tools[1].description).toBe('get_thing 설명')
    expect(demo.tools[1].channels).toEqual(['demo:get', 'demo:getDetail'])
  })

  it('인자는 이름 + 필수/선택으로 펼친다', () => {
    const [demo] = buildToolCatalog(defs, coverage)
    expect(demo.tools[0].args).toEqual([])
    expect(demo.tools[1].args).toEqual([
      { name: 'id', optional: false },
      { name: 'fields', optional: true }
    ])
  })

  it('미노출 채널은 사유와 함께 남긴다 — "왜 이 기능은 도구가 없나"의 답', () => {
    const [demo] = buildToolCatalog(defs, coverage)
    expect(demo.excluded).toEqual([{ channel: 'demo:delete', reason: '파괴적 조작은 사람이 앱에서만' }])
  })

  it('지도에만 있고 정의가 없는 도구는 조용히 버리지 않고 던진다', () => {
    const broken: ServiceCoverage[] = [{ service: 'demo', tools: { ghost: ['demo:x'] }, excluded: {} }]
    expect(() => buildToolCatalog(defs, broken)).toThrow(/ghost/)
  })

  it('도구가 하나도 없는 서비스도 자리를 남긴다(제외 사유만 있는 경우)', () => {
    const onlyExcluded: ServiceCoverage[] = [
      { service: 'shellish', tools: {}, excluded: { 'window:close': '원격 노출 실익 없음' } }
    ]
    const [s] = buildToolCatalog(defs, onlyExcluded)
    expect(s.tools).toEqual([])
    expect(s.excluded).toHaveLength(1)
  })
})

describe('buildToolCatalog — 실제 정본', () => {
  it('현재 노출 지도·도구 정의로 어긋남 없이 조립된다', () => {
    const catalog = buildToolCatalog()
    expect(catalog.length).toBeGreaterThan(0)
    const names = catalog.flatMap((s) => s.tools.map((t) => t.name))
    expect(names.length).toBe(new Set(names).size) // 한 도구는 한 서비스만 소유
    expect(names).toContain('list_designs')
    // 설명은 예외 없이 있어야 한다 — 에이전트가 도구를 고르는 유일한 단서다.
    // 반면 채널은 **비어 있을 수 있다**: 창구를 새로 열지 않고 저장소를 직접 읽는 도구가 있다
    // (예: infra_get_node_doc). 그래서 여기서 0 개를 금지하지 않는다.
    for (const t of catalog.flatMap((s) => s.tools)) {
      expect(t.description.length).toBeGreaterThan(0)
    }
  })
})
