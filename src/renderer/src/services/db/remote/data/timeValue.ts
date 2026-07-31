/**
 * 시간값 생성 도우미의 순수 유틸(§ops 향상 — Data #2).
 * 셀에 넣을 값을 `YYYY-MM-DD HH:mm:ss[.SSS]` 로 정규화하고, NOW 값을 만든다.
 * 파싱/포맷 순수 함수 → 테스트 의무 대상(NOW 의 시계 자체는 테스트하지 않음).
 */

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** Date 의 로컬 구성요소 → `YYYY-MM-DD HH:mm:ss[.SSS]`. */
export function toDateTimeString(d: Date, withMs = false): string {
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return withMs ? `${base}.${pad(d.getMilliseconds(), 3)}` : base
}

/**
 * 사용자 입력/ISO 값을 `YYYY-MM-DD HH:mm:ss[.SSS]` 로 정규화한다.
 * - 날짜만(`YYYY-MM-DD`) 이면 ` 00:00:00` 을 붙인다.
 * - `T` 구분자·말미 `Z`·타임존 오프셋은 벗겨 로컬 리터럴로 둔다(표시용 정규화이지 변환이 아님).
 * - 형식을 못 알아보면 null(잘못된 입력) — UI 가 거부 표시.
 */
export function normalizeDateTime(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:?\d{2})?$/
  )
  if (!m) return null
  const [, y, mo, d, h = '00', mi = '00', se = '00', ms] = m
  const base = `${y}-${mo}-${d} ${h}:${mi}:${se}`
  return ms != null ? `${base}.${ms.padEnd(3, '0')}` : base
}

/** 현재 시각을 도우미 포맷으로(ms 포함). NOW 버튼용. */
export function nowDateTime(): string {
  return toDateTimeString(new Date(), true)
}
