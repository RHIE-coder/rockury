import type { Node } from '@xyflow/react'
import type { Positions } from './layout'

/**
 * 재배치 seed 계산(순수) — 세 ERD 캔버스(Remote 실 ERD·편집 ERD·Design 가상 ERD)의
 * setNodes updater 공용. 첫 seed(first)는 저장된 위치를, 이후엔 현재 화면(prev) 위치를
 * 입혀 사용자가 옮긴 배치를 보존하고, overlay 에 없는 새 노드만 base(dagre) 자리로 채운다.
 *
 * ⚠ 이후 seed 에서도 **저장된 위치를 바탕에 깐다.** 화면(prev)에 없던 노드가 다시 나타날 때
 * (접힌 그룹을 펴거나 `관계만`·`그룹만 보기` 필터를 끌 때) prev 만 보면 그 노드는 자리를 잃고
 * dagre 자리로 튄다 — 사용자가 옮겨 둔 배치가 필터 한 번에 사라지는 회귀였다(e2e 실측).
 * 우선순위는 **화면 > 저장본 > dagre**.
 *
 * ⚠ 반드시 순수를 유지할 것: React StrictMode(dev)는 setNodes updater 를 두 번 부른다.
 * 과거 first 판정(ref 변경)을 updater 안에서 하다가 두 번째 호출이 "처음 아님"으로 오판,
 * 저장 위치 대신 dagre 배치가 적용·영속되는 버그가 있었다. first 는 밖에서 판정해 넘긴다.
 * seed.test.ts 가 이중 호출 동작을 고정한다.
 */
export function seedNodes(baseNodes: Node[], prev: Node[], first: boolean, storedPositions: Positions): Node[] {
  const prevMap = new Map(prev.map((n) => [n.id, n]))
  const overlay: Positions = first
    ? storedPositions
    : { ...storedPositions, ...Object.fromEntries(prev.map((n) => [n.id, n.position])) }
  return baseNodes.map((n) => ({
    ...n,
    position: overlay[n.id] ?? n.position,
    measured: prevMap.get(n.id)?.measured
  }))
}
