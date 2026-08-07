import { ipcRenderer } from 'electron'
import { unwrap } from '../envelope'
import type { ConnectionGroupRecord, ConnectionRecord, DbType } from '../../main/store/connections'
import type { SampleResult, SampleStatus } from '../../shared/db/samplePlan'
import type { ConnectionFormData, TestConnectionResult } from '../../main/services/connectionService'
import type { EnvironmentRecord } from '../../main/store/environments'
import type { IntrospectedSchema } from '../../main/services/introspection/types'
import type { QueryResult, TxBeginResult, ExplainResult } from '../../main/services/queryService'
import type { AppendHistoryInput, QueryHistoryRecord } from '../../main/store/queryHistory'
import type { FolderRecord, SavedQueryRecord } from '../../main/store/savedQueries'
import type { LibraryScope } from '../../main/store/libraryScope'
import type { CollectionRecord, CollectionItemRecord, CollectionFolderRecord } from '../../main/store/collections'
import type { DiagramLayoutRecord, SaveLayoutInput } from '../../main/store/diagramLayouts'
import type {
  CreateLogInput,
  CreateSnapshotInput,
  MigrationLogRecord,
  SnapshotRecord
} from '../../main/store/migration'
import type { StoreChangedEvent } from '../../shared/storeChanged'

// 메인 프로세스 타입을 렌더러 쪽으로 그대로 통과시킨다 — 화면이 main 을 직접 import 하지 않게.
export type {
  ConnectionGroupRecord,
  ConnectionRecord,
  ConnectionFormData,
  TestConnectionResult,
  EnvironmentRecord,
  LibraryScope,
  DbType
}

/** 로컬 메타 저장소의 설계 레코드 (main/store/designs 와 동일 형태). */
export interface DesignRecord {
  id: string
  name: string
  description: string
  dialect: string
  created_at: string
  /** 속한 프로젝트. null 이면 무소속. */
  project_id: string | null
}
export interface CreateDesignInput {
  name: string
  description?: string
  dialect: string
  /** 만들 때 보고 있던 프로젝트. 안 주면 무소속. */
  projectId?: string | null
}

/** 테이블 정의 레코드 (main/store/tables 와 동일 형태). */
export interface TableRecord {
  id: string
  designId: string
  name: string
  comment: string
  columns: unknown[]
  constraints: unknown[]
  /** 뷰(view)면 true — 역설계로 들여왔거나 설계부에서 선언했거나. */
  isView?: boolean
  /** 뷰 본문 SELECT(`CREATE VIEW … AS` 뒷부분). 뷰일 때만 의미. */
  viewSql?: string
}

/** 시드 세트 레코드 (main/store/seedSets 와 동일 형태). 컬럼은 이름으로 가리킨다. */
export interface SeedSetRecord {
  designId: string
  tableName: string
  naturalKey: string[]
  ignoredColumns: string[]
  strength: string
  rows: unknown[]
}

