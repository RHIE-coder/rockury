import type { NodeStatus } from '../catalog/types'

/**
 * 대조에 오가는 것들.
 *
 * 대조는 **설계본(정본) ↔ 실물(스냅샷)** 을 짝지어 어긋난 곳을 짚는 일이다.
 * 이 방향을 뒤집지 않는 것이 이 서비스의 공통 불변식이다 —
 * 여기서 나오는 어떤 결과도 실물을 바꾸는 지시가 되지 못한다.
 */

/** 실물 하나 — 탐침이 읽어 스냅샷에 저장된 것. */
export interface LiveResource {
  externalId: string
  /** 어느 노드 종류로 읽혔나. 카탈로그에 없는 종류면 '미상'으로 남는다. */
  typeId: string
  name: string
  status: NodeStatus
  /** 공급자가 준 원본 상태 문자열. */
  rawStatus: string
  parentExternalId?: string
  /** `rockury:node` 태그로 들어온 설계 노드 id — 짝짓기 1순위 근거. */
  designNodeRef?: string
}

/** 무엇을 근거로 짝지었나. 태그로 맞은 것과 이름으로 어쩌다 맞은 것은 신뢰도가 다르다. */
export type MatchBasis = 'tag' | 'name'

export const BASIS_LABEL: Record<MatchBasis, string> = {
  tag: '태그',
  name: '이름'
}

/** 대조 결과 한 줄의 판정. */
export type Verdict = 'missing' | 'unregistered' | 'drift' | 'ok' | 'not-checked'

export const VERDICT_LABEL: Record<Verdict, string> = {
  missing: '미구축',
  unregistered: '미등록',
  drift: '어긋남',
  ok: '일치',
  'not-checked': '대조 안 함'
}
