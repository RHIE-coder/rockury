/**
 * 최소 markdown 렌더.
 *
 * **왜 손으로 쓰나:** 의존성을 안 늘린다(그건 `main` 몫). 그리고 라이브러리를 쓰면 대부분
 * HTML 문자열을 돌려주는데, 그걸 화면에 붙이려면 `dangerouslySetInnerHTML` 이 필요해진다 —
 * 사람이 쓴 문서라도 가져오기로 들어온 남의 글이 섞일 수 있는 자리에 그 문을 열지 않는다.
 * 그래서 여기는 **토막(token) 트리**를 돌려주고 화면이 React 요소로 그린다.
 *
 * 이 파일이 지키는 한 문장: **모르는 것을 안다고 말하지 않는다.**
 *   · 지원하는 문법은 아래 `MARKDOWN_SUPPORT` 에 적어 두고 화면이 사람에게 보인다
 *   · 모르는 문법은 **추측해서 꾸미지 않고 원문 그대로** 글자로 남긴다(조용히 사라지지 않는다)
 *   · 링크는 `http`·`https`·`mailto` 만 링크로 만든다 — 그 밖의 스킴(`javascript:` 등)은
 *     링크가 아니라 글자로 남긴다. 여는 순간 무슨 일이 날지 우리가 모르기 때문이다.
 */

/** 화면이 "여기까지 그립니다" 로 보여 주는 목록. 코드와 같은 자리에 둬야 안 어긋난다. */
export const MARKDOWN_SUPPORT = [
  '제목(#)',
  '굵게(**)',
  '기울임(*)',
  '인라인 코드(`)',
  '코드블록(```)',
  '목록(- · 1.)',
  '인용(>)',
  '표(|)',
  '구분선(---)',
  '링크([글](주소))'
] as const

// ── 조각(인라인) ──────────────────────────────────────────────────────────

export type MdSpan =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'strong'; text: string }
  | { t: 'em'; text: string }
  | { t: 'link'; text: string; href: string }

/** 링크로 만들어도 되는 주소인가. 모르는 스킴은 링크가 아니라 글자로 남는다. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim()
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed
  // 상대 경로·앵커는 이 앱에서 갈 곳이 없다 — 링크로 만들지 않는다.
  return null
}

/** 인라인 문법 하나를 찾는 정규식. 순서가 곧 우선순위다(코드가 가장 세다). */
const INLINE = [
  { t: 'code' as const, re: /`([^`\n]+)`/ },
  { t: 'link' as const, re: /\[([^\]\n]*)\]\(([^)\s]+)\)/ },
  { t: 'strong' as const, re: /\*\*([^*\n]+)\*\*/ },
  { t: 'em' as const, re: /\*([^*\n]+)\*/ }
]

export function parseInline(text: string): MdSpan[] {
  const out: MdSpan[] = []
  let rest = text

  while (rest) {
    // 가장 먼저 나오는 것을 고른다 — 뒤엣것을 먼저 잡으면 앞 글자가 통째로 삼켜진다.
    let best: { at: number; len: number; span: MdSpan } | null = null
    for (const { t, re } of INLINE) {
      const m = re.exec(rest)
      if (!m || m.index === undefined) continue
      if (best && m.index >= best.at) continue

      let span: MdSpan
      if (t === 'link') {
        const href = safeHref(m[2])
        // 못 믿을 주소는 **원문 그대로** 글자로 남긴다 — 조용히 지우지 않는다.
        span = href === null ? { t: 'text', text: m[0] } : { t: 'link', text: m[1] || href, href }
      } else if (t === 'code') span = { t: 'code', text: m[1] }
      else if (t === 'strong') span = { t: 'strong', text: m[1] }
      else span = { t: 'em', text: m[1] }

      best = { at: m.index, len: m[0].length, span }
    }

    if (!best) {
      out.push({ t: 'text', text: rest })
      break
    }
    if (best.at > 0) out.push({ t: 'text', text: rest.slice(0, best.at) })
    out.push(best.span)
    rest = rest.slice(best.at + best.len)
  }

  // 빈 토막은 화면만 어지럽히고, **붙어 있는 글자 토막은 하나로 합친다** —
  // 못 믿을 링크를 글자로 되돌릴 때처럼 원문이 여러 조각으로 갈릴 수 있는데,
  // 갈린 채로 두면 "원문 그대로"가 눈으로만 그렇고 데이터로는 아니게 된다.
  const merged: MdSpan[] = []
  for (const span of out) {
    if (span.t === 'text' && span.text === '') continue
    const prev = merged[merged.length - 1]
    if (span.t === 'text' && prev && prev.t === 'text') prev.text += span.text
    else merged.push(span.t === 'text' ? { ...span } : span)
  }
  return merged
}

// ── 덩어리(블록) ──────────────────────────────────────────────────────────

export type MdBlock =
  | { t: 'heading'; level: number; spans: MdSpan[] }
  | { t: 'paragraph'; spans: MdSpan[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'list'; ordered: boolean; items: MdSpan[][] }
  | { t: 'quote'; spans: MdSpan[] }
  | { t: 'table'; head: MdSpan[][]; rows: MdSpan[][][] }
  | { t: 'rule' }

/** `| a | b |` 한 줄을 칸으로 쪼갠다. 양 끝 파이프는 있어도 없어도 된다. */
function tableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** 구분줄(`|---|:--:|`)인가 — 이게 있어야 표다. 없으면 그냥 글이다. */
function isTableRule(line: string): boolean {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c))
}

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: MdBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i += 1
      continue
    }

    // 코드블록 — **안쪽은 문법을 안 본다.** 여기서 파싱하면 예제 코드가 꾸며져 버린다.
    const fence = /^```(.*)$/.exec(line)
    if (fence) {
      const lang = fence[1].trim()
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      // 닫는 울타리가 없어도 **버리지 않는다** — 쓰다 만 문서도 보여야 한다.
      if (i < lines.length) i += 1
      out.push({ t: 'code', lang, text: body.join('\n') })
      continue
    }

    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ t: 'rule' })
      i += 1
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      out.push({ t: 'heading', level: heading[1].length, spans: parseInline(heading[2].trim()) })
      i += 1
      continue
    }

    // 표 — 머리줄 + 구분줄이 짝으로 있어야 한다.
    if (line.includes('|') && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const head = tableCells(line).map(parseInline)
      const rows: MdSpan[][][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(tableCells(lines[i]).map(parseInline))
        i += 1
      }
      out.push({ t: 'table', head, rows })
      continue
    }

    const bullet = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line)
    if (bullet) {
      const ordered = /\d/.test(bullet[1])
      const items: MdSpan[][] = []
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(lines[i])
        if (!m || /\d/.test(m[1]) !== ordered) break
        items.push(parseInline(m[2]))
        i += 1
      }
      out.push({ t: 'list', ordered, items })
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      out.push({ t: 'quote', spans: parseInline(body.join(' ')) })
      continue
    }

    // 그 밖은 문단. 빈 줄이 나올 때까지 이어 붙인다(한 줄 바꿈은 이음으로 본다).
    const body: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,6}\s|\s*>|\s*([-*+]|\d+\.)\s)/.test(lines[i])) {
      body.push(lines[i].trim())
      i += 1
    }
    out.push({ t: 'paragraph', spans: parseInline(body.join(' ')) })
  }

  return out
}
