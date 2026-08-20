/**
 * Infra 서비스의 **양쪽이 다 쓰는** 값들 — 메인과 렌더러가 같은 사전을 봐야 하는 것만 여기 둔다.
 *
 * 왜 공용으로 올렸나: 대조 계산(`reconcile/`)이 렌더러에만 있으면 **메인이 그걸 못 부른다.**
 * 그러면 MCP 로 대조 결과를 내보낼 수 없고
 * 억지로 열려면 메인에 같은 규칙을 한 벌 더 쓰게 된다 — 그건 두 화면이 서로 다른 답을 말하게 되는
 * 것과 같은 종류의 사고다. 그래서 규칙 자체를 한 곳으로 올렸다.
 *
 * 카탈로그의 풍부한 모델(아이콘·탐침·문서 틀)은 **여기 올리지 않는다** — 그건 화면 쪽 일이고,
 * 메인이 알아야 할 것은 "무엇을 비교하나"뿐이다.
 */

/** 탐침이 읽어 온 원본 상태 문자열을 옮겨 담을 다섯 칸. */
export type NodeStatus = 'ok' | 'warn' | 'stopped' | 'gone' | 'unknown'

/** 화면 표기 — 코드 식별자는 영어, 사용자가 보는 말은 한국어. */
export const STATUS_LABEL: Record<NodeStatus, string> = {
  ok: '정상',
  warn: '주의',
  stopped: '멈춤',
  gone: '없어짐',
  unknown: '모름'
}

/** 대조에서 무엇을 비교할지. 지정 안 하면 상태만 본다. */
export type CompareField = 'status' | 'parent' | 'type'

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

/**
 * 대조에 필요한 **설계 노드의 최소 모양.**
 *
 * 렌더러의 `DesignNode`(좌표·문서까지 달린 것)와 메인이 SQLite 에서 읽은 행이 **둘 다 이 모양을
 * 만족한다** — TypeScript 는 구조로 판정하므로 어느 쪽도 변환 없이 그대로 넘길 수 있다.
 * 계산에 필요한 것만 요구하는 것이 요점이다: 좌표나 문서를 요구하면 메인이 못 부른다.
 */
export interface ReconNode {
  id: string
  typeId: string | null
  name: string
  parentId: string | null
}

/** 대조에 필요한 **노드 종류의 최소 모양.** */
export interface ReconType {
  compareFields?: CompareField[]
}
