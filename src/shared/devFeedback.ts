/**
 * 개발용 화면 피드백 도구의 순수 로직 — 저장 폴더 이름, 보낸 내용 검증, 사람이 읽을 note.md 생성.
 *
 * 렌더러(오버레이)와 메인(저장 핸들러)이 **같은 타입을 공유**해야 하므로 shared 에 둔다.
 *
 * 왜 순수 함수로 갈랐나: 이 도구의 값은 전부 "에이전트가 읽고 무엇을 고칠지 특정할 수 있는가"에
 * 달려 있다. 폴더 이름이 겹쳐 조용히 덮이거나 note.md 형식이 깨지면 피드백이 통째로 무의미해지는데,
 * DOM·파일시스템에 묶여 있으면 그걸 테스트로 못 박을 수가 없다.
 *
 * 담는 그릇이 셋으로 겹쳐 있다: **흐름**(화면 여럿) ⊃ **묶음**(메모 하나) ⊃ **표시**(자국 하나).
 * 묶음과 화면은 서로 가로지른다 — 메모 하나가 화면 여럿을 걸칠 수 있다.
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

/** 표시의 갈래 — 몸짓이 가른다. 콕 누르면 자리 하나(핀), 끌면 그려서 두른 영역(shape). */
export type FeedbackMarkKind = 'pin' | 'shape'

/** 묶음 안의 표시 하나 — 자국(또는 자리) 한 벌과 그 자리에 실제로 있던 요소. */
export interface FeedbackMarkPart {
  /** 핀이면 `bounds` 는 넓이가 아니라 **자리**다(배지 지름만 한 정사각형). */
  kind: FeedbackMarkKind
  bounds: FeedbackRect
  target: FeedbackTarget | null
  /**
   * 어느 단계(화면)에서 그린 것인가. 1부터.
   *
   * 좌표는 **그 단계 화면 기준**이다. 이걸 안 달면 A화면에서 그린 좌표가 B화면의
   * 엉뚱한 자리를 가리킨다 — 화면 하나에 매여 있던 시절의 실패가 그것이었다.
   */
  step: number
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
  /** nav 경로 — `/db/design/schema` 꼴. 폴더 이름의 재료이자 화면 식별자. */
  route: string
  /** 사람이 읽는 경로 — 'DB › Design › Schema'. */
  label: string
  /** 상단 컨텍스트 바 선택값(Design·Env 등). 같은 화면도 무엇을 보고 있었는지로 갈린다. */
  context: { label: string; value: string }[]
}

/**
 * 흐름의 한 차례 = 화면 하나.
 *
 * 사용자가 "다음 화면"을 눌러 지금 화면을 굳힐 때마다 하나씩 는다. 같은 nav 경로를 다시
 * 찾아와도 새 단계다 — 같은 화면이라도 무엇을 하고 난 뒤인지가 다르기 때문이다.
 */
export interface FeedbackStep {
  /** 흐름에서 몇 번째인가. 1부터. 사용자가 순서를 바꾸면 이 값이 바뀐다. */
  index: number
  location: FeedbackLocation
  viewport: { width: number; height: number }
  /** 이 단계의 화면 그림 파일. 캡처가 실패했으면 null. */
  imageFile: string | null
}

/**
 * 메모 하나가 덮는 표시 묶음.
 *
 * 왜 표시 하나가 아니라 묶음인가: "이 카드를 저 목록으로 옮겨라"처럼 한 요청이 표시
 * 여럿(화살표 + 상자 + 핀)을 필요로 할 때가 있다. 표시마다 메모를 따로 받으면 같은
 * 말을 세 번 적거나, 둘은 메모 없이 남아 무슨 뜻인지 알 수 없게 된다.
 *
 * 가리킨 요소는 묶음이 아니라 **표시마다** 잡는다. 묶음 전체를 감싼 사각형으로 재면
 * 화살표와 상자 사이의 거대한 상위 감싸개가 잡혀, 핀을 도입하며 없앤 실패가 되살아난다.
 */
export interface FeedbackMark {
  memo: string
  /** 이 묶음에 든 표시들. 최소 하나. */
  parts: FeedbackMarkPart[]
  /** 딸린 제안 그림의 **파일 이름**. 그림 자체(base64)는 여기 담지 않는다 — 담으면
   *  note.json 이 사람이 열 수 없는 크기가 되고 같은 그림이 두 벌 저장된다. */
  sketchFile: string | null
}

