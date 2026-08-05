/**
 * nav 트리를 **늦게** 건네받는 창구 — `useNav` 가 `registry` 를 직접 임포트하지 않게 하려고 둔다.
 *
 * 왜 필요한가. 임포트가 고리를 이룬다: `useNav → registry → 서비스들 → useNav`.
 * 고리 자체는 흠이 아니지만, 고리 안의 파일이 **읽히는 도중에** 남의 값을 쓰면 그 값은 아직
 * 없다(`api/store.ts` 가 파일을 읽는 자리에서 바로 `useNav.subscribe` 를 부른다). 그래서 앱이
 * 어느 파일부터 읽히느냐에 따라 뜨기도 하고 "useNav 를 초기화 전에 쓸 수 없다"로 죽기도 했다 —
 * 실제로 2026-08-05 에 셸에 파일 하나(탭 줄)를 더했을 뿐인데 앱이 안 떴다.
 *
 * 여기가 끊는 자리다. `useNav` 는 이 파일만 임포트하고(이 파일은 아무도 안 부른다 = 고리 밖),
 * `registry` 가 자기를 읽힐 때 트리를 건네준다. 고리가 사라지므로 **어느 파일부터 읽히든** 된다.
 *
 * 트리를 쓰는 시점은 전부 화면을 그리거나 사용자가 누른 뒤다 — 그때는 파일이 다 읽힌 뒤라
 * 트리가 이미 등록돼 있다.
 */
import type { Service } from './types'

let provider: (() => Service[]) | null = null

/** nav 트리를 등록한다 — `nav/registry` 가 자기를 읽힐 때 한 번 부른다. */
export function provideRegistry(fn: () => Service[]): void {
  provider = fn
}

export function navRegistry(): Service[] {
  if (!provider) {
    // 파일 읽는 도중에 트리를 쓰려 한 것이다 — 조용히 빈 배열을 주면 "첫 서비스"가 undefined 가
    // 되어 한참 뒤 엉뚱한 곳에서 죽는다. 여기서 이유를 밝히고 멈춘다.
    throw new Error('nav 트리가 아직 등록되지 않았습니다 — nav/registry 를 임포트한 뒤에 쓰세요.')
  }
  return provider()
}
