import { DatabaseSync } from 'node:sqlite'
import { SEED_TABLES, SEED_VERSIONS } from './seed'
import { applyMigrations } from './migrations'

/**
 * DB 파일 경로 주입 seam — db.ts 는 electron 을 import 하지 않는다(테스트 가능성).
 * main 진입점(app.whenReady)에서 `setDbPath(userData/rockury.db)` 를 호출하고,
 * 테스트는 임시 파일 경로를 주입한다(`ROCKURY_DB_PATH` 또는 setDbPath). 실 앱 DB 무관.
 */
let dbPath: string | null = process.env.ROCKURY_DB_PATH ?? null
export function setDbPath(p: string): void {
  dbPath = p
}
function resolveDbFile(): string {
  if (!dbPath) throw new Error('DB 경로 미설정 — main 진입점에서 setDbPath() 를 먼저 호출하세요.')
  return dbPath
}

/**
 * Rockury 로컬 메타 저장소 (설계·버전·스냅샷·이력의 지상 진실 — IA §4).
 *
 * Electron 43 이 번들한 Node 24 의 내장 `node:sqlite` 를 사용한다 —
 * 네이티브 모듈(better-sqlite3)·electron-rebuild 없이 진짜 SQL 저장소를 얻는다.
 * 파일은 OS 사용자 데이터 디렉터리(app userData)에 둔다.
 */
let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  db = new DatabaseSync(resolveDbFile())
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  applyMigrations(db)
  seed(db)
  return db
}

/** 첫 실행 시드 — commerce-core (MySQL) 설계 + 예제 테이블. designs 가 비어 있을 때만. */
function seed(d: DatabaseSync): void {
  const { c } = d.prepare('SELECT COUNT(*) AS c FROM designs').get() as unknown as { c: number }
  if (c > 0) return
  d.prepare(
    'INSERT INTO designs (id, name, description, dialect, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('commerce-core', 'commerce-core', '커머스 코어 도메인', 'mysql', new Date().toISOString())

  const insert = d.prepare(
    'INSERT INTO tables (id, design_id, name, comment, position, columns, constraints) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  SEED_TABLES.forEach((t, i) =>
    insert.run(
      t.id,
      t.designId,
      t.name,
      t.comment,
      i,
      JSON.stringify(t.columns),
      JSON.stringify(t.constraints)
    )
  )

  // 버전 이력 시드 — Design 의 v0.3.14 드리프트 배지와 아귀를 맞춘다.
  const insertVersion = d.prepare(
    'INSERT INTO versions (id, design_id, number, note, snapshot, locked, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  )
  for (const v of SEED_VERSIONS) {
    insertVersion.run(
      `commerce-core@${v.number}`,
      'commerce-core',
      v.number,
      v.note,
      JSON.stringify(v.snapshot),
      v.createdAt
    )
  }
}
