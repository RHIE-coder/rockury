import { contextBridge, ipcRenderer } from 'electron'
import type { Envelope } from '../main/ipc/envelope'
import type { ConnectionRecord, DbType } from '../main/store/connections'
import type { ConnectionFormData, TestConnectionResult } from '../main/services/connectionService'
import type { EnvironmentRecord } from '../main/store/environments'
import type { IntrospectedSchema } from '../main/services/introspection/types'
import type { QueryResult, TxBeginResult, ExplainResult } from '../main/services/queryService'
import type { AppendHistoryInput, QueryHistoryRecord } from '../main/store/queryHistory'
import type { FolderRecord, SavedQueryRecord } from '../main/store/savedQueries'
import type { CollectionRecord, CollectionItemRecord, CollectionFolderRecord } from '../main/store/collections'
import type { DiagramLayoutRecord, SaveLayoutInput } from '../main/store/diagramLayouts'
import type {
  CreateLogInput,
  CreateSnapshotInput,
  MigrationLogRecord,
  SnapshotRecord
} from '../main/store/migration'

/** 봉투 IPC 언랩 — 성공 시 data, 실패 시 throw. 운영부(ops) 채널 규약. */
async function unwrap<T>(p: Promise<Envelope<T>>): Promise<T> {
  const res = await p
  if (!res.success) throw new Error(res.error ?? 'IPC 호출에 실패했습니다.')
  return res.data as T
}

/** 로컬 메타 저장소의 설계 레코드 (main/store/designs 와 동일 형태). */
export interface DesignRecord {
  id: string
  name: string
  description: string
  dialect: string
  created_at: string
}
export interface CreateDesignInput {
  name: string
  description?: string
  dialect: string
}

/** 테이블 정의 레코드 (main/store/tables 와 동일 형태). */
export interface TableRecord {
  id: string
  designId: string
  name: string
  comment: string
  columns: unknown[]
  constraints: unknown[]
}

/** 버전 스냅샷 레코드 (main/store/versions 와 동일 형태). */
export interface VersionRecord {
  id: string
  designId: string
  number: string
  note: string
  snapshot: unknown
  locked: boolean
  createdAt: string
}
export interface CreateVersionInput {
  designId: string
  number: string
  note?: string
  snapshot: unknown
}

export type { ConnectionRecord, ConnectionFormData, TestConnectionResult, EnvironmentRecord, DbType }

/**
 * 렌더러에 노출되는 안전한 API 표면.
 *   window       — 프레임리스 창 제어
 *   designs/tables/versions — 로컬 SQLite 메타 저장소(설계) — raw invoke
 *   connections  — 원시 접속(1급) CRUD + 연결 테스트 — Console 구동 (봉투)
 *   environments — (connection×design) 바인딩 — Migration 전용 (봉투)
 *   introspection/query/migration — 실 DB 역설계·실행·마이그레이션 (봉투)
 */
