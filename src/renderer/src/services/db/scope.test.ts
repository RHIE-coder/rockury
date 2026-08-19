import { describe, expect, it } from 'vitest'
import type { ConnectionDef } from './connections/store'
import {
  catalogConnectionDraft,
  designSchemas,
  designScopeFace,
  designScopeSummary,
  findConnectionForCatalog,
  reconcileScope,
  scopeFace,
  scopeModel,
  scopeNamesLine,
  scopeSummary,
  scopedTables,
  shownScope,
  toggleDesignSchema,
  toggleSchema
} from './scope'

const conn = (over: Partial<ConnectionDef> = {}): ConnectionDef => ({
  id: 'c1',
  name: 'prod',
  dbType: 'postgresql',
  host: 'db.internal',
  port: 5432,
  database: 'app',
  user: 'rockury',
  sslEnabled: false,
  schemas: [],
  autoCheckDisabled: false,
  groupId: null,
  projectId: null,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
  ...over
})

describe('scopeModel — 벤더마다 다중 선택하는 층이 다르다', () => {
  it('PostgreSQL 은 database 위층 + schema 다중', () => {
    expect(scopeModel('postgresql')).toEqual({
      selectable: true,
      hasCatalogLayer: true,
      schemaLabel: '스키마',
      catalogLabel: '데이터베이스'
    })
  })

  it('MySQL·MariaDB 는 database 다중 — 위층이 없다(교차 database 가 되기 때문)', () => {
    for (const d of ['mysql', 'mariadb'] as const) {
      const m = scopeModel(d)
      expect(m.selectable).toBe(true)
      expect(m.hasCatalogLayer).toBe(false)
      expect(m.schemaLabel).toBe('데이터베이스')
    }
  })

  it('SQLite 는 고를 것이 없다 — 선택기를 안 그린다', () => {
    expect(scopeModel('sqlite').selectable).toBe(false)
  })
})

describe('scopeSummary', () => {
  // 2026-07-30 실측: 손잡이에 "기본"이라 적었더니 사용자가 그것을 못 찾았다("어디있다는거지?").
  // 무엇을 보고 있는지도, 눌러서 뭘 하는지도 안 알려 주는 말이었다.
  it('보여 줄 이름이 하나도 없을 때만 자리 이름으로 둔다 — "기본" 같은 말은 안 쓴다', () => {
    expect(scopeSummary([])).toBe('범위')
  })

  it('하나면 그 이름, 여럿이면 첫 이름 + 나머지 수', () => {
    expect(scopeSummary(['public'])).toBe('public')
    expect(scopeSummary(['public', 'auth'])).toBe('public 외 1')
    expect(scopeSummary(['public', 'auth', 'billing'])).toBe('public 외 2')
  })
})

describe('scopeFace — 두 단으로 접힌 손잡이의 짧은 판', () => {
  /*
   * 처음엔 개수만 적었다(`4`). "4개"인지 "4번"인지 애매하고 어느 스키마를 보고 있나에
   * 답을 못 했다(2026-08-18 사용자 지적) — 그래서 위 손잡이(`public 외 3`)와 같은 문법의
   * 짧은 판으로 바꿨다.
   */
  it('하나면 그 이름만, 여럿이면 첫 이름 + 나머지 수', () => {
    expect(scopeFace(['public'])).toEqual({ head: 'public', rest: 0 })
    expect(scopeFace(['service1', 'service2', 'service3', 'testdb'])).toEqual({
      head: 'service1',
      rest: 3
    })
  })

  it('이름과 수를 **따로** 낸다 — 한 문자열이면 말줄임이 `+3` 을 삼켜 개수가 사라진다', () => {
    const face = scopeFace(['analytics_warehouse_events', 'b', 'c'])
    expect(face.head).toBe('analytics_warehouse_events')
    expect(face.rest).toBe(2)
  })

  it('볼 것이 없으면 자리 이름 — `scopeSummary` 와 같은 규칙', () => {
    expect(scopeFace([])).toEqual({ head: '범위', rest: 0 })
  })

  /*
   * 빈 자리의 말은 **넓은 판과 같아야 한다.** 설계부는 `designScopeSummary` 가 `스키마`,
   * 운영부는 `scopeSummary` 가 `범위` 라 서로 다르다 — 짧은 판이 한 낱말로 고정돼 있던 동안은
   * 폭을 줄이면 `스키마` 가 `범위` 로 바뀌었다(2026-08-18 실측).
   */
  it('빈 자리의 말은 넓은 판과 같다 — 설계부는 `스키마`, 운영부는 `범위`', () => {
    expect(designScopeFace([], [])).toEqual({ head: '스키마', rest: 0 })
    expect(designScopeSummary([], [])).toBe('스키마')
    expect(scopeFace([]).head).toBe(scopeSummary([]))
  })

  it('설계 범위는 안 골랐으면 전부이므로 고를 수 있는 것들을 든다', () => {
    expect(designScopeFace([], ['auth', 'billing', 'public'])).toEqual({ head: 'auth', rest: 2 })
    expect(designScopeFace(['public'], ['auth', 'billing', 'public'])).toEqual({
      head: 'public',
      rest: 0
    })
  })
})

