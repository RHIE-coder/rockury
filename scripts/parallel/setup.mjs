#!/usr/bin/env node
// 5서비스 병렬 개발 워크트리 준비 — 폴더 5개를 만들고 바로 개발 가능한 상태로 맞춘다.
//
//   node scripts/parallel/setup.mjs           준비(멱등 — 두 번 돌려도 안전)
//   node scripts/parallel/setup.mjs status    현황만 본다
//   node scripts/parallel/setup.mjs sync      워크트리를 main 최신으로 끌어올린다(빨리감기만)
//   node scripts/parallel/setup.mjs remove    워크트리 정리(미커밋 변경이 있으면 멈춘다)
//   node scripts/parallel/setup.mjs --no-install   npm install 을 건너뛴다(빠른 확인용)
//   node scripts/parallel/setup.mjs --help    이 사용법
//
// 준비가 끝나면 각 폴더에서 사람이 `claude` 를 띄운다 — 이 스크립트는 판만 깔아 준다.
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVICES, describePlan, parseArgs, planWorktrees, syncVerdict } from './plan.mjs'
import { helpIfAsked, usageOf } from '../lib/usage.cjs'

const SELF = fileURLToPath(import.meta.url)
const REPO = path.resolve(path.dirname(SELF), '..', '..')
helpIfAsked(SELF) // 명령 판정보다 먼저 — 늦게 보면 도움말 요청이 setup 을 실행한다
const { cmd, noInstall: NO_INSTALL } = parseArgs(process.argv.slice(2))

