import { describe, expect, it } from 'vitest'
import { blocksSharedFeedbackDelete } from './no-shared-feedback-delete.mjs'

/**
 * 공유 제보 폴더를 워크트리가 지우지 못하게 막는 가드의 판정.
 *
 * 정규식 뭉치라 조용히 헐거워지기 쉽다 — 한 줄 고쳤다가 아무것도 안 잡는 가드가 되는 것이
 * 이 검사가 막는 사고다. 반대쪽(읽기까지 막아 일을 못 하게 되는 것)도 같이 못 박는다.
 */
const WT = '/Users/x/Workspace/.worktrees/rockury/db'
const MAIN = '/Users/x/Workspace/rockury'

describe('워크트리에서 공유 제보를 지우려 하면 막는다', () => {
  it.each([
    'rm -rf .harness/feedback/20260820-201836-uiux-features',
    'rm -rf .harness/feedback/',
    'rm .harness/feedback',
    'rmdir .harness/feedback/20260820-201836-uiux-features',
    'npm test && rm -rf .harness/feedback/x',
    'cd /tmp; rm -rf .harness/feedback',
    'find .harness/feedback -type d -delete',
    'ls .harness/feedback | xargs rm -rf',
    'mv .harness/feedback/20260820-201836-uiux-features /tmp/',
    // 워크트리에서 main 폴더 경로를 직접 적어도 같은 사고다.
    'rm -rf /Users/x/Workspace/rockury/.harness/feedback/20260820-201836-uiux-features'
  ])('%s', (command) => {
    expect(blocksSharedFeedbackDelete({ command, cwd: WT })).toBe(true)
  })
})

describe('막지 않는 것', () => {
  it('main 폴더에서 지우는 것은 정상 흐름이다 — 다 처리한 제보를 치우는 쪽이다', () => {
    const command = 'rm -rf .harness/feedback/20260820-201836-uiux-features'
    expect(blocksSharedFeedbackDelete({ command, cwd: MAIN })).toBe(false)
  })

  it.each([
    ['읽기', 'cat .harness/feedback/20260820-201836-uiux-features/note.md'],
    ['목록', 'ls -la .harness/feedback/'],
    // `"rm"` 이 글자로 들어 있다고 막으면 제보를 읽는 일 자체가 안 된다.
    ['따옴표 속 rm', 'grep -rn "rm" .harness/feedback/'],
    ['남기기', 'echo done > .harness/feedback/20260820-201836-uiux-features/done-db.md'],
    ['다른 폴더 삭제', 'rm -rf out && rm -rf node_modules/.vite']
  ])('%s — %s', (_label, command) => {
    expect(blocksSharedFeedbackDelete({ command, cwd: WT })).toBe(false)
  })

  it('입력이 비어도 던지지 않는다 — 훅이 죽으면 가드가 통째로 사라진다', () => {
    expect(blocksSharedFeedbackDelete({})).toBe(false)
    expect(blocksSharedFeedbackDelete({ command: 'rm -rf /', cwd: '' })).toBe(false)
  })
})
