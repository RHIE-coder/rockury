import type { NodeDoc } from '../catalog/types'

/**
 * 설계본 데이터 모델 — **Rockury 가 들고 있는 정본.** 실물은 이것과 대조되는 대상일 뿐이다.
 */

export interface Design {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface DesignNode {
  id: string
  designId: string
  /** 카탈로그·프리셋의 종류 id. `null` 이면 종류 없는 '맨 노드'. */
  typeId: string | null
  name: string
  /** 담긴 부모 노드. `null` 이면 최상위. */
  parentId: string | null
  /**
   * 좌표는 **부모 기준 상대값**이다(@xyflow 규약). 최상위 노드는 캔버스 절대 좌표.
   * 상대값으로 두면 "부모를 옮기면 자식이 따라온다"가 코드 없이 성립한다.
   */
  x: number
  y: number
  w: number
  h: number
  doc: NodeDoc
  /**
   * 이 노드를 만들 때 기준이 된 카탈로그 **내용** 버전.
   * 나중에 종류가 카탈로그에서 사라져도 "언제 기준의 무엇이었는지"가 남아 노드를 지키지 않아도 된다.
   */
  catalogVersion?: string
}

export interface DesignEdge {
  id: string
  designId: string
  sourceId: string
  targetId: string
  label: string
  kind: string
}

/** 노드 기본 크기 — 종류가 정하지 않으면 이 크기로 놓인다. */
export const DEFAULT_NODE_W = 200
export const DEFAULT_NODE_H = 60

/** 부모 박스 안쪽 여백과 제목줄 높이 — 배치·크기 계산이 같은 값을 본다. */
export const BOX_PAD = 24
export const BOX_HEADER = 32
