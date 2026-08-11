import { describe, expect, it } from 'vitest'
import {
  addSchema,
  checkSchemaName,
  removeSchema,
  renameSchema,
  resolveSchemas,
  schemaIssues,
  schemaTableCounts,
  shouldQualify,
  suggestSchemaName,
  supportsSchemas,
  toIdentifier
} from './schemaCatalog'

describe('supportsSchemas', () => {
  it('pg·mysql·mariadb 는 같은 층이라 함께 참 — 낱말만 다르다', () => {
    expect(supportsSchemas('postgresql')).toBe(true)
    expect(supportsSchemas('mysql')).toBe(true)
    expect(supportsSchemas('mariadb')).toBe(true)
  })

  it('sqlite 는 스키마 층 자체가 없다', () => {
    expect(supportsSchemas('sqlite')).toBe(false)
  })
})

describe('suggestSchemaName', () => {
  it('postgresql 은 새 DB 에 이미 있는 public', () => {
    expect(suggestSchemaName('postgresql', '쇼핑몰 코어')).toBe('public')
  })

  it('sqlite 는 파일 자체를 가리키는 main', () => {
    expect(suggestSchemaName('sqlite', '아무거나')).toBe('main')
  })

  it('mysql 계열은 정해진 기본이 없어 설계 이름에서 따온다', () => {
    expect(suggestSchemaName('mysql', 'test-mysql-1')).toBe('test_mysql_1')
    expect(suggestSchemaName('mariadb', '쇼핑몰 코어')).toBe('쇼핑몰_코어')
  })

  it('따올 것이 없으면 app', () => {
    expect(suggestSchemaName('mysql', '!!!')).toBe('app')
  })
})

describe('toIdentifier', () => {
  it('공백·하이픈·점·슬래시를 밑줄로 — MySQL DB 이름은 폴더 이름이 된다', () => {
    expect(toIdentifier('test-mysql-1')).toBe('test_mysql_1')
    expect(toIdentifier('a.b/c\\d')).toBe('a_b_c_d')
  })

  it('한글은 남긴다 — 지우면 이름이 통째로 사라진다', () => {
    expect(toIdentifier('쇼핑몰')).toBe('쇼핑몰')
  })

  it('양끝 밑줄을 떼고 64자로 자른다', () => {
    expect(toIdentifier('  hi  ')).toBe('hi')
    expect(toIdentifier('x'.repeat(80))).toHaveLength(64)
  })
})

describe('checkSchemaName', () => {
  it('빈 이름은 막는다', () => {
    expect(checkSchemaName('  ', [])).toEqual({ ok: false, reason: '이름을 적으세요' })
  })

  it('엔진이 거부하는 글자를 막는다', () => {
    expect(checkSchemaName('a b', []).ok).toBe(false)
    expect(checkSchemaName('a.b', []).ok).toBe(false)
    expect(checkSchemaName('a/b', []).ok).toBe(false)
  })

  it('대소문자만 다른 중복도 중복으로 본다', () => {
    expect(checkSchemaName('Public', ['public']).reason).toBe('이미 있는 이름')
  })

  it('멀쩡한 이름은 통과', () => {
    expect(checkSchemaName('testdb', ['public'])).toEqual({ ok: true, reason: '' })
  })
})

describe('addSchema', () => {
  it('맨 뒤에 더한다 — 첫째 자리(기본 스키마)를 흔들지 않는다', () => {
    expect(addSchema(['public'], 'auth')).toEqual(['public', 'auth'])
  })

  it('이미 있으면 그대로', () => {
    expect(addSchema(['public'], 'PUBLIC')).toEqual(['public'])
  })

  it('빈 이름은 무시', () => {
    expect(addSchema(['public'], '  ')).toEqual(['public'])
  })
})

describe('renameSchema', () => {
  it('자리를 지키며 이름만 바꾼다', () => {
    expect(renameSchema(['public', 'auth'], 'public', 'testdb')).toEqual(['testdb', 'auth'])
  })

  it('없는 이름을 바꾸라면 아무것도 안 한다', () => {
    expect(renameSchema(['public'], 'nope', 'x')).toEqual(['public'])
  })

  it('빈 이름으로는 못 바꾼다', () => {
    expect(renameSchema(['public'], 'public', ' ')).toEqual(['public'])
  })
})

describe('removeSchema', () => {
  it('그 이름만 뺀다', () => {
    expect(removeSchema(['public', 'auth'], 'auth')).toEqual(['public'])
  })
})

describe('schemaTableCounts', () => {
  it('스키마마다 표를 센다', () => {
    const counts = schemaTableCounts([{ schema: 'a' }, { schema: 'b' }, { schema: 'a' }])
    expect(counts.get('a')).toBe(2)
    expect(counts.get('b')).toBe(1)
  })

  it('이름 없는 표는 빈 키로 모인다 — 그것도 사실이라 감추지 않는다', () => {
    expect(schemaTableCounts([{}, { schema: '' }]).get('')).toBe(2)
  })
})

describe('resolveSchemas', () => {
  it('선언이 먼저, 그다음 표에서 발견된 것', () => {
    expect(resolveSchemas(['public'], [{ schema: 'auth' }, { schema: 'public' }])).toEqual([
      'public',
      'auth'
    ])
  })

  it('표가 없는 선언도 남는다 — 방금 만든 빈 스키마', () => {
    expect(resolveSchemas(['public', 'auth'], [])).toEqual(['public', 'auth'])
  })

  it('선언이 없어도 표에서 찾아낸다 — 선언 기능 이전 설계', () => {
    expect(resolveSchemas([], [{ schema: 'testdb' }, { schema: 'testdb' }])).toEqual(['testdb'])
  })

  it('이름 없는 표는 스키마로 세지 않는다', () => {
    expect(resolveSchemas([], [{}, { schema: '' }])).toEqual([])
  })
})

describe('schemaIssues', () => {
  it('MySQL 계열이 public 을 들고 있으면 집어낸다 — 그런 DB 는 없다', () => {
    expect(schemaIssues('mysql', ['public', 'testdb'])).toEqual(['public'])
    expect(schemaIssues('mariadb', ['Public'])).toEqual(['Public'])
  })

  it('postgresql 의 public 은 정상이다', () => {
    expect(schemaIssues('postgresql', ['public'])).toEqual([])
  })

  it('sqlite 는 볼 것이 없다', () => {
    expect(schemaIssues('sqlite', ['main'])).toEqual([])
  })
})

describe('shouldQualify', () => {
  it('이름을 다 알면 하나뿐이어도 붙인다 — 세션 상태에 안 기대려고', () => {
    expect(shouldQualify('mysql', [{ schema: 'testdb' }, { schema: 'testdb' }])).toBe(true)
    expect(shouldQualify('postgresql', [{ schema: 'public' }])).toBe(true)
  })

  it('이름 모르는 표가 섞이면 안 붙인다 — 반쯤 한정된 SQL 이 가장 나쁘다', () => {
    expect(shouldQualify('mysql', [{ schema: 'testdb' }, {}])).toBe(false)
  })

  it('sqlite 는 붙일 층이 없다', () => {
    expect(shouldQualify('sqlite', [{ schema: 'main' }])).toBe(false)
  })

  it('표가 없으면 붙일 것도 없다', () => {
    expect(shouldQualify('mysql', [])).toBe(false)
  })
})
