import { parseContent } from './content'
import type { SpecTree } from './store'

/**
 * 설계 스냅샷과 비교.
 *
 * 스냅샷은 **그 시점의 트리 통째**다. 차이만 저장하면 중간 버전 하나가 깨졌을 때 그 뒤가 전부
 * 못 읽히고, 설계 하나의 크기는 그렇게 크지 않다(화면 수십 장 × JSON).
 *
 * 비교는 **화면 단위**로 본다 — 요소 하나까지 훑어 내려가면 "무엇이 바뀌었나"가 아니라
 * "얼마나 많이 바뀌었나"만 남는다. 무엇을 봐야 할지 정하는 게 먼저다.
 */

export interface Snapshot {
  applications: { id: string; key: string; name: string }[]
  services: { id: string; applicationId: string; key: string; name: string }[]
  surfaces: {
    id: string
    serviceId: string
    key: string
    name: string
    kind: string
    status: string
    content: string
  }[]
}

export type ChangeKind = 'added' | 'removed' | 'changed' | 'same'

export interface SurfaceDiff {
  address: string
  name: string
  change: ChangeKind
  /** 무엇이 달라졌나 — 사람이 읽는 문장. `changed` 일 때만 채워진다. */
  details: string[]
}

/** 지금 트리 → 스냅샷. 저장소 행에서 필요한 것만 추린다(읽는 쪽이 모르는 칸에 기대지 않게). */
export function takeSnapshot(tree: SpecTree): Snapshot {
  return {
    applications: tree.applications.map((a) => ({ id: a.id, key: a.key, name: a.name })),
    services: tree.services.map((s) => ({
      id: s.id,
      applicationId: s.application_id,
      key: s.key,
      name: s.name
    })),
    surfaces: tree.surfaces.map((s) => ({
      id: s.id,
      serviceId: s.service_id,
      key: s.key,
      name: s.name,
      kind: s.kind,
      status: s.status,
      content: s.content
    }))
  }
}

/** 스냅샷 안에서 화면의 주소를 만든다(프로젝트 조각은 밖에서 붙인다 — 스냅샷은 프로젝트 안이다). */
function addressIn(snapshot: Snapshot, surfaceId: string): string | null {
  const surface = snapshot.surfaces.find((s) => s.id === surfaceId)
  if (!surface) return null
  const service = snapshot.services.find((s) => s.id === surface.serviceId)
  const app = service && snapshot.applications.find((a) => a.id === service.applicationId)
  if (!service || !app) return null
  return `${app.key}.${service.key}.${surface.key}`
}

/** 화면 하나의 요약 — 비교가 "무엇이"를 말하려면 셀 것을 정해 둬야 한다. */
function summarize(contentJson: string): { sections: number; components: number; events: number } {
  const content = parseContent(contentJson)
  return {
    sections: content.sections.length,
    components: content.sections.reduce((n, s) => n + s.components.length, 0),
    events: (content.events ?? []).length
  }
}

/**
 * 두 스냅샷 비교. **주소로 짝짓는다** — 저장소 id 로 짝지으면 이름을 바꾼 화면이 "지우고 새로
 * 만든 것"으로 보인다(주소는 그 화면의 정체성이고, id 는 우연히 붙은 번호다).
 *
 * 순서는 바뀐 것 → 더해진 것 → 사라진 것 → 그대로. 볼 필요가 있는 것부터 위로 온다.
 */
export function diffSnapshots(before: Snapshot, after: Snapshot): SurfaceDiff[] {
  const beforeByAddress = new Map<string, Snapshot['surfaces'][number]>()
  for (const s of before.surfaces) {
    const address = addressIn(before, s.id)
    if (address) beforeByAddress.set(address, s)
  }

  const out: SurfaceDiff[] = []
  const seen = new Set<string>()

  for (const s of after.surfaces) {
    const address = addressIn(after, s.id)
    if (!address) continue
    seen.add(address)
    const old = beforeByAddress.get(address)
    if (!old) {
      out.push({ address, name: s.name, change: 'added', details: [] })
      continue
    }

    const details: string[] = []
    if (old.name !== s.name) details.push(`이름 ${old.name} → ${s.name}`)
    if (old.kind !== s.kind) details.push(`종류 ${old.kind} → ${s.kind}`)
    if (old.status !== s.status) details.push(`상태 ${old.status} → ${s.status}`)

    const a = summarize(old.content)
    const b = summarize(s.content)
    if (a.sections !== b.sections) details.push(`영역 ${a.sections} → ${b.sections}`)
    if (a.components !== b.components) details.push(`요소 ${a.components} → ${b.components}`)
    if (a.events !== b.events) details.push(`전이 ${a.events} → ${b.events}`)
    // 개수는 같은데 내용이 다를 수 있다 — 그때도 "바뀌었다"는 말은 해야 한다.
    if (details.length === 0 && old.content !== s.content) details.push('내용이 바뀌었어요')

    out.push({ address, name: s.name, change: details.length > 0 ? 'changed' : 'same', details })
  }

  for (const [address, s] of beforeByAddress) {
    if (!seen.has(address)) out.push({ address, name: s.name, change: 'removed', details: [] })
  }

  const rank: Record<ChangeKind, number> = { changed: 0, added: 1, removed: 2, same: 3 }
  return out.sort((x, y) => rank[x.change] - rank[y.change] || x.address.localeCompare(y.address))
}

/** 다음 버전 번호 — 마지막 것에서 가운데 자리를 올린다. 형식이 아니면 처음부터 센다. */
export function nextVersionNumber(existing: string[]): string {
  let best = 0
  for (const v of existing) {
    const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(v)
    if (m) best = Math.max(best, Number(m[2]))
  }
  return `v0.${best + 1}.0`
}
