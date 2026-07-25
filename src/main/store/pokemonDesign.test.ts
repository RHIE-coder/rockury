import { describe, it, expect } from 'vitest'
import { POKEMON_DESIGN, POKEMON_TABLES } from './pokemonDesign'

/**
 * 포켓몬 설계 데이터 정합성 검증.
 * 16개 테이블을 손으로 옮겼으므로 "입력→출력이 결정적인" 빌더 출력의 구조 무결성을
 * 기계로 못박는다(FK 대상 존재·컬럼 참조 해소·id 유일·PK 존재 등). 오타·끊긴 참조를 잡는다.
 */

interface Col { id: string; name: string; type: string; nullable: boolean; defaultValue: string | null; comment: string }
interface ColRef { columnId: string; direction?: string }
interface Constraint {
  id: string
  kind: 'pk' | 'uk' | 'fk' | 'check' | 'idx'
  name: string
  columns: ColRef[]
  refTable?: string
  refColumns?: string[]
  onDelete?: string
}
const cols = (t: (typeof POKEMON_TABLES)[number]): Col[] => t.columns as Col[]
const cons = (t: (typeof POKEMON_TABLES)[number]): Constraint[] => t.constraints as Constraint[]

describe('POKEMON_DESIGN', () => {
  it('postgresql 방언 · 안정적 id', () => {
    expect(POKEMON_DESIGN.dialect).toBe('postgresql')
    expect(POKEMON_DESIGN.id).toBe('pokemon-tcg')
    expect(POKEMON_DESIGN.name.length).toBeGreaterThan(0)
  })
})

describe('POKEMON_TABLES 정합성', () => {
  it('YAML 의 16개 테이블을 모두 담는다', () => {
    expect(POKEMON_TABLES).toHaveLength(16)
  })

  it('테이블 id·이름은 전역 유일하고 모두 설계에 속한다', () => {
    const ids = POKEMON_TABLES.map((t) => t.id)
    const names = POKEMON_TABLES.map((t) => t.name)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(names).size).toBe(names.length)
    for (const t of POKEMON_TABLES) expect(t.designId).toBe(POKEMON_DESIGN.id)
  })

  it('컬럼 id 는 테이블 안에서 유일하고, 이름·주석·타입이 비지 않는다', () => {
    for (const t of POKEMON_TABLES) {
      const ids = cols(t).map((c) => c.id)
      expect(new Set(ids).size, `${t.name} 컬럼 id 중복`).toBe(ids.length)
      for (const c of cols(t)) {
        expect(c.name.length, `${t.name} 컬럼명 비었음`).toBeGreaterThan(0)
        expect(c.type.length, `${t.name}.${c.name} 타입 비었음`).toBeGreaterThan(0)
        expect(c.comment.length, `${t.name}.${c.name} 주석 비었음`).toBeGreaterThan(0)
      }
    }
  })

  it('모든 테이블은 정확히 1개의 단일 컬럼 PK 를 가진다', () => {
    for (const t of POKEMON_TABLES) {
      const pks = cons(t).filter((k) => k.kind === 'pk')
      expect(pks.length, `${t.name} PK 개수`).toBe(1)
      expect(pks[0].columns.length, `${t.name} PK 컬럼 수`).toBe(1)
    }
  })

  it('제약이 참조하는 컬럼 id 는 모두 같은 테이블 안에서 해소된다', () => {
    for (const t of POKEMON_TABLES) {
      const colIds = new Set(cols(t).map((c) => c.id))
      for (const k of cons(t)) {
        for (const r of k.columns) {
          expect(colIds.has(r.columnId), `${t.name} 제약 ${k.name} → 미상 컬럼 ${r.columnId}`).toBe(true)
        }
      }
    }
  })

  it('FK 는 컬럼:참조컬럼이 1:1 이고, 대상 테이블의 PK/UNIQUE 컬럼을 가리킨다', () => {
    const byName = new Map(POKEMON_TABLES.map((t) => [t.name, t]))
    // 각 테이블에서 PK/UNIQUE 로 보장된 컬럼명 집합
    const uniqueColsOf = (tableName: string): Set<string> => {
      const t = byName.get(tableName)!
      const idToName = new Map(cols(t).map((c) => [c.id, c.name]))
      const out = new Set<string>()
      for (const k of cons(t)) {
        if ((k.kind === 'pk' || k.kind === 'uk') && k.columns.length === 1) {
          const n = idToName.get(k.columns[0].columnId)
          if (n) out.add(n)
        }
      }
      return out
    }

    for (const t of POKEMON_TABLES) {
      for (const k of cons(t).filter((c) => c.kind === 'fk')) {
        expect(k.refTable, `${t.name} FK ${k.name} refTable 없음`).toBeTruthy()
        expect(byName.has(k.refTable!), `${t.name} FK → 미상 테이블 ${k.refTable}`).toBe(true)
        expect(k.columns.length, `${t.name} FK ${k.name} 컬럼 수`).toBe(k.refColumns?.length ?? -1)
        const uniques = uniqueColsOf(k.refTable!)
        for (const rc of k.refColumns ?? []) {
          expect(uniques.has(rc), `${t.name} FK → ${k.refTable}.${rc} 는 PK/UNIQUE 가 아님`).toBe(true)
        }
        expect(['RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'NO ACTION']).toContain(k.onDelete)
      }
    }
  })

  it('bigserial PK 컬럼은 NOT NULL 이다', () => {
    for (const t of POKEMON_TABLES) {
      const pk = cons(t).find((k) => k.kind === 'pk')!
      const pkCol = cols(t).find((c) => c.id === pk.columns[0].columnId)!
      expect(pkCol.nullable, `${t.name} PK nullable`).toBe(false)
    }
  })
})
