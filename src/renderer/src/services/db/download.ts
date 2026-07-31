/**
 * 텍스트를 파일로 내려받는다 — Blob + a[download].
 * Electron 은 저장 경로가 정해지지 않은 내려받기에 저장 대화상자를 띄운다(어디에 둘지는 사람이 고른다).
 * Query/Data 의 CSV·JSON·INSERT 내보내기와 Definition 의 DDL 저장이 같은 것을 쓴다.
 */
export function downloadText(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
