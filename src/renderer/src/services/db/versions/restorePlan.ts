import { bumpVer, latestVer } from './semver'

/**
 * 되돌리기 전 **자동 보관 버전**의 번호·메모(순수).
 *
 * 왜 번호를 자동으로 짓나: 물러설 길은 사용자가 이름을 고민하지 않아야 만들어진다. 되돌리기
 * 창에서 번호를 물으면 그 칸을 채우기 싫어 보관을 꺼 버리고, 그러면 안전줄이 사라진다.
 */

/** 보관 버전 번호 — 최신 뒤의 patch 자리. 버전이 하나도 없으면 첫 번호. */
export function backupVersionNumber(existing: readonly string[]): string {
  const latest = latestVer([...existing])
  return latest ? bumpVer(latest, 'patch') : 'v0.0.1'
}

/**
 * 보관 버전 메모 — 목록에서 **한눈에 자동 보관임을 알아보게** 한다. 사람이 컷한 버전과
 * 섞여 보이면 계보가 헷갈린다.
 */
export function backupVersionNote(restoredTo: string): string {
  return `되돌리기 전 자동 보관 (→ ${restoredTo})`
}

/** 자동 보관으로 만들어진 버전인가 — 목록에서 다르게 그릴 때 쓴다. */
export function isBackupVersion(note: string): boolean {
  return note.startsWith('되돌리기 전 자동 보관')
}
