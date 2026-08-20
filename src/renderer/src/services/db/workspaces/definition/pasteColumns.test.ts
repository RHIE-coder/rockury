import { describe, it, expect } from 'vitest'
import { parseColumns } from './pasteColumns'

const one = (text: string) => parseColumns(text).columns[0]

describe('parseColumns — 엑셀(탭으로 나뉜 칸)', () => {
  it('이름·타입·표식·설명을 칸 순서대로 읽는다', () => {
    const r = one('created_at\tDATETIME\tNOT NULL\t생성 시각')
    expect([r.name, r.type, r.nullable]).toEqual(['created_at', 'DATETIME', false])
  })

  it('칸이 둘뿐이어도 읽는다', () => {
    expect(one('sku\tVARCHAR(48)')).toMatchObject({ name: 'sku', type: 'VARCHAR(48)', nullable: true })
  })

  it('머리글 줄은 뺀다 — 엑셀에서 제목까지 함께 긁어오는 일이 잦다', () => {
    const r = parseColumns('컬럼\t타입\ncreated_at\tDATETIME')
    expect(r.columns.map((c) => c.name)).toEqual(['created_at'])
  })

  it('머리글처럼 보여도 첫 줄이 아니면 안 뺀다', () => {
    const r = parseColumns('created_at\tDATETIME\nname\ttype')
    expect(r.columns.map((c) => c.name)).toEqual(['created_at', 'name'])
  })
})

describe('parseColumns — 이 앱의 우클릭 복사 형식', () => {
  it('`이름 타입 NOT NULL DEFAULT x -- 설명` 을 그대로 되읽는다', () => {
    const r = one("id BIGINT UNSIGNED NOT NULL DEFAULT 1 -- 주문 PK")
    expect(r).toMatchObject({ name: 'id', nullable: false, defaultValue: '1', comment: '주문 PK' })
  })

  it('설명 안의 낱말이 타입·기본값으로 새지 않는다', () => {
    const r = one('memo TEXT -- DEFAULT 값은 없음 NOT NULL')
    expect([r.type, r.defaultValue, r.nullable]).toEqual(['TEXT', null, true])
  })

  it('NULL 이면 널 허용', () => {
    expect(one('memo TEXT NULL').nullable).toBe(true)
  })
})

describe('parseColumns — DDL 조각', () => {
  it('백틱·따옴표·뒤 쉼표를 벗긴다', () => {
    expect(one('`created_at` DATETIME NOT NULL,')).toMatchObject({ name: 'created_at', type: 'DATETIME' })
    expect(one('"user_id" bigint,')).toMatchObject({ name: 'user_id', type: 'bigint' })
  })

  it('PRIMARY KEY 는 NOT NULL 로 읽는다', () => {
    expect(one('id BIGINT PRIMARY KEY').nullable).toBe(false)
  })

  it('DEFAULT 뒤에 표식이 이어져도 값만 집는다', () => {
    expect(one('status VARCHAR(10) DEFAULT pending NOT NULL').defaultValue).toBe('pending')
  })
})

describe('parseColumns — 이름만 있을 때', () => {
  it('타입이 없으면 기본 타입을 채운다', () => {
    expect(one('nickname')).toMatchObject({ name: 'nickname', type: 'VARCHAR(255)' })
  })

  it('타입 자리에 표식만 있으면 타입으로 안 읽는다', () => {
    expect(one('nickname NOT NULL')).toMatchObject({ type: 'VARCHAR(255)', nullable: false })
  })

  it('기본 타입은 부르는 쪽이 정한다', () => {
    expect(parseColumns('nickname', 'TEXT').columns[0].type).toBe('TEXT')
  })
})

describe('parseColumns — 못 읽는 줄', () => {
  it('빈 줄은 그냥 넘긴다(버린 줄로도 안 센다)', () => {
    expect(parseColumns('a INT\n\n\nb INT')).toMatchObject({ columns: [{ name: 'a' }, { name: 'b' }], dropped: [] })
  })

  it('이름을 못 찾은 줄은 버리고 **무엇을 버렸는지 알려 준다**', () => {
    const r = parseColumns('-- 그냥 주석\ncreated_at DATETIME')
    expect(r.columns.map((c) => c.name)).toEqual(['created_at'])
    expect(r.dropped).toEqual(['-- 그냥 주석'])
  })

  it('같은 이름이 두 번 오면 뒤엣것을 버린다', () => {
    const r = parseColumns('a INT\na TEXT')
    expect(r.columns).toHaveLength(1)
    expect(r.dropped).toEqual(['a TEXT'])
  })
})

describe('parseColumns — 여러 줄', () => {
  it('줄 순서를 지키고 id 를 자리 순으로 매긴다', () => {
    const r = parseColumns('created_at DATETIME\nupdated_at DATETIME\ndeleted_at DATETIME')
    expect(r.columns.map((c) => [c.name, c.id])).toEqual([
      ['created_at', 'paste-0'],
      ['updated_at', 'paste-1'],
      ['deleted_at', 'paste-2']
    ])
  })

  it('빈 글자는 빈 결과', () => {
    expect(parseColumns('   \n  ')).toEqual({ columns: [], dropped: [] })
  })
})

/*
 * 엑셀의 **설명 칸**. 2026-08-20 실측에서 통째로 버려지고 있었다 —
 * `created_at⇥DATETIME⇥NOT NULL⇥생성 시각` 을 붙였는데 설명만 빈 채로 들어갔다.
 */
describe('parseColumns — 탭으로 나뉜 글자의 설명 칸', () => {
  it('표식이 아닌 칸은 설명이다', () => {
    expect(one('created_at\tDATETIME\tNOT NULL\t생성 시각')).toMatchObject({
      type: 'DATETIME',
      nullable: false,
      comment: '생성 시각'
    })
  })

  it('표식 없이 설명만 있어도 읽는다', () => {
    expect(one('memo\tTEXT\t자유 메모')).toMatchObject({ type: 'TEXT', comment: '자유 메모' })
  })

  it('DEFAULT 칸은 설명으로 안 읽는다', () => {
    expect(one("status\tVARCHAR(10)\tDEFAULT 'pending'\t주문 상태")).toMatchObject({
      defaultValue: 'pending',
      comment: '주문 상태'
    })
  })

  it('`--` 로 적은 설명이 칸보다 먼저다 — 사람이 대놓고 적은 것이다', () => {
    expect(one('memo\tTEXT\t칸 설명 -- 진짜 설명').comment).toBe('진짜 설명')
  })

  it('공백으로 나뉜 줄에서는 안 한다 — 낱말이 표식인지 설명인지 가릴 근거가 없다', () => {
    expect(one('memo TEXT 자유 메모').comment).toBe('')
  })
})
