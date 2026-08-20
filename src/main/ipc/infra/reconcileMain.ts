import { reconcile } from '../../../shared/infra/reconcile/diff'
import {
  VERDICT_LABEL,
  type CompareField,
  type LiveResource,
  type NodeStatus,
  type ReconNode,
  type ReconType
} from '../../../shared/infra/types'
import { latestSnapshot, listCatalogs, listNodes, listProviders } from './store'

/**
 * 메인 프로세스에서 대조 결과를 낸다 — **MCP 로 내보내기 위한 자리**
 *
 * 규칙을 여기 다시 쓰지 않는다. 화면이 부르는 것과 **똑같은 함수**(`@shared/infra/reconcile/diff`)를
 * 부른다 — 규칙을 두 벌 들고 있으면 화면과 에이전트가 서로 다른 답을 말하게 되고, 그건 이 서비스가
 * 가장 피하려는 종류의 거짓말이다.
 *
 * 메인이 카탈로그에서 읽는 것은 **비교 필드뿐**이다. 아이콘·탐침·문서 틀은 화면 쪽 일이라
 * 여기서 파싱하지 않는다(그래서 카탈로그 형식이 바뀌어도 이 파일은 대개 안 흔들린다).
 */

/** 카탈로그 원문에서 대조에 필요한 것만 훑어 낸다. 깨진 카탈로그는 조용히 건너뛴다(화면이 이미 알린다). */
function typesForReconcile(): Record<string, ReconType> {
  const out: Record<string, ReconType> = {}
  for (const row of listCatalogs()) {
    let body: unknown
    try {
      body = JSON.parse(row.body)
    } catch {
      continue
    }
    const nodeTypes = (body as { nodeTypes?: unknown }).nodeTypes
    if (!Array.isArray(nodeTypes)) continue
    for (const t of nodeTypes) {
      const id = (t as { id?: unknown }).id
      if (typeof id !== 'string') continue
      const cf = (t as { compareFields?: unknown }).compareFields
      out[id] = Array.isArray(cf) ? { compareFields: cf as CompareField[] } : {}
    }
  }
  return out
}

export interface ReconcileSummaryRow {
  verdict: string
  /** 사람이 읽는 판정 이름 — 에이전트에게도 코드보다 이 말이 낫다. */
  verdictLabel: string
  designNode?: { name: string; typeId: string | null }
  live: { externalId: string; name: string; status: NodeStatus; rawStatus: string }[]
  /** 어느 필드가 어떻게 다른가. "다름" 한 단어로 뭉개지 않는다. */
  differences: { field: string; design: string; live: string }[]
  basis?: string
  unknownType: boolean
}

export interface ReconcileSummary {
  designId: string
  providerId: string
  providerName: string
  /** 언제 읽은 실물과 견줬나. **"방금"처럼 보이지 않게 늘 함께 낸다.** */
  snapshotTakenAt: string | null
  /** 이번 스냅샷이 실제로 읽어 온 종류들 — 여기 없으면 '대조 안 함'이다. */
  checkedTypeIds: string[]
  /** 못 읽은 탐침 — "0건이었다"와 "못 읽었다"를 가르는 근거. */
  failedProbes: { typeId: string; error: string }[]
  counts: Record<string, number>
  rows: ReconcileSummaryRow[]
}

/**
 * 설계본 하나와 공급자 하나를 견준다.
 *
 * 스냅샷이 아예 없으면 **'미구축'이 하나도 나오지 않는다** — 읽지도 않고 "없다"고 말하면
 * 사용자·에이전트가 멀쩡한 인프라를 지우러 간다. 그 경우는 전부 '대조 안 함'으로 나온다.
 */
export function reconcileSummary(designId: string, providerId: string): ReconcileSummary {
  const provider = listProviders().find((p) => p.id === providerId)
  if (!provider) throw new Error('공급자 연결을 찾을 수 없습니다.')

  const nodes: ReconNode[] = listNodes(designId).map((n) => ({
    id: n.id,
    typeId: n.typeId,
    name: n.name,
    parentId: n.parentId
  }))
  const snap = latestSnapshot(providerId)
  const resources: LiveResource[] = (snap?.resources ?? []).map((r) => ({
    typeId: r.typeId,
    externalId: r.externalId,
    name: r.name,
    status: r.status as NodeStatus,
    rawStatus: r.rawStatus,
    parentExternalId: r.parentExternalId ?? undefined,
    designNodeRef: r.designNodeRef ?? undefined
  }))
  const checked = (snap?.probes ?? []).filter((p) => p.ok).map((p) => p.typeId)

  const rows = reconcile({
    nodes,
    resources,
    types: typesForReconcile(),
    checkedTypeIds: new Set(checked)
  })

  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1

  return {
    designId,
    providerId,
    providerName: provider.name,
    snapshotTakenAt: snap?.takenAt ?? null,
    checkedTypeIds: checked,
    failedProbes: (snap?.probes ?? [])
      .filter((p) => !p.ok)
      .map((p) => ({ typeId: p.typeId, error: p.error })),
    counts,
    rows: rows.map((r) => ({
      verdict: r.verdict,
      verdictLabel: VERDICT_LABEL[r.verdict],
      designNode: r.designNode ? { name: r.designNode.name, typeId: r.designNode.typeId } : undefined,
      live: r.resources.map((x) => ({
        externalId: x.externalId,
        name: x.name,
        status: x.status,
        rawStatus: x.rawStatus
      })),
      differences: r.fields.map((f) => ({ field: f.field, design: f.design, live: f.live })),
      basis: r.basis,
      unknownType: r.unknownType
    }))
  }
}
