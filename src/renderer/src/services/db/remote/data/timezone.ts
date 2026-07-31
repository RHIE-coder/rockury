/**
 * 날짜 표시 타임존 유틸(§ops 향상 — Data 툴바). 3-way 토글: UTC / LOCAL(IANA) / TIMESTAMP(epoch ms).
 * 저장된 datetime 리터럴(타임존 표기 없음)은 UTC 로 간주해 변환한다(레거시 의도와 동일).
 * 순수 함수 → 테스트 의무 대상.
 */
export type TzMode = 'UTC' | 'LOCAL' | 'TIMESTAMP'
export const TZ_MODES: TzMode[] = ['UTC', 'LOCAL', 'TIMESTAMP']

/** 셀 값(epoch 숫자/문자, ISO, `YYYY-MM-DD[ HH:mm:ss]` 리터럴)을 Date 로. 못 알아보면 null. */
export function toDate(value: unknown): Date | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(+value) ? null : value
  if (typeof value === 'number') return new Date(value)
  const s = String(value).trim()
  if (!s) return null
  if (/^\d{10,}$/.test(s)) return new Date(Number(s)) // epoch ms
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(+d) ? null : d
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?$/)
  if (m) {
    const [, y, mo, d, h = '00', mi = '00', se = '00', ms = '0'] = m
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se, +ms.padEnd(3, '0')))
  }
  const d = new Date(s)
  return Number.isNaN(+d) ? null : d
}

function formatInZone(d: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

/** 모드별 날짜 셀 표시 문자열. 파싱 실패 시 원본 문자열을 그대로 반환(값을 잃지 않도록). */
export function formatDateCell(value: unknown, mode: TzMode, tz?: string): string {
  const d = toDate(value)
  if (!d) return value == null ? '' : String(value)
  if (mode === 'TIMESTAMP') return String(d.getTime())
  if (mode === 'UTC') return formatInZone(d, 'UTC')
  return formatInZone(d, tz || Intl.DateTimeFormat().resolvedOptions().timeZone)
}

/** 사용 가능한 IANA 타임존 목록(지원 환경) — 없으면 최소 폴백. */
export function timezoneOptions(): string[] {
  const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
  if (typeof sv === 'function') return sv('timeZone')
  return ['UTC', 'Asia/Seoul', 'America/New_York', 'Europe/London']
}
