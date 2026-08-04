import { describe, expect, it } from 'vitest'
import { displayColumns } from './displayColumns'

/**
 * 회귀(2026-08-04 사용자 실측): 밖에서 실 DB 스키마를 고치고 Data 새로고침을 눌렀더니
 * **모든 칸이 `undefined`** 로 떴다. 조회는 `SELECT *` 라 행에는 새 컬럼이 담기는데,
 * 헤더는 캐시된 옛 역설계 결과여서 화면이 없는 키로 값을 꺼내고 있었다.
 */
describe('displayColumns', () => {
  it('평소에는 역설계 순서를 그대로 쓴다 — 사람이 설계한 순서가 보여야 한다', () => {
    expect(displayColumns(['id', 'name', 'email'], ['id', 'name', 'email'])).toEqual([
      'id',
      'name',
      'email'
    ])
  })

  it('행이 0개여도 헤더를 지우지 않는다 (표의 모양은 남아야 한다)', () => {
    expect(displayColumns(['id', 'name'], [])).toEqual(['id', 'name'])
  })

  it('역설계를 아직 못 읽었으면 결과 컬럼을 쓴다', () => {
    expect(displayColumns([], ['id', 'title'])).toEqual(['id', 'title'])
  })

  it('실 DB 에서 사라진 컬럼은 헤더에서 뺀다 — 그 칸은 늘 비어 보인다', () => {
    expect(displayColumns(['id', 'name', 'legacy'], ['id', 'name'])).toEqual(['id', 'name'])
  })

  it('실 DB 에 새로 생긴 컬럼은 뒤에 붙인다 — 안 보이면 있는 데이터를 숨기는 것이다', () => {
    expect(displayColumns(['id', 'name'], ['id', 'name', 'created_at'])).toEqual([
      'id',
      'name',
      'created_at'
    ])
  })

  it('컬럼이 통째로 바뀌어도 실제 데이터를 보인다 (undefined 판 금지)', () => {
    // 이 경우가 사용자가 만난 상황이다 — 옛 이름만 남기면 모든 칸이 undefined 가 된다.
    expect(displayColumns(['old_a', 'old_b'], ['new_a', 'new_b'])).toEqual(['new_a', 'new_b'])
  })

  it('이름이 같으면 순서가 달라도 역설계 순서를 지킨다', () => {
    expect(displayColumns(['id', 'name'], ['name', 'id'])).toEqual(['id', 'name'])
  })
})
