import { describe, expect, it } from 'vitest'
import { changedDesignIds, mergeDesignTables, reconcileActiveTable } from './designScope'
import type { TableDef } from './types'

const t = (designId: string, id: string, name = id): TableDef => ({
  id,
  designId,
  name,
  comment: '',
  columns: [],
  constraints: []
})

describe('changedDesignIds — 설계 스코프 저장의 diff', () => {
  it('같은 참조면 빈 배열', () => {
    const list = [t('a', 'a1')]
    expect(changedDesignIds(list, list)).toEqual([])
  })

  it('한 설계의 테이블만 바뀌면 그 설계만 — 다른 설계는 저장 대상에서 빠진다', () => {
    const a1 = t('a', 'a1')
    const b1 = t('b', 'b1')
    const prev = [a1, b1]
    const next = [{ ...a1, name: 'renamed' }, b1] // a1 만 새 객체
    expect(changedDesignIds(prev, next)).toEqual(['a'])
  })

  it('추가·삭제도 그 설계만 짚는다', () => {
    const a1 = t('a', 'a1')
    const b1 = t('b', 'b1')
    expect(changedDesignIds([a1, b1], [a1, b1, t('b', 'b2')])).toEqual(['b']) // 추가
    expect(changedDesignIds([a1, b1], [a1])).toEqual(['b']) // 마지막 테이블 삭제(비우기)도 감지
  })

  it('여러 설계가 동시에 바뀌면 전부', () => {
    const a1 = t('a', 'a1')
    const b1 = t('b', 'b1')
    const next = [{ ...a1 }, { ...b1 }]
    expect(changedDesignIds([a1, b1], next).sort()).toEqual(['a', 'b'])
  })

  it('새 설계의 첫 테이블도 감지', () => {
    const a1 = t('a', 'a1')
    expect(changedDesignIds([a1], [a1, t('c', 'c1')])).toEqual(['c'])
  })
})

describe('mergeDesignTables — 리하이드레이션 병합', () => {
  it('대상 설계 슬라이스만 교체, 다른 설계는 참조 그대로 보존', () => {
    const a1 = t('a', 'a1')
    const b1 = t('b', 'b1')
    const incoming = [t('a', 'a2', 'from-agent')]
    const merged = mergeDesignTables([a1, b1], 'a', incoming)
    expect(merged.map((x) => x.id).sort()).toEqual(['a2', 'b1'])
    expect(merged.find((x) => x.id === 'b1')).toBe(b1) // 참조 보존 → 불필요한 리렌더 없음
  })

  it('incoming 에 섞인 다른 설계 레코드는 무시(스코프 밖 오염 차단)', () => {
    const merged = mergeDesignTables([t('b', 'b1')], 'a', [t('a', 'a1'), t('b', 'evil')])
    expect(merged.map((x) => x.id).sort()).toEqual(['a1', 'b1'])
  })

  it('빈 incoming = 설계 비우기', () => {
    expect(mergeDesignTables([t('a', 'a1'), t('b', 'b1')], 'a', []).map((x) => x.id)).toEqual(['b1'])
  })
})

describe('reconcileActiveTable — 리하이드레이션 후 활성 테이블 재조정', () => {
  it('활성 테이블이 그대로 있으면 변경 없음', () => {
    const merged = [t('a', 'a1'), t('a', 'a2')]
    expect(reconcileActiveTable('a1', merged, merged)).toEqual({ changed: false, activeTableId: 'a1' })
  })

  it('활성 테이블이 사라지면 갱신된 설계의 첫 테이블로', () => {
    const incoming = [t('a', 'a2'), t('a', 'a3')]
    const merged = [t('b', 'b1'), ...incoming]
    // 편집 중이던 a1 이 에이전트 쓰기로 사라짐 → a2(첫 테이블)로 되돌림
    expect(reconcileActiveTable('a1', merged, incoming)).toEqual({ changed: true, activeTableId: 'a2' })
  })

  it('설계가 통째로 비워지면 빈 활성 id', () => {
    expect(reconcileActiveTable('a1', [t('b', 'b1')], [])).toEqual({ changed: true, activeTableId: '' })
  })

  it('활성 id 가 없으면(빈 문자열) 변경 없음', () => {
    expect(reconcileActiveTable('', [t('a', 'a1')], [t('a', 'a1')])).toEqual({ changed: false, activeTableId: '' })
  })

  it('다른 설계의 활성 테이블은 건드리지 않는다(그 설계는 병합에 남아있음)', () => {
    // 설계 a 를 리하이드레이트하지만 활성은 설계 b 의 b1 — merged 에 b1 이 남아 변경 없음
    const incoming = [t('a', 'a9')]
    const merged = [t('b', 'b1'), ...incoming]
    expect(reconcileActiveTable('b1', merged, incoming)).toEqual({ changed: false, activeTableId: 'b1' })
  })
})
