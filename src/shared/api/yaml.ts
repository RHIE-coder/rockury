/**
 * YAML 부분집합 읽기 — OpenAPI 문서를 읽기 위한 최소 파서.
 *
 * 의존성을 더하지 않으려고 직접 쓴다(`AGENTS.md`: 의존성 추가는 `main` 에서 한 명만).
 * 그래서 **아는 것만 읽고 모르는 것은 추측 대신 거부한다** — 어설픈 파서가 조용히 잘못 읽으면
 * 명세가 틀린 채로 앉고, 그 틀린 명세가 그대로 판정 기준이 된다. 못 읽는 편이 낫다.
 *
 * 읽는 것: 주석 · 들여쓰기 매핑 · 시퀀스 · 따옴표/평문 스칼라 · 숫자/불리언/null ·
 *          블록 스칼라(`|` `>`) · 한 줄 흐름형(`[a, b]` `{a: 1}`)
 * 거부하는 것: 앵커/별칭(`&` `*`) · 태그(`!`) · 병합 키(`<<`) · 여러 문서 · 복합 키(`?`)
 */

export class YamlError extends Error {
  constructor(
    message: string,
    public readonly line: number
  ) {
    super(`${line}번째 줄: ${message}`)
  }
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

interface Line {
  indent: number
  text: string
  no: number
}

const UNSUPPORTED: [RegExp, string][] = [
  [/^\s*<<\s*:/, '병합 키(<<)는 읽지 못합니다.'],
  [/(^|\s)[&*][A-Za-z0-9_-]+/, '앵커·별칭(& *)은 읽지 못합니다.'],
  [/(^|\s)!!?[A-Za-z]/, '태그(!)는 읽지 못합니다.'],
  [/^\s*\?\s/, '복합 키(?)는 읽지 못합니다.']
]

/** 주석을 뗀다 — 따옴표 안의 `#` 은 주석이 아니다. */
function stripComment(raw: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (quote) {
      out += c
      if (c === '\\' && quote === '"') {
        out += raw[++i] ?? ''
        continue
      }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      out += c
      continue
    }
    if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) break
    out += c
  }
  return out.trimEnd()
}

function scalar(text: string, no: number): Json {
  const t = text.trim()
  if (t === '' || t === '~' || t === 'null') return null
  if (t === 'true') return true
  if (t === 'false') return false
  if (t[0] === '"' || t[0] === "'") {
    const q = t[0]
    if (t.length < 2 || t[t.length - 1] !== q) throw new YamlError('따옴표가 닫히지 않았습니다.', no)
    const inner = t.slice(1, -1)
    return q === '"' ? inner.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c)) : inner.replace(/''/g, "'")
  }
  if (t[0] === '[' || t[0] === '{') return flow(t, no)
  if (/^-?\d+$/.test(t)) return Number(t)
  if (/^-?\d*\.\d+([eE][-+]?\d+)?$/.test(t)) return Number(t)
  return t
}

/** 한 줄짜리 흐름형(`[a, b]`, `{a: 1}`). 여러 줄에 걸친 흐름형은 안 읽는다. */
function flow(text: string, no: number): Json {
  let i = 0
  const ws = (): void => {
    while (i < text.length && /\s/.test(text[i])) i++
  }
  const readToken = (stops: string): string => {
    let out = ''
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i++]
      while (i < text.length && text[i] !== q) out += text[i++]
      if (text[i] !== q) throw new YamlError('따옴표가 닫히지 않았습니다.', no)
      i++
      return q + out + q
    }
    while (i < text.length && !stops.includes(text[i])) out += text[i++]
    return out.trim()
  }
  const value = (): Json => {
    ws()
    if (text[i] === '[') {
      i++
      const arr: Json[] = []
      ws()
      if (text[i] === ']') {
        i++
        return arr
      }
      for (;;) {
        arr.push(value())
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') {
          i++
          return arr
        }
        throw new YamlError('흐름형 목록이 닫히지 않았습니다.', no)
      }
    }
    if (text[i] === '{') {
      i++
      const obj: Record<string, Json> = {}
      ws()
      if (text[i] === '}') {
        i++
        return obj
      }
      for (;;) {
        ws()
        const key = readToken(':,}')
        ws()
        if (text[i] !== ':') throw new YamlError('흐름형 매핑에 콜론이 없습니다.', no)
        i++
        obj[String(scalar(key, no))] = value()
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') {
          i++
          return obj
        }
        throw new YamlError('흐름형 매핑이 닫히지 않았습니다.', no)
      }
    }
    return scalar(readToken(',]}'), no)
  }
  const out = value()
  ws()
  if (i < text.length) throw new YamlError(`흐름형 뒤에 남은 글자가 있습니다: ${text.slice(i)}`, no)
  return out
}

