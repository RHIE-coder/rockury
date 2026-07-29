import type { RequestDef } from './types'

/**
 * 요청 트리 — `docs/spec/api-studio.md` § requests.tree.
 *
 * `RequestDef.folder` 는 `결제/환불` 처럼 슬래시로 이은 한 줄이다. 폴더를 엔티티로 두지
 * 않는 이유: 빈 폴더라는 상태가 생기면 "요청은 없는데 폴더만 있는" 것을 저장·정리·동기화해야
 * 하고, 그 값어치가 없다. **폴더는 요청이 들고 있는 경로일 뿐**이라 요청을 옮기면 자동으로
 * 접히고 펴진다.
 *
 * 그래서 이 파일은 저장소를 안 건드린다 — 요청 목록을 받아 **새 목록을 돌려줄 뿐**이다.
 */

export const FOLDER_SEP = '/'

export interface TreeLeaf {
  t: 'request'
  request: RequestDef
}

export interface TreeFolder {
  t: 'folder'
  /** 이 폴더의 전체 경로(`결제/환불`). 드롭 대상 식별자로 그대로 쓴다. */
  path: string
  /** 화면에 보이는 마지막 조각(`환불`). */
  name: string
  children: TreeNode[]
}

export type TreeNode = TreeFolder | TreeLeaf

/** `a//b`·앞뒤 공백·빈 조각을 정리한다. 최상위는 빈 문자열이다. */
export function normalizeFolder(folder: string): string {
  return folder
    .split(FOLDER_SEP)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(FOLDER_SEP)
}

/**
 * 요청 목록 → 폴더 트리.
 * **요청의 원래 순서를 지킨다** — 목록 순서가 곧 사람이 정한 순서라 알파벳으로 다시 정렬하면
 * 그 의도가 사라진다. 폴더는 처음 등장한 자리에 선다.
 */
export function buildRequestTree(requests: readonly RequestDef[]): TreeNode[] {
  const root: TreeNode[] = []
  const folders = new Map<string, TreeFolder>()

  /** 경로를 따라 폴더를 만들며 내려간다. 이미 있으면 그걸 쓴다. */
  const ensure = (path: string): TreeNode[] => {
    if (!path) return root
    const existing = folders.get(path)
    if (existing) return existing.children

    const cut = path.lastIndexOf(FOLDER_SEP)
    const parent = cut === -1 ? '' : path.slice(0, cut)
    const name = cut === -1 ? path : path.slice(cut + 1)
    const node: TreeFolder = { t: 'folder', path, name, children: [] }
    folders.set(path, node)
    ensure(parent).push(node)
    return node.children
  }

  for (const r of requests) ensure(normalizeFolder(r.folder)).push({ t: 'request', request: r })
  return root
}

/** 트리에 있는 폴더 경로 전부(중첩 포함). 드롭 대상 목록·이름 바꾸기에 쓴다. */
export function folderPaths(requests: readonly RequestDef[]): string[] {
  const out: string[] = []
  for (const r of requests) {
    const f = normalizeFolder(r.folder)
    if (!f) continue
    // 중간 단계도 폴더다 — `a/b` 만 있어도 `a` 는 존재한다.
    const parts = f.split(FOLDER_SEP)
    for (let i = 1; i <= parts.length; i += 1) {
      const p = parts.slice(0, i).join(FOLDER_SEP)
      if (!out.includes(p)) out.push(p)
    }
  }
  return out
}

/** `부모`가 `자손`의 조상인가(자기 자신도 참). `a` 는 `a/b` 의 조상이지만 `ab` 의 조상은 아니다. */
export function isAncestor(ancestor: string, descendant: string): boolean {
  if (ancestor === '') return true
  if (ancestor === descendant) return true
  return descendant.startsWith(ancestor + FOLDER_SEP)
}

export interface MoveCheck {
  ok: boolean
  /** 막은 이유. `ok` 면 null. */
  reason: string | null
}

/**
 * 폴더를 옮겨도 되나 (CASE-apistudio-051).
 *
 * **자기 자손 안으로는 못 옮긴다** — 옮기는 순간 그 가지가 자기를 부모로 갖게 되어 경로가
 * 무한히 늘어난다(트리가 고리가 된다). 조용히 무시하면 "왜 안 옮겨지지"가 되므로 이유를 준다.
 */
