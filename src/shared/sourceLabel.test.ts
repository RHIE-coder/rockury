import { describe, expect, it } from 'vitest'
import { sourceLabel } from './sourceLabel'

describe('소스 폴더 라벨', () => {
  it('워크트리는 <저장소>:<서비스>', () => {
    expect(sourceLabel('/Users/x/Workspace/.worktrees/rockury/api')).toBe('rockury:api')
    expect(sourceLabel('/Users/x/Workspace/.worktrees/rockury/db')).toBe('rockury:db')
  })

  it('main 폴더는 저장소 폴더 이름', () => {
    expect(sourceLabel('/Users/x/Workspace/rockury')).toBe('rockury')
  })

  it('끝 슬래시가 붙어도 같은 이름', () => {
    expect(sourceLabel('/Users/x/Workspace/.worktrees/rockury/api/')).toBe('rockury:api')
  })

  it('빌드 산출물 경로를 넣으면 안 된다는 걸 드러낸다 — 소스 루트를 넣어야 한다', () => {
    // out/main 을 넣으면 'main' 이 나와 브랜치 이름처럼 보인다. 호출부는 반드시 소스 루트를 준다.
    expect(sourceLabel('/Users/x/Workspace/rockury/out/main')).toBe('main')
  })
})

describe('플랫폼 중립 (렌더러에서도 번들된다)', () => {
  it('윈도우 역슬래시 경로도 읽는다', () => {
    expect(sourceLabel('C:\\Users\\x\\Workspace\\.worktrees\\rockury\\api')).toBe('rockury:api')
  })

  it('중복 슬래시를 흘려보낸다', () => {
    expect(sourceLabel('/Users/x//Workspace/.worktrees//rockury/db')).toBe('rockury:db')
  })

  it('짧은 경로에서도 터지지 않는다', () => {
    expect(sourceLabel('/rockury')).toBe('rockury')
    expect(sourceLabel('')).toBe('')
  })
})
