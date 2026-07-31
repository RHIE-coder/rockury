import { DRAFT_LENS } from './store'

/**
 * Design 렌즈 드롭다운에 세울 항목을 만든다 — 순수 함수(입력 목록 → 출력 목록).
 * 화면에서 떼어 놓아 테스트가 붙는다(AGENTS.md 테스트 의무 1).
 */

export interface LensOption {
  /** `'draft'` 또는 커밋 버전 번호. */
  id: string
  label: string
  /** 라벨 옆에 흐리게 붙는 한 마디 — 컷 메모가 있으면 그것, 없으면 상태말. */
  hint?: string
  /** 이 시점에서는 편집이 막힌다. */
  readOnly: boolean
}

/**
 * 항상 **Draft 가 맨 위**다 — 편집 가능한 유일한 자리이고, 사용자가 가장 자주 돌아오는 곳이다.
 * 그 아래로 컷된 버전이 들어온 순서(최신순)대로 붙는다.
 */
export function lensOptions(
  versions: readonly { number: string; note: string }[]
): LensOption[] {
  return [
    { id: DRAFT_LENS, label: 'Draft', hint: '편집 중', readOnly: false },
    ...versions.map((v) => ({
      id: v.number,
      label: v.number,
      hint: v.note || '읽기 전용',
      readOnly: true
    }))
  ]
}

/**
 * 지금 고른 항목. 고른 버전이 목록에서 사라졌으면(다른 설계로 옮겼거나 버전을 지웠다)
 * **Draft 로 떨어뜨린다** — 없는 시점을 가리킨 채 빈 화면을 보여 주는 것보다 낫다.
 */
export function currentLensOption(options: readonly LensOption[], lens: string): LensOption {
  return options.find((o) => o.id === lens) ?? options[0]
}