describe('scopeNamesLine — 짧은 판이 감춘 이름을 tooltip 이 밝힌다', () => {
  it('고른 것을 다 적는다', () => {
    expect(scopeNamesLine(['service1', 'testdb'])).toBe('보는 중: service1 · testdb')
  })

  it('밝힐 것이 없으면 빈 문자열 — 부르는 쪽이 그 줄을 아예 안 넣는다', () => {
    expect(scopeNamesLine([])).toBe('')
  })
})

describe('reconcileScope — 저장된 범위를 그대로 믿지 않는다', () => {
  it('없어진 스키마는 떨어뜨린다', () => {
    expect(reconcileScope(['public', 'gone'], ['public', 'auth'])).toEqual(['public'])
  })

  it('순서는 고를 수 있는 목록을 따른다 — 매번 같은 순서로 읽게', () => {
    expect(reconcileScope(['public', 'auth'], ['auth', 'public'])).toEqual(['auth', 'public'])
  })

  it('하나도 안 남으면 빈 배열 = 기본 스키마로 되돌아간다', () => {
    expect(reconcileScope(['gone'], ['public'])).toEqual([])
  })
})

describe('shownScope — 손잡이에 적을 이름', () => {
  it('고른 것이 있으면 그것을 쓴다', () => {
    expect(shownScope(['auth'], [{ schema: 'public' }])).toEqual(['auth'])
  })

  it('안 골랐으면 지금 화면에 올라온 스키마를 쓴다 — 손잡이가 늘 비어 보이지 않게', () => {
    expect(shownScope([], [{ schema: 'public' }, { schema: 'public' }])).toEqual(['public'])
    expect(shownScope([], [{ schema: 'public' }, { schema: 'auth' }])).toEqual(['auth', 'public'])
  })

  it('아직 아무것도 안 읽었으면 빈 목록', () => {
    expect(shownScope([], [])).toEqual([])
    expect(shownScope([], [{ schema: undefined }])).toEqual([])
  })
})

describe('toggleSchema', () => {
  it('없으면 켜고 있으면 끈다', () => {
    expect(toggleSchema(['public'], 'auth')).toEqual(['public', 'auth'])
    expect(toggleSchema(['public', 'auth'], 'auth')).toEqual(['public'])
  })

  it('마지막 하나는 못 끈다 — 다 끄면 빈 화면이 되고 그건 고장으로 읽힌다', () => {
    expect(toggleSchema(['public'], 'public')).toEqual(['public'])
  })
})

describe('findConnectionForCatalog — PostgreSQL 의 database 전환은 연결 전환이다', () => {
  const from = conn()
  const other = conn({ id: 'c2', name: 'prod-analytics', database: 'analytics' })

  it('같은 서버·계정에서 그 database 를 보는 연결을 찾는다', () => {
    expect(findConnectionForCatalog([from, other], from, 'analytics')?.id).toBe('c2')
  })

  it('지금 보고 있는 database 를 고르면 자기 자신 — 갈아탈 것이 없다', () => {
    expect(findConnectionForCatalog([from, other], from, 'app')?.id).toBe('c1')
  })

  it('서버·포트·계정 중 하나라도 다르면 다른 연결로 치지 않는다', () => {
    const otherHost = conn({ id: 'c3', host: 'db.other', database: 'analytics' })
    const otherUser = conn({ id: 'c4', user: 'someone', database: 'analytics' })
    const otherPort = conn({ id: 'c5', port: 5433, database: 'analytics' })
    expect(findConnectionForCatalog([otherHost, otherUser, otherPort], from, 'analytics')).toBeNull()
  })

  it('없으면 null — 말없이 만들지 않고 물어봐야 한다는 신호', () => {
    expect(findConnectionForCatalog([from], from, 'billing')).toBeNull()
  })
})

