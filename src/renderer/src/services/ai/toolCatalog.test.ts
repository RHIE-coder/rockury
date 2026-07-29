import { describe, expect, it } from 'vitest'
import {
  countTools,
  filterCatalog,
  orderByRail,
  serviceLabel,
  toolSignature,
  type McpServiceTools
} from './toolCatalog'

/** AI › Tools 화면의 순수 로직 검증 — 검색·서명·개수. 화면 없이 입력→출력만 본다. */

const catalog: McpServiceTools[] = [
  {
    service: 'db',
    tools: [
      {
        name: 'get_schema',
        description: '설계의 현재 작업본 스키마를 반환한다',
        args: [
          { name: 'designId', optional: false },
          { name: 'tables', optional: true }
        ],
        channels: ['db:listTables']
      }
    ],
    excluded: [{ channel: 'db:deleteDesign', reason: '파괴적 조작은 사람이 앱에서만' }]
  },
  {
    service: 'uiux',
    tools: [
      {
        name: 'list_ui_projects',
        description: '화면 설계 프로젝트 목록',
        args: [],
        channels: ['uiux:listProjects']
      }
    ],
    excluded: []
  },
  { service: 'ai', tools: [], excluded: [{ channel: 'ai:status', reason: '접속 키 포함' }] }
]

describe('toolSignature', () => {
  it('인자를 괄호 안에 펼치고 선택 인자에는 물음표를 붙인다', () => {
    expect(toolSignature(catalog[0].tools[0])).toBe('get_schema(designId, tables?)')
  })

  it('인자가 없으면 빈 괄호', () => {
    expect(toolSignature(catalog[1].tools[0])).toBe('list_ui_projects()')
  })
})

describe('serviceLabel', () => {
  it('좌측 레일과 같은 이름을 쓴다', () => {
    expect(serviceLabel('uiux')).toBe('UI/UX')
    expect(serviceLabel('shell')).toBe('앱 셸(공용)')
  })

  it('모르는 id 는 그대로 보여 준다 — 이름이 없다고 목록에서 사라지면 안 된다', () => {
    expect(serviceLabel('mystery')).toBe('mystery')
  })
})

describe('orderByRail', () => {
  const g = (service: string): McpServiceTools => ({ service, tools: [], excluded: [] })

  it('좌측 레일 순서로 세운다', () => {
    const out = orderByRail([g('db'), g('ai'), g('uiux'), g('infra'), g('api')])
    expect(out.map((s) => s.service)).toEqual(['uiux', 'api', 'db', 'infra', 'ai'])
  })

  it('레일에 없는 것(shell)은 맨 뒤로 보낸다', () => {
    const out = orderByRail([g('shell'), g('db'), g('uiux')])
    expect(out.map((s) => s.service)).toEqual(['uiux', 'db', 'shell'])
  })

  it('원본을 건드리지 않는다', () => {
    const input = [g('db'), g('uiux')]
    orderByRail(input)
    expect(input.map((s) => s.service)).toEqual(['db', 'uiux'])
  })
})

describe('countTools', () => {
  it('서비스를 가로질러 도구 수를 센다', () => {
    expect(countTools(catalog)).toBe(2)
  })
})

describe('filterCatalog', () => {
  it('검색어가 비면 도구 0개인 서비스까지 그대로 남긴다', () => {
    const out = filterCatalog(catalog, '  ')
    expect(out.map((s) => s.service)).toEqual(['db', 'uiux', 'ai'])
  })

  it('도구 이름으로 찾는다', () => {
    const out = filterCatalog(catalog, 'get_sch')
    expect(out).toHaveLength(1)
    expect(out[0].tools.map((t) => t.name)).toEqual(['get_schema'])
  })

  it('설명으로도 찾는다', () => {
    expect(filterCatalog(catalog, '스키마')[0].tools[0].name).toBe('get_schema')
  })

  it('인자 이름으로도 찾는다', () => {
    expect(filterCatalog(catalog, 'designId')[0].tools[0].name).toBe('get_schema')
  })

  it('덮는 앱 능력(채널)으로도 찾는다 — 채널 이름만 알아도 도구에 닿는다', () => {
    expect(filterCatalog(catalog, 'uiux:listProjects')[0].tools[0].name).toBe('list_ui_projects')
  })

  it('대소문자를 가리지 않는다', () => {
    expect(filterCatalog(catalog, 'GET_SCHEMA')).toHaveLength(1)
  })

  it('미노출 사유로도 찾히고, 그 서비스는 도구가 0개여도 남는다', () => {
    const out = filterCatalog(catalog, '접속 키')
    expect(out.map((s) => s.service)).toEqual(['ai'])
    expect(out[0].excluded[0].channel).toBe('ai:status')
  })

  it('아무것도 안 걸리면 빈 목록', () => {
    expect(filterCatalog(catalog, 'zzz없는말')).toEqual([])
  })

  it('원본을 건드리지 않는다', () => {
    filterCatalog(catalog, 'get_schema')
    expect(catalog[1].tools).toHaveLength(1)
  })
})
