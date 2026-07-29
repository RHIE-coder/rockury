import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

/**
 * e2e 안전 불변식 가드(재발 방지) — 앱 구동 스크립트가 **실 앱 DB 를 절대 건드리지 못하게** 강제한다.
 * 과거 smoke.mjs 가 `~/Library/Application Support/Rockury/rockury.db` 를 rmSync 해
 * 사용자 연결을 파괴한 사고가 있었다. 그 회귀가 재도입되면 `npm test` 가 여기서 실패한다.
 *
 * 스모크가 러너(smoke.mjs) + 하네스(lib/) + 스위트(suites/)로 쪼개졌으므로 **e2e 하위 모든 .mjs**
 * 를 훑는다 — 파일을 나눠서 가드를 빠져나가는 일이 없게(가드 우회 차단이 이 테스트의 요점).
 */
const E2E = dirname(fileURLToPath(import.meta.url))

function collectMjs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...collectMjs(p))
    else if (name.endsWith('.mjs')) out.push(p)
  }
  return out
}

const files = collectMjs(E2E).map((p) => ({ path: relative(E2E, p), src: readFileSync(p, 'utf8') }))

describe('e2e 격리 불변식', () => {
  it('스캔 대상이 비지 않는다(가드가 헛돌지 않게)', () => {
    // 러너 + 하네스 + 스위트 12개 + surface 어댑터 → 넉넉히 10개 이상.
    expect(files.length).toBeGreaterThanOrEqual(10)
    expect(files.map((f) => f.path)).toContain('smoke.mjs')
  })

  it('실 앱 userData 경로(Application Support/Rockury)를 참조하지 않는다', () => {
    for (const f of files) expect(f.src, f.path).not.toMatch(/Application Support/)
  })

  it('실 DB 파일을 삭제(rmSync)하지 않는다 — 임시 userData 만 정리', () => {
    for (const f of files) {
      // rmSync 는 임시 userData(USER_DATA) 정리에만 쓰여야 한다.
      const rmCalls = f.src.match(/rmSync\([^)]*\)/g) ?? []
      for (const call of rmCalls) expect(call, f.path).toMatch(/USER_DATA/)
    }
  })

  it('앱을 띄우는 파일은 격리된 임시 userData 를 쓴다(--user-data-dir + mkdtemp)', () => {
    const launchers = files.filter((f) => f.src.includes('electron.launch'))
    expect(launchers.length).toBeGreaterThan(0)
    for (const f of launchers) {
      expect(f.src, f.path).toMatch(/--user-data-dir=/)
      expect(f.src, f.path).toMatch(/mkdtempSync/)
    }
  })

  it('스위트는 폴더에서 자동 발견된다 — 러너에 목록을 하드코딩하지 않는다', () => {
    // 하드코딩한 등록 배열을 두면 ⑴ 스위트를 더할 때마다 공용 러너를 고쳐야 해서
    // 병렬 개발에서 매번 충돌하고 ⑵ 등록을 빠뜨린 스위트가 **조용히 안 돌아간다**.
    // (docs/qa/parallel-dev.md CASE-pdev-003)
    const runner = files.find((f) => f.path === 'smoke.mjs')!.src
    expect(runner, '러너가 suites 폴더를 읽지 않는다').toMatch(/readdirSync\(SUITES_DIR\)/)

    // 폴더에 있는 스위트가 전부 실행 대상이 된다 — 러너가 세는 방식과 같은 규칙으로 확인.
    const onDisk = readdirSync(join(E2E, 'suites')).filter((n) => n.endsWith('.mjs'))
    expect(onDisk.length).toBeGreaterThan(0)
    const scanned = files.filter((f) => f.path.startsWith('suites/')).length
    expect(scanned, '스위트 파일이 격리 검사에서 빠졌다').toBe(onDisk.length)
  })
})

/**
 * 스위트 **이름 규칙** 가드.
 *
 * 러너가 폴더를 이름순으로 돌기 때문에 파일 이름이 곧 실행 순서다. 등록 목록이 없다는 것은
 * 서비스가 공용 파일을 안 건드리고 스위트를 더할 수 있다는 뜻이지만, 그 대가로 **번호를
 * 누가 쓰고 있는지 아무도 강제하지 않는다** — 실제로 2026-07-29 병렬 개발에서 infra·uiux·api
 * 셋이 동시에 13번을 잡았다. 사람이 `ls` 로 알아채는 대신 여기서 막는다.
 */
