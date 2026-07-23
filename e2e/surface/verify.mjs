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
//   사용: npm run build && node e2e/surface/verify.mjs [--update-baseline]
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'
import { runChecks, exitCodeFor } from './checks.mjs'

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
const BASELINE = path.join(APP, 'e2e/surface/baseline.json')
const UPDATE_BASELINE = process.argv.includes('--update-baseline')

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
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })
  // 미저장 가드 등 confirm 은 수락(순회가 막히지 않게).
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await page.waitForSelector('text=Studio', { timeout: 15_000 })
  await page.waitForTimeout(400) // 초기 렌더 안정화

  await captureScreen('boot')

  // 시드 설계 선택 — 설계부 화면들이 placeholder 가 아니라 실 콘텐츠로 렌더되도록.
  // (운영부는 docker 없이도 도는 게이트라 연결은 안 만든다 — 빈 상태 화면 그대로가 검사 대상.)
  try {
    await page.locator('button:has-text("Design")').first().click()
    await page.locator('[role="menuitem"]:has-text("commerce-core")').first().click()
    await page.waitForTimeout(300)
  } catch {
    errors.push('console.error: 시드 설계(commerce-core) 선택 실패 — 설계부 화면이 placeholder 로 캡처됨')
  }

  // ⭐ 전 화면 자동 순회 — 셸 훅(data-nav-*)에서 nav 트리를 발견해 모든 leaf 를 방문한다.
  const serviceIds = await page.$$eval('[data-nav-service]', (els) => els.map((e) => e.getAttribute('data-nav-service')))
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
  if (leaves < MIN_LEAVES) {
    throw new Error(`nav 순회 실패: leaf ${leaves}개 < 최소 ${MIN_LEAVES} (data-nav-* 훅이 사라졌나?)`)
  }

  // --update-baseline: 현재 findings 를 수용 기준선으로 굳힌다(기준선 없이 계산한 raw).
  if (UPDATE_BASELINE) {
    const raw = runChecks(captures, {})
    fs.writeFileSync(BASELINE, JSON.stringify(raw.findings, null, 2))
    console.log(`기준선 갱신 → ${BASELINE} (현재 ${raw.findings.length}건 수용)`)
  }
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : []

  const record = { generatedAt: null, feature: featureName(), captures, baseline }
  const recPath = path.join(ARTIFACTS, 'surface-verify.json')
  fs.writeFileSync(recPath, JSON.stringify(record, null, 2))

  const result = runChecks(record.captures, { baseline })
  const observed = result.findings.filter((f) => f.severity === 'observe').length
  console.log(`surface-verify → ${recPath}`)
  console.log(`  화면 ${captures.length}개(leaf ${leaves}) · status=${result.status} · 차단 ${result.blockingCount}건 · 관찰(기준선 수용) ${observed}건`)
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
