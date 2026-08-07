import { describe, expect, it } from 'vitest'
import { filterOptions, moveCursor, type SearchOption } from './searchSelect'

/**
 * CASE-remote-065 · 066 — 검색 카드의 거르기·정렬·키보드 커서(§db-remote.data.filter AC-1b).
 * 화면 없이 판정되는 부분만 여기서 고정한다.
 */
const cols = (...names: string[]): SearchOption[] => names.map((n) => ({ value: n, label: n }))

describe('filterOptions — 거르기와 정렬', () => {
  it('검색어가 비면 원래 순서 그대로', () => {
    const all = cols('id', 'name', 'email')
    expect(filterOptions(all, '')).toEqual(all)
    expect(filterOptions(all, '   ')).toEqual(all)
  })

  it('부분일치로 거른다', () => {
    const r = filterOptions(cols('id', 'user_id', 'name'), 'id')
    expect(r.map((o) => o.value)).toEqual(['id', 'user_id'])
  })

  it('앞글자부터 맞는 후보를 위로 올린다', () => {
    // 사람이 `user` 를 칠 때 찾는 것은 대개 `user_id` 지 `created_by_user` 가 아니다.
    const r = filterOptions(cols('created_by_user', 'user_id'), 'user')
    expect(r.map((o) => o.value)).toEqual(['user_id', 'created_by_user'])
  })

  it('앞글자 일치끼리는 원래 순서를 지킨다', () => {
    const r = filterOptions(cols('user_name', 'user_id'), 'user')
    expect(r.map((o) => o.value)).toEqual(['user_name', 'user_id'])
  })

  it('대소문자를 가리지 않는다', () => {
    const r = filterOptions(cols('userId', 'Email'), 'EMAIL')
    expect(r.map((o) => o.value)).toEqual(['Email'])
  })

  it('라벨이 값과 다르면 라벨도 훑는다', () => {
    const opts: SearchOption[] = [
      { value: '!=', label: '같지 않다' },
      { value: '=', label: '같다' }
    ]
    expect(filterOptions(opts, '같지').map((o) => o.value)).toEqual(['!='])
  })

  it('맞는 것이 없으면 빈 목록', () => {
    expect(filterOptions(cols('id', 'name'), 'zzz')).toEqual([])
  })
})

describe('moveCursor — 키보드 커서', () => {
  it('걸러진 목록 안에서 위아래로 움직인다', () => {
    expect(moveCursor(0, 1, 3)).toBe(1)
    expect(moveCursor(1, -1, 3)).toBe(0)
  })

  it('양 끝에서 감싸돈다', () => {
    expect(moveCursor(2, 1, 3)).toBe(0)
    expect(moveCursor(0, -1, 3)).toBe(2)
  })

  it('목록이 줄어 커서가 밖으로 나가도 범위 안으로 돌아온다', () => {
    // 검색어를 더 치면 후보가 줄어든다 — 그때 커서가 없는 항목을 가리키면 Enter 가 터진다.
    expect(moveCursor(9, 1, 3)).toBe(0)
    expect(moveCursor(9, 0, 3)).toBe(2)
  })

  it('빈 목록에서는 가리킬 것이 없다', () => {
    expect(moveCursor(0, 1, 0)).toBe(-1)
    expect(moveCursor(0, -1, 0)).toBe(-1)
  })
})
