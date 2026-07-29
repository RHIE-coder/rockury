import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 디자인 토큰 가드 — `AGENTS.md` 네임스페이스 규칙.
 *
 * **왜 있나(실측 사고):** 2026-07-29 api 서비스가 `bg-danger-soft` 를 24곳에 썼는데
 * `--color-danger-soft` 는 `@theme` 에 **선언이 없었다.** Tailwind v4 는 미선언 키의
 * 유틸리티를 **아무 말 없이 안 만든다** — 빌드 CSS 에 그 클래스가 0회 등장하고, 쓰는 자리가
 * 전부 `rgba(0,0,0,0)` 로 그려졌다. 위험 표시만 채움이 없어 **위계가 정확히 반전**됐는데
 * 타입검사·테스트·`surface-verify` 어느 것도 안 잡았다(순회가 빈 상태만 훑기 때문).
 *
 * 사람이 눈으로 알아채는 대신 여기서 막는다. 이 검사가 지키는 것은 둘이다:
 *   ① 쓰는 색 토큰은 전부 **선언돼 있다**
 *   ② 클래스에 **날색(hex)을 박지 않는다** — 토큰 정본이 둘로 갈리면 테마가 흔들린다
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const RENDERER = join(HERE, '..')
const GLOBALS = join(HERE, 'globals.css')

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) collect(p, out)
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const files = collect(RENDERER).map((p) => ({
  path: relative(RENDERER, p),
  src: readFileSync(p, 'utf8')
}))

const globals = readFileSync(GLOBALS, 'utf8')

/** `@theme` 안에 선언된 색 토큰 이름(`--color-foo` → `foo`). */
const declared = new Set(
  [...globals.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1])
)

/**
 * Tailwind 가 기본으로 주는 색 이름. 프로젝트 팔레트가 아니라 라이브러리 것이라
 * `@theme` 에 없어도 유틸리티가 만들어진다 — 여기서 거짓 경보를 내면 안 된다.
 */
const BUILTIN = new Set([
  'transparent', 'current', 'inherit', 'black', 'white',
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow',
  'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
  'purple', 'fuchsia', 'pink', 'rose'
])

/** shadcn 시맨틱 토큰은 `@theme inline` 이 아니라 `:root` 변수로 온다 — 따로 읽는다. */
const shadcn = new Set([...globals.matchAll(/^\s*--([a-z0-9-]+)\s*:/gm)].map((m) => m[1]))

const COLOR_PREFIX = '(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|caret|accent|shadow|divide|placeholder)'
// `(?<![\w-])` 가 없으면 `bg-accent-soft` 안의 `accent-soft` 를 다시 잡아 거짓 경보가 난다
// (`accent` 도 접두어 목록에 있기 때문). 클래스의 **맨 앞**에서만 시작한다.
const CLASS_RE = new RegExp(`(?<![\\w-])${COLOR_PREFIX}-([a-z][a-z0-9-]*)\\b`, 'g')

/**
 * **우리 팔레트를 향한 것처럼 생겼는데 선언이 없는가.**
 *
 * "이게 색인가"를 묻지 않는다 — 같은 접두어가 구조 유틸리티(`border-b-0`·`shadow-md`·
 * `ring-inset`·`ring-offset-1`)에도 쓰여서 그 질문으로는 거짓 경보만 쌓인다.
 * 대신 **우리 이름을 빌린 것만** 본다: 뒤에 `-soft` 가 붙었거나, 첫 조각이 우리 밑색이거나.
 * 그게 실제로 사고가 나는 모양이다(`danger` 는 있는데 `danger-soft` 가 없다).
 */
function looksLikeOurToken(token: string): boolean {
  if (declared.has(token) || shadcn.has(token)) return false
  if (BUILTIN.has(token) || BUILTIN.has(token.split('-')[0])) return false
  if (token.endsWith('-soft')) return true
  return declared.has(token.split('-')[0])
}

describe('디자인 토큰 가드', () => {
  it('스캔 대상이 비지 않는다(가드가 헛돌지 않게)', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(declared.size).toBeGreaterThan(5)
  })

  it('**쓰는 색 토큰은 전부 `@theme` 에 선언돼 있다** — 선언 없이 쓰면 그 자리가 투명해진다', () => {
    const missing: string[] = []
    for (const f of files) {
      if (f.path.startsWith('styles/')) continue
      for (const m of f.src.matchAll(CLASS_RE)) {
        const token = m[1]
        if (!looksLikeOurToken(token)) continue
        // 임의값(`bg-[#fff]`)·변수 참조는 이 정규식에 안 걸린다.
        const where = `${f.path}: ${m[0]}`
        if (!missing.includes(where)) missing.push(where)
      }
    }
    expect(
      missing,
      `선언 안 된 색 토큰을 쓰고 있다 — Tailwind v4 는 미선언 키의 유틸리티를 만들지 않아 ` +
        `그 자리가 **투명하게** 그려진다. \`styles/globals.css\` 의 @theme 에 ` +
        `\`--color-<이름>\` 을 선언하거나 클래스 이름을 고치세요:\n${missing.join('\n')}`
    ).toEqual([])
  })

  it('클래스에 날색(hex)을 박지 않는다 — 토큰 정본이 둘로 갈리면 테마가 흔들린다', () => {
    const hardcoded: string[] = []
    for (const f of files) {
      if (f.path.startsWith('styles/')) continue
      // `className` 문자열 안의 임의값 색만 본다 — SVG 속성·주석은 대상이 아니다.
      for (const m of f.src.matchAll(/\b(?:bg|text|border|ring|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/g)) {
        hardcoded.push(`${f.path}: ${m[0]}`)
      }
    }
    expect(
      hardcoded,
      `클래스에 색이 직접 박혀 있다. 팔레트에 이름을 주고 그 이름을 쓰세요:\n${hardcoded.join('\n')}`
    ).toEqual([])
  })

  it('`-soft` 짝이 빠지지 않는다 — 채움 없는 위험 표시가 생기는 자리다', () => {
    // `danger` 는 있는데 `danger-soft` 가 없어서 24곳이 투명해진 사고가 이 검사의 이유다.
    const bases = [...declared].filter((t) => !t.endsWith('-soft'))
    const usedSoft = new Set<string>()
    for (const f of files) {
      if (f.path.startsWith('styles/')) continue
      for (const m of f.src.matchAll(new RegExp(`(?<![\\w-])${COLOR_PREFIX}-([a-z0-9-]+)-soft\\b`, 'g'))) {
        usedSoft.add(`${m[1]}-soft`)
      }
    }
    const missing = [...usedSoft].filter((t) => !declared.has(t))
    expect(
      missing,
      `\`-soft\` 짝이 선언돼 있지 않다(밑색: ${bases.join(', ')}):\n${missing.join('\n')}`
    ).toEqual([])
  })
})
