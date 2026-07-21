// surface-verify — 순수 검사 로직 (steward surface-verify 계약의 판정부).
//   입력은 "정규화 모델"(CaptureResult[]) 뿐 — Electron/DOM 어휘가 여기 섞이면 안 된다.
//   추출(어떻게 색·경계를 얻나)은 어댑터(verify.mjs)의 몫, 판정(대비/겹침/잘림/넘침/에러)은 여기.
//   대비 수학은 WCAG 2.2 SC 1.4.3 (sRGB 상대휘도). 이 파일은 zero-dep ESM (node/vitest 공용).
//
// CaptureResult { surface, target, formFactor:{label,w,h,unit,theme?}, status:'ok'|'cannot-verify',
//                 capture, errors:string[], elements:Element[], meta:{...} }
// Element { role, text, fg:[r,g,b]|null, bg:[r,g,b]|null, bounds:{x,y,w,h},
//           states, interactive, truncated, essential, fontSize?, bold? }

// WCAG AA 대비 임계값 (본문 4.5 · 큰 텍스트 3.0).
export const CONTRAST_MIN = { normal: 4.5, large: 3.0 }

// sRGB 채널 → 선형화 (WCAG 공식).
function channelLinear(c) {
  const cs = c / 255
  return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4
}

// 상대휘도 L (0~1).
export function relativeLuminance([r, g, b]) {
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b)
}

// 대비비 (1~21). 순서 무관.
export function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

// 큰 텍스트 판정 (픽셀 표면): ≥24px, 또는 굵고 ≥18.66px(=14pt bold).
export function isLargeText(fontSize, bold) {
  if (!fontSize) return false
  return fontSize >= 24 || (!!bold && fontSize >= 18.66)
}

// 두 경계의 겹침 넓이.
function overlapArea(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return ix * iy
}

const area = (bnd) => Math.max(0, bnd.w) * Math.max(0, bnd.h)
const round = (n) => Math.round(n)

// 한 finding 의 안정 키 (기준선 diff·중복 제거용).
//   bounds 는 키에서 뺀다 — 레이아웃이 몇 px 흔들려도 같은 finding 으로 매칭돼야 기준선이 안정적이다.
export function findingKey(f) {
  return [f.check, f.formFactor ?? '', f.role ?? '', (f.text ?? '').slice(0, 60)].join('|')
}

/**
 * 정규화 캡처들을 검사한다.
 * @param captures CaptureResult[]
 * @param opts.baseline 이전 findings[] (있으면 그 키는 차단에서 제외 → 관찰로 강등)
 * @returns { status:'ok'|'block'|'cannot-verify', blockingCount, findings, caveats }
 */
export function runChecks(captures, opts = {}) {
  const list = Array.isArray(captures) ? captures : [captures]
  const baselineKeys = new Set((opts.baseline ?? []).map(findingKey))
  const findings = []
  const caveats = new Set()
  let cannotVerify = false

  const push = (f) => {
    const severity = baselineKeys.has(findingKey(f)) ? 'observe' : (f.severity ?? 'block')
    findings.push({ ...f, severity })
  }

  for (const cap of list) {
    if (!cap || cap.status === 'cannot-verify') {
      cannotVerify = true
      push({ check: 'render-ok', severity: 'block', formFactor: cap?.formFactor?.label, detail: 'cannot-verify: 어댑터가 화면을 렌더/추출하지 못함' })
      continue
    }
    ;(cap.meta?.caveats ?? []).forEach((c) => caveats.add(c))
    const ff = cap.formFactor ?? { w: Infinity, h: Infinity }
    const label = ff.label

    // render-ok: 렌더/실행 에러 (기준선 대비 새 에러면 차단).
    for (const err of cap.errors ?? []) push({ check: 'render-ok', formFactor: label, detail: err })

    const els = cap.elements ?? []
    for (const el of els) {
      const hasText = !!(el.text && el.text.trim())
      // contrast — 텍스트 요소의 전경 vs 실효 배경.
      if (hasText && el.fg && el.bg) {
        const ratio = contrastRatio(el.fg, el.bg)
        const min = isLargeText(el.fontSize, el.bold) ? CONTRAST_MIN.large : CONTRAST_MIN.normal
        if (ratio + 1e-9 < min) {
          push({ check: 'contrast', formFactor: label, role: el.role, text: el.text, bounds: el.bounds,
            detail: `대비 ${ratio.toFixed(2)} < ${min} (fg ${el.fg} / bg ${el.bg})` })
        }
      }
      // truncation — 핵심 내용이 잘려 소실.
      if (el.essential && el.truncated) {
        push({ check: 'truncation', formFactor: label, role: el.role, text: el.text, bounds: el.bounds,
          detail: '핵심 텍스트가 잘림(essential && truncated)' })
      }
      // fits — 가로 넘침만 차단(세로 스크롤은 정상). caveat 로 표시.
      if (el.bounds && Number.isFinite(ff.w)) {
        if (el.bounds.x < -1 || el.bounds.x + el.bounds.w > ff.w + 1) {
          caveats.add('fits: 가로 넘침만 검사(세로 스크롤 제외)')
          push({ check: 'fits', formFactor: label, role: el.role, text: el.text, bounds: el.bounds,
            detail: `가로 넘침: x+w ${round(el.bounds.x + el.bounds.w)} > 폭 ${ff.w}` })
        }
      }
    }

    // overlap — 상호작용 요소끼리 실질적 겹침(작은 min 넓이의 10% 초과).
    const inter = els.filter((e) => e.interactive && e.bounds && area(e.bounds) > 0)
    for (let i = 0; i < inter.length; i++) {
      for (let j = i + 1; j < inter.length; j++) {
        const ov = overlapArea(inter[i].bounds, inter[j].bounds)
        const minA = Math.min(area(inter[i].bounds), area(inter[j].bounds))
        if (ov > 0.1 * minA) {
          caveats.add('overlap: 상호작용 요소 겹침(자식 포함관계는 오탐 가능)')
          push({ check: 'overlap', formFactor: label, role: inter[i].role, bounds: inter[i].bounds,
            detail: `상호작용 요소 겹침(${inter[i].role} ↔ ${inter[j].role})` })
        }
      }
    }
  }

  const blockingCount = findings.filter((f) => f.severity === 'block').length
  const status = cannotVerify ? 'cannot-verify' : blockingCount > 0 ? 'block' : 'ok'
  return { status, blockingCount, findings, caveats: [...caveats] }
}

// 상태 → 종료코드 (어댑터·판정기 CLI 공용). 0 통과 · 1 차단 · 2 검증불가.
export function exitCodeFor(status) {
  return status === 'cannot-verify' ? 2 : status === 'block' ? 1 : 0
}
