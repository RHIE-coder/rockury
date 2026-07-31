import { describe, expect, it } from 'vitest'
import { safeFileName, sqlFileName } from './sqlFile'

describe('safeFileName', () => {
  it('경로로 읽힐 글자를 바꾼다', () => {
    expect(safeFileName('pokemon/tcg')).toBe('pokemon-tcg')
    expect(safeFileName('prod:main')).toBe('prod-main')
    expect(safeFileName('a*b?c"d<e>f|g\\h')).toBe('a-b-c-d-e-f-g-h')
  })

  it('앞뒤 점·공백을 떼고 공백을 하나로 줄인다', () => {
    expect(safeFileName('  my   design  ')).toBe('my design')
    expect(safeFileName('.hidden')).toBe('hidden')
    expect(safeFileName('trailing...')).toBe('trailing')
  })

  it('남는 게 없으면 빈 문자열 — 기본값은 부르는 쪽이 정한다', () => {
    expect(safeFileName('...')).toBe('')
    expect(safeFileName('')).toBe('')
  })
})

describe('sqlFileName', () => {
  it('테이블 범위는 테이블 이름', () => {
    expect(sqlFileName('table', 'card_texts', 'oh-my-pokemon')).toBe('card_texts.sql')
  })

  it('전체 범위는 설계/연결 이름', () => {
    expect(sqlFileName('schema', 'card_texts', 'oh-my-pokemon')).toBe('oh-my-pokemon.sql')
  })

  it('이름이 없거나 다 걸러지면 기본 이름으로 떨어진다', () => {
    expect(sqlFileName('schema', 'card_texts')).toBe('schema.sql')
    expect(sqlFileName('schema', 'card_texts', '///')).toBe('---.sql')
    expect(sqlFileName('schema', 'card_texts', '...')).toBe('schema.sql')
    expect(sqlFileName('table', '')).toBe('table.sql')
  })
})
