import { ipcRenderer } from 'electron'
import { unwrap } from '../envelope'
import type { CatalogSource, ProviderPublic, RunOutcome } from '../../main/ipc/infra/contract'
import type { RunProbeInput } from '../../main/ipc/infra'
import type {
  CatalogRow,
  DesignRow,
  EdgeRow,
  NodeRow,
  ProbeOutcomeRow,
  ResourceRow,
  RunRow,
  SaveCatalogInput,
  SnapshotRow
} from '../../main/ipc/infra/store'

// 메인 프로세스 타입을 렌더러 쪽으로 통과시킨다 — 화면이 main 을 직접 import 하지 않게.
export type {
  CatalogSource,
  ProviderPublic,
  RunOutcome,
  CatalogRow,
  DesignRow,
  EdgeRow,
  NodeRow,
  RunRow,
  SaveCatalogInput,
  RunProbeInput,
  ProbeOutcomeRow,
  ResourceRow,
  SnapshotRow
}

/** 그래프에 오가는 형태 — 설계 id 는 인자로 따로 넘긴다. */
export type GraphNode = Omit<NodeRow, 'designId'>
export type GraphEdge = Omit<EdgeRow, 'designId'>

/**
 * Infra 서비스가 렌더러에 여는 창구.
 *
 * 최상위 키는 `infra` 하나 — 다른 서비스와 겹치면 조립이 실패한다(preload 네임스페이스 규칙).
 * 자격증명은 **넣는 길만 있고 꺼내는 길이 없다** — 평문을 렌더러로 돌려주는 채널을 아예 만들지 않았다.
 */
export const infraApi = {
  infra: {
    // 카탈로그
    listCatalogs: (): Promise<CatalogRow[]> => unwrap(ipcRenderer.invoke('infra:listCatalogs')),
    saveCatalog: (input: SaveCatalogInput): Promise<CatalogRow> =>
      unwrap(ipcRenderer.invoke('infra:saveCatalog', input)),
    deleteCatalog: (id: string): Promise<void> =>
      unwrap(ipcRenderer.invoke('infra:deleteCatalog', id)),

    // 공급자 연결
    listProviders: (): Promise<ProviderPublic[]> =>
      unwrap(ipcRenderer.invoke('infra:listProviders')),
    saveProvider: (input: {
      id?: string
      catalogId: string
      name: string
      readOnly: boolean
      credentials?: Record<string, string>
    }): Promise<ProviderPublic> => unwrap(ipcRenderer.invoke('infra:saveProvider', input)),
    deleteProvider: (id: string): Promise<void> =>
      unwrap(ipcRenderer.invoke('infra:deleteProvider', id)),

    // 설계본
    listDesigns: (): Promise<DesignRow[]> => unwrap(ipcRenderer.invoke('infra:listDesigns')),
    createDesign: (input: { name: string; description?: string }): Promise<DesignRow> =>
      unwrap(ipcRenderer.invoke('infra:createDesign', input)),
    updateDesign: (id: string, patch: { name?: string; description?: string }): Promise<void> =>
      unwrap(ipcRenderer.invoke('infra:updateDesign', id, patch)),
    deleteDesign: (id: string): Promise<void> =>
      unwrap(ipcRenderer.invoke('infra:deleteDesign', id)),
    getGraph: (designId: string): Promise<{ nodes: NodeRow[]; edges: EdgeRow[] }> =>
      unwrap(ipcRenderer.invoke('infra:getGraph', designId)),
    saveGraph: (designId: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void> =>
      unwrap(ipcRenderer.invoke('infra:saveGraph', designId, nodes, edges)),

    // 실물 스냅샷
    saveSnapshot: (input: {
      providerId: string
      probes: ProbeOutcomeRow[]
      resources: ResourceRow[]
    }): Promise<SnapshotRow> => unwrap(ipcRenderer.invoke('infra:saveSnapshot', input)),
    latestSnapshot: (providerId: string): Promise<SnapshotRow | null> =>
      unwrap(ipcRenderer.invoke('infra:latestSnapshot', providerId)),

    // 탐침 실행·이력
    runProbe: (input: RunProbeInput): Promise<RunOutcome> =>
      unwrap(ipcRenderer.invoke('infra:runProbe', input)),
    listRuns: (limit?: number): Promise<RunRow[]> =>
      unwrap(ipcRenderer.invoke('infra:listRuns', limit))
  }
}
