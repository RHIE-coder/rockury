import { describe, expect, it } from 'vitest'
import {
  deterministicUuid,
  PK_TEMPLATE_TOKENS,
  pkPreview,
  pkRuleOptions,
  pkRuleVariesPerRow,
  pkSeedString,
  pkValueTypeIssue,
  renderPkTemplate,
  seedPkValues,
  unknownPkTokens
} from './seedPk'
import type { Column } from '../definition/types'
import type { SeedRow, SeedSet } from './types'

const col = (name: string, type: string): Column =>
  ({ id: `c-${name}`, name, type, nullable: false }) as Column

/**
 * 시드 PK 생성 규칙(순수) — 정본 `docs/spec/db-studio.md` Section `db-studio.seed.apply-contract` AC-2.
 * 핵심 계약은 **결정적**(같은 입력 → 항상 같은 값)이라는 것이고, 저작 화면 미리보기가 반영 계획과
 * 같은 값을 보여야 한다는 것이다.
 */

const set = (over: Partial<SeedSet> = {}): SeedSet => ({
  designId: 'd1',
  tableName: 'roles',
  naturalKey: ['name'],
  ignoredColumns: [],
  strength: 'ensure',
  rows: [],
  ...over
})

const row = (over: Partial<SeedRow> = {}): SeedRow => ({
  id: 'r1',
  alias: 'admin',
  values: { name: '관리자' },
  ...over
})

