/**
 * 개발용 화면 피드백 도구의 순수 로직 — 저장 폴더 이름, 보낸 내용 검증, 사람이 읽을 note.md 생성.
 *
 * 렌더러(오버레이)와 메인(저장 핸들러)이 **같은 타입을 공유**해야 하므로 shared 에 둔다.
 *
 * 왜 순수 함수로 갈랐나: 이 도구의 값은 전부 "에이전트가 읽고 무엇을 고칠지 특정할 수 있는가"에
 * 달려 있다. 폴더 이름이 겹쳐 조용히 덮이거나 note.md 형식이 깨지면 피드백이 통째로 무의미해지는데,
 * DOM·파일시스템에 묶여 있으면 그걸 테스트로 못 박을 수가 없다.
 */

export interface FeedbackRect {
  x: number
  y: number
  width: number
  height: number
}

/** 표시한 자리에 실제로 있던 DOM 요소의 신원. 좌표가 아니라 이것이 코드로 가는 주소다. */
export interface FeedbackTarget {
  tag: string
  className: string
  testId: string | null
  text: string
  cssPath: string
  /** React 컴포넌트 이름 사슬 (안쪽에서 바깥쪽 순). 소스 파일을 찾는 최단 경로. */
  components: string[]
  rect: FeedbackRect
}

/** 화면 위에 그린 표시 하나 + 거기 붙인 메모. */
export interface FeedbackMark {
  memo: string
  bounds: FeedbackRect
  target: FeedbackTarget | null
}

/** 피드백 직전까지 렌더러 콘솔에 쌓인 오류·경고 한 줄. */
export interface FeedbackLogEntry {
  level: 'error' | 'warn'
  /** 사람이 읽는 시:분:초. 피드백을 남긴 시각과 대조하면 방금 난 것인지 알 수 있다. */
  at: string
  text: string
}

/** 어느 화면에서 남긴 피드백인지. Rockury 는 URL 이 없으므로 nav 경로가 그 자리를 대신한다. */
export interface FeedbackLocation {
  /** nav 경로 — `/db/studio/schema` 꼴. 폴더 이름의 재료이자 화면 식별자. */
  route: string
  /** 사람이 읽는 경로 — 'DB › Studio › Schema'. */
  label: string
  /** 상단 컨텍스트 바 선택값(Design·Env 등). 같은 화면도 무엇을 보고 있었는지로 갈린다. */
  context: { label: string; value: string }[]
}

export interface FeedbackPayload {
  location: FeedbackLocation
  viewport: { width: number; height: number }
  marks: FeedbackMark[]
  logs: FeedbackLogEntry[]
}

export type ParseResult = { ok: true; value: FeedbackPayload } | { ok: false; error: string }

/** 표시 하나에 붙는 동그라미 번호. 화면 배지와 note.md 가 같은 기호를 쓴다. */
const MARK_LABELS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

export function markLabel(index: number): string {
  return MARK_LABELS[index] ?? `(${index + 1})`
}

/** 번호 배지의 반지름. 화면 SVG 와 눌림 판정이 같은 값을 봐야 어긋나지 않는다. */
export const BADGE_RADIUS = 11
// 손가락·트랙패드는 정확히 11px 원을 못 맞춘다. 판정만 조금 넓힌다(그림은 그대로).
const BADGE_TOUCH_SLACK = 5

/** 배지가 그려지는 자리 — 표시 영역의 좌상단 모서리에 얹는다. */
export function badgeCenter(bounds: FeedbackRect): { x: number; y: number } {
  return { x: bounds.x + BADGE_RADIUS, y: bounds.y + BADGE_RADIUS }
}

/**
 * (x, y) 아래에 있는 배지의 id. 겹치면 나중에 그린 것이 이긴다(화면에서 위에 보이는 것).
 * 없으면 null.
 */
export function badgeHit<T extends { id: number; bounds: FeedbackRect }>(
  marks: readonly T[],
  x: number,
  y: number
): number | null {
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    const c = badgeCenter(marks[i].bounds)
    if (Math.hypot(x - c.x, y - c.y) <= BADGE_RADIUS + BADGE_TOUCH_SLACK) return marks[i].id
  }
  return null
}

/**
 * 표시 영역 아래의 요소를 찾을 때 찔러 볼 점들. 가운데를 먼저 보고, 거기가 빈 자리면
 * 안쪽 네 점을 더 훑는다. 무언가를 "둘러싸게" 그리는 게 자연스러운 동작이라 가운데가
 * 정답인 경우가 대부분이지만, 도넛 모양 여백에 걸리는 경우를 위한 보정이다.
 */
export function probePoints(bounds: FeedbackRect): Array<[number, number]> {
  const { x, y, width, height } = bounds
  return [
    [x + width / 2, y + height / 2],
    [x + width * 0.3, y + height * 0.3],
    [x + width * 0.7, y + height * 0.3],
    [x + width * 0.3, y + height * 0.7],
    [x + width * 0.7, y + height * 0.7]
  ]
}

