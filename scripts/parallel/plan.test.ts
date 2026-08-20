import { describe, expect, it } from 'vitest'
import {
  FEEDBACK_DIR,
  SERVICES,
  feedbackLinkVerdict,
  parseArgs,
  planWorktrees,
  syncVerdict
} from './plan.mjs'

/**
 * TestPlan: parallel-dev · Scenario S7 (CASE-pdev-060)
 * 워크트리 준비 스크립트의 **계획 계산**만 검증한다 — 실제 폴더 생성은 수동 확인(S7 나머지).
 */
describe('병렬 워크트리 계획', () => {
  const REPO = '/Users/x/Workspace/rockury'

  it('다섯 서비스가 코드와 같은 토큰을 쓴다', () => {
    // nav registry·IPC 접두어·마이그레이션/커버리지/흐름 파일 이름과 같은 id 여야 한다.
    expect(SERVICES.map((s) => s.id)).toEqual(['uiux', 'api', 'db', 'infra', 'ai'])
  })

  it('CASE-pdev-060 서비스 → (브랜치, 폴더) 대응이 결정적이다', () => {
    const plan = planWorktrees(REPO)
    expect(plan.map((p) => p.branch)).toEqual([
      'feat/uiux',
      'feat/api',
      'feat/db',
      'feat/infra',
      'feat/ai'
    ])
    expect(plan.map((p) => p.dir)).toEqual([
      '/Users/x/Workspace/.worktrees/rockury/uiux',
      '/Users/x/Workspace/.worktrees/rockury/api',
      '/Users/x/Workspace/.worktrees/rockury/db',
      '/Users/x/Workspace/.worktrees/rockury/infra',
      '/Users/x/Workspace/.worktrees/rockury/ai'
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

/**
 * TestPlan: parallel-dev · Scenario S7 — 워크트리를 main 에 맞추는 판정.
 * 되돌릴 수 없는 조작을 하지 않는 것이 요점이다: 끌어올릴 수 있을 때만 손대고,
 * 갈라졌거나 앞서 있으면 사람에게 넘긴다.
 */
describe('워크트리 동기화 판정', () => {
  it('뒤처지기만 했으면 빨리감기 대상', () => {
    const v = syncVerdict({ exists: true, behind: 3 })
    expect(v.kind).toBe('behind')
    expect(v.act).toBe(true)
    expect(v.text).toContain('3커밋')
  })

  it('이미 최신이면 손대지 않는다', () => {
    expect(syncVerdict({ exists: true, behind: 0 })).toMatchObject({ kind: 'current', act: false })
  })

  it('앞서 있으면 손대지 않는다 — 올릴 차례지 내릴 차례가 아니다', () => {
    expect(syncVerdict({ exists: true, ahead: 2 })).toMatchObject({ kind: 'ahead', act: false })
  })

  it('갈라졌으면 손대지 않고 rebase 를 안내한다 (작업물 보호)', () => {
    const v = syncVerdict({ exists: true, ahead: 2, behind: 3 })
    expect(v.kind).toBe('diverged')
    expect(v.act).toBe(false)
    expect(v.text).toContain('rebase')
  })

  it('워크트리가 없으면 건너뛴다', () => {
    expect(syncVerdict({ exists: false, behind: 5 })).toMatchObject({ kind: 'missing', act: false })
  })

  it('미커밋이 있어도 뒤처짐이면 시도한다 — 겹치면 git 이 거부하므로 안전', () => {
    const v = syncVerdict({ exists: true, behind: 1, dirty: 2 })
    expect(v.act).toBe(true)
    expect(v.text).toContain('미커밋')
  })

  it('어떤 상태에서도 되돌릴 수 없는 조작을 지시하지 않는다', () => {
    const cases = [
      { exists: false },
      { exists: true },
      { exists: true, behind: 1 },
      { exists: true, ahead: 1 },
      { exists: true, ahead: 1, behind: 1 },
      { exists: true, behind: 1, dirty: 3 }
    ]
    for (const c of cases) {
      expect(syncVerdict(c).text).not.toMatch(/reset|--hard|force/)
    }
  })
})

describe('명령줄 파싱', () => {
  it('회귀 — `--help` 는 setup 으로 떨어지지 않는다', () => {
    // 예전 판정(`argv[2]` 가 `--` 로 시작하면 기본값 setup)은 도움말을 부른 사람에게
    // 워크트리 5개 생성 + npm install 을 실행시켰다.
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
    expect(parseArgs(['sync', '--help']).help).toBe(true)
  })

  it('명령이 없으면 setup, 있으면 그 명령', () => {
    expect(parseArgs([]).cmd).toBe('setup')
    expect(parseArgs(['status']).cmd).toBe('status')
    expect(parseArgs(['sync']).cmd).toBe('sync')
    expect(parseArgs(['remove']).cmd).toBe('remove')
  })

  it('플래그는 명령으로 읽지 않는다 — 순서가 바뀌어도 같다', () => {
    expect(parseArgs(['--no-install']).cmd).toBe('setup')
    expect(parseArgs(['--no-install', 'status'])).toMatchObject({ cmd: 'status', noInstall: true })
    expect(parseArgs(['status', '--no-install'])).toMatchObject({ cmd: 'status', noInstall: true })
  })

  it('모르는 명령은 그대로 넘긴다 — 안내는 부르는 쪽 몫', () => {
    expect(parseArgs(['foo']).cmd).toBe('foo')
  })
})

/**
 * 화면 피드백은 main 폴더 하나를 다섯 워크트리가 나눠 쓴다 — 사본이 아니라 링크다.
 * 판정의 요점은 하나: **사람이 남긴 제보를 말없이 지우지 않는다.**
 */
describe('워크트리 피드백 연결 판정', () => {
  const WANT = '/Users/x/Workspace/rockury/.harness/feedback'

  it('저장소 안 상대 경로는 앱이 쓰는 자리와 같다', () => {
    // src/main/ipc/devFeedback.ts 가 `<소스루트>/.harness/feedback` 에 떨군다.
    expect(FEEDBACK_DIR).toBe('.harness/feedback')
  })

  it('자리가 비었으면 연결한다', () => {
    expect(feedbackLinkVerdict({ exists: false, want: WANT })).toMatchObject({
      kind: 'missing',
      act: true
    })
  })

  it('이미 main 폴더를 가리키면 손대지 않는다 (멱등)', () => {
    const v = feedbackLinkVerdict({ exists: true, isLink: true, target: WANT, want: WANT })
    expect(v).toMatchObject({ kind: 'linked', act: false })
  })

  it('경로 표기가 달라도 같은 곳으로 알아본다', () => {
    const v = feedbackLinkVerdict({
      exists: true,
      isLink: true,
      target: '/Users/x/Workspace/rockury/./.harness//feedback',
      want: WANT
    })
    expect(v.kind).toBe('linked')
  })

  it('링크가 딴 곳을 가리키면 다시 잇는다 — 저장소를 옮겼을 때', () => {
    const v = feedbackLinkVerdict({
      exists: true,
      isLink: true,
      target: '/Users/x/Old/rockury/.harness/feedback',
      want: WANT
    })
    expect(v).toMatchObject({ kind: 'relink', act: true })
  })

  it('빈 실물 폴더는 치우고 잇는다 — 잃을 것이 없다', () => {
    const v = feedbackLinkVerdict({ exists: true, entries: 0, want: WANT })
    expect(v).toMatchObject({ kind: 'empty', act: true })
  })

  it('제보가 든 실물 폴더는 건드리지 않는다 — 사람 것을 말없이 지우지 않는다', () => {
    const v = feedbackLinkVerdict({ exists: true, entries: 3, want: WANT })
    expect(v).toMatchObject({ kind: 'occupied', act: false })
    expect(v.text).toContain('3건')
  })

  it('손대는 판정은 링크이거나 빈 자리일 때뿐이다', () => {
    const cases = [
      { exists: false },
      { exists: true, isLink: true, target: WANT },
      { exists: true, isLink: true, target: '/elsewhere' },
      { exists: true, entries: 0 },
      { exists: true, entries: 1 },
      { exists: true, entries: 99 }
    ]
    for (const c of cases) {
      const v = feedbackLinkVerdict({ ...c, want: WANT })
      // 내용물이 있는 실물 폴더에서 act 가 참이면 제보가 날아간다.
      if (!c.isLink && (c.entries ?? 0) > 0) expect(v.act).toBe(false)
    }
  })
})