export interface FeedbackPayload {
  /** 첫 단계의 화면. 폴더 이름이 이걸 따른다 — 흐름은 여기서 시작했다는 뜻이다. */
  location: FeedbackLocation
  /** 흐름. 최소 하나. 화면 하나짜리 피드백이면 길이 1이다. */
  steps: FeedbackStep[]
  marks: FeedbackMark[]
  logs: FeedbackLogEntry[]
}

/** 렌더러가 "이 화면을 굳혀 달라"고 보내는 것. 그림은 메인이 직접 창에서 뜬다. */
export interface FeedbackStepInput {
  /** 쌓는 중인 초안 폴더. 첫 화면이면 null — 그때 메인이 이름을 지어 돌려준다. */
  draft: string | null
  /** 뜬 순서. 그림 파일 이름(`screen-N.png`)이 이걸 따른다. */
  seq: number
  location: FeedbackLocation
}

export interface FeedbackStepResult {
  draft: string
  /** 창을 못 찍었으면 false. 좌표와 요소는 살아 있으므로 흐름은 그대로 이어진다. */
  hasImage: boolean
}

/**
 * 렌더러가 보내는 표시. 저장된 것(`FeedbackMark`)과 갈리는 칸은 그림 하나뿐이다 —
 * 보낼 때는 그림 자체(PNG 데이터 URL), 저장된 뒤에는 그 파일 이름.
 */
export interface FeedbackMarkInput {
  memo: string
  parts: FeedbackMarkPart[]
  sketch: string | null
}

export interface FeedbackPayloadInput {
  /** 마무리할 초안 폴더. */
  draft: string
  /** `seqs[i]` 가 i+1단계의 **뜬 순서**. 메인이 그림 파일 이름을 흐름 차례로 고쳐 짓는 데 쓴다. */
  seqs: number[]
  steps: { location: FeedbackLocation; viewport: { width: number; height: number }; hasImage: boolean }[]
  marks: FeedbackMarkInput[]
  logs: FeedbackLogEntry[]
}

export interface SaveFeedbackResult {
  folder: string
  saved: string
  /** 그림이 빠진 화면 수. 조용히 넘기면 없는 그림을 찾게 된다. */
  missingImages: number
}

/** 메인이 파일로 떨굴 그림 한 장. 이름은 검증이 정하고, 쓰기는 저장 핸들러가 한다. */
export interface ParsedSketch {
  file: string
  dataUrl: string
}

export type ParseResult =
  | { ok: true; value: FeedbackPayload; sketches: ParsedSketch[] }
  | { ok: false; error: string }

/** 제안 그림은 PNG 데이터 URL 로 온다. 다른 형식은 받지 않는다. */
export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,'
/** 그림 한 장의 상한. 흰 바탕에 선 몇 개라 훨씬 작지만, 무한정 받아 메인 프로세스
 *  메모리를 밀어내지는 않게 막는다. */
export const MAX_SKETCH_CHARS = 8 * 1024 * 1024

/** PNG 데이터 URL 인가. 형식과 크기 둘 다 본다. */
export function isPngDataUrl(v: unknown, maxChars: number): v is string {
  return typeof v === 'string' && v.startsWith(PNG_DATA_URL_PREFIX) && v.length <= maxChars
}

/** N 번째 묶음에 딸린 제안 그림의 파일 이름. 번호는 배지 번호와 같은 순서다(① → 1). */
export function sketchFileName(index: number): string {
  return `sketch-${index + 1}.png`
}

/**
 * 초안이 쌓이는 동안 쓰는 화면 그림 이름 — **뜬 순서**를 따른다.
 *
 * 최종 이름(`shot-N.png`)과 왜 다른가: 사용자가 흐름 순서를 바꿀 수 있어서, 뜬 순서와
 * 흐름 차례가 어긋난다. 초안 중에 이름을 계속 고쳐 맞추면 이미 쓴 파일을 옮기다
 * 어긋날 여지가 생긴다. 뜬 순서로 쌓아 두고 **보낼 때 한 번** 흐름 순서로 고친다.
 */
export function draftShotFileName(captureSeq: number): string {
  return `screen-${captureSeq}.png`
}

/** 최종 화면 그림 이름 — 흐름 차례를 따른다(1단계가 `shot-1.png`). */
export function shotFileName(step: number): string {
  return `shot-${step}.png`
}

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
 * (x, y) 가 이 표시의 배지 원 안인가. 안이면 가운데까지의 거리, 아니면 null.
 * 배지를 눌러 메모를 여는 판정과 지우개 판정이 **같은 자**를 써야 어긋나지 않는다.
 */
