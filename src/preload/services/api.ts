import { ipcRenderer } from 'electron'
import type { CreateSpecInput, SpecSummary, VersionRecord } from '../../main/store/apiSpecs'
import type {
  DeleteEnvironmentResult,
  ListRunsFilter,
  SaveEnvironmentInput
} from '../../main/store/apiOps'
import type { SendRequestInput, SendRequestResult } from '../../main/ipc/api/ops'
import type {
  OpenStreamInput,
  OpenStreamResult,
  StreamEndedEvent
} from '../../main/ipc/api/stream'
import type { ContractLog } from '../../main/store/apiContract'
import type { ImportPreview, ImportSourceKind } from '../../main/ipc/api/transfer'
import type { ApiChangedEvent } from '../../main/ai/apiTools'
import type { PatchOp } from '../../shared/api/patch'
import type { AbsorbPreview } from '../../shared/api/absorb'
import type { DriftResult } from '../../shared/api/drift'
import type { ExportFormat, ExportResult } from '../../shared/api/exportSpec'
import type { SessionEvent } from '../../main/api/streamSession'
import type { EnvironmentDef, RequestDef, RunRecord, SpecDef, StreamMessage } from '../../shared/api/types'

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
  OpenStreamInput,
  OpenStreamResult,
  SessionEvent,
  StreamEndedEvent,
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

  /**
   * 스트림 세션 — 오래 살고 스스로 끝날 수도 있어서 **응답이 아니라 이벤트**로 온다.
   * 세션은 메인이 들고 있으므로 화면을 나갔다 와도 안 끊긴다.
   */
  apiStream: {
    open: (input: OpenStreamInput): Promise<OpenStreamResult> =>
      ipcRenderer.invoke('api:openStream', input),
    /** 양방향 세션에만 있다. 보낸 글자의 `{{변수}}` 는 메인이 실값으로 바꿔 내보낸다. */
    send: (sessionId: string, text: string): Promise<StreamMessage> =>
      ipcRenderer.invoke('api:sendStream', sessionId, text),
    close: (sessionId: string): Promise<void> => ipcRenderer.invoke('api:closeStream', sessionId),
    /** 남은 세션 전부 정리 — 렌더러가 새로 뜰 때 부른다(주인 없는 소켓을 남기지 않는다). */
    closeAll: (): Promise<void> => ipcRenderer.invoke('api:closeAllStreams'),

    /** 상태 변화·새 메시지. 해지 함수를 돌려준다. */
    onEvent: (fn: (e: SessionEvent) => void): (() => void) => {
      const listener = (_e: unknown, payload: SessionEvent): void => fn(payload)
      ipcRenderer.on('api:stream', listener)
      return () => ipcRenderer.removeListener('api:stream', listener)
    },
    /** 세션이 끝나 Run 으로 굳었을 때. 사용자가 껐든 서버가 끊었든 여기로 온다. */
    onEnded: (fn: (e: StreamEndedEvent) => void): (() => void) => {
      const listener = (_e: unknown, payload: StreamEndedEvent): void => fn(payload)
      ipcRenderer.on('api:streamEnded', listener)
      return () => ipcRenderer.removeListener('api:streamEnded', listener)
    }
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
