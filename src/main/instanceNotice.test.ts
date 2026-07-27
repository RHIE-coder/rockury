import { describe, expect, it } from 'vitest'
import { alreadyRunningNotice } from './instanceNotice'

/**
 * 병렬 개발 함정 가드: "남의 워크트리 앱을 내 앱으로 착각" 방지 안내.
 * 조용한 실패가 문제였으므로, **무엇이 어긋났는지 문구에 반드시 들어가는지**를 본다.
 */
describe('실행 중 인스턴스 안내', () => {
  const API = '/Users/x/Workspace/.worktrees/rockury/api'
  const DB = '/Users/x/Workspace/.worktrees/rockury/db'

  it('다른 폴더의 앱이 떠 있으면 "그 창은 남의 코드"라고 못박는다', () => {
    const msg = alreadyRunningNotice(API, DB)
    expect(msg).toContain('rockury:db') // 떠 있는 쪽
    expect(msg).toContain('rockury:api') // 띄우려던 쪽
    expect(msg).toContain('의 변경은 그 화면에 없습니다')
  })

  it('같은 폴더를 두 번 띄운 경우엔 "남의 코드" 경고를 붙이지 않는다', () => {
    // 실수로 두 번 실행한 것뿐이라 착각할 여지가 없다 — 겁줄 필요 없음.
    const msg = alreadyRunningNotice(API, API)
    expect(msg).not.toContain('의 변경은 그 화면에 없습니다')
    expect(msg).toContain('이미 실행 중')
  })

  it('실행 중인 소스를 모를 때도 조용히 끝나지 않는다', () => {
    const msg = alreadyRunningNotice(API, null)
    expect(msg).toContain('이미 실행 중')
    expect(msg).toContain('알 수 없음')
  })

  it('어느 경우에도 두 경로가 다 보인다 — 어디서 무엇이 어긋났는지 추적 가능', () => {
    for (const running of [DB, API, null]) {
      const msg = alreadyRunningNotice(API, running)
      expect(msg).toContain(API)
      if (running) expect(msg).toContain(running)
    }
  })

  it('검증 대안(병렬 안전한 명령)을 함께 안내한다', () => {
    const msg = alreadyRunningNotice(API, DB)
    expect(msg).toContain('npm test')
    expect(msg).toContain('npm run e2e')
  })
})
