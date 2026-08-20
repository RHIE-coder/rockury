import type { SpecTree } from './store'
import type { SurfaceStatus } from './types'

/**
 * 능력 인덱스 집계
 *
 * **세는 단위가 화면이면 사람 말이 안 된다.** "화면 42개 중 31개 확인"은 아무 그림도 안 그려지지만
 * "결제: 5개 중 5개 확인 · 배송: 3개 중 0개"는 읽힌다. 그래서 앱 › 서비스로 접어 센다.
 *
 * 화면이 하나도 없는 앱·서비스도 **빠뜨리지 않는다** — 만들어만 두고 아직 안 그린 자리가
 * 목록에서 사라지면 "빠진 것"을 영영 못 본다.
 */

export interface StatusCount {
  total: number
  designed: number
  implemented: number
  verified: number
}

export interface SurfaceBrief {
  id: string
  key: string
  name: string
  description: string
  kind: string
  status: SurfaceStatus
  checkedAt: string
  checkedBy: string
  checkedNote: string
}

export interface ServiceSummary {
  id: string
  key: string
  name: string
  description: string
  counts: StatusCount
  surfaces: SurfaceBrief[]
}

export interface ApplicationSummary {
  id: string
  key: string
  name: string
  description: string
  counts: StatusCount
  services: ServiceSummary[]
}

export interface TreeSummary {
  applications: ApplicationSummary[]
  counts: StatusCount
}

const EMPTY: StatusCount = { total: 0, designed: 0, implemented: 0, verified: 0 }

/** 모르는 상태 값은 `designed` 로 본다 — 저장소가 열린 문자열이라 언제든 모르는 값이 올 수 있다. */
function normalize(status: string): SurfaceStatus {
  return status === 'implemented' || status === 'verified' ? status : 'designed'
}

function add(a: StatusCount, b: StatusCount): StatusCount {
  return {
    total: a.total + b.total,
    designed: a.designed + b.designed,
    implemented: a.implemented + b.implemented,
    verified: a.verified + b.verified
  }
}

function count(surfaces: SurfaceBrief[]): StatusCount {
  return surfaces.reduce(
    (acc, s) => ({ ...acc, total: acc.total + 1, [s.status]: acc[s.status] + 1 }),
    { ...EMPTY }
  )
}

export function summarizeTree(tree: SpecTree): TreeSummary {
  const applications = tree.applications.map((app) => {
    const services = tree.services
      .filter((s) => s.application_id === app.id)
      .map((svc) => {
        const surfaces: SurfaceBrief[] = tree.surfaces
          .filter((sf) => sf.service_id === svc.id)
          .map((sf) => ({
            id: sf.id,
            key: sf.key,
            name: sf.name,
            description: sf.description,
            kind: sf.kind,
            status: normalize(sf.status),
            checkedAt: sf.checked_at,
            checkedBy: sf.checked_by,
            checkedNote: sf.checked_note
          }))
        return {
          id: svc.id,
          key: svc.key,
          name: svc.name,
          description: svc.description,
          counts: count(surfaces),
          surfaces
        }
      })

    return {
      id: app.id,
      key: app.key,
      name: app.name,
      description: app.description,
      counts: services.reduce((acc, s) => add(acc, s.counts), { ...EMPTY }),
      services
    }
  })

  return {
    applications,
    counts: applications.reduce((acc, a) => add(acc, a.counts), { ...EMPTY })
  }
}

/**
 * 완성도 — **확인된 것만** 센다. 구현됐지만 확인 안 된 것을 완성으로 세면 "다 됐다"가 거짓이 된다.
 * 화면이 하나도 없으면 0(나눗셈 대신).
 */
export function completion(counts: StatusCount): number {
  return counts.total === 0 ? 0 : counts.verified / counts.total
}

/**
 * 눈에 띄어야 하는 것 — 화면이 있는데 **확인이 하나도 없는** 서비스. 이게 "빠진 곳" 목록이다.
 * 화면이 아직 없는 서비스는 여기 안 넣는다(그건 설계를 시작도 안 한 것이라 다른 이야기).
 */
export function gaps(summary: TreeSummary): { application: string; service: string; total: number }[] {
  const out: { application: string; service: string; total: number }[] = []
  for (const app of summary.applications) {
    for (const svc of app.services) {
      if (svc.counts.total > 0 && svc.counts.verified === 0) {
        out.push({ application: app.name, service: svc.name, total: svc.counts.total })
      }
    }
  }
  return out
}