// React 트리에는 배선용 껍데기 컴포넌트가 잔뜩 섞여 있다. 그대로 넘기면 사슬이 노이즈로
// 가득 차 정작 화면을 만든 컴포넌트가 묻힌다. Provider/Boundary 류는 "이 화면 조각이
// 어느 파일에서 왔나"에 아무 답을 못 주므로 통째로 버린다.
const NOISE_SUFFIX = /(Context|Provider|Boundary|Root|Node|Handler)$/
const NOISE_EXACT = /^(Fragment|Suspense|Activity|StrictMode|Profiler|ErrorOverlay|HotReload)$/

/** 컴포넌트 사슬에서 걸러낼 이름인가. 대문자로 시작하지 않으면 컴포넌트가 아니다. */
export function isNoiseComponentName(name: string): boolean {
  return NOISE_SUFFIX.test(name) || NOISE_EXACT.test(name) || !/^[A-Z]/.test(name)
}

/** 뒤에서부터 max 개만 남기고 앞을 버리는 기록 버퍼. 콘솔 로그가 무한정 쌓이지 않게 한다. */
export function appendCapped<T>(list: readonly T[], entry: T, max: number): T[] {
  const next = [...list, entry]
  return next.length > max ? next.slice(next.length - max) : next
}

/**
 * nav 경로를 폴더 이름 조각으로 바꾼다. 경로 구분자와 특수문자를 전부 없애야
 * `..` 나 `/` 가 섞인 값으로 저장 위치가 폴더 밖으로 빠져나가지 않는다.
 */
export function slugifyRoute(route: string): string {
  const slug = route
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || 'root'
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** 사람이 읽는 시각. 로컬 시간 기준(피드백을 남긴 사람의 시계와 맞춘다). */
export function formatStamp(at: Date): string {
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  )
}

/** 시:분:초만. 콘솔 로그 줄에 붙는다. */
export function formatClock(at: Date): string {
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/**
 * 저장 폴더 이름. 초까지 넣는 이유는 같은 화면에서 연달아 남긴 피드백이
 * 말없이 서로를 덮어쓰지 않게 하려는 것.
 */
export function feedbackFolderName(at: Date, route: string): string {
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `${date}-${time}-${slugifyRoute(route)}`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function parseRect(v: unknown): FeedbackRect | null {
  if (!isRecord(v)) return null
  const x = num(v.x)
  const y = num(v.y)
  const width = num(v.width)
  const height = num(v.height)
  if (x === null || y === null || width === null || height === null) return null
  return { x, y, width, height }
}

function parseTarget(v: unknown): FeedbackTarget | null {
  if (!isRecord(v)) return null
  const rect = parseRect(v.rect)
  if (!rect) return null
  const components = Array.isArray(v.components)
    ? v.components.filter((c): c is string => typeof c === 'string').slice(0, 8)
    : []
  return {
    tag: str(v.tag, 40) || 'unknown',
    className: str(v.className, 400),
    testId: typeof v.testId === 'string' ? v.testId.slice(0, 120) : null,
    text: str(v.text, 200),
    cssPath: str(v.cssPath, 600),
    components,
    rect
  }
}

function parseLocation(v: unknown): FeedbackLocation | null {
  if (!isRecord(v)) return null
  const route = str(v.route, 300)
  if (!route.startsWith('/')) return null
  const context = Array.isArray(v.context)
    ? v.context
        .filter(isRecord)
        .slice(0, 12)
        .map((c) => ({ label: str(c.label, 60), value: str(c.value, 160) }))
        .filter((c) => c.label !== '')
    : []
  return { route, label: str(v.label, 200) || route, context }
}

function parseLogs(v: unknown): FeedbackLogEntry[] {
  if (!Array.isArray(v)) return []
  return v
    .filter(isRecord)
    .slice(-MAX_LOGS)
    .map((e) => ({
      level: e.level === 'warn' ? ('warn' as const) : ('error' as const),
      at: str(e.at, 20),
      text: str(e.text, 1200)
    }))
    .filter((e) => e.text !== '')
}

/** 표시 개수 상한. 한 번에 스무 개를 넘길 일이 없고, 배지 기호도 스무 개다. */
const MAX_MARKS = 20
/** 콘솔 로그 상한. 이보다 많으면 note.md 가 로그 덤프가 되어 정작 메모가 묻힌다. */
export const MAX_LOGS = 30

export function parseFeedbackPayload(raw: unknown): ParseResult {
  if (!isRecord(raw)) return { ok: false, error: '보낸 내용이 객체가 아닙니다' }

  const location = parseLocation(raw.location)
  if (!location) return { ok: false, error: '화면 위치(location)가 없습니다' }

  const viewport = isRecord(raw.viewport)
    ? { width: num(raw.viewport.width), height: num(raw.viewport.height) }
    : null
  if (!viewport || viewport.width === null || viewport.height === null) {
    return { ok: false, error: '화면 크기(viewport)가 없습니다' }
  }

  if (!Array.isArray(raw.marks) || raw.marks.length === 0) {
    return { ok: false, error: '표시가 하나도 없습니다' }
  }
  if (raw.marks.length > MAX_MARKS) {
    return { ok: false, error: `표시는 최대 ${MAX_MARKS}개까지입니다` }
  }

  const marks: FeedbackMark[] = []
  for (const m of raw.marks) {
    if (!isRecord(m)) return { ok: false, error: '표시 형식이 잘못됐습니다' }
    const bounds = parseRect(m.bounds)
    if (!bounds) return { ok: false, error: '표시 영역이 잘못됐습니다' }
    marks.push({ memo: str(m.memo, 1000), bounds, target: parseTarget(m.target) })
  }

  return {
    ok: true,
    value: {
      location,
      viewport: { width: viewport.width, height: viewport.height },
      marks,
      logs: parseLogs(raw.logs)
    }
  }
}

/**
 * 저장 실패를 사람이 읽고 **다음에 뭘 할지 아는** 한 줄로 바꾼다.
 *
 * 통로가 없는 경우를 따로 가르는 이유: 개발 서버가 이 도구를 넣기 전부터 떠 있었으면
 * 화면(렌더러)만 갈아끼워지고 메인은 옛 것이라 채널이 없다. 그때 "저장하지 못했습니다"만
 * 띄우면 사람은 자기가 잘못 그린 줄 알고 다시 그린다 — 정답은 앱을 다시 띄우는 것이다.
 */
export const FEEDBACK_CHANNEL_MISSING =
  '저장 통로가 아직 안 붙었습니다. 개발 서버(npm run dev)를 다시 띄워 주세요.'

export function feedbackFailureMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/No handler registered|is not a function|undefined/i.test(raw)) return FEEDBACK_CHANNEL_MISSING
  return `저장하지 못했습니다: ${raw} — 표시는 그대로 두었으니 다시 보내 보세요.`
}

