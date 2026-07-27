/**
 * 저장 전 텍스트 위생 검사 — "반영한 뒤에 깨진 글자를 발견"하는 일을 없앤다.
 *
 * 에이전트가 보내는 JSON 에는 인코딩 사고(모지바케)의 흔적이 섞일 수 있다: 치환 문자
 * (U+FFFD), 짝 잃은 서로게이트, 제어 문자, 문장 중간의 BOM. 이 값들은 그대로 저장되어
 * 화면·DDL·문서로 흘러가고, 저장이 문서형(테이블 단위 JSON 블롭)이라 한 글자를 고치려
 * 해도 그 테이블을 통째로 다시 보내야 한다. → 쓰기 도구는 **저장 전에** 전 문자열을 훑어
 * 위치와 함께 거부한다(부분 반영 없음).
 *
 * 잡지 않는 것: 폭 없는 결합자(U+200C~200D)와 U+200B. 이모지 결합 시퀀스처럼 정상 본문에
 * 등장할 수 있어 오탐이 실익을 넘는다 — 이 검사는 "확실히 사고인 것"만 막는다.
 */

export type TextProblemKind = 'replacement' | 'lone-surrogate' | 'control' | 'bom'

export interface TextProblem {
  /** 값의 위치 — 예: `tables[25].columns[11].comment` */
  path: string
  kind: TextProblemKind
  /** 문자열 안에서 문제 글자의 인덱스(UTF-16 코드 유닛) */
  index: number
  /** 예: `U+FFFD` */
  codePoint: string
  /** 문제 글자를 ⟪⟫ 로 감싼 주변 문맥 */
  sample: string
}

const KIND_LABEL: Record<TextProblemKind, string> = {
  replacement: '치환 문자(모지바케 흔적)',
  'lone-surrogate': '짝 잃은 서로게이트(문자열 잘림)',
  control: '제어 문자',
  bom: '문장 속 BOM(폭 없는 공백)'
}

/** 탭·개행·복귀는 정상 본문 — 나머지 C0/DEL 만 사고로 본다. */
const isControl = (code: number): boolean =>
  (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || code === 0x7f)

const hex = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`

/** 문맥 표시용 — 다른 제어 문자는 화면을 망치므로 가운뎃점으로 바꿔 보인다. */
function context(text: string, index: number): string {
  const clean = (s: string): string =>
    [...s].map((ch) => (isControl(ch.charCodeAt(0)) ? '·' : ch)).join('')
  const before = clean(text.slice(Math.max(0, index - 12), index))
  const after = clean(text.slice(index + 1, index + 13))
  const head = index > 12 ? '…' : ''
  const tail = index + 13 < text.length ? '…' : ''
  return `${head}${before}⟪${text[index]}⟫${after}${tail}`
}

/** 문자열 하나를 훑어 문제 글자를 모은다. 정상 서로게이트 쌍(이모지 등)은 통째로 건너뛴다. */
export function scanText(path: string, text: string): TextProblem[] {
  const out: TextProblem[] = []
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    let kind: TextProblemKind | null = null

    if (code === 0xfffd) kind = 'replacement'
    else if (code === 0xfeff) kind = 'bom'
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : NaN
      // 뒤 유닛이 하위 서로게이트면 정상 쌍 — 두 유닛을 함께 소비한다.
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++
        continue
      }
      kind = 'lone-surrogate'
    } else if (code >= 0xdc00 && code <= 0xdfff) kind = 'lone-surrogate'
    else if (isControl(code)) kind = 'control'

    if (kind) out.push({ path, kind, index: i, codePoint: hex(code), sample: context(text, i) })
  }
  return out
}

/**
 * 값 트리(객체·배열·문자열)를 훑어 모든 문자열을 검사한다.
 * 객체 **키**도 검사 대상 — 미지의 필드를 보존하는 looseObject 특성상 깨진 키가 그대로 저장될 수 있다.
 */
export function scanValue(value: unknown, path = ''): TextProblem[] {
  if (typeof value === 'string') return scanText(path || '(값)', value)
  if (Array.isArray(value)) return value.flatMap((v, i) => scanValue(v, `${path}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
      const at = path ? `${path}.${k}` : k
      // 키 자체가 깨진 경우도 잡는다(값 경로와 구분되게 `(키)` 를 붙임).
      return [...scanText(`${at} (키)`, k), ...scanValue(v, at)]
    })
  }
  return []
}

const MAX_SHOWN = 10

/** 보고서 문자열 — 어디가 왜 깨졌는지 + 어떻게 고칠지. */
export function describeProblems(problems: TextProblem[], label: string): string {
  const lines = problems
    .slice(0, MAX_SHOWN)
    .map((p) => `  · ${p.path} [${p.codePoint} ${KIND_LABEL[p.kind]}] ${p.sample}`)
  const more = problems.length > MAX_SHOWN ? `\n  … 외 ${problems.length - MAX_SHOWN}곳` : ''
  return (
    `${label} 저장을 멈췄습니다 — 보낸 값에 깨진 글자가 ${problems.length}곳 있습니다(저장소에는 아무것도 쓰지 않았습니다).\n` +
    `${lines.join('\n')}${more}\n` +
    '해당 자리의 텍스트를 다시 만들어 보내세요. 원문을 복사해 붙였다면 인코딩이 깨진 것이니 직접 다시 입력하는 편이 확실합니다.'
  )
}

/**
 * 문제가 있으면 throw(도구 핸들러 래퍼가 isError 로 변환) — 저장 호출 앞에 세운다.
 * rootPath 는 도구 인자 이름(`tables`·`operations`)을 넣는다 — 보고 경로가 에이전트가 보낸
 * 인자 구조와 같아야 어디를 고칠지 바로 짚을 수 있다.
 */
export function assertCleanText(value: unknown, label: string, rootPath = ''): void {
  const problems = scanValue(value, rootPath)
  if (problems.length > 0) throw new Error(describeProblems(problems, label))
}
