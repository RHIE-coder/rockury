import { sourceLabel } from '../shared/sourceLabel'

/**
 * 병렬 개발에서 "다른 워크트리의 앱을 내 앱으로 착각"하는 함정을 막는 안내 — **순수 로직**.
 *
 * 앱은 userData 기준 단일 인스턴스라 두 번째 실행은 스스로 종료하고, 먼저 떠 있던 창이
 * 앞으로 나온다. 그래서 두 번째 사람 눈에는 "창이 떴다"로 보이는데 **그 창은 남의 코드**다.
 * 조용하면 멀쩡한 코드를 고치기 시작한다 — 그래서 시끄럽게 알린다.
 */

/** 두 번째 인스턴스가 종료하기 전에 터미널에 남길 안내. */
export function alreadyRunningNotice(currentPath: string, runningPath: string | null): string {
  const here = sourceLabel(currentPath)
  const there = runningPath ? sourceLabel(runningPath) : null
  const lines = [
    '',
    '⚠ Rockury 가 이미 실행 중입니다 — 이 프로세스는 종료합니다.',
    runningPath
      ? `   실행 중인 앱의 소스: ${there}  (${runningPath})`
      : '   실행 중인 앱의 소스: 알 수 없음(이전 버전이 띄운 앱일 수 있습니다)',
    `   지금 실행하려던 소스: ${here}  (${currentPath})`
  ]
  if (there && there !== here) {
    lines.push(
      '',
      `   ▶ 앞으로 나온 창은 '${there}' 의 코드입니다. '${here}' 의 변경은 그 화면에 없습니다.`,
      '     내 코드로 보려면 실행 중인 앱을 먼저 끄세요.'
    )
  }
  lines.push(
    '',
    '   앱은 로컬 DB 파일 하나를 공유하므로 한 번에 하나만 뜹니다.',
    '   손으로 확인하는 건 한 번에 한 명 — 검증은 `npm test` · `npm run e2e` 로 (병렬 안전).',
    ''
  )
  return lines.join('\n')
}