const SUITE_BANDS = `  01–12  기존 블록(공용·db·ai) — 내부 순서가 상태 의존이라 재배치하지 않는다
  13–19  infra
  20–29  uiux
  30–49  api
  50–59  db 추가분      60–69  ai 추가분
  99     콜드 재시작 — **맨 마지막**이어야 앞선 모든 서비스가 만든 상태가 재시작 검증에 들어간다`

/**
 * 서비스별 번호 구간 (`AGENTS.md` 의 표와 **같은 값이어야 한다**).
 *
 * 왜 기계가 보나: 등록 목록이 없다는 것은 "누가 어느 번호를 쓰는지 아무도 모른다"는 뜻이라
 * 2026-07-29 에 세 서비스가 13번을 동시에 잡았다. 그래서 구간을 나눴는데, **중복만 막으면
 * 옆 구간을 말없이 쓰는 것은 그대로 통과한다** — 그 서비스가 자기 첫 스위트를 놓는 순간
 * `main` 에서 깨지고, 그때는 번호가 곧 실행 순서라 재배치가 위험한 작업이 된다
 * (실제로 api 가 30–39 를 다 쓰고 40 을 집었다가 여기 걸렸다).
 */
const BANDS: Record<string, [number, number]> = {
  infra: [13, 19],
  uiux: [20, 29],
  api: [30, 49],
  db: [50, 59],
  ai: [60, 69]
}
/** 서비스 토큰이 붙기 전에 만들어진 블록. 이 아래는 구간 검사를 안 한다. */
const LEGACY_MAX = 12

describe('e2e 스위트 이름 규칙', () => {
  const suites = files
    .filter((f) => f.path.startsWith('suites/'))
    .map((f) => ({ file: f.path.slice('suites/'.length), src: f.src }))

  it('스위트가 하나 이상 발견된다(가드가 헛돌지 않게)', () => {
    expect(suites.length).toBeGreaterThan(0)
  })

  it('번호가 겹치지 않는다 — 겹치면 실행 순서가 번호가 아니라 이름 철자에 좌우된다', () => {
    const byNumber = new Map<string, string[]>()
    for (const s of suites) {
      const n = s.file.slice(0, 2)
      byNumber.set(n, [...(byNumber.get(n) ?? []), s.file])
    }
    const dup = [...byNumber.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([n, v]) => `${n}: ${v.join(' / ')}`)
    expect(dup, `번호가 겹쳤다. 자기 서비스 구간에서 빈 번호를 고르세요 —\n${SUITE_BANDS}\n`).toEqual(
      []
    )
  })

  it('**자기 서비스 구간 안의 번호를 쓴다** — 옆 구간을 말없이 쓰면 그 서비스가 나중에 깨진다', () => {
    const outOfBand: string[] = []
    for (const s of suites) {
      const n = Number(s.file.slice(0, 2))
      if (!Number.isFinite(n) || n <= LEGACY_MAX || n === 99) continue
      // `39-api-grpc.mjs` → `api`
      const svc = s.file.split('-')[1]
      const band = BANDS[svc]
      if (!band) continue // 서비스 토큰이 아닌 이름은 이 검사 대상이 아니다
      if (n < band[0] || n > band[1]) {
        outOfBand.push(`${s.file}: ${svc} 구간은 ${band[0]}–${band[1]} 입니다`)
      }
    }
    expect(
      outOfBand,
      `구간 밖 번호를 썼다. 자기 구간이 꽉 찼으면 **옆 칸을 쓰지 말고** ` +
        `\`AGENTS.md\` 의 표와 여기 \`BANDS\` 를 함께 넓히세요 —\n${SUITE_BANDS}\n`
    ).toEqual([])
  })

  it('meta.name 이 파일 이름과 같다 — 개명할 때 안이 안 따라오면 체크포인트에 옛 이름이 남는다', () => {
    const mismatched: string[] = []
    for (const s of suites) {
      const declared = /name:\s*'([^']+)'/.exec(s.src)?.[1]
      const expected = s.file.replace(/\.mjs$/, '')
      if (declared !== expected) mismatched.push(`${s.file}: meta.name='${declared}'`)
    }
    expect(mismatched, 'meta.name 과 파일 이름이 다르다').toEqual([])
  })
})