describe('deterministicUuid', () => {
  it('같은 입력이면 항상 같은 값 — 반영을 두 번 돌려도 같은 행이 두 벌 생기지 않는다', () => {
    expect(deterministicUuid('d1:roles:admin')).toBe(deterministicUuid('d1:roles:admin'))
  })

  it('입력이 다르면 값이 다르다', () => {
    expect(deterministicUuid('d1:roles:admin')).not.toBe(deterministicUuid('d1:roles:member'))
  })

  it('UUID 모양(8-4-4-4-12)이고 버전 자리는 8 — 랜덤 v4 와 구별된다', () => {
    const u = deterministicUuid('아무거나')
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('pkSeedString', () => {
  it('별칭이 있으면 별칭으로 — 짝짓기 기준 값이 바뀌어도 PK 가 안 흔들린다', () => {
    expect(pkSeedString(set(), row())).toBe('d1:roles:admin')
    expect(pkSeedString(set(), row({ values: { name: '이름변경' } }))).toBe('d1:roles:admin')
  })

  it('별칭이 없으면 짝짓기 기준 값으로', () => {
    expect(pkSeedString(set(), row({ alias: undefined }))).toBe('d1:roles:관리자')
  })

  it('설계 id 가 다르면 씨앗도 다르다 — 다른 설계와 값이 겹치지 않게', () => {
    expect(pkSeedString(set({ designId: 'd2' }), row())).not.toBe(pkSeedString(set(), row()))
  })
})

describe('renderPkTemplate', () => {
  it('자리표시자를 값으로 펼친다', () => {
    expect(renderPkTemplate('{table}-{alias}', set(), row())).toBe('roles-admin')
  })

  it('{key} 는 짝짓기 기준 값들을 `-` 로 잇는다', () => {
    const s = set({ naturalKey: ['scope', 'name'] })
    const r = row({ values: { scope: 'org', name: 'admin' } })
    expect(renderPkTemplate('{key}', s, r)).toBe('org-admin')
  })

  it('{uuid} 는 이 행의 결정적 UUID', () => {
    expect(renderPkTemplate('{uuid}', set(), row())).toBe(deterministicUuid('d1:roles:admin'))
  })

  it('모르는 자리표시자는 그대로 남긴다 — 조용히 지우면 잘못된 PK 가 만들어진다', () => {
    expect(renderPkTemplate('x-{uuidd}', set(), row())).toBe('x-{uuidd}')
  })
})

describe('unknownPkTokens', () => {
  it('아는 자리표시자만 쓰면 빈 배열', () => {
    expect(unknownPkTokens('{table}-{alias}-{key}-{uuid}')).toEqual([])
  })

  it('오타를 잡아낸다', () => {
    expect(unknownPkTokens('{uuidd}-{alias}')).toEqual(['{uuidd}'])
  })

  it('같은 오타를 여러 번 써도 한 번만 알린다', () => {
    expect(unknownPkTokens('{nope}/{nope}')).toEqual(['{nope}'])
  })

  it('자리표시자가 없으면 빈 배열', () => {
    expect(unknownPkTokens('role-fixed')).toEqual([])
  })

  it('설명 문구는 아는 자리표시자 목록과 짝이 맞는다 — 화면 안내가 판정과 갈라지지 않게', () => {
    for (const t of PK_TEMPLATE_TOKENS) expect(unknownPkTokens(t.token)).toEqual([])
  })
})

describe('seedPkValues', () => {
  it('DB 가 만들면 아무것도 주지 않는다', () => {
    expect(seedPkValues(set({ pkStrategy: 'db', pkTemplate: '{uuid}' }), row(), ['id'])).toEqual({})
  })

  it('규칙이 있으면 규칙이 첫 PK 컬럼을 채운다', () => {
    const s = set({ pkStrategy: 'seed', pkTemplate: 'role-{alias}' })
    expect(seedPkValues(s, row(), ['id'])).toEqual({ id: 'role-admin' })
  })

  it('규칙이 없으면 셀에 쓴 값을 쓴다', () => {
    const s = set({ pkStrategy: 'seed' })
    const r = row({ values: { name: '관리자', id: 'fixed-1' } })
    expect(seedPkValues(s, r, ['id'])).toEqual({ id: 'fixed-1' })
  })

  it('규칙이 셀 값을 이긴다 — 어느 쪽이 이기는지 한쪽으로 못박는다', () => {
    const s = set({ pkStrategy: 'seed', pkTemplate: 'role-{alias}' })
    const r = row({ values: { name: '관리자', id: 'fixed-1' } })
    expect(seedPkValues(s, r, ['id'])).toEqual({ id: 'role-admin' })
  })

  it('복합 PK 는 첫 컬럼만 규칙, 나머지는 셀 값', () => {
    const s = set({ pkStrategy: 'seed', pkTemplate: '{alias}' })
    const r = row({ values: { name: '관리자', a: 'ignored-by-rule', b: 'cell-b' } })
    expect(seedPkValues(s, r, ['a', 'b'])).toEqual({ a: 'admin', b: 'cell-b' })
  })

  it('규칙도 셀 값도 없으면 빈 결과 — 반영 계획 단계에서 막힌다', () => {
    expect(seedPkValues(set({ pkStrategy: 'seed' }), row(), ['id'])).toEqual({})
  })
})

describe('pkRuleOptions', () => {
  it('숫자 PK 에는 문자열 규칙을 아예 안 내놓는다 — 타입 사고를 목록에서 없앤다', () => {
    expect(pkRuleOptions(col('id', 'bigint unsigned')).map((o) => o.value)).toEqual([''])
  })

  it('date·boolean·json PK 도 셀 값만', () => {
    for (const t of ['datetime', 'boolean', 'json'])
      expect(pkRuleOptions(col('id', t)).map((o) => o.value)).toEqual([''])
  })

  it('char(36) 에는 {uuid} 를 포함해 전부 내놓는다', () => {
    expect(pkRuleOptions(col('id', 'char(36)')).map((o) => o.value)).toEqual([
      '',
      '{uuid}',
      '{key}',
      '{alias}',
      '{table}-{alias}'
    ])
  })

  it('36자보다 짧은 문자 PK 에는 {uuid} 를 빼고 나머지만', () => {
    expect(pkRuleOptions(col('code', 'varchar(20)')).map((o) => o.value)).toEqual([
      '',
      '{key}',
      '{alias}',
      '{table}-{alias}'
    ])
  })

  it('길이 선언 없는 text 는 {uuid} 를 허용한다', () => {
    expect(pkRuleOptions(col('id', 'text')).map((o) => o.value)).toContain('{uuid}')
  })

  it('컬럼을 모르면 셀 값만', () => {
    expect(pkRuleOptions(undefined).map((o) => o.value)).toEqual([''])
  })

  it('내놓는 규칙은 전부 행마다 값이 달라진다 — 상수 규칙은 목록에 없다', () => {
    for (const t of ['char(36)', 'varchar(20)', 'text'])
      for (const o of pkRuleOptions(col('id', t)))
        if (o.value !== '') expect(pkRuleVariesPerRow(o.value)).toBe(true)
  })
})

describe('pkRuleVariesPerRow', () => {
  it('{uuid}·{key}·{alias} 중 하나면 행마다 달라진다', () => {
    expect(pkRuleVariesPerRow('{uuid}')).toBe(true)
    expect(pkRuleVariesPerRow('role-{key}')).toBe(true)
    expect(pkRuleVariesPerRow('{table}-{alias}')).toBe(true)
  })

  it('{table} 만 있거나 상수면 안 달라진다 — 전 행이 같은 PK 가 된다', () => {
    expect(pkRuleVariesPerRow('{table}')).toBe(false)
    expect(pkRuleVariesPerRow('role-fixed')).toBe(false)
    expect(pkRuleVariesPerRow('12345')).toBe(false)
  })
})

describe('pkValueTypeIssue', () => {
  it('숫자 컬럼에 UUID 를 넣으면 잡는다 — 대표 사고', () => {
    const msg = pkValueTypeIssue(col('id', 'bigint unsigned'), deterministicUuid('x'))
    expect(msg).toContain('숫자가 아니')
  })

  it('숫자 컬럼에 숫자면 통과(음수·소수 포함)', () => {
    expect(pkValueTypeIssue(col('id', 'int'), '42')).toBeNull()
    expect(pkValueTypeIssue(col('n', 'decimal(12,2)'), '-3.5')).toBeNull()
  })

  it('char(36) 에 UUID 는 딱 맞는다 — 오탐 없음', () => {
    expect(pkValueTypeIssue(col('id', 'char(36)'), deterministicUuid('x'))).toBeNull()
  })

  it('선언된 길이를 넘으면 잡는다', () => {
    const msg = pkValueTypeIssue(col('code', 'varchar(8)'), 'roles-administrator')
    expect(msg).toContain('19자')
    expect(msg).toContain('8자까지')
  })

  it('길이 선언이 없는 문자 타입은 판정하지 않는다', () => {
    expect(pkValueTypeIssue(col('body', 'text'), 'x'.repeat(500))).toBeNull()
  })

  it('decimal(12,2) 의 괄호를 길이로 오독하지 않는다', () => {
    expect(pkValueTypeIssue(col('amount', 'decimal(12,2)'), '1234567890123')).toBeNull()
  })

  it('변수는 반영할 때 채워지므로 판정하지 않는다', () => {
    expect(pkValueTypeIssue(col('id', 'bigint'), '{{ADMIN_ID}}')).toBeNull()
  })

  it('빈 값·컬럼 모름이면 판정하지 않는다', () => {
    expect(pkValueTypeIssue(col('id', 'bigint'), '')).toBeNull()
    expect(pkValueTypeIssue(undefined, 'anything')).toBeNull()
  })
})

describe('pkPreview', () => {
  it('DB 가 만들면 보여줄 것이 없다', () => {
    expect(pkPreview(set({ pkStrategy: 'db' }), row(), ['id'])).toBeNull()
  })

  it('PK 컬럼이 없으면 보여줄 것이 없다', () => {
    expect(pkPreview(set({ pkStrategy: 'seed', pkTemplate: '{uuid}' }), row(), [])).toBeNull()
  })

  it('규칙이 있으면 그 결과와 대상 컬럼을 알려준다', () => {
    const s = set({ pkStrategy: 'seed', pkTemplate: '{table}-{alias}' })
    expect(pkPreview(s, row(), ['id'])).toEqual({
      column: 'id',
      from: 'template',
      value: 'roles-admin',
      unknown: [],
      typeIssue: null
    })
  })

  it('규칙이 비면 셀에 쓴 값이 그대로 온다', () => {
    const s = set({ pkStrategy: 'seed' })
    const r = row({ values: { name: '관리자', id: 'fixed-1' } })
    expect(pkPreview(s, r, ['id'])).toEqual({ column: 'id', from: 'cell', value: 'fixed-1', unknown: [], typeIssue: null })
  })

  it('규칙도 셀 값도 없으면 from=none — 반영이 막힌다는 걸 저작 중에 알린다', () => {
    expect(pkPreview(set({ pkStrategy: 'seed' }), row(), ['id'])).toEqual({
      column: 'id',
      from: 'none',
      value: '',
      unknown: [],
      typeIssue: null
    })
  })

  it('오타 자리표시자를 함께 알린다', () => {
    const s = set({ pkStrategy: 'seed', pkTemplate: '{uuidd}' })
    expect(pkPreview(s, row(), ['id'])).toEqual({
      column: 'id',
      from: 'template',
      value: '{uuidd}',
      unknown: ['{uuidd}'],
      typeIssue: null
    })
  })

  it('컬럼을 주면 타입 불일치를 함께 알린다 — bigint PK 에 {uuid}', () => {
    const s = set({ pkStrategy: 'seed', pkTemplate: '{uuid}' })
    expect(pkPreview(s, row(), ['id'], [col('id', 'bigint')])?.typeIssue).toContain('숫자가 아니')
  })

  it('컬럼을 안 주면 타입 검사를 건너뛴다', () => {
    const s = set({ pkStrategy: 'seed', pkTemplate: '{uuid}' })
    expect(pkPreview(s, row(), ['id'])?.typeIssue).toBeNull()
  })

  it('미리보기와 반영 계획이 같은 값을 낸다 — 미리보기가 거짓말하지 않게', () => {
    const s = set({ pkStrategy: 'seed', pkTemplate: '{uuid}' })
    expect(pkPreview(s, row(), ['id'])?.value).toBe(seedPkValues(s, row(), ['id']).id)
  })
})
