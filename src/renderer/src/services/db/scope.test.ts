import { describe, expect, it } from 'vitest'
import type { ConnectionDef } from './connections/store'
import {
  catalogConnectionDraft,
  findConnectionForCatalog,
  reconcileScope,
  scopeModel,
  scopeSummary,
  shownScope,
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
