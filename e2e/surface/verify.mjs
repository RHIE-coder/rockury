// surface-verify 어댑터 (Electron 표면). 빌드된 앱을 _electron 으로 띄워 화면을
//   "정규화 모델"(CaptureResult)로 추출하고 .harness/steward/artifacts/<feature>/surface-verify.json 에
//   남긴다. 판정(대비/겹침/잘림/넘침/에러)은 순수 로직(checks.mjs)이 한다 — 여기선 추출·증거만.
//   커밋 훅(surface-gate.mjs)이 이 기록 + 판정기(surface-checks.mjs)를 재실행해 통과를 강제한다.
//
//   불변식: 실 앱 DB 를 절대 안 건드린다 — 격리된 임시 userData(--user-data-dir)로 띄우고 그것만 정리.
//   함정: getByRole 계열은 이 창을 크래시시킨다 → 여기선 DOM 평가(page.evaluate)만 쓴다.
//
//   사용: npm run build && node e2e/surface/verify.mjs
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
  // 검증불가 기록을 남기고 종료(2) — 조용히 통과시키지 않는다.
  const rec = { generatedAt: null, feature: featureName(), captures: [{ surface: 'native-desktop', target: 'boot', status: 'cannot-verify', formFactor: { label: 'default' }, errors: ['빌드 없음: out/main/index.js'], elements: [], meta: { adapter: 'electron', adapterVersion: '1', caveats: [] } }] }
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
const errors = []
try {
  app = await electron.launch({ executablePath: electronBin, args: [MAIN, `--user-data-dir=${USER_DATA}`], timeout: 30_000 })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })
  await page.waitForSelector('text=Studio', { timeout: 15_000 })
  await page.waitForTimeout(400) // 초기 렌더 안정화

  const shot = path.join(ARTIFACTS, 'surface-boot.png')
  await page.screenshot({ path: shot })
  const dom = await page.evaluate(extractScript())

  const capture = {
    surface: 'native-desktop',
    target: 'boot: Studio shell',
    formFactor: { label: 'default', w: dom.w, h: dom.h, unit: 'px', theme: 'light' },
    status: 'ok',
    capture: shot,
    // node:sqlite ExperimentalWarning 등 무해 로그는 대상 아님(pageerror/console.error 만 모음).
    errors: errors.slice(),
    elements: dom.elements,
    meta: { adapter: 'electron', adapterVersion: '1', caveats: ['bg 는 불투명 조상 근사', 'fits 는 가로 넘침만'] },
  }

  // --update-baseline: 현재 findings 를 수용 기준선으로 굳힌다(기준선 없이 계산한 raw).
  if (UPDATE_BASELINE) {
    const raw = runChecks([capture], {})
    fs.writeFileSync(BASELINE, JSON.stringify(raw.findings, null, 2))
    console.log(`기준선 갱신 → ${BASELINE} (현재 ${raw.findings.length}건 수용)`)
  }
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : []

  const record = { generatedAt: null, feature: featureName(), captures: [capture], baseline }
  const recPath = path.join(ARTIFACTS, 'surface-verify.json')
  fs.writeFileSync(recPath, JSON.stringify(record, null, 2))

  const result = runChecks(record.captures, { baseline })
  const observed = result.findings.filter((f) => f.severity === 'observe').length
  console.log(`surface-verify → ${recPath}`)
  console.log(`  요소 ${capture.elements.length}개 · status=${result.status} · 차단 ${result.blockingCount}건 · 관찰(기준선 수용) ${observed}건`)
  for (const f of result.findings.filter((x) => x.severity === 'block').slice(0, 20)) {
    console.log(`  ✗ [${f.check}] ${f.detail}${f.text ? ` — "${f.text}"` : ''}`)
  }
  if (result.caveats.length) console.log('  caveats: ' + result.caveats.join(' · '))
  await app.close()
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  process.exit(exitCodeFor(result.status))
} catch (e) {
  console.error('SURFACE-VERIFY FAIL:', (e?.message || String(e)).split('\n')[0])
  const rec = { generatedAt: null, feature: featureName(), captures: [{ surface: 'native-desktop', target: 'boot', status: 'cannot-verify', formFactor: { label: 'default' }, errors: [String(e?.message || e)], elements: [], meta: { adapter: 'electron', adapterVersion: '1', caveats: [] } }] }
  fs.writeFileSync(path.join(ARTIFACTS, 'surface-verify.json'), JSON.stringify(rec, null, 2))
  await app?.close().catch(() => {})
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  process.exit(2) // 검증불가 ≠ 통과
}