const C = { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', x: '\x1b[0m' }
const say = (s = '') => console.log(s)

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', ...opts }).trim()
}

/** `git worktree list --porcelain` 에서 폴더 경로만 뽑는다. */
function currentWorktrees() {
  return git(['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length))
}

function currentBranches() {
  return git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean)
}

function plan() {
  return planWorktrees(REPO, currentWorktrees(), currentBranches())
}

/** 폴더 하나 크기(대략) — node_modules 안내용. */
function dirSizeMb(dir) {
  try {
    const out = execFileSync('du', ['-sm', dir], { encoding: 'utf8' })
    return parseInt(out.split('\t')[0], 10)
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────── status

function showStatus() {
  say(`${C.b}병렬 개발 워크트리 현황${C.x}  ${C.dim}(저장소: ${REPO})${C.x}`)
  say()
  for (const p of plan()) {
    const mark = p.worktreeExists ? `${C.g}●${C.x}` : `${C.dim}○${C.x}`
    const size = p.worktreeExists ? dirSizeMb(p.dir) : null
    const deps = p.worktreeExists && fs.existsSync(path.join(p.dir, 'node_modules'))
    const harness = p.worktreeExists && fs.existsSync(path.join(p.dir, '.harness-main'))
    const extra = p.worktreeExists
      ? `  ${C.dim}${size ? size + 'MB' : ''} ${deps ? '· 의존성 ✔' : '· 의존성 없음(npm install 필요)'}${harness ? ' · steward ✔' : ' · steward 꺼짐'}${C.x}`
      : ''
    say(`  ${mark} ${p.label.padEnd(6)} ${p.branch.padEnd(12)} ${p.dir}${extra}`)
  }
  say()
  const ready = plan().filter((p) => p.worktreeExists).length
  say(`  준비된 워크트리 ${ready}/${SERVICES.length}`)
}

// ─────────────────────────────────────────────────────────────── setup

function setup() {
  const todo = plan()
  const missing = todo.filter((p) => !p.worktreeExists)

  say(`${C.b}5서비스 병렬 개발 워크트리 준비${C.x}`)
  say(`${C.dim}저장소: ${REPO}${C.x}`)
  say()
  for (const p of todo) say('  ' + describePlan(p))
  say()

  if (missing.length === 0) {
    say(`${C.g}이미 다 준비돼 있습니다.${C.x} 각 폴더에서 \`claude\` 를 띄우세요.`)
    printNextSteps(todo)
    return
  }

  // 디스크 안내 — Electron 이 무거워 폴더당 수백 MB 든다. 놀라지 않게 미리 알린다.
  const perFolder = dirSizeMb(path.join(REPO, 'node_modules'))
  if (!NO_INSTALL && perFolder) {
    say(`${C.y}주의${C.x} 폴더마다 npm install 이 필요합니다 — 약 ${perFolder}MB × ${missing.length}개 = 약 ${perFolder * missing.length}MB.`)
    say(`${C.dim}      건너뛰려면 --no-install (나중에 각 폴더에서 npm install)${C.x}`)
    say()
  }

  for (const p of missing) {
    say(`${C.b}▸ ${p.label}${C.x} (${p.branch})`)

    // 1) 워크트리 + 브랜치 — 브랜치가 이미 있으면 -b 없이 붙인다(멱등).
    const args = p.branchExists
      ? ['worktree', 'add', p.dir, p.branch]
      : ['worktree', 'add', p.dir, '-b', p.branch]
    const add = spawnSync('git', args, { cwd: REPO, stdio: 'inherit' })
    if (add.status !== 0) {
      say(`${C.r}  ✗ 워크트리 생성 실패 — 건너뜁니다${C.x}`)
      continue
    }

    // 2) steward 하네스 켜기 — `.harness-main` 은 gitignore 대상이라 워크트리에 안 따라온다.
    fs.writeFileSync(path.join(p.dir, '.harness-main'), 'steward\n')
    say(`  ${C.g}✔${C.x} .harness-main (steward 활성)`)

    // 3) 의존성 — node_modules 도 gitignore 대상이라 안 따라온다.
    if (NO_INSTALL) {
      say(`  ${C.y}—${C.x} npm install 건너뜀 (직접 실행하세요)`)
    } else {
      say(`  ${C.dim}npm install …${C.x}`)
      const inst = spawnSync('npm', ['install'], { cwd: p.dir, stdio: 'inherit' })
      say(inst.status === 0 ? `  ${C.g}✔${C.x} 의존성 설치` : `  ${C.r}✗ npm install 실패 — 폴더에서 직접 실행하세요${C.x}`)
    }
    say()
  }

  printNextSteps(plan())
}

function printNextSteps(todo) {
  say()
  say(`${C.b}다음 할 일${C.x} — 터미널을 ${todo.length}개 열고 각 폴더에서 에이전트를 띄웁니다:`)
  say(`${C.dim}(폴더는 점으로 시작해 숨겨져 있습니다 — \`ls\` 에는 안 보이지만 \`cd\` 는 그냥 됩니다)${C.x}`)
  say()
  for (const p of todo) say(`  ${C.dim}cd${C.x} ${p.dir} ${C.dim}&&${C.x} claude    ${C.dim}# ${p.label} 담당${C.x}`)
  say()
  say(`${C.b}공유 자원 규칙${C.x} ${C.dim}(워크트리로 격리되지 않는 것들 — docs/agents/parallel-dev.md)${C.x}`)
  say(`  · 앱을 손으로 띄워 확인하는 건 ${C.b}한 번에 한 명${C.x} — 로컬 DB 파일 하나를 공유하고, 앱은 단일 인스턴스다.`)
  say(`  · ${C.b}npm run db:reset${C.x} 도 한 번에 한 명 — 도커 테스트 DB 는 고정 포트 공유다.`)
  say(`  · 의존성 추가(package.json)는 ${C.b}main 에서 한 명${C.x}만, 나머지는 rebase 로 받아간다.`)
  say(`  · 자동 e2e(${C.b}npm run e2e${C.x})는 임시 폴더를 써서 동시에 돌려도 안전하다.`)
  say()
  say(`${C.dim}현황: node scripts/parallel/setup.mjs status · 정리: … remove${C.x}`)
}

// ─────────────────────────────────────────────────────────────── sync

/** 통합 브랜치 이름 — 저장소의 기본 브랜치. */
const MAIN = 'main'

function sync() {
  say(`${C.b}워크트리를 ${MAIN} 최신으로 맞춤${C.x}`)
  const head = git(['log', '--oneline', '-1', MAIN])
  say(`${C.dim}${MAIN}: ${head}${C.x}`)
  say()

  let moved = 0
  let blocked = 0

  for (const p of plan()) {
    const count = (range) => {
      try {
        return parseInt(git(['rev-list', '--count', range]), 10)
      } catch {
        return 0
      }
    }
    const dirty = p.worktreeExists
      ? git(['status', '--porcelain'], { cwd: p.dir }).split('\n').filter(Boolean).length
      : 0
    const v = syncVerdict({
      exists: p.worktreeExists,
      behind: count(`${p.branch}..${MAIN}`),
      ahead: count(`${MAIN}..${p.branch}`),
      dirty
    })

    process.stdout.write(`  ${p.label.padEnd(6)} `)
    if (!v.act) {
      const color = v.kind === 'current' ? C.g : v.kind === 'missing' ? C.dim : C.y
      say(`${color}${v.text}${C.x}`)
      if (v.kind === 'diverged' || v.kind === 'ahead') blocked++
      continue
    }

    // 빨리감기만 한다 — 갈라졌으면 git 이 거부하고, 우리는 강제하지 않는다.
    const r = spawnSync('git', ['merge', '--ff-only', MAIN], {
      cwd: p.dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (r.status === 0) {
      say(`${C.g}✔${C.x} ${v.text} → 최신`)
      moved++
    } else {
      // 대개 미커밋 파일이 병합 대상과 겹친 경우. 무엇을 하라고 알려 준다.
      say(`${C.r}✗ 끌어올리지 못함${C.x} ${C.dim}(${(r.stderr || '').trim().split('\n')[0]})${C.x}`)
      say(`         ${C.dim}그 폴더에서 변경을 커밋하거나 되돌린 뒤 다시 실행하세요: ${p.dir}${C.x}`)
      blocked++
    }
  }

  say()
  say(`  ${moved}개 최신화${blocked > 0 ? ` · ${C.y}${blocked}개는 사람 확인 필요${C.x}` : ''}`)
  if (blocked > 0) process.exitCode = 1
}

// ─────────────────────────────────────────────────────────────── remove

function remove() {
  const todo = plan().filter((p) => p.worktreeExists)
  if (todo.length === 0) {
    say('정리할 워크트리가 없습니다.')
    return
  }

  // 미커밋 변경이 있으면 멈춘다 — 작업물을 말없이 날리지 않는다.
  const dirty = todo.filter((p) => {
    try {
      return git(['status', '--porcelain'], { cwd: p.dir }).length > 0
    } catch {
      return true // 상태를 못 읽으면 안전한 쪽으로
    }
  })
  if (dirty.length > 0) {
    say(`${C.r}멈춤 — 커밋하지 않은 변경이 있습니다:${C.x}`)
    for (const p of dirty) say(`  · ${p.label}  ${p.dir}`)
    say()
    say('그 폴더에서 커밋하거나 되돌린 뒤 다시 실행하세요. (작업물을 말없이 지우지 않습니다.)')
    process.exitCode = 1
    return
  }

  for (const p of todo) {
    spawnSync('git', ['worktree', 'remove', p.dir], { cwd: REPO, stdio: 'inherit' })
    say(`${C.g}✔${C.x} ${p.label} 워크트리 제거 — ${C.dim}브랜치 ${p.branch} 는 남겨 둡니다${C.x}`)
  }

  // 빈 껍데기 폴더 정리 — `.worktrees/<저장소>` 와 `.worktrees` 가 비었으면 지운다.
  // 비어 있을 때만 지운다(rmdir): 다른 프로젝트의 워크트리가 들어 있으면 손대지 않는다.
  for (const dir of [path.dirname(todo[0].dir), path.dirname(path.dirname(todo[0].dir))]) {
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
    } catch {
      // 남아 있는 게 있거나 이미 없으면 그대로 둔다.
    }
  }

  say()
  say(`${C.dim}브랜치까지 지우려면: git branch -d ${plan().map((p) => p.branch).join(' ')}${C.x}`)
}

// ───────────────────────────────────────────────────────────────

if (cmd === 'status') showStatus()
else if (cmd === 'sync') sync()
else if (cmd === 'remove') remove()
else if (cmd === 'setup') setup()
else {
  say(`알 수 없는 명령: ${cmd}\n`)
  say(usageOf(SELF))
  process.exitCode = 1
}
