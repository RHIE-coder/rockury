// surface-verify 어댑터 (Electron 표면). 빌드된 앱을 _electron 으로 띄워 화면을
//   "정규화 모델"(CaptureResult)로 추출하고 .harness/steward/artifacts/<feature>/surface-verify.json 에
//   남긴다. 판정(대비/겹침/잘림/넘침/에러)은 순수 로직(checks.mjs)이 한다 — 여기선 추출·증거만.
//   커밋 훅(surface-gate.mjs)이 이 기록 + 판정기(surface-checks.mjs)를 재실행해 통과를 강제한다.
//
//   ⭐ 전 화면 자동 순회: 셸의 data-nav-service / data-nav-module / data-nav-view 훅을 읽어
//   모든 서비스×모듈×뷰 leaf 를 방문·캡처한다. 새 화면은 nav 에 등록만 되면 자동으로
//   여기 커버리지에 들어온다(수동 등록 없음 — "안 쌓이는" 회귀의 구조적 차단).
//   실패 안전핀: 발견된 leaf 가 MIN_LEAVES 미만이면 순회가 깨진 것 → 검증불가(2)로 크게 실패한다.
//
//   불변식: 실 앱 DB 를 절대 안 건드린다 — 격리된 임시 userData(--user-data-dir)로 띄우고 그것만 정리.
//   함정: getByRole 계열은 이 창을 크래시시킨다 → CSS 로케이터 + DOM 평가(page.evaluate)만 쓴다.
//
//   ⭐ 범위 좁히기: `--only=db` 로 그 서비스 화면만 **다시 뜬다.** 나머지는 **지난 기록을 그대로
//   이어받아** 기록 전체가 여전히 전 화면을 덮는다 — 안 그러면 좁힌 순간 다른 서비스가 기록에서
//   사라져 커밋 관문이 "검사할 게 없어서" 조용히 통과한다(이 저장소가 제일 싫어하는 실패).
//   그래서 지난 기록이 없으면 `--only` 는 거절한다: 이어받을 것이 없으면 구멍이 된다.
//
//   사용: npm run build && node e2e/surface/verify.mjs [--only=<서비스,...>] [--update-baseline]
//         npm run surface-verify -- --only=db
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'
import { runChecks, exitCodeFor } from './checks.mjs'
import { loadBaseline, writeBaseline } from './baseline.mjs'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(path.join(APP, 'package.json'))
const electronBin = path.join(
  APP,
  process.platform === 'darwin'
    ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    : 'node_modules/electron/dist/electron'
)
const MAIN = path.join(APP, 'out/main/index.js')
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rockury-surface-'))

// 순회 실패 안전핀 — 현재 nav 는 leaf 30+개. 이 밑으로 떨어지면 훅/순회가 깨진 것이다.
const MIN_LEAVES = 5

/**
 * 검사 창 크기(고정) — 판정을 결정적으로 만드는 기준 폼팩터. 기준선(baseline.json)도 이 크기에서 뜬 것이다.
 * 바꾸면 잘림/겹침 판정이 통째로 달라지므로 기준선 재수립(`--update-baseline`)이 필요하다.
 */
const WINDOW = { w: 1440, h: 900 }

