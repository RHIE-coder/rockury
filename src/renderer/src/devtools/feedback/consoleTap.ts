import { MAX_LOGS, appendCapped, formatClock, type FeedbackLogEntry } from '@shared/devFeedback'

/**
 * 렌더러 콘솔 오류·경고를 최근 것만 들고 있는 기록기 (개발 전용).
 *
 * 왜 필요한가: "이 화면이 안 떠요" 류 피드백의 원인은 대개 콘솔에 이미 찍혀 있는데,
 * 사람은 개발자 도구를 열어 그걸 복사해 오지 않는다. 피드백을 보낼 때 같이 실어 보내면
 * 화면 그림과 오류가 한 폴더에서 맞물린다.
 *
 * 원래 콘솔 동작은 그대로 둔다 — 개발자 도구에서 보던 것이 사라지면 안 된다.
 */

let buffer: FeedbackLogEntry[] = []
let installed = false

function record(level: FeedbackLogEntry['level'], text: string): void {
  if (text.trim() === '') return
  buffer = appendCapped(buffer, { level, at: formatClock(new Date()), text }, MAX_LOGS)
}

/** console 인자를 한 줄 문자열로. Error 는 스택 첫 줄까지만 — 전문은 개발자 도구에 있다. */
function stringify(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        // 순환 참조 등 — 못 찍는 값 하나 때문에 기록 전체를 잃지 않는다.
        return String(a)
      }
    })
    .join(' ')
    .slice(0, 1200)
}

/**
 * 기록을 시작한다. 여러 번 불러도 한 번만 건다.
 * 되돌리는 함수는 두지 않는다 — 개발 세션 내내 켜져 있는 것이 이 도구의 전제다.
 */
export function startConsoleTap(): void {
  if (installed) return
  installed = true

  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]): void => {
      record(level, stringify(args))
      original(...args)
    }
  }

  // console 을 거치지 않고 터지는 것들 — 렌더링 중 throw, 안 잡힌 Promise 거절.
  window.addEventListener('error', (e) => {
    record('error', e.error instanceof Error ? `${e.error.name}: ${e.error.message}` : e.message)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    record('error', r instanceof Error ? `${r.name}: ${r.message}` : `Unhandled rejection: ${String(r)}`)
  })
}

/** 지금까지 쌓인 기록. 피드백을 보낼 때 그대로 실어 보낸다. */
export function recentLogs(): FeedbackLogEntry[] {
  return buffer
}
