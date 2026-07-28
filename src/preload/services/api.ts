import { ipcRenderer } from 'electron'
import type { CreateSpecInput, SpecSummary, VersionRecord } from '../../main/store/apiSpecs'
import type {
  DeleteEnvironmentResult,
  ListRunsFilter,
  SaveEnvironmentInput
} from '../../main/store/apiOps'
import type { SendRequestInput, SendRequestResult } from '../../main/ipc/api/ops'
import type { ContractLog } from '../../main/store/apiContract'
import type { ImportPreview, ImportSourceKind } from '../../main/ipc/api/transfer'
import type { ApiChangedEvent } from '../../main/ai/apiTools'
import type { PatchOp } from '../../shared/api/patch'
import type { AbsorbPreview } from '../../shared/api/absorb'
import type { DriftResult } from '../../shared/api/drift'
import type { ExportFormat, ExportResult } from '../../shared/api/exportSpec'
import type { EnvironmentDef, RequestDef, RunRecord, SpecDef } from '../../shared/api/types'

// 메인 프로세스 타입을 렌더러 쪽으로 그대로 통과시킨다 — 화면이 main 을 직접 import 하지 않게.
export type {
  CreateSpecInput,
  SpecSummary,
  VersionRecord,
  ApiChangedEvent,
  SaveEnvironmentInput,
  DeleteEnvironmentResult,
  SendRequestInput,
  SendRequestResult,
  ListRunsFilter,
  ContractLog,
  AbsorbPreview,
  DriftResult,
  ImportPreview,
  ImportSourceKind,
  ExportFormat,
  ExportResult
}

/**
 * API 서비스가 렌더러에 여는 창구.
 *
 * 최상위 키는 `apiSpecs` — 다른 서비스와 겹치면 조립이 실패한다(preload/services/index.ts).
 * DB 서비스의 `store` 키(=`store:changed`)를 빌려 쓰지 않고 `api:changed` 를 따로 듣는 이유:
 * 서비스끼리 런타임으로 얽히면 병렬 개발의 전제가 깨진다.
 *
 * 이 채널들은 봉투(envelope) 규약이 아니라 값을 그대로 돌려주므로 unwrap 하지 않는다
 * (설계부 저장소 채널 관례 — `designs:*` 와 같다).
 */
export const apiApi = {
  apiSpecs: {
    list: (): Promise<SpecSummary[]> => ipcRenderer.invoke('api:listSpecs'),
    get: (id: string): Promise<SpecDef | null> => ipcRenderer.invoke('api:getSpec', id),
    create: (input: CreateSpecInput): Promise<SpecSummary> =>
      ipcRenderer.invoke('api:createSpec', input),
    update: (id: string, patch: { name: string; description: string }): Promise<SpecSummary> =>
      ipcRenderer.invoke('api:updateSpec', id, patch),
    /** 요청 전량 교체. 여기 없는 기존 요청은 삭제된다. */
    setRequests: (specId: string, requests: RequestDef[]): Promise<void> =>
      ipcRenderer.invoke('api:setSpec', specId, requests),
    /** 부분 수정 — 하나라도 실패하면 전부 미반영. 바뀐 것 목록을 돌려준다. */
    patch: (specId: string, ops: PatchOp[]): Promise<string[]> =>
      ipcRenderer.invoke('api:patchSpec', specId, ops),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('api:deleteSpec', id),

    listVersions: (specId: string): Promise<VersionRecord[]> =>
      ipcRenderer.invoke('api:listVersions', specId),
    createVersion: (specId: string, number: string, note?: string): Promise<VersionRecord> =>
      ipcRenderer.invoke('api:createVersion', specId, number, note),

    /** 에이전트(MCP) 쓰기 알림 — 열린 화면이 스코프만 다시 읽는다. 해지 함수를 돌려준다. */
    onChanged: (fn: (e: ApiChangedEvent) => void): (() => void) => {
      const listener = (_e: unknown, payload: ApiChangedEvent): void => fn(payload)
      ipcRenderer.on('api:changed', listener)
      return () => ipcRenderer.removeListener('api:changed', listener)
    }
  },

  /** 운영부 — 환경과 실행. 실행은 사람이 앱에서만 한다(MCP 에는 없다). */
  apiOps: {
    listEnvironments: (specId: string): Promise<EnvironmentDef[]> =>
      ipcRenderer.invoke('api:listEnvironments', specId),
    saveEnvironment: (input: SaveEnvironmentInput): Promise<EnvironmentDef> =>
      ipcRenderer.invoke('api:saveEnvironment', input),
    /** 구조만 복사한다 — 값·주소·운영 표식은 따라오지 않는다. */
    duplicateEnvironment: (id: string, name: string): Promise<EnvironmentDef> =>
      ipcRenderer.invoke('api:duplicateEnvironment', id, name),
    deleteEnvironment: (id: string): Promise<DeleteEnvironmentResult> =>
      ipcRenderer.invoke('api:deleteEnvironment', id),

    send: (input: SendRequestInput): Promise<SendRequestResult> =>
      ipcRenderer.invoke('api:send', input),
    listRuns: (specId: string, filter?: ListRunsFilter): Promise<RunRecord[]> =>
      ipcRenderer.invoke('api:listRuns', specId, filter),
    getRun: (specId: string, runId: string): Promise<RunRecord | null> =>
      ipcRenderer.invoke('api:getRun', specId, runId)
  },

  /** 판정 — 선언한 명세와 실제 서버가 어긋났는지. 흡수는 사람이 수락해야 반영된다. */
  apiContract: {
    runDrift: (specId: string, environmentId: string): Promise<DriftResult> =>
      ipcRenderer.invoke('api:runDrift', { specId, environmentId }),
    getDrift: (specId: string): Promise<ContractLog | null> =>
      ipcRenderer.invoke('api:getDrift', specId),
    listLogs: (specId: string): Promise<ContractLog[]> =>
      ipcRenderer.invoke('api:listContractLogs', specId),
    /** 미리보기만 만든다 — 이걸 부른다고 Draft 가 바뀌지 않는다. */
    previewAbsorb: (specId: string, environmentId: string, requestNames: string[]): Promise<AbsorbPreview> =>
      ipcRenderer.invoke('api:previewAbsorb', specId, environmentId, requestNames),
    acceptAbsorb: (specId: string, environmentId: string, requestNames: string[]): Promise<AbsorbPreview> =>
      ipcRenderer.invoke('api:acceptAbsorb', specId, environmentId, requestNames)
  },

  /** 가져오기·내보내기 — 기존 자산을 물리고, 내보낸 파일에는 값이 실리지 않는다. */
  apiTransfer: {
    /** 미리보기는 아무것도 바꾸지 않는다 — 추가/충돌/미해석을 보여 줄 뿐. */
    preview: (kind: ImportSourceKind, source: string, intoSpecId?: string): Promise<ImportPreview> =>
      ipcRenderer.invoke('api:previewImport', kind, source, intoSpecId),
    run: (kind: ImportSourceKind, source: string, intoSpecId?: string): Promise<{ specId: string; added: number }> =>
      ipcRenderer.invoke('api:import', kind, source, intoSpecId),
    export: (specId: string, format: ExportFormat): Promise<ExportResult> =>
      ipcRenderer.invoke('api:export', specId, format)
  }
}