export function canMoveFolder(
  from: string,
  toParent: string,
  existing: readonly string[] = []
): MoveCheck {
  const src = normalizeFolder(from)
  const dst = normalizeFolder(toParent)
  if (!src) return { ok: false, reason: '최상위는 옮길 대상이 아닙니다.' }
  if (isAncestor(src, dst)) {
    return { ok: false, reason: `'${src}' 를 자기 안(${dst || '최상위'})으로 옮길 수 없습니다.` }
  }
  const parent = src.includes(FOLDER_SEP) ? src.slice(0, src.lastIndexOf(FOLDER_SEP)) : ''
  if (parent === dst) return { ok: false, reason: '이미 그 자리에 있습니다.' }

  // **가는 자리에 같은 이름이 있으면 막는다.** 안 막으면 두 폴더가 조용히 하나로 합쳐지고,
  // 되돌리려면 어느 요청이 원래 어느 쪽이었는지를 사람이 기억해야 한다(되돌릴 수 없다).
  const leaf = leafOf(src)
  const target = dst ? `${dst}${FOLDER_SEP}${leaf}` : leaf
  if (existing.some((p) => normalizeFolder(p) === target)) {
    return { ok: false, reason: `'${target}' 가 이미 있습니다 — 합치지 않습니다.` }
  }
  return { ok: true, reason: null }
}

/** 경로의 마지막 조각. `a/b/c` → `c`. */
function leafOf(path: string): string {
  return path.includes(FOLDER_SEP) ? path.slice(path.lastIndexOf(FOLDER_SEP) + 1) : path
}

/**
 * 폴더 이름을 바꿔도 되나.
 *
 * `renameFolder` 는 경로를 갈아 끼우기만 해서, 형제와 이름이 겹치면 **두 폴더가 조용히
 * 합쳐진다.** 옮기기와 같은 이유로 막는다 — 합쳐진 뒤에는 되돌릴 근거가 사라진다.
 */
export function canRenameFolder(
  path: string,
  newName: string,
  existing: readonly string[] = []
): MoveCheck {
  const src = normalizeFolder(path)
  const name = normalizeFolder(newName)
  if (!src) return { ok: false, reason: '최상위는 이름을 바꿀 대상이 아닙니다.' }
  if (!name) return { ok: false, reason: '이름이 비었습니다.' }
  if (name.includes(FOLDER_SEP)) {
    return { ok: false, reason: `이름에 '${FOLDER_SEP}' 는 못 씁니다 — 옮기려면 끌어다 놓으세요.` }
  }
  if (name === leafOf(src)) return { ok: false, reason: '이름이 그대로입니다.' }

  const parent = src.includes(FOLDER_SEP) ? src.slice(0, src.lastIndexOf(FOLDER_SEP)) : ''
  const target = parent ? `${parent}${FOLDER_SEP}${name}` : name
  if (existing.some((p) => normalizeFolder(p) === target)) {
    return { ok: false, reason: `'${target}' 가 이미 있습니다 — 합치지 않습니다.` }
  }
  return { ok: true, reason: null }
}

/** 요청 하나를 다른 폴더로. 목록 순서는 안 바꾼다 — 옮긴 것은 자리가 아니라 소속이다. */
export function moveRequest(
  requests: readonly RequestDef[],
  name: string,
  toFolder: string
): RequestDef[] {
  const folder = normalizeFolder(toFolder)
  return requests.map((r) => (r.name === name ? { ...r, folder } : r))
}

/** 폴더 통째로 옮기기 — 그 아래 모든 요청의 경로 앞부분을 갈아 끼운다. */
export function moveFolder(
  requests: readonly RequestDef[],
  from: string,
  toParent: string
): RequestDef[] {
  const src = normalizeFolder(from)
  const dst = normalizeFolder(toParent)
  if (!canMoveFolder(src, dst).ok) return [...requests]
  const next = dst ? `${dst}${FOLDER_SEP}${leafOf(src)}` : leafOf(src)

  return requests.map((r) => {
    const f = normalizeFolder(r.folder)
    if (!isAncestor(src, f)) return r
    return { ...r, folder: next + f.slice(src.length) }
  })
}

/** 폴더 이름 바꾸기. 자손 경로도 함께 따라간다. */
export function renameFolder(
  requests: readonly RequestDef[],
  path: string,
  newName: string
): RequestDef[] {
  const src = normalizeFolder(path)
  const name = normalizeFolder(newName)
  if (!src || !name || name.includes(FOLDER_SEP)) return [...requests]
  const parent = src.includes(FOLDER_SEP) ? src.slice(0, src.lastIndexOf(FOLDER_SEP)) : ''
  const next = parent ? `${parent}${FOLDER_SEP}${name}` : name

  return requests.map((r) => {
    const f = normalizeFolder(r.folder)
    if (!isAncestor(src, f)) return r
    return { ...r, folder: next + f.slice(src.length) }
  })
}