function round(n: number): number {
  return Math.round(n)
}

/**
 * 에이전트가 읽을 요약. 이 한 파일만 읽으면 "어디의 무엇이 왜 불만인지"와
 * "그게 어느 컴포넌트인지"가 다 나오게 쓴다.
 */
export function renderNoteMarkdown(
  payload: FeedbackPayload,
  opts: { at: Date; imageFile: string | null; sourceRoot?: string }
): string {
  const lines: string[] = []
  lines.push(`# 화면 피드백 · ${payload.location.label}`)
  lines.push('')
  lines.push(`- 남긴 시각: ${formatStamp(opts.at)}`)
  lines.push(`- 화면 경로: \`${payload.location.route}\``)
  lines.push(`- 창 크기: ${round(payload.viewport.width)} × ${round(payload.viewport.height)}`)
  if (opts.sourceRoot) lines.push(`- 소스 폴더: \`${opts.sourceRoot}\``)
  for (const c of payload.location.context) {
    lines.push(`- ${c.label}: ${c.value || '(선택 안 함)'}`)
  }
  if (opts.imageFile) {
    lines.push(`- 화면 이미지: ${opts.imageFile} (표시가 그려진 그대로)`)
  } else {
    lines.push('- 화면 이미지: 없음 (캡처 실패, 아래 좌표와 요소 정보로 판단할 것)')
  }
  lines.push('')

  payload.marks.forEach((mark, i) => {
    const memo = mark.memo.trim() || '(메모 없음)'
    lines.push(`## ${markLabel(i)} ${memo}`)
    lines.push('')
    const b = mark.bounds
    lines.push(`- 표시한 영역: x=${round(b.x)} y=${round(b.y)} (${round(b.width)} × ${round(b.height)})`)
    const t = mark.target
    if (!t) {
      lines.push('- 가리킨 요소: 찾지 못함 (빈 자리를 표시했을 수 있음)')
      lines.push('')
      return
    }
    lines.push(`- 가리킨 요소: \`<${t.tag}>\`${t.className ? ` \`${t.className}\`` : ''}`)
    if (t.components.length > 0) lines.push(`- 컴포넌트: ${t.components.join(' ‹ ')}`)
    if (t.testId) lines.push(`- 테스트 아이디: \`${t.testId}\``)
    if (t.text) lines.push(`- 보이던 글자: "${t.text}"`)
    if (t.cssPath) lines.push(`- CSS 경로: \`${t.cssPath}\``)
    lines.push('')
  })

  if (payload.logs.length > 0) {
    lines.push('## 콘솔 (피드백 직전까지)')
    lines.push('')
    for (const log of payload.logs) {
      lines.push(`- \`${log.at}\` **${log.level}** ${log.text.replace(/\n/g, ' ⏎ ')}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