describe('catalogConnectionDraft', () => {
  it('자격은 그대로 물려받고 database 만 바꾼다', () => {
    const draft = catalogConnectionDraft(conn({ sslEnabled: true }), 'billing')
    expect(draft).toEqual({
      name: 'prod · billing',
      dbType: 'postgresql',
      host: 'db.internal',
      port: 5432,
      database: 'billing',
      user: 'rockury',
      sslEnabled: true,
      sslConfig: undefined
    })
  })
})

// ── 설계부의 범위 ─────────────────────────────────────────────────────────────
// 운영부와 개념은 같지만 **빈 배열의 뜻이 반대**다: 연결은 "기본 하나", 설계는 "전부".
const t = (schema: string, name: string) => ({ schema, name })

describe('designSchemas — 설계에 실제로 든 스키마', () => {
  it('중복을 접고 이름순으로 준다', () => {
    expect(designSchemas([t('public', 'users'), t('auth', 'sessions'), t('public', 'posts')])).toEqual([
      'auth',
      'public'
    ])
  })

  it('스키마가 안 붙은 행은 세지 않는다', () => {
    expect(designSchemas([{ schema: undefined }, t('public', 'users')])).toEqual(['public'])
  })
})

describe('scopedTables', () => {
  const tables = [t('public', 'users'), t('auth', 'sessions'), t('billing', 'invoices')]

  it('안 골랐으면 전부 — 설계는 이미 손안에 있어 감출 이유가 없다', () => {
    expect(scopedTables(tables, [])).toHaveLength(3)
  })

  it('고른 스키마의 것만 남긴다', () => {
    expect(scopedTables(tables, ['auth']).map((x) => x.name)).toEqual(['sessions'])
    expect(scopedTables(tables, ['public', 'billing']).map((x) => x.name)).toEqual(['users', 'invoices'])
  })
})

describe('toggleDesignSchema — 마지막을 꺼도 빈 화면이 안 된다', () => {
  const all = ['auth', 'billing', 'public']

  it('전부 보던 중 하나를 끄면 "그것만 빼고 전부"가 된다', () => {
    expect(toggleDesignSchema([], 'auth', all)).toEqual(['billing', 'public'])
  })

  it('하나만 켜 두고 그것을 끄면 전부로 돌아간다(빈 배열)', () => {
    expect(toggleDesignSchema(['auth'], 'auth', all)).toEqual([])
  })

  it('다시 전부가 되면 빈 배열로 접는다 — "전부"의 표현은 하나뿐', () => {
    expect(toggleDesignSchema(['auth', 'billing'], 'public', all)).toEqual([])
  })

  it('꺼진 것을 켜면 더한다', () => {
    expect(toggleDesignSchema(['auth'], 'billing', all)).toEqual(['auth', 'billing'])
  })
})

describe('designScopeSummary', () => {
  it('안 골랐으면 몇 갈래인지 보인다 — "전부"만으로는 고를 것이 있는지 모른다', () => {
    expect(designScopeSummary([], ['auth', 'billing', 'public'])).toBe('전체 3')
  })

  it('스키마가 하나뿐인 설계는 그 이름을 그대로 — 셀 것이 없다', () => {
    expect(designScopeSummary([], ['public'])).toBe('public')
  })

  it('아무 테이블도 없는 새 설계는 자리 이름으로 둔다', () => {
    expect(designScopeSummary([], [])).toBe('스키마')
  })

  it('골랐으면 운영부와 같은 말투', () => {
    expect(designScopeSummary(['auth'], ['auth', 'public'])).toBe('auth')
    expect(designScopeSummary(['auth', 'public'], ['auth', 'billing', 'public'])).toBe('auth 외 1')
  })
})
