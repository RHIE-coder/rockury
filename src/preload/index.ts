import { contextBridge, ipcRenderer } from 'electron'
import type { Envelope } from '../main/ipc/envelope'
import type { IntrospectedSchema } from '../main/services/introspection/types'
import type { QueryResult, TxBeginResult } from '../main/services/queryService'
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

export type EnvDbType = 'postgresql' | 'mysql' | 'mariadb' | 'sqlite'

/** 환경 레코드 (main/store/environments 와 동일 형태 — 비밀번호는 노출 안 됨). */
export interface EnvironmentRecord {
  id: string
  designId: string
  name: string
  dbType: EnvDbType
  host: string
  port: number
  database: string
  user: string
  sslEnabled: boolean
  sslConfig?: Record<string, unknown>
  targetVersion: string
  appliedVersion: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 환경 폼 — 평문 password 포함(main 에서 암호화). */
export interface EnvironmentFormData {
  designId: string
  name: string
  dbType: EnvDbType
  host: string
  port: number
  database: string
  user: string
  password: string
  sslEnabled: boolean
  sslConfig?: Record<string, unknown>
  targetVersion: string
}

export interface TestConnectionResult {
  success: boolean
  message: string
  latencyMs?: number
  serverVersion?: string
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

/**
 * 렌더러에 노출되는 안전한 API 표면.
 *   window   — 프레임리스 창 제어
 *   designs  — 로컬 SQLite 메타 저장소(설계) 조회/생성
 *   tables   — 테이블 정의 조회/전량 교체(작업 스토어 write-through)
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
  // 운영부 — 봉투 패턴(unwrap 으로 성공 data / 실패 throw).
  environments: {
    list: (designId: string): Promise<EnvironmentRecord[]> =>
      unwrap(ipcRenderer.invoke('environments:list', designId)),
    create: (form: EnvironmentFormData): Promise<EnvironmentRecord> =>
      unwrap(ipcRenderer.invoke('environments:create', form)),
    update: (id: string, form: Partial<EnvironmentFormData>): Promise<EnvironmentRecord> =>
      unwrap(ipcRenderer.invoke('environments:update', id, form)),
    delete: (id: string): Promise<void> => unwrap(ipcRenderer.invoke('environments:delete', id)),
    setApplied: (id: string, version: string): Promise<EnvironmentRecord> =>
      unwrap(ipcRenderer.invoke('environments:setApplied', id, version)),
    reorder: (orderedIds: string[]): Promise<void> =>
      unwrap(ipcRenderer.invoke('environments:reorder', orderedIds)),
    test: (form: EnvironmentFormData): Promise<TestConnectionResult> =>
      unwrap(ipcRenderer.invoke('environments:test', form)),
    testById: (id: string): Promise<TestConnectionResult> =>
      unwrap(ipcRenderer.invoke('environments:testById', id))
  },
  // 운영부 — 실 DB 역설계(introspection). 활성 환경의 스키마를 IR 로 읽는다.
  introspection: {
    run: (envId: string): Promise<IntrospectedSchema> =>
      unwrap(ipcRenderer.invoke('introspection:run', envId))
  },
  // 운영부 — 쿼리 실행 + 트랜잭션 파괴 게이트.
  query: {
    run: (envId: string, sql: string): Promise<QueryResult> =>
      unwrap(ipcRenderer.invoke('query:run', envId, sql)),
    runParams: (envId: string, sql: string, params: unknown[]): Promise<QueryResult> =>
      unwrap(ipcRenderer.invoke('query:runParams', envId, sql, params)),
    txBegin: (envId: string): Promise<TxBeginResult> =>
      unwrap(ipcRenderer.invoke('query:txBegin', envId)),
    txExec: (txId: string, sql: string): Promise<QueryResult> =>
      unwrap(ipcRenderer.invoke('query:txExec', txId, sql)),
    txExecParams: (txId: string, sql: string, params: unknown[]): Promise<QueryResult> =>
      unwrap(ipcRenderer.invoke('query:txExecParams', txId, sql, params)),
    txCommit: (txId: string): Promise<void> => unwrap(ipcRenderer.invoke('query:txCommit', txId)),
    txRollback: (txId: string): Promise<void> =>
      unwrap(ipcRenderer.invoke('query:txRollback', txId))
  },
  // 운영부 — Migration 스냅샷 기준선 + 로그 체인.
  migration: {
    saveSnapshot: (input: CreateSnapshotInput): Promise<SnapshotRecord> =>
      unwrap(ipcRenderer.invoke('migration:saveSnapshot', input)),
    latestSnapshot: (envId: string): Promise<SnapshotRecord | null> =>
      unwrap(ipcRenderer.invoke('migration:latestSnapshot', envId)),
    appendLog: (input: CreateLogInput): Promise<MigrationLogRecord> =>
      unwrap(ipcRenderer.invoke('migration:appendLog', input)),
    listLogs: (envId: string): Promise<MigrationLogRecord[]> =>
      unwrap(ipcRenderer.invoke('migration:listLogs', envId))
  }
}

export type RockuryApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('rockury', api)
} else {
  // contextIsolation 이 꺼진 경우의 폴백 (개발 편의). DOM 타입에 의존하지 않도록 globalThis 사용.
  ;(globalThis as unknown as { rockury: RockuryApi }).rockury = api
}
