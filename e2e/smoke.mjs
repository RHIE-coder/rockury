// 빌드된 Rockury 앱 구동 스모크 — **러너**. 실제 체크는 `e2e/suites/*.mjs` 에 스위트로 쌓인다
// (누적 회귀 자산 — 지우지 않고 더한다). 새 앱 흐름은 알맞은 스위트에 check 를 더하거나
// `suites/` 에 새 파일을 놓기만 하면 된다 — **등록 목록이 없다**(아래 자동 발견).
//
// 실행: npm run build && npm run e2e            (docker test-db 전제 — npm run db:up)
//       npm run e2e -- --no-db                  test-db 필요한 스위트는 건너뜀(미검증으로 표시)
//       npm run e2e -- --only=03-studio-definition,04-studio-seed
//       npm run e2e -- --continue               스위트가 깨져도 다음 스위트까지 계속
//       npm run e2e -- --list                   스위트 목록만 출력
//
// ⭐ 체크포인트: 스위트별 상태·체크 결과를 JSON 으로 남긴다(체크 하나마다 flush).
//    중간에 죽어도 "어디까지 돌았고 무엇이 미실행인지"가 파일과 요약에 남는다.
//
// ⚠ 이 스모크는 **실 앱 DB(userData)를 절대 건드리지 않는다** — 격리된 임시 userData 로
//    앱을 띄우고(--user-data-dir), 종료 시 그 임시 디렉터리만 지운다. (e2e/isolation.test.ts 가 강제)
// ⚠ 접근성 쿼리(getByRole 등)는 이 Electron 창을 크래시시킨다 → CSS/text 로케이터만 사용.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { styleText } from 'node:util'
import { APP, createContext, createCheckpoint, probeTestDb, requireBuild } from './lib/harness.mjs'

/**
 * 스위트 목록은 **폴더를 읽어 자동으로** 만든다 — 러너에 손으로 등록하지 않는다.
 *
 * 등록 배열을 두면 스위트를 더할 때마다 이 공용 파일을 고쳐야 하고, 다섯 서비스가 각자
 * 워크트리에서 동시에 일하는 이 프로젝트에선 그 한 줄이 매번 충돌 지점이 된다(AGENTS.md
 * "건드리지 않는 공용 파일"). 파일 이름 앞의 숫자가 곧 실행 순서다 — 실행 순서 = 상태 의존
 * 순서(앞 스위트가 만든 설계·연결을 뒤가 쓴다)이므로, 번호를 임의로 바꾸지 말 것.
 */
const SUITES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'suites')
const SUITES = fs
  .readdirSync(SUITES_DIR)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => f.slice(0, -4))
  .sort()

// 안전핀: 발견이 0건이면 "스위트가 전부 통과했다"가 아니라 **러너가 깨진 것**이다.
if (SUITES.length === 0) {
  console.error(`[e2e] ${path.relative(APP, SUITES_DIR)} 에서 스위트를 하나도 못 찾았습니다.`)
  process.exit(2)
}

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const valOf = (f) => argv.find((a) => a.startsWith(f + '='))?.slice(f.length + 1)
const NO_DB = has('--no-db')
const CONTINUE = has('--continue')
const ONLY = valOf('--only')?.split(',').map((s) => s.trim()).filter(Boolean)

const modules = []
for (const name of SUITES) {
  const mod = await import(`./suites/${name}.mjs`)
  modules.push({ name, needsDb: !!mod.meta?.needsDb, desc: mod.meta?.desc ?? '', run: mod.run })
}

if (has('--list')) {
  for (const m of modules) console.log(`${m.name}${m.needsDb ? ' [test-db]' : ''} — ${m.desc}`)
  process.exit(0)
}

requireBuild()

const CHECKPOINT = path.join(APP, '.harness/steward/artifacts/e2e-checkpoint.json')
const cp = createCheckpoint(CHECKPOINT, { argv, noDb: NO_DB, only: ONLY ?? null })

// test-db 사전 점검 — 깊은 곳에서 15초 타임아웃으로 죽는 대신 지금 알려준다.
const willRunDbSuite = modules.some((m) => m.needsDb && (!ONLY || ONLY.includes(m.name)))
if (!NO_DB && willRunDbSuite && !(await probeTestDb())) {
  console.error(styleText('red', '[e2e] test-db(mysql:13306)가 응답하지 않습니다.'))
  console.error('      `npm run db:up` 으로 띄우거나, 없이 돌리려면 `npm run e2e -- --no-db` 를 쓰세요.')
  for (const m of modules) cp.mark(m.name, m.needsDb, 'notrun', 'test-db 미기동')
  cp.finish()
  process.exit(2)
}

const ctx = await createContext()
let failed = false
let aborted = null

try {
  await ctx.page.waitForSelector('text=Studio', { timeout: 15_000 })

  for (const [i, m] of modules.entries()) {
    if (ONLY && !ONLY.includes(m.name)) {
      cp.mark(m.name, m.needsDb, 'skipped', '--only 로 제외')
      continue
    }
    if (NO_DB && m.needsDb) {
      cp.mark(m.name, m.needsDb, 'skipped', '--no-db (test-db 필요)')
      continue
    }
    if (aborted) {
      cp.mark(m.name, m.needsDb, 'notrun', `앞 스위트(${aborted}) 중단으로 미실행`)
      continue
    }

    console.log(styleText('cyan', `\n── [${i + 1}/${modules.length}] ${m.name} — ${m.desc}`))
    ctx.onCheck = cp.begin(m.name, m.needsDb)
    try {
      await m.run(ctx)
      const bad = cp.record.suites.at(-1).checks.filter((c) => !c.ok).length
      cp.end(bad ? 'fail' : 'pass')
      if (bad) failed = true
    } catch (e) {
      const msg = String(e?.message ?? e).split('\n')[0]
      console.error(styleText('red', `SUITE FAIL: ${m.name} — ${msg}`))
      cp.end('fail', msg)
      failed = true
      if (!CONTINUE) aborted = m.name
    } finally {
      ctx.onCheck = null
    }
  }
} catch (e) {
  console.error(styleText('red', 'SMOKE FAIL: ' + String(e?.message ?? e).split('\n')[0]))
  failed = true
} finally {
  await ctx.close()
  cp.finish()
}

// ── 요약 — 미검증(건너뜀·미실행)을 숨기지 않는다.
const s = cp.record.summary
console.log(
  `\n[e2e] 스위트 ${cp.record.suites.length}개 — 통과 ${s.pass} · 실패 ${s.fail} · 건너뜀 ${s.skipped} · 미실행 ${s.notrun}` +
    ` · 체크 ${s.checks}건(실패 ${s.failedChecks})`
)
for (const su of cp.record.suites) {
  if (su.status === 'fail') {
    const bad = su.checks.filter((c) => !c.ok).map((c) => c.label)
    console.log(
      styleText('red', `  ✗ ${su.name}`) +
        (su.error ? ` — ${su.error}` : '') +
        (bad.length ? ` — 실패 체크: ${bad.join(' / ')}` : '')
    )
  } else if (su.status === 'skipped' || su.status === 'notrun') {
    console.log(styleText('yellow', `  ⏭ ${su.name} — 미검증(${su.reason})`))
  }
}
if (s.skipped || s.notrun) {
  console.log(styleText('yellow', '  ⚠ 위 스위트는 이번 실행에서 검증되지 않았습니다(통과 아님).'))
}
console.log(`  체크포인트: ${path.relative(APP, CHECKPOINT)}`)
console.log(failed ? styleText('red', '\nSOME FAILED') : styleText('green', '\nALL PASS'))
process.exit(failed ? 1 : 0)
