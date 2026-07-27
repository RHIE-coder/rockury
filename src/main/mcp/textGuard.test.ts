import { describe, expect, it } from 'vitest'
import { assertCleanText, scanText, scanValue } from './textGuard'

/**
 * 저장 전 위생 검사 — 실제로 겪은 사고(설계 주석에 U+FFFD 가 박힌 채 33개 테이블이 반영됨)의
 * 회귀 테스트. 사고 재현 → 저장 전에 잡히는지, 정상 본문(한글·이모지·개행)은 안 걸리는지.
 */

describe('scanText — 깨진 글자 판정', () => {
  it('치환 문자(U+FFFD)를 위치·문맥과 함께 잡는다', () => {
    const [p] = scanText('c.comment', '요율이 바\uFFFD뀌어도 정산은 이 값으로')
    expect(p.kind).toBe('replacement')
    expect(p.codePoint).toBe('U+FFFD')
    expect(p.index).toBe(5)
    expect(p.sample).toContain('⟪\uFFFD⟫')
  })

  it('짝 잃은 서로게이트를 잡는다 — 상위·하위 양쪽', () => {
    expect(scanText('a', 'ab\uD83Dcd')[0].kind).toBe('lone-surrogate')
    expect(scanText('a', 'ab\uDE00cd')[0].kind).toBe('lone-surrogate')
  })

  it('상위 서로게이트가 문자열 맨 끝이어도 잡는다(뒤 유닛 없음)', () => {
    const found = scanText('a', '잘린 문자열\uD83D')
    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe('lone-surrogate')
  })

  it('정상 이모지(서로게이트 쌍)와 결합 시퀀스는 통과시킨다', () => {
    expect(scanText('a', '완료 ✅ 재고 📦')).toEqual([])
    expect(scanText('a', '가족 👨‍👩‍👧')).toEqual([]) // ZWJ 는 오탐 방지를 위해 잡지 않는다
  })

  it('제어 문자는 잡고 탭·개행·복귀는 통과시킨다', () => {
    expect(scanText('a', 'x\u0000y')[0].kind).toBe('control')
    expect(scanText('a', 'x\u001By')[0].kind).toBe('control')
    expect(scanText('a', '줄1\n줄2\t끝\r')).toEqual([])
  })

  it('문장 속 BOM 을 잡는다', () => {
    expect(scanText('a', '주문\uFEFF원장')[0].kind).toBe('bom')
  })

  it('평범한 한글·영문·기호는 통과한다', () => {
    expect(scanText('a', "ENUM('pending','confirmed') — 주문 상태 · 기본값 0.00")).toEqual([])
  })
})

describe('scanValue — 값 트리 전수 검사', () => {
  const payload = {
    tables: [
      {
        name: 'orders',
        columns: [
          { name: 'id', type: 'BIGINT', comment: '정상' },
          { name: 'memo', type: 'TEXT', comment: '바\uFFFD뀜' }
        ]
      }
    ]
  }

  it('깊이 중첩된 문자열의 경로를 정확히 짚는다', () => {
    const found = scanValue(payload)
    expect(found).toHaveLength(1)
    expect(found[0].path).toBe('tables[0].columns[1].comment')
  })

  it('객체 키가 깨진 경우도 잡는다 — looseObject 가 미지의 키를 보존하기 때문', () => {
    const found = scanValue({ ['깨진\uFFFD키']: 'ok' })
    expect(found).toHaveLength(1)
    expect(found[0].path).toContain('(키)')
  })

  it('문자열 아닌 값(숫자·불리언·null)은 건너뛴다', () => {
    expect(scanValue({ a: 1, b: true, c: null, d: undefined })).toEqual([])
  })
})

describe('assertCleanText — 저장 앞 관문', () => {
  it('정상 입력은 통과(throw 없음)', () => {
    expect(() => assertCleanText({ name: '주문 원장', columns: [] }, 'set_schema')).not.toThrow()
  })

  it('깨진 입력은 위치·개수·해결 안내를 담아 throw', () => {
    expect(() => assertCleanText({ comment: '바\uFFFD뀜' }, 'set_schema')).toThrowError(
      /set_schema 저장을 멈췄습니다.*1곳.*U\+FFFD/s
    )
  })

  it('rootPath 를 주면 도구 인자 이름부터 경로를 찍는다', () => {
    expect(() => assertCleanText([{ comment: '바\uFFFD뀜' }], 'set_schema', 'tables')).toThrowError(
      /tables\[0\]\.comment/
    )
  })

  it('여러 곳이 깨졌으면 최대 10곳만 보이고 나머지는 개수로 알린다', () => {
    const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`c${i}`, `값\uFFFD`]))
    expect(() => assertCleanText(many, 'patch_schema')).toThrowError(/13곳.*외 3곳/s)
  })
})