const api = {
  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
    close: (): void => ipcRenderer.send('window:close')
  },
  designs: {
    list: (): Promise<DesignRecord[]> => ipcRenderer.invoke('designs:list'),
    create: (input: CreateDesignInput): Promise<DesignRecord> =>
      ipcRenderer.invoke('designs:create', input),
    update: (id: string, patch: { name: string; description: string }): Promise<DesignRecord> =>
      ipcRenderer.invoke('designs:update', id, patch),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('designs:delete', id)
  },
  tables: {
    list: (): Promise<TableRecord[]> => ipcRenderer.invoke('tables:list'),
    replaceAll: (records: TableRecord[]): Promise<void> =>
      ipcRenderer.invoke('tables:replaceAll', records)
  },
  versions: {
    list: (designId: string): Promise<VersionRecord[]> =>
      ipcRenderer.invoke('versions:list', designId),
    create: (input: CreateVersionInput): Promise<VersionRecord> =>
      ipcRenderer.invoke('versions:create', input)
  },
  // 운영부 — 원시 접속(1급). 설계 무관, Console 구동.
  connections: {
    list: (): Promise<ConnectionRecord[]> => unwrap(ipcRenderer.invoke('connections:list')),
    create: (form: ConnectionFormData): Promise<ConnectionRecord> =>
      unwrap(ipcRenderer.invoke('connections:create', form)),
    update: (id: string, form: Partial<ConnectionFormData>): Promise<ConnectionRecord> =>
      unwrap(ipcRenderer.invoke('connections:update', id, form)),
    delete: (id: string): Promise<void> => unwrap(ipcRenderer.invoke('connections:delete', id)),
    reorder: (orderedIds: string[]): Promise<void> =>
      unwrap(ipcRenderer.invoke('connections:reorder', orderedIds)),
    test: (form: ConnectionFormData): Promise<TestConnectionResult> =>
      unwrap(ipcRenderer.invoke('connections:test', form)),
    testById: (id: string): Promise<TestConnectionResult> =>
      unwrap(ipcRenderer.invoke('connections:testById', id))
  },
  // 운영부 — (connection×design) 바인딩. Migration 전용.
  environments: {
    find: (connectionId: string, designId: string): Promise<EnvironmentRecord | null> =>
      unwrap(ipcRenderer.invoke('environments:find', connectionId, designId)),
    ensure: (connectionId: string, designId: string, targetVersion: string): Promise<EnvironmentRecord> =>
      unwrap(ipcRenderer.invoke('environments:ensure', connectionId, designId, targetVersion)),
    setTarget: (id: string, version: string): Promise<EnvironmentRecord> =>
      unwrap(ipcRenderer.invoke('environments:setTarget', id, version)),
    setApplied: (id: string, version: string): Promise<EnvironmentRecord> =>
      unwrap(ipcRenderer.invoke('environments:setApplied', id, version))
  },
  // 운영부 — 실 DB 역설계(introspection). 활성 Connection 의 스키마를 IR 로 읽는다.
  introspection: {
    run: (connectionId: string): Promise<IntrospectedSchema> =>
      unwrap(ipcRenderer.invoke('introspection:run', connectionId))
  },
  // 운영부 — 쿼리 실행 + 트랜잭션 파괴 게이트(활성 Connection 대상).
  query: {
    run: (connectionId: string, sql: string): Promise<QueryResult> =>
      unwrap(ipcRenderer.invoke('query:run', connectionId, sql)),
    runParams: (connectionId: string, sql: string, params: unknown[]): Promise<QueryResult> =>
      unwrap(ipcRenderer.invoke('query:runParams', connectionId, sql, params)),
    txBegin: (connectionId: string): Promise<TxBeginResult> =>
      unwrap(ipcRenderer.invoke('query:txBegin', connectionId)),
    txExec: (txId: string, sql: string): Promise<QueryResult> =>
      unwrap(ipcRenderer.invoke('query:txExec', txId, sql)),
    txExecParams: (txId: string, sql: string, params: unknown[]): Promise<QueryResult> =>
      unwrap(ipcRenderer.invoke('query:txExecParams', txId, sql, params)),
    txCommit: (txId: string): Promise<void> => unwrap(ipcRenderer.invoke('query:txCommit', txId)),
    txRollback: (txId: string): Promise<void> =>
      unwrap(ipcRenderer.invoke('query:txRollback', txId)),
    explain: (connectionId: string, sql: string): Promise<ExplainResult> =>
      unwrap(ipcRenderer.invoke('query:explain', connectionId, sql)),
    historyAppend: (input: AppendHistoryInput): Promise<QueryHistoryRecord> =>
      unwrap(ipcRenderer.invoke('query:historyAppend', input)),
    historyList: (connectionId: string): Promise<QueryHistoryRecord[]> =>
      unwrap(ipcRenderer.invoke('query:historyList', connectionId)),
    historyClear: (connectionId: string): Promise<void> =>
      unwrap(ipcRenderer.invoke('query:historyClear', connectionId))
  },
  // 운영부 — 저장 쿼리 라이브러리(폴더 트리).
  savedQueries: {
    tree: (connectionId: string): Promise<{ folders: FolderRecord[]; queries: SavedQueryRecord[] }> =>
      unwrap(ipcRenderer.invoke('sq:tree', connectionId)),
    createFolder: (input: { connectionId: string; parentId: string | null; name: string }): Promise<FolderRecord> =>
      unwrap(ipcRenderer.invoke('sq:createFolder', input)),
    createQuery: (input: { connectionId: string; folderId: string | null; name: string; sql: string }): Promise<SavedQueryRecord> =>
      unwrap(ipcRenderer.invoke('sq:createQuery', input)),
    renameFolder: (id: string, name: string): Promise<void> => unwrap(ipcRenderer.invoke('sq:renameFolder', id, name)),
    updateQuery: (id: string, patch: { name?: string; description?: string; sql?: string }): Promise<void> =>
      unwrap(ipcRenderer.invoke('sq:updateQuery', id, patch)),
    deleteFolder: (id: string): Promise<void> => unwrap(ipcRenderer.invoke('sq:deleteFolder', id)),
    deleteQuery: (id: string): Promise<void> => unwrap(ipcRenderer.invoke('sq:deleteQuery', id)),
    reorderTree: (items: { id: string; kind: 'folder' | 'query'; parentId: string | null; sortOrder: number }[]): Promise<void> =>
      unwrap(ipcRenderer.invoke('sq:reorderTree', items))
  },
  // 운영부 — 컬렉션(순서 있는 쿼리 묶음 · Run-All).
  collections: {
    list: (connectionId: string): Promise<CollectionRecord[]> => unwrap(ipcRenderer.invoke('col:list', connectionId)),
    folders: (connectionId: string): Promise<CollectionFolderRecord[]> => unwrap(ipcRenderer.invoke('col:folders', connectionId)),
    items: (collectionId: string): Promise<CollectionItemRecord[]> => unwrap(ipcRenderer.invoke('col:items', collectionId)),
    create: (input: { connectionId: string; name: string; folderId?: string | null }): Promise<CollectionRecord> => unwrap(ipcRenderer.invoke('col:create', input)),
    createFolder: (input: { connectionId: string; parentId: string | null; name: string }): Promise<CollectionFolderRecord> => unwrap(ipcRenderer.invoke('col:createFolder', input)),
    rename: (id: string, name: string): Promise<void> => unwrap(ipcRenderer.invoke('col:rename', id, name)),
    update: (id: string, patch: { name?: string; description?: string }): Promise<void> => unwrap(ipcRenderer.invoke('col:update', id, patch)),
    renameFolder: (id: string, name: string): Promise<void> => unwrap(ipcRenderer.invoke('col:renameFolder', id, name)),
    deleteFolder: (id: string): Promise<void> => unwrap(ipcRenderer.invoke('col:deleteFolder', id)),
    reorderTree: (items: { id: string; kind: 'folder' | 'collection'; parentId: string | null; sortOrder: number }[]): Promise<void> => unwrap(ipcRenderer.invoke('col:reorderTree', items)),
    delete: (id: string): Promise<void> => unwrap(ipcRenderer.invoke('col:delete', id)),
    addItem: (input: { collectionId: string; name: string; sql: string }): Promise<CollectionItemRecord> =>
      unwrap(ipcRenderer.invoke('col:addItem', input)),
    addReference: (input: { collectionId: string; savedQueryId: string }): Promise<CollectionItemRecord> =>
      unwrap(ipcRenderer.invoke('col:addReference', input)),
    updateItem: (id: string, patch: { name?: string; sql?: string }): Promise<void> => unwrap(ipcRenderer.invoke('col:updateItem', id, patch)),
    deleteItem: (id: string): Promise<void> => unwrap(ipcRenderer.invoke('col:deleteItem', id)),
    reorderItems: (orderedIds: string[]): Promise<void> => unwrap(ipcRenderer.invoke('col:reorderItems', orderedIds))
  },
  // 운영부 — Migration 스냅샷 기준선 + 로그 체인(환경 바인딩 id 로 키).
  migration: {
    saveSnapshot: (input: CreateSnapshotInput): Promise<SnapshotRecord> =>
      unwrap(ipcRenderer.invoke('migration:saveSnapshot', input)),
    latestSnapshot: (envId: string): Promise<SnapshotRecord | null> =>
      unwrap(ipcRenderer.invoke('migration:latestSnapshot', envId)),
    appendLog: (input: CreateLogInput): Promise<MigrationLogRecord> =>
      unwrap(ipcRenderer.invoke('migration:appendLog', input)),
    listLogs: (envId: string): Promise<MigrationLogRecord[]> =>
      unwrap(ipcRenderer.invoke('migration:listLogs', envId))
  },
  // 운영부 — Console 실 ERD 레이아웃(연결별 노드 위치·뷰포트) 영속.
  diagram: {
    getLayout: (connectionId: string): Promise<DiagramLayoutRecord | null> =>
      unwrap(ipcRenderer.invoke('diagram:getLayout', connectionId)),
    saveLayout: (input: SaveLayoutInput): Promise<DiagramLayoutRecord> =>
      unwrap(ipcRenderer.invoke('diagram:saveLayout', input)),
    clearLayout: (connectionId: string): Promise<void> =>
      unwrap(ipcRenderer.invoke('diagram:clearLayout', connectionId))
  }
}

export type RockuryApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('rockury', api)
} else {
  ;(globalThis as unknown as { rockury: RockuryApi }).rockury = api
}
