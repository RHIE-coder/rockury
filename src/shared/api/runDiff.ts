import type { RunRecord } from './types'

/**
 * 두 실행 기록의 응답 비교 — `docs/spec/api-runner.md` § history.list AC-4.
 *
 * "무엇이 달라졌나"를 묻는 자리다. 판정(`drift.ts`)과 다르다 — 판정은 **선언 대 실제**를
 * 보고, 여기는 **실제 대 실제**를 본다. 그래서 선언이 없어도 되고, 어긋남이라는 말도 안 쓴다.
 *
 * 이 파일이 지키는 것: **비교할 수 없었다는 사실을 "같다"로 바꾸지 않는다.**
 * JSON 이 아니면 필드로 못 쪼개므로 그 사실을 결과에 담고, 필드 목록은 비운다.
 */

export const RUN_DIFF_KINDS = ['added', 'removed', 'changed'] as const
export type RunDiffKind = (typeof RUN_DIFF_KINDS)[number]

export const RUN_DIFF_LABEL: Record<RunDiffKind, string> = {
  added: '새로 생김',
  removed: '없어짐',
  changed: '값이 달라짐'
}

export interface RunFieldDiff {
  kind: RunDiffKind
  /** 점으로 이은 경로. 배열은 `items[0]` 처럼 자리번호가 붙는다. */
  path: string
  /** 기준(왼쪽) 값. `added` 면 없다. */
  before?: string
  /** 비교(오른쪽) 값. `removed` 면 없다. */
  after?: string
}

export interface RunDiff {
  /** 필드 단위로 못 쪼갠 이유. null 이면 비교가 실제로 돌았다. */
  unavailable: string | null
  /** 상태·소요처럼 본문 밖에서 달라진 것 — 본문이 같아도 이건 다를 수 있다. */
  meta: RunFieldDiff[]
  fields: RunFieldDiff[]
}

/** JSON 값을 `경로 → 값` 한 겹으로 편다. 잎(스칼라)만 담는다 — 가지는 경로로 표현된다. */
export function flatten(value: unknown, base = '', out: Map<string, string> = new Map()): Map<string, string> {
  if (Array.isArray(value)) {
    // 자리번호를 경로에 넣는다. 순서가 바뀐 것도 "달라짐"이고, 그 사실을 감추지 않는다.
    value.forEach((v, i) => flatten(v, `${base}[${i}]`, out))
    return out
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, base ? `${base}.${k}` : k, out)
    }
    return out
  }
  // null 은 값이다("없음"과 다르다) — 그래서 문자열로 남긴다.
  out.set(base || '(본문)', value === null ? 'null' : String(value))
  return out
}

function diffMaps(a: Map<string, string>, b: Map<string, string>): RunFieldDiff[] {
  const out: RunFieldDiff[] = []
  for (const [path, before] of a) {
    if (!b.has(path)) {
      out.push({ kind: 'removed', path, before })
      continue
    }
    const after = b.get(path)!
    if (after !== before) out.push({ kind: 'changed', path, before, after })
  }
  for (const [path, after] of b) if (!a.has(path)) out.push({ kind: 'added', path, after })
  return out
}

function metaDiff(a: RunRecord, b: RunRecord): RunFieldDiff[] {
  const out: RunFieldDiff[] = []
  const pair = (path: string, before: string, after: string): void => {
    if (before !== after) out.push({ kind: 'changed', path, before, after })
  }
  pair('상태', a.status, b.status)
  pair('HTTP 상태', String(a.httpStatus ?? '없음'), String(b.httpStatus ?? '없음'))
  pair('기준 버전', a.baseVersion ?? 'Draft', b.baseVersion ?? 'Draft')
  pair('환경', a.environmentName, b.environmentName)
  return out
}

/**
 * 기준(a) → 비교(b) 로 무엇이 달라졌나.
 * **순서가 뜻을 갖는다** — a 에만 있으면 `없어짐`, b 에만 있으면 `새로 생김`이다.
 */
export function diffRuns(a: RunRecord, b: RunRecord): RunDiff {
  const meta = metaDiff(a, b)

  if (!a.response || !b.response) {
    return {
      unavailable: '한쪽에 응답이 없습니다 — 못 붙은 실행이거나 스트림 세션이라 본문을 비교할 수 없습니다.',
      meta,
      fields: []
    }
  }

  let left: unknown
  let right: unknown
  try {
    left = JSON.parse(a.response.body)
    right = JSON.parse(b.response.body)
  } catch {
    // 통째로 문자열 비교까지 내려가지 않는다 — "이 줄이 다르다"는 필드 비교가 아니다.
    const same = a.response.body === b.response.body
    return {
      unavailable: same
        ? '응답이 JSON 이 아니라 필드로 못 쪼갰습니다 — 본문 글자는 같습니다.'
        : '응답이 JSON 이 아니라 필드로 못 쪼갰습니다 — 본문 글자가 다릅니다.',
      meta,
      fields: []
    }
  }

  return { unavailable: null, meta, fields: diffMaps(flatten(left), flatten(right)) }
}

/** 사람이 읽을 한 줄. **"같다"를 만들 수 있는 것은 비교가 실제로 돌았을 때뿐이다.** */
export function summarizeRunDiff(d: RunDiff): string {
  const metaPart = d.meta.length > 0 ? ` · 응답 밖 ${d.meta.length}건` : ''
  if (d.unavailable) return `필드 비교 불가${metaPart}`
  if (d.fields.length === 0) return `응답 본문이 같습니다${metaPart}`
  const by = (k: RunDiffKind): number => d.fields.filter((f) => f.kind === k).length
  const parts = RUN_DIFF_KINDS.filter((k) => by(k) > 0).map((k) => `${RUN_DIFF_LABEL[k]} ${by(k)}`)
  return `${parts.join(' · ')}${metaPart}`
}
