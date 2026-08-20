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

/**
 * 워크트리를 통합 브랜치(main)에 맞출 때 무엇을 할지 판정한다 — **순수 계산**.
 *
 * 되돌릴 수 없는 조작(`reset --hard`)은 절대 하지 않는다. 끌어올릴 수 있을 때만
 * 빨리감기(fast-forward)를 하고, 갈라졌으면 사람이 rebase 하도록 안내만 한다.
 *
 * @param exists  워크트리 폴더가 있는가
 * @param behind  main 에는 있고 이 브랜치엔 없는 커밋 수
 * @param ahead   이 브랜치에만 있는 커밋 수(아직 main 에 안 올린 작업)
 * @param dirty   커밋하지 않은 변경 파일 수
 */
export function syncVerdict({ exists, behind = 0, ahead = 0, dirty = 0 }) {
  if (!exists) {
    return { kind: 'missing', act: false, text: '워크트리 없음 — `setup` 으로 먼저 만드세요' }
  }
  if (ahead > 0 && behind > 0) {
    // 양쪽에 서로 없는 커밋이 있다 → 빨리감기 불가. 합치는 방법은 사람이 정한다.
    return {
      kind: 'diverged',
      act: false,
      text: `갈라짐(앞 ${ahead} · 뒤 ${behind}) — 그 폴더에서 \`git rebase main\` 후 다시`
    }
  }
  if (ahead > 0) {
    return { kind: 'ahead', act: false, text: `${ahead}커밋 앞섬 — main 으로 올릴 차례입니다` }
  }
  if (behind === 0) {
    return { kind: 'current', act: false, text: '이미 최신' }
  }
  // 뒤처지기만 했다 → 빨리감기 가능. 미커밋 파일이 병합 대상과 겹치면 git 이 알아서 거부한다.
  return {
    kind: 'behind',
    act: true,
    text: dirty > 0 ? `${behind}커밋 뒤처짐 (미커밋 ${dirty}건 — 겹치면 git 이 거부)` : `${behind}커밋 뒤처짐`
  }
}

/**
 * 명령줄을 명령·플래그로 가른다 — **순수 계산**.
 *
 * 도움말 요청을 명령 판정보다 **먼저** 본다. 예전엔 "`--` 로 시작하면 명령이 아니다"만 보고
 * 기본값 `setup` 으로 떨어뜨려서, `--help` 를 친 사람이 워크트리 5개를 실제로 만들고
 * `npm install` 까지 돌게 됐다(2026-08-18 실측).
 *
 * @param argv `process.argv.slice(2)`
 */
export function parseArgs(argv) {
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    cmd: argv.find((a) => !a.startsWith('-')) ?? 'setup',
    noInstall: argv.includes('--no-install')
  }
}

/**
 * 화면 피드백 폴더의 저장소 안 상대 경로.
 *
 * main 폴더에 있는 이 폴더 **하나**를 다섯 워크트리가 나눠 쓴다(각자 사본을 갖지 않는다).
 * 왜 사본이 아닌가: "읽고 고쳤으면 폴더를 지운다"가 규약인데, 사본이면 그 삭제가 제 사본만
 * 지우고 main 폴더의 원본은 남는다 — 남은 원본을 다음 사람이 또 집어 같은 것을 두 번 고치게 된다.
 */
export const FEEDBACK_DIR = path.join('.harness', 'feedback')

/**
 * 워크트리의 피드백 자리를 main 폴더에 이을지 판정한다 — **순수 계산**(파일을 건드리지 않는다).
 *
 * 사람이 남긴 제보를 말없이 지우지 않는 것이 요점이다. 자리가 비었거나 우리가 건 링크일
 * 때만 손대고, 실물 폴더에 내용물이 있으면(= 그 워크트리에서 앱을 띄워 남긴 제보가 있다)
 * 건드리지 않고 사람에게 넘긴다.
 *
 * @param exists  그 자리에 무언가 있는가
 * @param isLink  그것이 심볼릭 링크인가
 * @param target  링크라면 가리키는 곳(절대경로로 풀어서 넘긴다)
 * @param want    가리켜야 할 곳 — main 폴더의 피드백 폴더(절대경로)
 * @param entries 실물 폴더라면 그 안의 항목 수
 */
export function feedbackLinkVerdict({ exists, isLink = false, target = '', want, entries = 0 }) {
  if (!exists) return { kind: 'missing', act: true, text: 'main 폴더의 피드백에 연결' }
  if (isLink) {
    return path.resolve(target) === path.resolve(want)
      ? { kind: 'linked', act: false, text: '이미 연결됨' }
      : { kind: 'relink', act: true, text: `다른 곳을 가리킴(${target}) — main 폴더로 다시 연결` }
  }
  if (entries === 0) return { kind: 'empty', act: true, text: '빈 폴더를 치우고 연결' }
  return {
    kind: 'occupied',
    act: false,
    text: `제보 ${entries}건이 든 실물 폴더 — 건드리지 않습니다. main 폴더로 옮긴 뒤 다시 실행하세요`
  }
}