/** 환경 변수 정보 — **값(평문)은 담기지 않는다.** */
export interface EnvVariableInfo {
  envId: string
  name: string
  hasValue: boolean
  updatedAt: string
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

/**
 * DB 서비스가 렌더러에 여는 창구.
 *   designs/tables/versions/seedSets/envVars — 로컬 SQLite 메타 저장소(설계부) · raw invoke
 *   connections/connectionGroups — 원시 접속(1급) CRUD + 연결 테스트 — Remote 구동 (봉투)
 *   environments — (connection×design) 바인딩 — Migration 전용 (봉투)
 *   introspection/query/savedQueries/collections/migration/diagram — 실 DB 역설계·실행·마이그레이션 (봉투)
 *
 * 새 창구가 필요하면 이 파일에만 더한다 — `src/preload/index.ts` 나 다른 서비스 파일은
 * 건드리지 않는다(파일 소유권 — `docs/agents/parallel-dev.md`).
 */
export const dbApi = {
  designs: {
    list: (): Promise<DesignRecord[]> => ipcRenderer.invoke('designs:list'),
    create: (input: CreateDesignInput): Promise<DesignRecord> =>
      ipcRenderer.invoke('designs:create', input),
    update: (
      id: string,
      patch: { name?: string; description?: string; schemas?: string[]; projectId?: string | null }
    ): Promise<DesignRecord> => ipcRenderer.invoke('designs:update', id, patch),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('designs:delete', id)
  },
  tables: {
    list: (): Promise<TableRecord[]> => ipcRenderer.invoke('tables:list'),
    // 설계 스코프 저장 — 전량 교체(replaceAll)는 제거됨(에이전트·화면 동시 작업 경합 차단).
    replaceForDesign: (designId: string, records: TableRecord[]): Promise<void> =>
      ipcRenderer.invoke('tables:replaceForDesign', designId, records)
  },
  seedSets: {
    list: (): Promise<SeedSetRecord[]> => ipcRenderer.invoke('seedSets:list'),
    // tables 와 같은 설계 스코프 저장 — 설계 X 저장이 설계 Y 시드를 건드리지 않는다.
    replaceForDesign: (designId: string, records: SeedSetRecord[]): Promise<void> =>
      ipcRenderer.invoke('seedSets:replaceForDesign', designId, records)
  },
  envVars: {
    list: (envId: string): Promise<EnvVariableInfo[]> => ipcRenderer.invoke('envVars:list', envId),
    set: (envId: string, name: string, value: string): Promise<void> =>
      ipcRenderer.invoke('envVars:set', envId, name, value),
    delete: (envId: string, name: string): Promise<void> =>
      ipcRenderer.invoke('envVars:delete', envId, name),
    /** 반영 직전에만 — 평문 값. 화면에 그대로 보이지 않게 다룬다. */
    resolve: (envId: string): Promise<Record<string, string>> =>
      ipcRenderer.invoke('envVars:resolve', envId)
  },
  // 메인발 저장소 변경 알림(MCP 에이전트 쓰기) — 구독 해제 함수를 반환한다.
  store: {
    onChanged: (cb: (e: StoreChangedEvent) => void): (() => void) => {
      const listener = (_ev: Electron.IpcRendererEvent, e: StoreChangedEvent): void => cb(e)
      ipcRenderer.on('store:changed', listener)
      return () => ipcRenderer.removeListener('store:changed', listener)
    }
  },
  versions: {
    list: (designId: string): Promise<VersionRecord[]> =>
      ipcRenderer.invoke('versions:list', designId),
    create: (input: CreateVersionInput): Promise<VersionRecord> =>
      ipcRenderer.invoke('versions:create', input),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('versions:delete', id),
    // 메모만 고칠 수 있다 — 스냅샷과 번호는 불변이다(`store/versions.updateVersionNote` 주석).
    updateNote: (id: string, note: string): Promise<void> =>
      ipcRenderer.invoke('versions:updateNote', id, note)
  },
  // 운영부 — 원시 접속(1급). 설계 무관, Remote 구동.
  connections: {
    list: (): Promise<ConnectionRecord[]> => unwrap(ipcRenderer.invoke('connections:list')),
    create: (form: ConnectionFormData): Promise<ConnectionRecord> =>
      unwrap(ipcRenderer.invoke('connections:create', form)),
    update: (id: string, form: Partial<ConnectionFormData>): Promise<ConnectionRecord> =>
      unwrap(ipcRenderer.invoke('connections:update', id, form)),
    delete: (id: string): Promise<void> => unwrap(ipcRenderer.invoke('connections:delete', id)),
    reorder: (orderedIds: string[]): Promise<void> =>
      unwrap(ipcRenderer.invoke('connections:reorder', orderedIds)),
    move: (id: string, groupId: string | null, orderedIds: string[]): Promise<ConnectionRecord> =>
      unwrap(ipcRenderer.invoke('connections:move', id, groupId, orderedIds)),
    test: (form: ConnectionFormData): Promise<TestConnectionResult> =>
      unwrap(ipcRenderer.invoke('connections:test', form)),
    testById: (id: string): Promise<TestConnectionResult> =>
      unwrap(ipcRenderer.invoke('connections:testById', id)),
    revealPassword: (id: string): Promise<string> =>
      unwrap(ipcRenderer.invoke('connections:revealPassword', id)),
    // 샘플 DB — 준비물 없이 써 보는 SQLite 하나(만들기는 없는 쪽만, 다시 만들기는 파일만).
    sampleStatus: (): Promise<SampleStatus> => unwrap(ipcRenderer.invoke('connections:sampleStatus')),
    createSample: (): Promise<SampleResult> => unwrap(ipcRenderer.invoke('connections:createSample')),
    resetSample: (): Promise<SampleResult> => unwrap(ipcRenderer.invoke('connections:resetSample'))
  },
  // 운영부 — 접속 카드 그룹(분류). 삭제 시 소속 연결은 미분류로.
  connectionGroups: {
    list: (): Promise<ConnectionGroupRecord[]> => unwrap(ipcRenderer.invoke('connectionGroups:list')),
    create: (name: string): Promise<ConnectionGroupRecord> =>
      unwrap(ipcRenderer.invoke('connectionGroups:create', name)),
    rename: (id: string, name: string): Promise<ConnectionGroupRecord> =>
      unwrap(ipcRenderer.invoke('connectionGroups:rename', id, name)),
    reorder: (orderedIds: string[]): Promise<void> =>
      unwrap(ipcRenderer.invoke('connectionGroups:reorder', orderedIds)),
    delete: (id: string): Promise<void> => unwrap(ipcRenderer.invoke('connectionGroups:delete', id))
  },
  // 운영부 — (connection×design) 바인딩. Migration 전용.
  environments: {
    find: (connectionId: string, designId: string): Promise<EnvironmentRecord | null> =>
      unwrap(ipcRenderer.invoke('environments:find', connectionId, designId)),
    listByConnection: (connectionId: string): Promise<EnvironmentRecord[]> =>
      unwrap(ipcRenderer.invoke('environments:listByConnection', connectionId)),
    delete: (id: string): Promise<void> =>
      unwrap(ipcRenderer.invoke('environments:delete', id)),
    ensure: (connectionId: string, designId: string, targetVersion: string): Promise<EnvironmentRecord> =>
      unwrap(ipcRenderer.invoke('environments:ensure', connectionId, designId, targetVersion)),
    setTarget: (id: string, version: string): Promise<EnvironmentRecord> =>
      unwrap(ipcRenderer.invoke('environments:setTarget', id, version)),
    setApplied: (id: string, version: string): Promise<EnvironmentRecord> =>
      unwrap(ipcRenderer.invoke('environments:setApplied', id, version))
  },
  // 운영부 — 실 DB 역설계(introspection). 활성 Connection 의 스키마를 IR 로 읽는다.
  introspection: {
    /** `schemas` 를 주면 그 범위를, 안 주면 연결에 저장된 범위를 읽는다. */
    run: (connectionId: string, schemas?: string[]): Promise<IntrospectedSchema> =>
      unwrap(ipcRenderer.invoke('introspection:run', connectionId, schemas)),
    /** 이 연결에서 고를 수 있는 스키마 목록(시스템 스키마 제외). */
    schemas: (connectionId: string): Promise<string[]> =>
      unwrap(ipcRenderer.invoke('introspection:schemas', connectionId)),
    /** 이 서버의 카탈로그(database) 목록 — PostgreSQL 만 채워져 온다. */
    catalogs: (connectionId: string): Promise<string[]> =>
      unwrap(ipcRenderer.invoke('introspection:catalogs', connectionId))
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
  // 저장 쿼리 라이브러리(폴더 트리). 소속은 **설계 아니면 연결** — 설계 화면은 `designId`,
  // 운영 화면은 `connectionId` 를 준다(연결로 주면 물린 설계 것까지 함께 온다).
  savedQueries: {
    tree: (scope: LibraryScope): Promise<{ folders: FolderRecord[]; queries: SavedQueryRecord[] }> =>
      unwrap(ipcRenderer.invoke('sq:tree', scope)),
    createFolder: (input: { scope: LibraryScope; parentId: string | null; name: string }): Promise<FolderRecord> =>
      unwrap(ipcRenderer.invoke('sq:createFolder', input)),
    createQuery: (input: { scope: LibraryScope; folderId: string | null; name: string; sql: string }): Promise<SavedQueryRecord> =>
      unwrap(ipcRenderer.invoke('sq:createQuery', input)),
    renameFolder: (id: string, name: string): Promise<void> => unwrap(ipcRenderer.invoke('sq:renameFolder', id, name)),
    updateQuery: (id: string, patch: { name?: string; description?: string; sql?: string }): Promise<void> =>
      unwrap(ipcRenderer.invoke('sq:updateQuery', id, patch)),
    deleteFolder: (id: string): Promise<void> => unwrap(ipcRenderer.invoke('sq:deleteFolder', id)),
    deleteQuery: (id: string): Promise<void> => unwrap(ipcRenderer.invoke('sq:deleteQuery', id)),
    reorderTree: (items: { id: string; kind: 'folder' | 'query'; parentId: string | null; sortOrder: number }[]): Promise<void> =>
      unwrap(ipcRenderer.invoke('sq:reorderTree', items))
  },
  // 컬렉션(순서 있는 쿼리 묶음 · Run-All). 소속은 저장쿼리와 같다.
  collections: {
    list: (scope: LibraryScope): Promise<CollectionRecord[]> => unwrap(ipcRenderer.invoke('col:list', scope)),
    folders: (scope: LibraryScope): Promise<CollectionFolderRecord[]> => unwrap(ipcRenderer.invoke('col:folders', scope)),
    items: (collectionId: string): Promise<CollectionItemRecord[]> => unwrap(ipcRenderer.invoke('col:items', collectionId)),
    create: (input: { scope: LibraryScope; name: string; folderId?: string | null }): Promise<CollectionRecord> => unwrap(ipcRenderer.invoke('col:create', input)),
    createFolder: (input: { scope: LibraryScope; parentId: string | null; name: string }): Promise<CollectionFolderRecord> => unwrap(ipcRenderer.invoke('col:createFolder', input)),
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
  // 운영부 — Remote 실 ERD 레이아웃(연결별 노드 위치·뷰포트) 영속.
  diagram: {
    getLayout: (connectionId: string): Promise<DiagramLayoutRecord | null> =>
      unwrap(ipcRenderer.invoke('diagram:getLayout', connectionId)),
    saveLayout: (input: SaveLayoutInput): Promise<DiagramLayoutRecord> =>
      unwrap(ipcRenderer.invoke('diagram:saveLayout', input)),
    clearLayout: (connectionId: string): Promise<void> =>
      unwrap(ipcRenderer.invoke('diagram:clearLayout', connectionId))
  }
}