// feature 폴더 — steward 규칙과 동일(config feature: → git 브랜치 → default).
function featureName() {
  const cfg = path.join(APP, '.harness/steward/config.yaml')
  if (fs.existsSync(cfg)) {
    const m = fs.readFileSync(cfg, 'utf8').match(/^feature:\s*([^#\n]+)/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  try {
    const b = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: APP, encoding: 'utf8' }).trim()
    if (b && b !== 'HEAD') return b.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  } catch {}
  return 'default'
}
const ARTIFACTS = path.join(APP, '.harness/steward/artifacts', featureName())
fs.mkdirSync(ARTIFACTS, { recursive: true })

// 기준선 — 수용된 기존 findings(커밋되는 정본). 있으면 그 findings 는 차단에서 제외(관찰),
//   새로 생긴 회귀만 차단한다. `--update-baseline` 로 현재 상태를 기준선으로 굳힌다.
//   **서비스별 파일**로 나뉘어 있다(baseline/<서비스>.json) — 생성물이라 손으로 병합할 수
//   없는데 다섯 서비스가 같은 파일을 갱신하면 충돌이 나기 때문이다.
const BASELINE_DIR = path.join(APP, 'e2e/surface/baseline')
const UPDATE_BASELINE = process.argv.includes('--update-baseline')

const HELP = process.argv.includes('--help') || process.argv.includes('-h')
if (HELP) {
  console.log(
    [
      'surface-verify — 빌드된 앱을 띄워 전 화면을 재고 기록을 남긴다.',
      '',
      '  node e2e/surface/verify.mjs                  전 화면',
      '  node e2e/surface/verify.mjs --only=db        그 서비스만 다시 뜬다(나머지는 지난 기록 이어받음)',
      '  node e2e/surface/verify.mjs --only=db,api    여럿은 쉼표로',
      '  node e2e/surface/verify.mjs --update-baseline  지금 상태를 수용 기준선으로 굳힌다(전 화면에서만)',
      '',
      '  --only 는 지난 기록이 있어야 쓸 수 있다 — 이어받을 것이 없으면 기록에 구멍이 난다.'
    ].join('\n')
  )
  process.exit(0)
}

/** `--only=db,api` → ['db','api']. 안 주면 null(전부). */
const ONLY = (() => {
  const arg = process.argv.find((a) => a.startsWith('--only='))
  if (!arg) return null
  const ids = arg
    .slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return ids.length > 0 ? ids : null
})()

if (ONLY && UPDATE_BASELINE) {
  console.error('SURFACE-VERIFY FAIL: --update-baseline 은 전 화면에서만 쓴다(--only 와 같이 못 쓴다).')
  console.error('  기준선은 화면 전체를 한 판정 기준으로 묶는 것이라, 일부만 갱신하면 나머지와 어긋난다.')
  process.exit(2)
}

if (!fs.existsSync(MAIN)) {
  console.error('먼저 `npm run build` 를 실행하세요 (out/main/index.js 없음).')
  const rec = { generatedAt: null, feature: featureName(), captures: [{ surface: 'native-desktop', target: 'boot', status: 'cannot-verify', formFactor: { label: 'boot' }, errors: ['빌드 없음: out/main/index.js'], elements: [], meta: { adapter: 'electron', adapterVersion: '2', caveats: [] } }] }
  fs.writeFileSync(path.join(ARTIFACTS, 'surface-verify.json'), JSON.stringify(rec, null, 2))
  process.exit(2)
}

// 렌더러에서 실행 — 보이는 요소를 정규화 모델로 추출한다.
function extractScript() {
  return `(() => {
    const parseRGB = (s) => { const m = (s||'').match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(x=>parseFloat(x)); return { rgb:[p[0],p[1],p[2]], a: p[3]===undefined?1:p[3] }; };
    const effBg = (el) => { let n = el; while (n && n.nodeType===1) { const b = parseRGB(getComputedStyle(n).backgroundColor); if (b && b.a >= 0.5) return b.rgb; n = n.parentElement; } return [255,255,255]; };
    const directText = (el) => Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();
    const isInteractive = (el) => { const t = el.tagName; if (['BUTTON','A','INPUT','SELECT','TEXTAREA'].includes(t)) return true; const r = el.getAttribute('role'); if (['button','link','menuitem','tab','checkbox','switch'].includes(r||'')) return true; return false; };
    const visible = (el, r) => { const cs = getComputedStyle(el); return cs.display!=='none' && cs.visibility!=='hidden' && cs.opacity!=='0' && r.width>0 && r.height>0; };
    // 잘린 칸이 제 자리에서 펴지는가 — 옆에 붙은 펼침 손잡이(\`ui/clipped\` 의 ClipToggle)를 찾는다.
    // 두 겹까지만 올려다본다: 손잡이는 언제나 글자 상자의 형제이거나(대조표·Remote) 그 상자를
    // 감싼 버튼의 형제다(설계부의 EditableText). 더 올리면 같은 줄의 남의 손잡이를 제 것으로 센다.
    const expandable = (el) => { let n = el; for (let up=0; up<2 && n; up++, n=n.parentElement) { if (n.parentElement && n.parentElement.querySelector(':scope > [data-clip-toggle]')) return true; } return false; };
    const els = [];
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (!visible(el, r)) continue;
      const cs = getComputedStyle(el);
      const txt = directText(el);
      const interactive = isInteractive(el);
      if (!txt && !interactive) continue;
      const bounds = { x: r.x, y: r.y, w: r.width, h: r.height };
      const truncated = txt ? (el.scrollWidth > el.clientWidth + 1 && (cs.textOverflow==='ellipsis' || cs.overflow!=='visible' || cs.whiteSpace==='nowrap')) : false;
      els.push({
        role: interactive ? (el.tagName==='A'?'link':'button') : 'text',
        text: txt || null,
        fg: txt ? (parseRGB(cs.color)?.rgb ?? null) : null,
        bg: txt ? effBg(el) : null,
        bounds,
        states: [],
        interactive,
        truncated,
        expandable: truncated ? expandable(el) : false,
        essential: !!txt,
        fontSize: parseFloat(cs.fontSize) || null,
        bold: (parseInt(cs.fontWeight,10) || 400) >= 600,
      });
    }
    return { w: window.innerWidth, h: window.innerHeight, elements: els };
  })()`
}

let app, page
const errors = [] // 전역 누적 — 화면별로 slice 해서 그 화면의 errors 로 귀속시킨다.
let errCursor = 0
const captures = []

const safe = (s) => s.replace(/[^a-zA-Z0-9._-]+/g, '-')

/** 현재 화면을 CaptureResult 로 추출해 captures 에 쌓는다. target = 화면 경로. */
async function captureScreen(target) {
  const dom = await page.evaluate(extractScript())
  const shot = path.join(ARTIFACTS, `surface-${safe(target)}.png`)
  await page.screenshot({ path: shot })
  const newErrors = errors.slice(errCursor)
  errCursor = errors.length
  captures.push({
    surface: 'native-desktop',
    target,
    // label 에 화면 경로를 넣는다 — findingKey(기준선 매칭)가 화면별로 갈라지도록.
    formFactor: { label: target, w: dom.w, h: dom.h, unit: 'px', theme: 'light' },
    status: 'ok',
    capture: shot,
    errors: newErrors,
    elements: dom.elements,
    meta: { adapter: 'electron', adapterVersion: '2', caveats: ['bg 는 불투명 조상 근사', 'fits 는 가로 넘침만'] },
  })
}

try {
  app = await electron.launch({ executablePath: electronBin, args: [MAIN, `--user-data-dir=${USER_DATA}`], timeout: 30_000 })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('remote', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })
  // 미저장 가드 등 confirm 은 수락(순회가 막히지 않게).
  page.on('dialog', (d) => d.accept().catch(() => {}))
  // ⭐ 검사 창을 **주 디스플레이 + 고정 크기**로 못박는다 — 판정이 결정적이어야 하기 때문.
  //   앱은 "커서가 있는 화면"에 창을 띄우는데(src/main/index.ts), 좁은 세로 모니터(예: 1080폭)에
  //   걸리면 macOS 가 창 폭을 그 모니터 폭으로 잘라 버린다(windowSize.ts 주석의 실측 사례).
  //   그러면 표 컬럼 폭이 달라져 같은 커밋이 block ↔ ok 를 왕복했다(실측 flake).
  //   위치를 먼저 주 디스플레이로 옮긴 뒤 크기를 주고, **실제로 그 크기가 됐는지 확인**한다.
  const got = await app.evaluate(async ({ BrowserWindow, screen }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const wa = screen.getPrimaryDisplay().workArea
    win.setResizable(true)
    win.unmaximize()
    // 위치 → 크기 순서. 반대로 하면 옮기는 도중 좁은 화면에 걸려 폭이 잘린다.
    win.setBounds({ x: wa.x + 16, y: wa.y + 16, width: size.w, height: size.h })
    win.setContentSize(size.w, size.h)
    const [w, h] = win.getContentSize()
    return { w, h }
  }, WINDOW)
  if (!got || got.w !== WINDOW.w || got.h !== WINDOW.h) {
    // 조용히 다른 폼팩터로 재는 대신 크게 실패한다 — 기준선과 비교 불가한 측정이기 때문.
    throw new Error(
      `검사 창을 ${WINDOW.w}×${WINDOW.h} 로 만들지 못했습니다(실제 ${got ? `${got.w}×${got.h}` : '없음'}).` +
        ' 주 디스플레이 작업영역이 그보다 작으면 판정이 기준선과 어긋나므로 검증불가로 둡니다.'
    )
  }
  await page.waitForSelector('text=Design', { timeout: 15_000 })
  // 웹폰트 로드 전 측정하면 글자 폭이 달라져 잘림 판정이 또 흔들린다 → 폰트까지 기다린다.
  await page.evaluate(() => document.fonts?.ready.then(() => true))
  await page.waitForTimeout(400) // 초기 렌더 안정화

  await captureScreen('boot')

  // 시드 설계 선택 — 설계부 화면들이 placeholder 가 아니라 실 콘텐츠로 렌더되도록.
  // (운영부는 docker 없이도 도는 게이트라 연결은 안 만든다 — 빈 상태 화면 그대로가 검사 대상.)
  try {
    await page.locator('[data-context-selector="design"]').first().click()
    await page.locator('[role="menuitem"]:has-text("commerce-core")').first().click()
    await page.waitForTimeout(300)
  } catch {
    errors.push('console.error: 시드 설계(commerce-core) 선택 실패 — 설계부 화면이 placeholder 로 캡처됨')
  }

  // ⭐ 전 화면 자동 순회 — 셸 훅(data-nav-*)에서 nav 트리를 발견해 모든 leaf 를 방문한다.
  const allServiceIds = await page.$$eval('[data-nav-service]', (els) => els.map((e) => e.getAttribute('data-nav-service')))
  if (ONLY) {
    const unknown = ONLY.filter((s) => !allServiceIds.includes(s))
    if (unknown.length > 0) {
      throw new Error(`--only 에 없는 서비스: ${unknown.join(', ')} (쓸 수 있는 것: ${allServiceIds.join(', ')})`)
    }
  }
  const serviceIds = ONLY ? allServiceIds.filter((s) => ONLY.includes(s)) : allServiceIds
  let leaves = 0
  for (const svc of serviceIds) {
    await page.locator(`[data-nav-service="${svc}"]`).click()
    await page.waitForTimeout(250)
    const moduleIds = await page.$$eval('[data-nav-module]', (els) => els.map((e) => e.getAttribute('data-nav-module')))
    for (const mod of moduleIds) {
      await page.locator(`[data-nav-module="${mod}"]`).click()
      await page.waitForTimeout(350)
      const viewIds = await page.$$eval('[data-nav-view]', (els) => els.map((e) => e.getAttribute('data-nav-view')))
      if (viewIds.length === 0) {
        await captureScreen(`${svc}/${mod}`)
        leaves++
        continue
      }
      for (const view of viewIds) {
        await page.locator(`[data-nav-view="${view}"]`).click()
        await page.waitForTimeout(450) // ReactFlow 등 무거운 뷰 렌더 여유
        await captureScreen(`${svc}/${mod}/${view}`)
        leaves++
      }
    }
  }

  // 실패 안전핀 — 순회가 boot 만 남기고 조용히 쪼그라드는 회귀를 기계로 차단.
  //   범위를 좁혔으면 그 서비스 몫만 봐야 한다(한 서비스가 leaf 5개 미만일 수 있다).
  if (leaves < (ONLY ? 1 : MIN_LEAVES)) {
    throw new Error(`nav 순회 실패: leaf ${leaves}개 < 최소 ${MIN_LEAVES} (data-nav-* 훅이 사라졌나?)`)
  }

  // --update-baseline: 현재 findings 를 수용 기준선으로 굳힌다(기준선 없이 계산한 raw).
  if (UPDATE_BASELINE) {
    const raw = runChecks(captures, {})
    const groups = writeBaseline(BASELINE_DIR, raw.findings)
    const per = Object.entries(groups).map(([s, l]) => `${s} ${l.length}`).join(' · ')
    console.log(`기준선 갱신 → ${BASELINE_DIR}/ (현재 ${raw.findings.length}건 수용 — ${per})`)
  }
  const baseline = loadBaseline(BASELINE_DIR)

  /*
   * 범위를 좁혔으면 **나머지 화면은 지난 기록에서 그대로 이어받는다.**
   * 이어받지 않으면 기록이 이번에 뜬 몇 장으로 쪼그라들고, 커밋 관문은 그 몇 장만 보고 통과한다 —
   * 다른 서비스의 회귀가 "검사 대상이 아니라서" 조용히 빠져나가는 길이 된다.
   */
  let finalCaptures = captures
  let carried = 0
  if (ONLY) {
    const recPathPrev = path.join(ARTIFACTS, 'surface-verify.json')
    if (!fs.existsSync(recPathPrev)) {
      throw new Error('--only 는 지난 기록이 있어야 씁니다 — 먼저 범위 없이 한 번 돌리세요(npm run surface-verify).')
    }
    const prev = JSON.parse(fs.readFileSync(recPathPrev, 'utf8'))
    const fresh = new Set(captures.map((c) => c.target))
    const kept = (prev.captures ?? []).filter((c) => !fresh.has(c.target) && c.status !== 'cannot-verify')
    carried = kept.length
    if (carried === 0) {
      throw new Error('--only: 지난 기록에 이어받을 화면이 없습니다 — 범위 없이 한 번 돌리세요.')
    }
    finalCaptures = [...captures, ...kept]
  }

  const record = { generatedAt: null, feature: featureName(), captures: finalCaptures, baseline }
  const recPath = path.join(ARTIFACTS, 'surface-verify.json')
  fs.writeFileSync(recPath, JSON.stringify(record, null, 2))

  const result = runChecks(record.captures, { baseline })
  const observed = result.findings.filter((f) => f.severity === 'observe').length
  console.log(`surface-verify → ${recPath}`)
  const scopeNote = ONLY ? ` · 범위 ${ONLY.join(',')} — 새로 뜬 ${captures.length}개 · 지난 기록에서 이어받은 ${carried}개` : ''
  console.log(`  화면 ${finalCaptures.length}개(leaf ${leaves}) · status=${result.status} · 차단 ${result.blockingCount}건 · 관찰(기준선 수용) ${observed}건${scopeNote}`)
  for (const f of result.findings.filter((x) => x.severity === 'block').slice(0, 20)) {
    console.log(`  ✗ [${f.check}] (${f.formFactor}) ${f.detail}${f.text ? ` — "${f.text}"` : ''}`)
  }
  if (result.caveats.length) console.log('  caveats: ' + result.caveats.join(' · '))
  await app.close()
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  process.exit(exitCodeFor(result.status))
} catch (e) {
  console.error('SURFACE-VERIFY FAIL:', (e?.message || String(e)).split('\n')[0])
  const rec = { generatedAt: null, feature: featureName(), captures: [{ surface: 'native-desktop', target: 'boot', status: 'cannot-verify', formFactor: { label: 'boot' }, errors: [String(e?.message || e)], elements: [], meta: { adapter: 'electron', adapterVersion: '2', caveats: [] } }] }
  fs.writeFileSync(path.join(ARTIFACTS, 'surface-verify.json'), JSON.stringify(rec, null, 2))
  await app?.close().catch(() => {})
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  process.exit(2) // 검증불가 ≠ 통과
}
