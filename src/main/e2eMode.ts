import { app, session } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 이 앱이 **검사(e2e)로 떴나** — 하네스가 `ROCKURY_E2E=1` 로 켠다.
 *
 * 자동화가 손댈 수 없는 것 두 가지를 여기서만 끈다. 둘 다 **OS 가 그리는 것**이라 화면 안에서는
 * 닫을 수도, 피할 수도 없다:
 *
 * ⑴ **내려받기 저장 창.** macOS 는 창에 붙는 시트로 그려서, 뜬 동안 그 창이 통째로 얼어붙는다.
 *    자동화에는 그걸 닫을 손이 없다 — 한 번 뜨면 그 뒤 모든 조작이 타임아웃으로 흘러간다
 *    (2026-08-07 실측: `14-infra-design` 의 내보내기가 열어 둔 시트가 뒤쪽 스위트를 통째로 먹었다).
 * ⑵ **초점 뺏기.** 검사가 도는 몇 분 동안 창이 사람 앞으로 튀어나와 다른 일을 못 하게 한다.
 *
 * **사람이 쓰는 앱은 안 바뀐다** — 내보내기는 여전히 "어디에 저장할지" 묻는다.
 */
export function isE2E(): boolean {
  return process.env.ROCKURY_E2E === '1'
}

/**
 * 내려받기를 저장 창 없이 곧장 받는다 — 받는 곳은 userData 아래다.
 * e2e 의 userData 는 매 실행 새로 만드는 임시 폴더라, 끝나면 파일도 함께 지워진다.
 * 받은 파일이 실제로 떨어지므로 스위트가 "정말 나왔나"까지 볼 수 있다.
 */
export function downloadsDir(): string {
  return join(app.getPath('userData'), 'downloads')
}

export function acceptDownloadsSilently(): void {
  const dir = downloadsDir()
  mkdirSync(dir, { recursive: true })
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSavePath(join(dir, item.getFilename()))
  })
}

/**
 * 화면 앞으로 안 나선다 — Dock·⌘Tab 에서도 빠진다.
 *
 * 창을 아예 안 그리는 길(headless)은 없다: 좌표·드래그·화면 품질 검사가 실제로 그려진 창을
 * 재기 때문이다. 대신 **초점을 안 가져가게** 해서 사람의 일을 가로채지 않게 한다.
 * 자동화 입력은 CDP 로 들어가므로 창이 앞에 없어도 그대로 먹는다.
 */
export function stayOutOfTheWay(): void {
  app.dock?.hide()
}
