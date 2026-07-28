import { EMPTY_DOC, type DocLink, type NodeDoc } from '../catalog/types'

/**
 * 노드 문서 — 이 서비스의 무기.
 *
 * "EC2 하나 떠 있고 3000번 리스닝 중… 그래서 어쩌라고" 를 없애는 자리다.
 * 문서는 **설계 노드에 붙는다** — 실물은 재생성되면 식별자가 바뀌므로 실물에 매달면
 * 재배포 한 번에 전부 증발한다.
 */

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

function normalizeLinks(v: unknown): DocLink[] {
  if (!Array.isArray(v)) return []
  const out: DocLink[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const { label, url } = item as Record<string, unknown>
    // 둘 다 있어야 링크다 — 반쪽짜리는 화면에서 클릭했을 때 아무 데도 안 간다.
    if (typeof label === 'string' && typeof url === 'string' && label && url) out.push({ label, url })
  }
  return out
}

/**
 * 어떤 입력이 와도 정해진 모양의 문서를 낸다.
 * 로컬 DB 에 저장된 JSON 이 옛 형식이거나 깨져 있어도 화면이 살아야 한다.
 */
export function normalizeDoc(raw: unknown): NodeDoc {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_DOC }
  const r = raw as Record<string, unknown>
  return {
    role: text(r.role),
    impact: text(r.impact),
    owner: text(r.owner),
    deps: text(r.deps),
    beforeTouch: text(r.beforeTouch),
    notes: text(r.notes),
    links: normalizeLinks(r.links)
  }
}

/** 종류가 가진 기본 틀로 새 문서를 만든다 — 빈 종이 앞에 앉히지 않는다. */
export function docFromTemplate(template: Partial<NodeDoc> | undefined): NodeDoc {
  return normalizeDoc({ ...EMPTY_DOC, ...(template ?? {}) })
}

/**
 * "설명 없음" 판정 — 다이어그램에 표식을 붙여 **채우게 만드는 압력**이 된다.
 * 공백만 든 칸은 빈 것으로 본다(스페이스 하나로 표식을 지우는 우회 방지).
 */
export function isDocEmpty(doc: NodeDoc): boolean {
  const filled =
    [doc.role, doc.impact, doc.owner, doc.deps, doc.beforeTouch, doc.notes].some(
      (v) => v.trim().length > 0
    ) || doc.links.length > 0
  return !filled
}

export interface AgentNodeSummary {
  name: string
  typeLabel: string
  role: string
  /** 죽으면 무슨 일이 나나 — 이게 없으면 에이전트도 판단을 못 한다. */
  impact: string
  /** 무엇을 부르고 무엇이 나를 부르나. */
  deps: string
  owner: string
  beforeTouch: string
  /** 문서가 채워져 있나. 비어 있으면 **비었다고 말한다** — 조용히 빈 값을 주지 않는다. */
  documented: boolean
}

/**
 * MCP 로 에이전트에게 나가는 노드 한 줄.
 *
 * **의존과 영향이 반드시 포함된다.** "EC2 하나 있음" 만 주면 에이전트도 어쩌라는 건지 모른다 —
 * 이 서비스가 구축을 하지 않고 설계본만 들고 있기로 한 이상, 이 요약이 곧 산출물이다.
 */
export function docSummaryForAgent(input: {
  name: string
  typeLabel: string
  doc: NodeDoc
}): AgentNodeSummary {
  const { name, typeLabel, doc } = input
  return {
    name,
    typeLabel,
    role: doc.role,
    impact: doc.impact,
    deps: doc.deps,
    owner: doc.owner,
    beforeTouch: doc.beforeTouch,
    documented: !isDocEmpty(doc)
  }
}
