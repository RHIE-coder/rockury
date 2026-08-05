import { beforeAll, describe, expect, it, vi } from 'vitest'
import { areaRuns, groupBySlot, handlesFor } from '@renderer/nav/moduleSlots'
import type { Service } from '@renderer/nav/types'

/**
 * DB 서비스 선언 무결성. 깨져도 타입검사·빌드는 통과하고 **화면만 조용히 이상해진다** —
 * 탭이 사라지거나, 대상 고르는 손잡이가 통째로 없어지거나, 부서 색이 뒤바뀐다.
 *
 * 여기 붙드는 것은 사용자가 자리를 두고 여러 번 뒤집은 결정들이다(모듈 줄 세 칸 · 건너가는 자리 ·
 * Migration 만 손잡이 둘). 라벨 문자열을 그대로 옮겨 적지는 않는다.
 */

/**
 * 서비스 선언을 읽으려면 트리 전체를 임포트해야 하는데, 그 길에 화면 스토어들이 딸려 오고
 * 몇몇은 **임포트되는 순간** IPC 를 부른다(`db/rehydration`, `api/store`). 어떤 경로를 불러도
 * 조용히 빈 값을 주는 대역을 먼저 세워 둔다 — 선언만 보는 테스트라 실제 응답은 필요 없다.
 */
const ipcStub: unknown = new Proxy(function () {}, {
  get: () => ipcStub,
  apply: () => Promise.resolve([])
})

let dbService: Service

beforeAll(async () => {
  vi.stubGlobal('window', { rockury: ipcStub })
  // 대역을 세운 **뒤에** 불러온다 — 정적 임포트는 이 줄보다 먼저 돈다.
  //
  // 들머리는 `./index` 가 아니라 **레지스트리**여야 한다. 서비스들과 nav 스토어는 서로를
  // 참조해서(`db/designs/store` → `useNav` → `registry` → 서비스들), 어느 쪽을 먼저 여느냐에 따라
  // 절반만 초기화된 모듈이 남는다 — 앱도 레지스트리부터 연다. 서비스 하나만 콕 집어 열면
  // `useNav` 가 아직 안 만들어진 채로 api 스토어가 구독을 걸다 터진다.
  const { registry } = await import('@renderer/nav/registry')
  dbService = registry.find((s) => s.id === 'db')!
})

describe('dbService — 모듈 줄', () => {
  const byId = (id: string) => dbService.modules.find((m) => m.id === id)

  it('모듈은 셋뿐이다 — Versions·Reference 는 2026-08-03 에 Design 안 뷰로 내려갔다', () => {
    expect(dbService.modules.map((m) => m.id)).toEqual(['design', 'migration', 'remote'])
  })

  it('첫 착지는 설계부(Design)다', () => {
    expect(dbService.modules[0].id).toBe('design')
    expect(byId('design')?.area).toBe('design')
  })

  it('Design 뷰 줄이 설계부에서 하는 일을 전부 담는다', () => {
    expect(byId('design')?.views?.map((v) => v.id)).toEqual([
      'definition',
      'diagram',
      'seed',
      // 라이브러리 — 소속이 연결에서 설계로 옮겨져 생긴 자리(2026-08-04).
      'query',
      'collection',
      'mocking',
      'documenting',
      'validation',
      'versions',
      'reference'
    ])
  })

  it('Migration 은 두 부서 사이 건너가는 자리이고 색은 중립(common)이다', () => {
    expect(byId('migration')?.slot).toBe('center')
    expect(byId('migration')?.area).toBe('common')
  })

  it('Migration 만 손잡이를 둘 든다 — 설계와 실 DB 를 견주기 때문이다', () => {
    expect(handlesFor(byId('migration')!)).toEqual(['design', 'ops'])
    expect(handlesFor(byId('design')!)).toEqual(['design'])
    expect(handlesFor(byId('remote')!)).toEqual(['ops'])
  })

  it('모듈 id 와 한 모듈 안의 뷰 id 는 겹치지 않는다', () => {
    const ids = dbService.modules.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of dbService.modules) {
      const viewIds = (m.views ?? []).map((v) => v.id)
      expect(new Set(viewIds).size, `${m.id} 의 뷰 id 중복`).toBe(viewIds.length)
    }
  })
})

describe('dbService — 모듈 줄의 세 카드', () => {
  // 2026-08-04 사용자 요청 — 왼쪽은 설계 카드, 오른쪽은 운영 카드, 가운데는 건너가는 문.
  it('가운데는 Migration 하나뿐 — 문이 줄 한가운데에 선다', () => {
    expect(groupBySlot(dbService.modules).center.map((m) => m.id)).toEqual(['migration'])
  })

  it('왼쪽 자리는 설계 카드 한 장, 오른쪽 자리는 운영 카드 한 장', () => {
    const zones = groupBySlot(dbService.modules)
    expect(areaRuns(zones.start).map((r) => r.area)).toEqual(['design'])
    expect(areaRuns(zones.end).map((r) => r.area)).toEqual(['ops'])
  })
})

describe('dbService — 컨텍스트 셀렉터', () => {
  it('전부 구획 손잡이로 간다 — 상단 컨텍스트 바가 없다(2026-07-30 사용자 결정)', () => {
    const ctx = dbService.context ?? []
    expect(ctx.length).toBeGreaterThan(0)
    // `area` 가 하나라도 빠지면 그 셀렉터만 상단 바로 튀어 나가 없앤 줄이 되살아난다.
    for (const c of ctx) expect(c.area, `${c.id} 에 area 가 없다`).toBeTruthy()
  })
})