function toLines(src: string): Line[] {
  const out: Line[] = []
  const raw = src.split(/\r?\n/)
  let seenDoc = false

  for (let n = 0; n < raw.length; n++) {
    const original = raw[n]
    if (original.includes('\t')) throw new YamlError('탭 들여쓰기는 읽지 못합니다(공백을 쓰세요).', n + 1)
    const line = stripComment(original)
    if (line.trim() === '') continue
    if (/^---\s*$/.test(line.trim())) {
      if (seenDoc) throw new YamlError('한 파일에 여러 문서(---)가 있으면 읽지 못합니다.', n + 1)
      seenDoc = true
      continue
    }
    if (/^\.\.\.\s*$/.test(line.trim())) continue
    for (const [re, msg] of UNSUPPORTED) if (re.test(line)) throw new YamlError(msg, n + 1)
    out.push({ indent: line.length - line.trimStart().length, text: line.trim(), no: n + 1 })
  }
  return out
}

/** 블록 스칼라(`|` `>`) 본문을 모은다. */
function blockScalar(lines: Line[], start: number, parentIndent: number, style: string): [string, number] {
  const body: string[] = []
  let i = start
  while (i < lines.length && lines[i].indent > parentIndent) {
    body.push(' '.repeat(lines[i].indent - (lines[start]?.indent ?? 0)) + lines[i].text)
    i++
  }
  const joined = style.startsWith('|') ? body.join('\n') : body.join(' ')
  return [style.includes('-') ? joined : joined + (style.startsWith('|') ? '\n' : ''), i]
}

function parseBlock(lines: Line[], from: number, indent: number): [Json, number] {
  if (from >= lines.length) return [null, from]

  if (lines[from].text.startsWith('- ') || lines[from].text === '-') {
    const arr: Json[] = []
    let i = from
    while (i < lines.length && lines[i].indent === indent && (lines[i].text === '-' || lines[i].text.startsWith('- '))) {
      const rest = lines[i].text === '-' ? '' : lines[i].text.slice(2).trim()
      if (rest === '') {
        const [v, next] = parseBlock(lines, i + 1, i + 1 < lines.length ? lines[i + 1].indent : indent + 2)
        arr.push(v)
        i = next
        continue
      }
      // `- key: value` — 항목 자체가 매핑이다. 가상 들여쓰기로 다시 읽는다.
      if (/^[^:\s][^:]*:(\s|$)/.test(rest)) {
        const virtual: Line[] = [{ indent: indent + 2, text: rest, no: lines[i].no }]
        let j = i + 1
        while (j < lines.length && lines[j].indent > indent) {
          virtual.push(lines[j])
          j++
        }
        const [v] = parseBlock(virtual, 0, indent + 2)
        arr.push(v)
        i = j
        continue
      }
      arr.push(scalar(rest, lines[i].no))
      i++
    }
    return [arr, i]
  }

  const obj: Record<string, Json> = {}
  let i = from
  while (i < lines.length && lines[i].indent === indent) {
    const { text, no } = lines[i]
    const m = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:]+?)\s*:(?:\s+(.*))?$/.exec(text)
    if (!m) throw new YamlError(`매핑으로 읽을 수 없습니다: ${text}`, no)
    const key = String(scalar(m[1], no))
    const inline = (m[2] ?? '').trim()

    if (inline === '' ) {
      const childIndent = i + 1 < lines.length ? lines[i + 1].indent : indent
      if (i + 1 < lines.length && childIndent > indent) {
        const [v, next] = parseBlock(lines, i + 1, childIndent)
        obj[key] = v
        i = next
        continue
      }
      obj[key] = null
      i++
      continue
    }
    if (/^[|>][-+]?$/.test(inline)) {
      const [v, next] = blockScalar(lines, i + 1, indent, inline)
      obj[key] = v
      i = next
      continue
    }
    obj[key] = scalar(inline, no)
    i++
  }
  return [obj, i]
}

export function parseYaml(src: string): Json {
  const lines = toLines(src)
  if (lines.length === 0) return null
  const [value, consumed] = parseBlock(lines, 0, lines[0].indent)
  if (consumed < lines.length) {
    throw new YamlError(`들여쓰기가 맞지 않아 여기서 멈췄습니다: ${lines[consumed].text}`, lines[consumed].no)
  }
  return value
}

/** JSON 이면 JSON 으로, 아니면 YAML 부분집합으로 읽는다. */
export function parseJsonOrYaml(src: string): Json {
  const trimmed = src.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed) as Json
  return parseYaml(src)
}
