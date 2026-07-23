/**
 * ERD 내보내기 파일명 생성(순수) — `erd-<연결명>-<YYYYMMDD-HHmmss>.<ext>`.
 * 연결명은 파일시스템 안전 문자로 정규화(영숫자/._- 외는 `-`), 캡처 로직(DOM·html-to-image)은
 * 뷰에 둔다(테스트는 이 파일명 규칙만 — 나머지는 e2e/수동). 입력→출력 결정적 → 테스트 의무.
 */
export function exportFileName(connName: string, ext: 'png' | 'svg', date: Date): string {
  const safe = (connName || 'diagram').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram'
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  return `erd-${safe}-${stamp}.${ext}`
}
