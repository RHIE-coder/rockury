/**
 * 샘플 DB — 앱이 스스로 만들어 주는 SQLite 파일 하나와 그 접속.
 *
 * 준비물이 없다는 것이 이 기능의 전부다: 도커도, 네트워크도, 계정도 필요 없다.
 * 개발용 `npm run db:up` 이 만드는 `scripts/test-db/data/testdb.sqlite` 와는 **다른 파일**이라
 * 앱이 개발 환경을 건드리지 않는다. 정본: `docs/spec/db-connections.md` › db-connections.sample.
 *
 * userData 경로는 인자로 받는다 — 이 계층이 electron 을 안 물어야 테스트에서 임시 폴더로 돌린다.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import SAMPLE_SQL from '../resources/sample-sqlite.sql?raw'
import {
  findSampleConnection,
  planSample,
  SAMPLE_CONNECTION_NAME,
  SAMPLE_DIR,
  SAMPLE_FILE,
  samplePaths,
  type SampleResult,
  type SampleStatus
} from '../../shared/db/samplePlan'
import { createConnection, listConnections } from './connections'

/** 샘플 파일이 놓이는 자리. 앱을 지우면 함께 사라지는 userData 아래로 고정한다. */
export function samplePath(baseDir: string): string {
  return join(baseDir, SAMPLE_DIR, SAMPLE_FILE)
}

export function sampleStatus(baseDir: string): SampleStatus {
  const path = samplePath(baseDir)
  return {
    path,
    fileExists: existsSync(path),
    connectionId: findSampleConnection(listConnections(), path)
  }
}

/**
 * 빈 파일 하나를 만들고 샘플 SQL 을 넣는다.
 *
 * SQL 이 멱등하지 않다(평범한 `INSERT` 23개) — 이미 있는 파일에 두 번 넣으면 기본키 충돌로 깨진다.
 * 그래서 **없는 자리에만** 부른다.
 */
function writeSampleFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  try {
    db.exec(SAMPLE_SQL)
    // WAL 내용을 본 파일로 합쳐 둔다 — 곁 파일만 남고 본 파일이 비는 상태를 막는다.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
}

function removeAll(paths: string[]): void {
  for (const p of paths) rmSync(p, { force: true })
}

/** 파일과 접속을 따로 판정해 없는 쪽만 만든다. 둘 다 있으면 아무것도 하지 않는다. */
export function createSample(baseDir: string): SampleResult {
  const before = sampleStatus(baseDir)
  const action = planSample(before)
  if (action === 'reset') return { status: before, made: 'none' }

  if (action === 'create-both' || action === 'create-file') {
    writeSampleFile(before.path)
  }
  if (action === 'create-both' || action === 'create-connection') {
    // 파일 쓰기가 먼저다 — 실패하면 여기 못 와서 접속만 남는 반쪽 상태가 안 생긴다.
    createConnection({
      name: SAMPLE_CONNECTION_NAME,
      dbType: 'sqlite',
      host: '',
      port: 0,
      database: before.path,
      user: '',
      encryptedPassword: '',
      sslEnabled: false,
      // 프로젝트를 가리지 않는 공용 접속 — 어느 범위에서 눌러도 같은 샘플 하나다.
      projectId: null
    })
  }

  const made = action === 'create-both' ? 'both' : action === 'create-file' ? 'file' : 'connection'
  return { status: sampleStatus(baseDir), made }
}

/**
 * 파일만 새로 만든다 — **접속 레코드는 건드리지 않는다**(id·이름·그룹·순서 보존).
 *
 * 새 파일을 옆에 먼저 만든 뒤 바꿔치기한다. 지우기만 성공하고 만들기에서 실패해
 * 샘플이 통째로 증발하는 상태를 만들지 않기 위해서다.
 */
export function resetSample(baseDir: string): SampleResult {
  const status = sampleStatus(baseDir)
  const staging = `${status.path}.new`

  removeAll(samplePaths(staging))
  writeSampleFile(staging) // 여기서 던지면 기존 샘플은 그대로다

  const backup = `${status.path}.old`
  removeAll(samplePaths(backup))
  const hadFile = existsSync(status.path)
  if (hadFile) renameSync(status.path, backup)

  try {
    renameSync(staging, status.path)
  } catch (e) {
    if (hadFile) renameSync(backup, status.path) // 되돌린다 — 샘플 없는 상태로 끝내지 않는다
    removeAll(samplePaths(staging))
    throw e
  }

  // 옛 곁 파일이 남으면 새 파일에 옛 내용이 섞여 읽힌다.
  removeAll([...samplePaths(status.path).slice(1), ...samplePaths(backup), ...samplePaths(staging)])
  return { status: sampleStatus(baseDir), made: 'file' }
}
