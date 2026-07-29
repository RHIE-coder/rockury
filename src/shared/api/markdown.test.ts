import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, safeHref, type MdBlock } from './markdown'

/** TestPlan: api-studio · CASE-apistudio-032 (docs.authored AC-2 — 링크·코드블록·표). */

const first = (src: string): MdBlock => parseMarkdown(src)[0]

describe('링크 안전 판정', () => {
  it('http · https · mailto 만 링크가 된다', () => {
    expect(safeHref('https://x.test')).toBe('https://x.test')
    expect(safeHref('http://x.test')).toBe('http://x.test')
    expect(safeHref('mailto:a@b.test')).toBe('mailto:a@b.test')
  })

  it('**모르는 스킴은 링크로 안 만든다** — 여는 순간 무슨 일이 날지 우리가 모른다', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('  JavaScript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,<script>')).toBeNull()
    expect(safeHref('file:///etc/passwd')).toBeNull()
  })

  it('상대 경로·앵커도 링크가 아니다 — 이 앱에서 갈 곳이 없다', () => {
    expect(safeHref('/docs')).toBeNull()
    expect(safeHref('#section')).toBeNull()
  })

  it('못 믿을 링크는 **원문 그대로 글자로 남는다** — 조용히 사라지지 않는다', () => {
    expect(parseInline('[열기](javascript:alert(1))')).toEqual([
      { t: 'text', text: '[열기](javascript:alert(1))' }
    ])
  })
})

describe('인라인', () => {
  it('굵게·기울임·코드·링크를 가른다', () => {
    expect(parseInline('**굵게** *기울임* `코드`')).toEqual([
      { t: 'strong', text: '굵게' },
      { t: 'text', text: ' ' },
      { t: 'em', text: '기울임' },
      { t: 'text', text: ' ' },
      { t: 'code', text: '코드' }
    ])
  })

  it('링크는 글과 주소를 갈라 담는다', () => {
    expect(parseInline('[문서](https://x.test/a)')).toEqual([
      { t: 'link', text: '문서', href: 'https://x.test/a' }
    ])
  })

  it('가장 먼저 나오는 것부터 잡는다 — 뒤엣것을 먼저 잡으면 앞 글자가 삼켜진다', () => {
    expect(parseInline('앞 `코드` **뒤**')[0]).toEqual({ t: 'text', text: '앞 ' })
  })

  it('인라인 코드 안의 별표는 꾸미지 않는다 — 예제가 망가진다', () => {
    expect(parseInline('`a ** b`')).toEqual([{ t: 'code', text: 'a ** b' }])
  })

  it('짝이 안 맞는 표식은 원문 그대로 남는다', () => {
    expect(parseInline('**안 닫힘')).toEqual([{ t: 'text', text: '**안 닫힘' }])
  })
})

describe('블록', () => {
  it('제목의 깊이를 읽는다', () => {
    expect(first('### 셋')).toEqual({ t: 'heading', level: 3, spans: [{ t: 'text', text: '셋' }] })
  })

  it('코드블록 **안쪽은 문법을 안 본다** — 예제 코드가 꾸며지면 안 된다', () => {
    const b = first('```ts\nconst a = **1**\n```')
    expect(b).toEqual({ t: 'code', lang: 'ts', text: 'const a = **1**' })
  })

  it('닫는 울타리가 없어도 버리지 않는다 — 쓰다 만 문서도 보여야 한다', () => {
    expect(first('```\n쓰다 만 코드')).toEqual({ t: 'code', lang: '', text: '쓰다 만 코드' })
  })

  it('표는 머리줄과 구분줄이 짝일 때만 표다', () => {
    const b = first('| 이름 | 뜻 |\n| --- | :-: |\n| id | 식별자 |')
    expect(b.t).toBe('table')
    if (b.t !== 'table') return
    expect(b.head.map((c) => c.map((s) => ('text' in s ? s.text : '')).join(''))).toEqual(['이름', '뜻'])
    expect(b.rows).toHaveLength(1)
  })

  it('구분줄이 없으면 표가 아니라 그냥 글이다 — 추측해서 표로 만들지 않는다', () => {
    expect(first('| a | b |').t).toBe('paragraph')
  })

  it('표 칸 안의 인라인도 살아 있다', () => {
    const b = first('| a |\n| --- |\n| [문서](https://x.test) |')
    if (b.t !== 'table') throw new Error('표가 아님')
    expect(b.rows[0][0][0]).toMatchObject({ t: 'link', href: 'https://x.test' })
  })

  it('글머리표 목록과 번호 목록을 가른다', () => {
    expect(first('- 하나\n- 둘')).toMatchObject({ t: 'list', ordered: false })
    expect(first('1. 하나\n2. 둘')).toMatchObject({ t: 'list', ordered: true })
  })

  it('종류가 다른 목록은 이어 붙지 않는다', () => {
    const blocks = parseMarkdown('- 하나\n1. 둘')
    expect(blocks).toHaveLength(2)
  })

  it('인용은 여러 줄을 한 덩어리로 묶는다', () => {
    expect(first('> 한 줄\n> 두 줄')).toMatchObject({ t: 'quote' })
  })

  it('구분선을 읽는다', () => {
    expect(first('---')).toEqual({ t: 'rule' })
  })

  it('문단은 빈 줄에서 갈린다', () => {
    const blocks = parseMarkdown('첫 문단\n이어짐\n\n둘째 문단')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ t: 'paragraph', spans: [{ t: 'text', text: '첫 문단 이어짐' }] })
  })

  it('빈 문서는 빈 결과다 — 빈 문단을 지어내지 않는다', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n\n  \n')).toEqual([])
  })

  it('CRLF 줄바꿈도 읽는다', () => {
    expect(first('# 제목\r\n')).toMatchObject({ t: 'heading', level: 1 })
  })

  it('모르는 문법은 추측해서 꾸미지 않고 글자로 남긴다', () => {
    // 각주·정의목록 같은 확장 문법은 지원 목록에 없다 — 원문 그대로 보인다.
    expect(first('여기[^1] 각주')).toMatchObject({
      t: 'paragraph',
      spans: [{ t: 'text', text: '여기[^1] 각주' }]
    })
  })
})
