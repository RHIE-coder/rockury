import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 소스가 git 눈에 **텍스트로** 보이는지 검사한다.
 *
 * git 은 파일 앞머리에서 NUL(U+0000) 바이트를 만나면 그 파일을 통째로 바이너리로 본다 —
 * `diff` 도 `blame` 도 "Bin 1234 -> 5678 bytes" 한 줄로 끝난다. 빌드·타입검사·테스트는
 * 멀쩡히 통과하므로 **아무도 안 알려 준다.** 리뷰에서 그 파일만 안 보일 뿐이다.
 *
 * 실제 사고: 이름 짝짓기 키의 구분자로 NUL 을 골라 놓고(이름에 절대 못 들어가는 글자라
 * 고른 것이다) `'\u0000'` 이스케이프가 아니라 **실제 바이트**를 소스에 적었다.
 * 2026-08-11 에 `diffView.ts` 하나를 고쳤는데 같은 파일이 아홉 개 더 있었고, 나흘 뒤
 * 다른 작업 중에 우연히 드러났다(2026-08-15).
 *
 * 그래서 "git 이 이 파일을 뭐로 보나"를 git 에게 직접 묻는다 — NUL 을 직접 세면 git 의
 * 판정 규칙(앞머리 몇 바이트를 보나)을 여기서 다시 구현하는 꼴이 된다.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 검사 대상 — 사람이 읽고 고치는 것이 들어 있는 뿌리.
 * `docs` 도 넣는다: 이 가드를 쓰면서 문서에도 같은 사고가 났다(NUL 을 설명하는 문장에 실제 NUL).
 */
const ROOTS = ['src', 'e2e', 'scripts', 'docs', '.harness']

/** 진짜 바이너리라 이 검사에서 빼는 것 — 지금은 해당 파일이 없지만, 아이콘 하나 들어왔다고 터지면 안 된다. */
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|eot|pdf|zip|gz|node|wasm|db|sqlite3?)$/i

/**
 * git 이 바이너리로 보는 추적 파일 목록.
 * `git ls-files --eol` 은 줄 끝 판정을 내며 바이너리를 `-text` 로 적는다 — 형식은
 * `i/<index> w/<worktree> attr/<속성><탭><경로>`. 작업본 판정(`w/`)을 본다.
 */
function binaryTrackedFiles(): { all: string[]; binary: string[] } {
  const out = execFileSync('git', ['ls-files', '--eol', '--', ...ROOTS], { cwd: REPO, encoding: 'utf8' })
  const all: string[] = []
  const binary: string[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const path = line.slice(tab + 1)
    const eol = line.slice(0, tab)
    all.push(path)
    if (/\sw\/-text(\s|$)/.test(` ${eol} `) && !BINARY_EXT.test(path)) binary.push(path)
  }
  return { all, binary }
}

describe('소스가 git 눈에 텍스트인가', () => {
  const { all, binary } = binaryTrackedFiles()

  it('검사 대상을 실제로 찾았다 — 0건이면 스캐너 고장(통과가 아니라 실패)', () => {
    expect(all.length).toBeGreaterThan(50)
  })

  it('NUL 이 박힌 소스가 없다 — 있으면 그 파일만 diff·blame 이 안 보인다', () => {
    expect(
      binary,
      `git 이 바이너리로 보는 소스가 있다. 대개 NUL(U+0000)을 이스케이프가 아니라 실제 바이트로 적은 것이다 — ` +
        `문자열 안이면 '\\u0000' 으로 바꾼다(런타임 값은 그대로다):\n  ${binary.join('\n  ')}`
    ).toEqual([])
  })
})
