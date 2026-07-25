import type { Node } from '@xyflow/react'
import type { Positions } from './layout'

/**
 * 재배치 seed 계산(순수) — 세 ERD 캔버스(Console 실 ERD·편집 ERD·Studio 가상 ERD)의
 * setNodes updater 공용. 첫 seed(first)는 저장된 위치를, 이후엔 현재 화면(prev) 위치를
 * 입혀 사용자가 옮긴 배치를 보존하고, overlay 에 없는 새 노드만 base(dagre) 자리로 채운다.
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
    : Object.fromEntries(prev.map((n) => [n.id, n.position]))
  return baseNodes.map((n) => ({
    ...n,
    position: overlay[n.id] ?? n.position,
    measured: prevMap.get(n.id)?.measured
  }))
}
