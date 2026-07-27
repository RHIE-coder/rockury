import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

/**
 * 소스가 git 에 실제로 들어갔는지 검사한다.
 *
 * 실제 사고(2026-07-27): `.gitignore` 의 `coverage` 규칙이 깊이를 안 가려서
 * `src/main/ai/coverage/` 폴더 8개 파일이 **조용히 커밋에서 빠졌다.** 본진에는 파일이
 * 로컬로 남아 있어 typecheck·test·build 가 전부 통과했고, 워크트리를 새로 만들고 나서야
 * "모듈을 못 찾겠다"로 터졌다. 즉 **작업하던 컴퓨터에서는 절대 안 드러나는 종류의 사고**다.
 *
 * 그래서 "커밋에 들어갔나"를 기계가 본다. 새 소스가 gitignore 에 걸리면 여기서 실패한다.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 검사 대상 — 앱을 빌드·실행하는 데 반드시 필요한 소스 뿌리. */
const SOURCE_ROOTS = ['src', 'e2e', 'scripts']

/** 소스가 아니어서 추적하지 않는 게 맞는 것들. */
const NOT_SOURCE = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.DS_Store$/,
  // 도커 테스트 DB 의 실제 데이터 파일 — 만들어 쓰는 것이라 추적하지 않는다.
  /^scripts\/test-db\/data\//
]

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue
      walk(p, out)
    } else {
      out.push(relative(REPO, p).split(sep).join('/'))
    }
  }
  return out
}

describe('소스가 git 에 들어갔는가', () => {
  const tracked = new Set(
    execFileSync('git', ['ls-files', ...SOURCE_ROOTS], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
  )
  const onDisk = SOURCE_ROOTS.flatMap((r) => walk(join(REPO, r)))

  it('검사 대상을 실제로 찾았다 — 0건이면 스캐너 고장(통과가 아니라 실패)', () => {
    expect(onDisk.length).toBeGreaterThan(50)
    expect(tracked.size).toBeGreaterThan(50)
  })

  it('src·e2e·scripts 의 모든 파일이 git 에 추적된다 — gitignore 가 소스를 삼키지 않는다', () => {
    const missing = onDisk.filter((p) => !tracked.has(p) && !NOT_SOURCE.some((re) => re.test(p)))
    expect(
      missing,
      `git 에 안 들어간 소스: ${missing.join(', ')}\n` +
        `→ .gitignore 규칙에 걸렸는지 확인하세요: git check-ignore -v <파일>`
    ).toEqual([])
  })
})
