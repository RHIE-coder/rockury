import { describe, expect, it } from 'vitest'
import { SERVICES, planWorktrees } from './plan.mjs'

/**
 * TestPlan: parallel-dev · Scenario S7 (CASE-pdev-060)
 * 워크트리 준비 스크립트의 **계획 계산**만 검증한다 — 실제 폴더 생성은 수동 확인(S7 나머지).
 */
describe('병렬 워크트리 계획', () => {
  const REPO = '/Users/x/Workspace/rockury'

  it('다섯 서비스가 코드와 같은 토큰을 쓴다', () => {
    // nav registry·IPC 접두어·마이그레이션/커버리지/흐름 파일 이름과 같은 id 여야 한다.
    expect(SERVICES.map((s) => s.id)).toEqual(['uiux', 'api', 'db', 'infra', 'mcp'])
  })

  it('CASE-pdev-060 서비스 → (브랜치, 폴더) 대응이 결정적이다', () => {
    const plan = planWorktrees(REPO)
    expect(plan.map((p) => p.branch)).toEqual([
      'feat/uiux',
      'feat/api',
      'feat/db',
      'feat/infra',
      'feat/mcp'
    ])
    expect(plan.map((p) => p.dir)).toEqual([
      '/Users/x/Workspace/.worktrees/rockury/uiux',
      '/Users/x/Workspace/.worktrees/rockury/api',
      '/Users/x/Workspace/.worktrees/rockury/db',
      '/Users/x/Workspace/.worktrees/rockury/infra',
      '/Users/x/Workspace/.worktrees/rockury/mcp'
    ])
  })

  it('폴더를 저장소 바깥에 만든다 — 저장소 안에 두지 않는다', () => {
    // 안에 두면 빌드·테스트·검색이 `**` 로 훑을 때 자기 사본을 파고든다.
    for (const p of planWorktrees(REPO)) {
      expect(p.dir.startsWith(REPO + '/')).toBe(false)
    }
  })

  it('저장소 이름을 한 겹 둔다 — 같은 상위 폴더의 다른 프로젝트와 안 부딪히게', () => {
    const other = planWorktrees('/Users/x/Workspace/other-project')
    const mine = planWorktrees(REPO)
    // 두 프로젝트가 같은 서비스 이름을 써도 폴더가 겹치지 않는다.
    expect(new Set([...other, ...mine].map((p) => p.dir)).size).toBe(other.length + mine.length)
    expect(other[0].dir).toBe('/Users/x/Workspace/.worktrees/other-project/uiux')
  })

  it('상위 폴더 목록에서 숨겨진다 — 점으로 시작하는 폴더에 모은다', () => {
    for (const p of planWorktrees(REPO)) {
      expect(p.dir).toContain('/.worktrees/')
    }
  })

  it('CASE-pdev-060 이미 있는 워크트리는 "건너뜀"으로 분류된다 (멱등의 근거)', () => {
    const plan = planWorktrees(
      REPO,
      ['/Users/x/Workspace/.worktrees/rockury/db'],
      ['feat/db', 'feat/api']
    )
    const byId = Object.fromEntries(plan.map((p) => [p.id, p]))
    expect(byId.db.worktreeExists).toBe(true)
    expect(byId.db.branchExists).toBe(true)
    // 브랜치만 있고 폴더가 없는 경우 — 폴더만 새로 만들면 된다.
    expect(byId.api.worktreeExists).toBe(false)
    expect(byId.api.branchExists).toBe(true)
    expect(byId.uiux.worktreeExists).toBe(false)
    expect(byId.uiux.branchExists).toBe(false)
  })

  it('경로 표기가 달라도 같은 폴더로 알아본다 (끝 슬래시·중복 슬래시)', () => {
    const plan = planWorktrees(REPO, ['/Users/x/Workspace//.worktrees/rockury/db/'], [])
    expect(plan.find((p) => p.id === 'db')?.worktreeExists).toBe(true)
  })
})
