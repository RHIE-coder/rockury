import * as path from 'node:path'

/**
 * 병렬 개발 워크트리 계획 — **순수 계산**(파일도 git 도 건드리지 않는다).
 * setup.mjs 가 이 계획을 받아 실제로 만들고, 테스트는 이 함수만 검증한다.
 */

/**
 * 다섯 서비스. `id` 는 코드 전체가 쓰는 단 하나의 토큰이다 —
 * nav registry 의 `Service.id`, IPC 채널 접두어, 마이그레이션/커버리지/흐름 파일 이름이 모두 같다.
 * 토큰을 둘로 늘리지 않는다 — 서비스당 이름 하나.
 */
export const SERVICES = [
  { id: 'uiux', label: 'UI/UX' },
  { id: 'api', label: 'API' },
  { id: 'db', label: 'DB' },
  { id: 'infra', label: 'Infra' },
  { id: 'ai', label: 'AI' }
]

/** 워크트리들을 모아 두는 숨김 폴더 이름 — 저장소 **바깥**(상위 폴더)에 만든다. */
export const WORKTREE_ROOT = '.worktrees'

/**
 * 저장소 경로에서 각 서비스의 (브랜치, 워크트리 폴더)를 정한다.
 *
 * 배치: `<상위>/.worktrees/<저장소 이름>/<서비스>` — 예) `~/Workspace/.worktrees/rockury/api`
 *  · **저장소 바깥**에 둔다. 안에 두면 빌드·테스트·검색이 `**` 로 훑을 때 자기 사본을 파고든다.
 *    (바깥이므로 `.gitignore` 는 필요 없다 — git 의 시야가 저장소 밖까지 미치지 않는다.)
 *  · **숨김 폴더**라 상위 폴더 목록이 워크트리로 어질러지지 않는다.
 *  · **저장소 이름을 한 겹** 둬서, 같은 상위 폴더의 다른 프로젝트가 같은 방식을 써도 안 부딪힌다.
 *
 * @param repoRoot 저장소 루트 절대경로
 * @param existing 이미 있는 워크트리 폴더 절대경로 목록(`git worktree list` 결과)
 * @param existingBranches 이미 있는 브랜치 이름 목록
 */
export function planWorktrees(repoRoot, existing = [], existingBranches = []) {
  const parent = path.dirname(repoRoot)
  const base = path.basename(repoRoot)
  const here = new Set(existing.map((p) => path.resolve(p)))
  const branches = new Set(existingBranches)

  return SERVICES.map((s) => {
    const dir = path.join(parent, WORKTREE_ROOT, base, s.id)
    return {
      ...s,
      branch: `feat/${s.id}`,
      dir,
      // 이미 있으면 건너뛴다 — 두 번 돌려도 안 망가지게(멱등).
      worktreeExists: here.has(path.resolve(dir)),
      branchExists: branches.has(`feat/${s.id}`)
    }
  })
}

/** 사람이 읽을 요약 한 줄. */
export function describePlan(p) {
  const what = p.worktreeExists ? '이미 있음(건너뜀)' : p.branchExists ? '폴더만 새로' : '새로 만듦'
  return `${p.label.padEnd(6)} ${p.branch.padEnd(12)} → ${p.dir}  [${what}]`
}
