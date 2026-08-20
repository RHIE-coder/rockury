import type { Discover, NodeDoc, NodeTypeDef } from './types'

/**
 * 프리셋 — **모양만 있는 노드 종류**를 만들고, 나중에 탐침을 붙여 올리는(승격) 순수 로직.
 *
 * 왜 따로 두나: 탐침 편집기는 "읽어 오는 법"을 만드는 곳이라 **탐침이 있어야만** 저장된다.
 * 그런데 그라파나 하나를 그림에 올리려고 CLI 정의부터 하라는 건 말이 안 된다(D3) —
 * 모양만 있는 종류를 만드는 길이 따로 있어야 한다.
 */

/** 모양만 선언하는 입력. 탐침은 없다. */
export interface PresetInput {
  id: string
  label: string
  icon: string
  color?: string
  canNestIn?: string[]
  canContain?: string[]
  docTemplate?: Partial<NodeDoc>
}

export type PresetResult = { ok: true; type: NodeTypeDef } | { ok: false; error: string }

/** 종류 id 는 표현식·저장 키·설계 노드의 참조로 쓰인다 — 공백이 섞이면 그 전부가 흔들린다. */
const ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function makePresetType(input: PresetInput): PresetResult {
  const id = input.id.trim()
  if (!id) return { ok: false, error: '종류 id 를 입력하세요.' }
  if (!ID_OK.test(id)) {
    return {
      ok: false,
      error: '종류 id 에는 영문·숫자와 . _ - 만 쓸 수 있습니다(공백 불가).'
    }
  }
  return {
    ok: true,
    type: {
      id,
      label: input.label.trim() || id,
      icon: input.icon.trim() || 'phosphor:cube',
      ...(input.color ? { color: input.color } : {}),
      ...(input.canNestIn?.length ? { canNestIn: input.canNestIn } : {}),
      ...(input.canContain?.length ? { canContain: input.canContain } : {}),
      ...(input.docTemplate ? { docTemplate: input.docTemplate } : {})
    }
  }
}

/** 승격에 들고 갈 모양. 탐침만 빠진 종류 그대로다. */
export type PromoteSeed = Omit<NodeTypeDef, 'discover'>

/**
 * 이 종류를 승격할 수 있나 — **탐침이 없는 것만** 승격 대상이다.
 * 이미 탐침이 있으면 승격이 아니라 편집이고, 그건 탐침 편집기가 할 일이다.
 */
export function promoteSeed(type: NodeTypeDef): PromoteSeed | null {
  if (type.discover) return null
  const { discover: _drop, ...rest } = type
  void _drop
  return rest
}

/**
 * 모양 + 탐침 = 승격된 종류.
 *
 * **id 를 그대로 이어받는 것이 이 함수의 요점이다.** 설계 노드는 종류를 id 로 가리키므로,
 * 승격하면서 id 를 새로 만들면 이미 그려 둔 노드가 전부 '알 수 없는 종류'로 떨어진다.
 */
export function mergePromotion(seed: PromoteSeed, discover: Discover): NodeTypeDef {
  return { ...seed, discover }
}
