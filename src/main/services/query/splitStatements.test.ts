import { describe, expect, it } from 'vitest'
import { splitStatements } from './splitStatements'

describe('splitStatements', () => {
  it('세미콜론 없는 단일문', () => {
    expect(splitStatements('SELECT 1')).toEqual(['SELECT 1'])
  })

  it('여러 문장을 나누고 trim + 빈 문장 제거', () => {
    expect(splitStatements('SELECT 1;  SELECT 2 ;')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('빈 입력/공백/세미콜론만 → 빈 배열', () => {
    expect(splitStatements('')).toEqual([])
    expect(splitStatements('   ')).toEqual([])
    expect(splitStatements(';;;')).toEqual([])
  })

  it('문자열 안의 세미콜론으로는 쪼개지 않는다', () => {
    expect(splitStatements(`SELECT ';' AS x; SELECT 2`)).toEqual([`SELECT ';' AS x`, 'SELECT 2'])
  })

  it('따옴표 중첩(it\'\'s)을 하나의 문자열로 본다', () => {
    expect(splitStatements(`SELECT 'it''s; ok' AS x`)).toEqual([`SELECT 'it''s; ok' AS x`])
  })

  it('백슬래시 이스케이프 따옴표를 처리한다', () => {
    expect(splitStatements(`SELECT 'a\\'; b' AS x`)).toEqual([`SELECT 'a\\'; b' AS x`])
  })

  it('라인 주석(--) 안의 세미콜론은 무시', () => {
    expect(splitStatements('SELECT 1 -- a; b\n; SELECT 2')).toEqual([
      'SELECT 1 -- a; b',
      'SELECT 2'
    ])
  })

  it('블록 주석(/* */) 안의 세미콜론은 무시', () => {
    expect(splitStatements('SELECT /* ; ; */ 1; SELECT 2')).toEqual([
      'SELECT /* ; ; */ 1',
      'SELECT 2'
    ])
  })

  it('괄호 깊이 안의 세미콜론은 무시', () => {
    expect(splitStatements('SELECT f(a; b); SELECT 2')).toEqual(['SELECT f(a; b)', 'SELECT 2'])
  })

  it('큰따옴표 식별자 안의 세미콜론도 무시', () => {
    expect(splitStatements('SELECT "a;b" FROM t; SELECT 2')).toEqual([
      'SELECT "a;b" FROM t',
      'SELECT 2'
    ])
  })
})
