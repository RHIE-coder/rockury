import { describe, expect, it } from 'vitest'
import { toCsv, toJson, toSqlInsert } from './exportRows'

const rows = [
  { id: 1, name: 'ada', note: null },
  { id: 2, name: 'grace', note: '쉼표, 포함' }
]

describe('toCsv — 표를 CSV 로 (파일 Export + 클립보드 CSV 복사 공용)', () => {
  it('머리줄 + 컬럼 순서대로 값', () => {
    expect(toCsv(['id', 'name'], rows)).toBe('id,name\n1,ada\n2,grace')
  })

  it('NULL/undefined 는 빈 칸 — 스프레드시트에서 "NULL" 글자가 값으로 보이면 안 된다', () => {
    expect(toCsv(['note'], [{ note: null }, { note: undefined }, {}])).toBe('note\n\n\n')
  })

  it('쉼표·따옴표·줄바꿈이 든 값은 따옴표로 감싸고 따옴표는 두 번 겹친다', () => {
    expect(toCsv(['v'], [{ v: 'a,b' }])).toBe('v\n"a,b"')
    expect(toCsv(['v'], [{ v: 'say "hi"' }])).toBe('v\n"say ""hi"""')
    expect(toCsv(['v'], [{ v: 'a\nb' }])).toBe('v\n"a\nb"')
  })

  it('객체 값은 JSON 문자열로 (따옴표가 있으니 감싸진다)', () => {
    expect(toCsv(['j'], [{ j: { a: 1 } }])).toBe('j\n"{""a"":1}"')
  })

  it('숨긴 컬럼은 애초에 columns 에 없으면 나오지 않는다', () => {
    expect(toCsv(['name'], rows)).toBe('name\nada\ngrace')
  })

  it('행이 없어도 머리줄은 남긴다', () => {
    expect(toCsv(['id', 'name'], [])).toBe('id,name')
  })
})

describe('toJson', () => {
  it('보기 좋게 들여쓴 JSON 배열', () => {
    expect(toJson([{ id: 1 }])).toBe('[\n  {\n    "id": 1\n  }\n]')
  })
})

describe('toSqlInsert', () => {
  it('방언별 식별자 인용 + 값 리터럴', () => {
    expect(toSqlInsert('mysql', 't', ['id', 'name'], [{ id: 1, name: 'ada' }])).toBe(
      "INSERT INTO `t` (`id`, `name`) VALUES (1, 'ada');"
    )
    expect(toSqlInsert('postgresql', 't', ['id'], [{ id: 1 }])).toBe('INSERT INTO "t" ("id") VALUES (1);')
  })

  it('NULL·불린·작은따옴표 이스케이프', () => {
    expect(toSqlInsert('mysql', 't', ['a', 'b', 'c'], [{ a: null, b: true, c: "it's" }])).toBe(
      "INSERT INTO `t` (`a`, `b`, `c`) VALUES (NULL, TRUE, 'it''s');"
    )
  })
})