export function badgeContains(bounds: FeedbackRect, x: number, y: number): number | null {
  const c = badgeCenter(bounds)
  const d = Math.hypot(x - c.x, y - c.y)
  return d <= BADGE_RADIUS + BADGE_TOUCH_SLACK ? d : null
}

/**
 * (x, y) 아래에 있는 배지 — 어느 묶음의 몇 번째 표시인가. 없으면 null.
 * 겹치면 나중에 그린 것이 이긴다(화면에서 위에 보이는 것).
 *
 * 묶음의 표시는 **전부 같은 번호 배지를 단다.** 그래서 어느 하나를 눌러도 같은 메모가
 * 열린다 — 눈에 ① 이 세 군데 있으면 그 셋이 한 이야기라는 뜻이다.
 */
export function badgeHit<
  T extends { id: number; parts: readonly { bounds: FeedbackRect; screen?: number }[] }
>(
  marks: readonly T[],
  x: number,
  y: number,
  onScreen?: number
): { id: number; part: number } | null {
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    const parts = marks[i].parts
    for (let p = parts.length - 1; p >= 0; p -= 1) {
      // 지금 화면의 표시만 본다. 지난 화면 것은 눈에 안 보이는데 눌리면 유령을 만지는
      // 셈이고, 좌표도 이 화면 기준이 아니라 엉뚱한 자리를 집는다.
      if (onScreen !== undefined && parts[p].screen !== onScreen) continue
      if (badgeContains(parts[p].bounds, x, y) !== null) return { id: marks[i].id, part: p }
    }
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

/**
 * 오버레이가 열려 있는 동안 키 하나를 어떻게 다룰지.
 * - `toggle` 도구 열기/닫기 · `send` 보내기 · `close` 한 겹 닫기
 * - `shield` 앱에 못 닿게 삼킨다(화면 얼리기) · `pass` 그대로 흘려보낸다
 */
export type FeedbackKeyAction = 'toggle' | 'send' | 'close' | 'shield' | 'pass'

/** 판정에 필요한 것만 추린 키 이벤트. DOM 없이 테스트하려고 좁혔다. */
export interface FeedbackKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

/**
 * 키를 오버레이가 먹을지, 앱까지 흘려보낼지.
 *
 * 이 판정이 틀리면 **지적하려던 화면이 지적하는 도중에 사라진다.** Radix 계열 겹층
 * (모달·팝오버)은 Escape 를 document 캡처 단계에서 듣고 스스로 닫는다 — 오버레이가
 * 열려 있는 동안 앱이 키를 아예 못 보게 해야 하는 이유가 그것이다(2026-07-30 사용자 제보).
 * 유일한 예외가 메모창이라, 오버레이 안에서 난 키만 통과시킨다.
 */
export function feedbackKeyAction(
  e: FeedbackKeyEvent,
  ctx: { open: boolean; fromOverlay: boolean }
): FeedbackKeyAction {
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.shiftKey && e.key.toLowerCase() === 'f') return 'toggle'
  if (!ctx.open) return 'pass'
  if (mod && e.key === 'Enter') return 'send'
  if (e.key === 'Escape') return 'close'
  return ctx.fromOverlay ? 'pass' : 'shield'
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

/**
 * 아직 쌓는 중인 피드백이 사는 폴더 이름.
 *
 * 왜 파일로 쌓나: 화면 여럿을 도는 동안 화면이 다시 그려지면(개발 중엔 코드를 저장할
 * 때마다 그렇다) 메모리에 든 초안은 통째로 날아간다. 이 도구가 필요한 순간이 하필
 * 그런 순간이라, 화면을 굳힐 때마다 메인에 바로 쓴다.
 *
 * 밑줄로 시작하는 이유: "피드백 봐줘"에서 최신 폴더를 읽는 습관이 **아직 안 끝난
 * 초안에 낚이지 않게** 눈에 띄게 갈라 둔다.
 */
export const DRAFT_PREFIX = '_draft-'

export function draftFolderName(at: Date, route: string): string {
  return `${DRAFT_PREFIX}${feedbackFolderName(at, route)}`
}

/**
 * 렌더러가 보내온 초안 폴더 이름이 우리가 지은 그것인가.
 *
 * 이 값은 파일 경로가 되므로 **모양을 통째로 확인한다** — `..` 나 `/` 가 섞이면 저장
 * 위치가 `.harness/feedback` 밖으로 새어 나간다. 화이트리스트가 유일하게 안전한 길이다.
 */
export function isDraftFolderName(v: unknown): v is string {
  return typeof v === 'string' && /^_draft-\d{8}-\d{6}-[a-z0-9-]{1,40}$/.test(v)
}

/** 초안이 끝나면 붙일 최종 이름. 시각은 **시작한 때**로 남는다(흐름이 거기서 출발했다). */
export function finalFolderName(draft: string): string {
  return draft.slice(DRAFT_PREFIX.length)
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

export function parseLocation(v: unknown): FeedbackLocation | null {
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

function parsePart(v: unknown, stepCount: number): FeedbackMarkPart | null {
  if (!isRecord(v)) return null
  const bounds = parseRect(v.bounds)
  if (!bounds) return null
  // 단계를 안 보내거나 없는 단계를 가리키면 1단계로 떨어뜨린다. 화면 하나뿐이던 시절의
  // 본문이 그렇고, 그때는 모든 표시가 그 한 화면의 것이었다.
  const rawStep = num(v.step)
  const step = rawStep !== null && rawStep >= 1 && rawStep <= stepCount ? Math.round(rawStep) : 1
  // 갈래를 안 보내는 옛 본문도 받는다 — 그리기만 있던 시절의 표시는 전부 'shape' 다.
  return { kind: v.kind === 'pin' ? 'pin' : 'shape', bounds, target: parseTarget(v.target), step }
}

/**
 * 흐름 한 차례. `imageFile` 은 **렌더러가 정하지 않는다** — 파일 이름은 메인이 짓고
 * 여기서는 "그림이 있었는가"만 받는다. 이름을 받아 쓰면 그게 곧 경로 조작 구멍이 된다.
 */
function parseStep(v: unknown, index: number): FeedbackStep | null {
  if (!isRecord(v)) return null
  const location = parseLocation(v.location)
  if (!location) return null
  const viewport = isRecord(v.viewport)
    ? { width: num(v.viewport.width), height: num(v.viewport.height) }
    : null
  if (!viewport || viewport.width === null || viewport.height === null) return null
  return {
    index,
    location,
    viewport: { width: viewport.width, height: viewport.height },
    imageFile: v.hasImage === true ? shotFileName(index) : null
  }
}

/** 묶음(메모 하나) 개수 상한. 한 번에 스무 개를 넘길 일이 없고, 배지 기호도 스무 개다. */
const MAX_MARKS = 20
/**
 * 묶음 하나에 들 수 있는 표시 수. 묶음 개수(20)보다 훨씬 넉넉하게 잡는다 — 펜은 손을 뗄
 * 때마다 자국이 하나씩 늘어서, 한 요청을 설명하다 보면 스무 개는 금방 넘긴다. 여기서
 * 인색하게 굴면 다 그리고 **보내는 순간에야** 거절당한다.
 */
const MAX_PARTS = 60
/** 흐름 길이 상한. 화면 열둘을 거치는 설명이면 말로 적는 편이 낫다. */
export const MAX_STEPS = 12
/** 콘솔 로그 상한. 이보다 많으면 note.md 가 로그 덤프가 되어 정작 메모가 묻힌다. */
export const MAX_LOGS = 30

export function parseFeedbackPayload(raw: unknown): ParseResult {
  if (!isRecord(raw)) return { ok: false, error: '보낸 내용이 객체가 아닙니다' }

  // 흐름을 모르던 옛 본문은 화면 하나짜리 흐름으로 읽는다 — 그때는 화면 위치·창 크기가
  // 본문 맨 위에 붙어 있었고, 그게 곧 유일한 단계였다.
  const rawSteps =
    Array.isArray(raw.steps) && raw.steps.length > 0 ? raw.steps : [{ ...raw, hasImage: true }]
  if (rawSteps.length > MAX_STEPS) {
    return { ok: false, error: `화면은 최대 ${MAX_STEPS}개까지입니다` }
  }
  const steps: FeedbackStep[] = []
  for (const [i, rawStep] of rawSteps.entries()) {
    const step = parseStep(rawStep, i + 1)
    if (!step) return { ok: false, error: `${i + 1}번째 화면 정보가 잘못됐습니다` }
    steps.push(step)
  }

  if (!Array.isArray(raw.marks) || raw.marks.length === 0) {
    return { ok: false, error: '표시가 하나도 없습니다' }
  }
  if (raw.marks.length > MAX_MARKS) {
    return { ok: false, error: `표시는 최대 ${MAX_MARKS}개까지입니다` }
  }

  const marks: FeedbackMark[] = []
  const sketches: ParsedSketch[] = []
  for (const [i, m] of raw.marks.entries()) {
    if (!isRecord(m)) return { ok: false, error: '표시 형식이 잘못됐습니다' }
    // 묶음을 모르던 옛 본문은 표시 하나짜리 묶음으로 읽는다 — 갈래·영역·요소가
    // 그때도 표시 자신에 붙어 있었으므로 본문 그대로가 곧 표시 하나다.
    const rawParts = Array.isArray(m.parts) && m.parts.length > 0 ? m.parts : [m]
    if (rawParts.length > MAX_PARTS) {
      return { ok: false, error: `${markLabel(i)} 묶음의 표시는 최대 ${MAX_PARTS}개까지입니다` }
    }
    const parts: FeedbackMarkPart[] = []
    for (const rawPart of rawParts) {
      const part = parsePart(rawPart, steps.length)
      if (!part) return { ok: false, error: '표시 영역이 잘못됐습니다' }
      parts.push(part)
    }
    // 그림은 있을 때만 검증한다. 형식이 틀리면 조용히 버리지 않고 거절한다 —
    // 그렸는데 파일이 없으면 "왜 안 왔지"의 원인을 알 길이 없다.
    let sketchFile: string | null = null
    if (m.sketch != null && m.sketch !== '') {
      if (!isPngDataUrl(m.sketch, MAX_SKETCH_CHARS)) {
        return { ok: false, error: `${markLabel(i)} 표시의 그림 형식이 잘못됐습니다` }
      }
      sketchFile = sketchFileName(i)
      sketches.push({ file: sketchFile, dataUrl: m.sketch })
    }
    marks.push({ memo: str(m.memo, 1000), parts, sketchFile })
  }

  return {
    ok: true,
    value: { location: steps[0].location, steps, marks, logs: parseLogs(raw.logs) },
    sketches
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

/** 표시 하나의 자리. 핀은 넓이가 아니라 자리다 — 안 밝히면 배지 지름이 "이만한 영역이
 *  문제"로 읽힌다. */
function geometryLine(part: FeedbackMarkPart): string {
  const b = part.bounds
  if (part.kind === 'pin') {
    return `콕 집은 자리: x=${round(b.x + b.width / 2)} y=${round(b.y + b.height / 2)} (영역이 아니라 한 점)`
  }
  return `표시한 영역: x=${round(b.x)} y=${round(b.y)} (${round(b.width)} × ${round(b.height)})`
}

/** 표시가 가리킨 요소 — 좌표가 아니라 이것이 코드로 가는 주소다. */
function targetLines(t: FeedbackTarget | null): string[] {
  if (!t) return ['가리킨 요소: 찾지 못함 (빈 자리를 표시했을 수 있음)']
  const out = [`가리킨 요소: \`<${t.tag}>\`${t.className ? ` \`${t.className}\`` : ''}`]
  if (t.components.length > 0) out.push(`컴포넌트: ${t.components.join(' ‹ ')}`)
  if (t.testId) out.push(`테스트 아이디: \`${t.testId}\``)
  if (t.text) out.push(`보이던 글자: "${t.text}"`)
  if (t.cssPath) out.push(`CSS 경로: \`${t.cssPath}\``)
  return out
}

/** 표시 앞에 붙는 단계 꼬리표. 흐름이 한 화면뿐이면 군더더기라 안 붙인다. */
function stepTag(part: FeedbackMarkPart, steps: FeedbackStep[]): string {
  if (steps.length < 2) return ''
  const step = steps.find((s) => s.index === part.step) ?? steps[0]
  return `[${step.index}단계 ${step.location.label}] `
}

/** 컨텍스트 바 선택값을 한 줄로. 흐름 절에서는 화면 줄 뒤에 붙는다. */
function contextInline(location: FeedbackLocation): string {
  return location.context.map((c) => `${c.label}: ${c.value || '(선택 안 함)'}`).join(' · ')
}

/**
 * 에이전트가 읽을 요약. 이 한 파일만 읽으면 "어디의 무엇이 왜 불만인지"와
 * "그게 어느 컴포넌트인지"가 다 나오게 쓴다.
 */
export function renderNoteMarkdown(
  payload: FeedbackPayload,
  opts: { at: Date; sourceRoot?: string }
): string {
  const { steps, marks } = payload
  const multi = steps.length > 1
  const lines: string[] = []
  lines.push(
    `# 화면 피드백 · ${payload.location.label}${multi ? ` 외 화면 ${steps.length - 1}개` : ''}`
  )
  lines.push('')
  lines.push(`- 남긴 시각: ${formatStamp(opts.at)}`)
  if (opts.sourceRoot) lines.push(`- 소스 폴더: \`${opts.sourceRoot}\``)
  lines.push('')

  // ── 흐름 ────────────────────────────────────────────────────────────────
  // 화면이 둘 이상이면 이게 제일 먼저 읽혀야 한다. "1단계에서 이걸 했더니 2단계에서
  // 저게 안 나온다"가 이 피드백의 뼈대이고, 순서가 곧 그 이야기이기 때문이다.
  if (multi) {
    lines.push(`## 흐름 (화면 ${steps.length}개)`)
    lines.push('')
    lines.push('화면을 옮겨 가며 남긴 하나의 이야기다. 순서대로 읽는다.')
    lines.push('')
    for (const step of steps) {
      const on = marks
        .map((m, i) => (m.parts.some((p) => p.step === step.index) ? markLabel(i) : null))
        .filter((label): label is string => label !== null)
      const image = step.imageFile ?? '그림 없음 (캡처 실패)'
      const size = `${round(step.viewport.width)} × ${round(step.viewport.height)}`
      const ctx = contextInline(step.location)
      lines.push(
        `${step.index}. ${step.location.label} \`${step.location.route}\` · ${image} · 창 ${size}` +
          (ctx ? ` · ${ctx}` : '') +
          (on.length > 0 ? ` · 표시 ${on.join(' ')}` : ' · (표시 없음)')
      )
    }
    lines.push('')
  } else {
    const only = steps[0]
    lines.push(`- 화면 경로: \`${only.location.route}\``)
    lines.push(`- 창 크기: ${round(only.viewport.width)} × ${round(only.viewport.height)}`)
    for (const c of only.location.context) {
      lines.push(`- ${c.label}: ${c.value || '(선택 안 함)'}`)
    }
    if (only.imageFile) {
      lines.push(`- 화면 이미지: ${only.imageFile} (표시가 그려진 그대로)`)
    } else {
      lines.push('- 화면 이미지: 없음 (캡처 실패, 아래 좌표와 요소 정보로 판단할 것)')
    }
    lines.push('')
  }

  marks.forEach((mark, i) => {
    const memo = mark.memo.trim() || '(메모 없음)'
    const label = markLabel(i)
    lines.push(`## ${label} ${memo}`)
    lines.push('')
    // 표시가 여럿이면 그 사실을 먼저 밝힌다. 안 밝히면 "화살표 하나에 대한 메모"로 읽히고,
    // 정작 같이 가리킨 나머지가 딴 이야기로 떨어져 나간다.
    const grouped = mark.parts.length > 1
    const spans = new Set(mark.parts.map((p) => p.step)).size
    if (grouped) {
      lines.push(
        `- 아래 표시 ${mark.parts.length}개가 **한 요청**이다 (화면과 그림에도 ${label} 배지가 ${mark.parts.length}개 다 붙어 있다)` +
          // 화면을 걸친 요청은 "A에서 이러면 B가 이렇다"는 뜻이다. 안 밝히면 표시들이
          // 같은 화면에 있는 줄 알고 좌표를 한 그림에서 찾게 된다.
          (spans > 1 ? ` · **화면 ${spans}개에 걸쳐 있다** (각 표시의 단계를 보라)` : '')
      )
    }
    if (mark.sketchFile) {
      lines.push(`- 제안 그림: ${mark.sketchFile} ("이렇게 생겼으면 좋겠다"고 직접 그린 것)`)
    }
    mark.parts.forEach((part, pi) => {
      const tag = stepTag(part, steps)
      if (!grouped) {
        lines.push(`- ${tag}${geometryLine(part)}`)
        for (const line of targetLines(part.target)) lines.push(`- ${line}`)
        return
      }
      lines.push(`- ${pi + 1}) ${tag}${geometryLine(part)}`)
      for (const line of targetLines(part.target)) lines.push(`  - ${line}`)
    })
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
