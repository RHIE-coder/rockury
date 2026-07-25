// 포켓몬 TCG 설계를 rockury 앱 로컬 DB 에 "추가 삽입"하는 일회성 로더.
//
//   node scripts/loadPokemonDesign.mjs            # 설계 + 테이블 + v0.1.0 버전 컷
//   node scripts/loadPokemonDesign.mjs --no-version  # 버전 없이 draft 만
//   ROCKURY_DB_PATH=/tmp/x.db node scripts/loadPokemonDesign.mjs  # 대상 DB 경로 오버라이드(테스트용)
//
// 안전 규약(AGENTS.md 불변식):
//   · 추가(INSERT)만 한다 — 기존 설계/테이블을 지우거나 덮지 않는다.
//   · 같은 id 의 설계가 이미 있으면 아무것도 안 하고 종료(멱등).
//   · 반드시 Rockury 앱을 종료한 상태에서 실행한다. 저장이 설계 스코프(replaceForDesign)로
//     좁혀져 다른 설계가 덮일 위험은 사라졌지만, 앱(단일 작성자)과 이 스크립트가 같은 SQLite
//     파일을 동시에 여는 것 자체를 피한다 — 켜진 앱은 새 설계를 리하이드레이션 없이 모른다.
//
// Node 24 의 타입 스트리핑으로 .ts 데이터 모듈을 직접 import 한다(빌드 불필요).

import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { POKEMON_DESIGN, POKEMON_TABLES } from '../src/main/store/pokemonDesign.ts'

const withVersion = !process.argv.includes('--no-version')

function resolveDbPath() {
  if (process.env.ROCKURY_DB_PATH) return process.env.ROCKURY_DB_PATH
  // 실 앱 userData 경로(macOS). db.ts 의 setDbPath(userData/rockury.db) 와 동일 파일.
  return join(homedir(), 'Library', 'Application Support', 'Rockury', 'rockury.db')
}

const dbPath = resolveDbPath()
if (!existsSync(dbPath)) {
  console.error(`✗ DB 파일이 없습니다: ${dbPath}\n  Rockury 를 한 번 실행해 DB 를 만든 뒤 다시 시도하세요(또는 ROCKURY_DB_PATH 지정).`)
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON;')

// designs 테이블이 있어야 한다(앱이 최소 1회 구동해 마이그레이션됨).
const hasDesigns = db
  .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='designs'`)
  .get()
if (!hasDesigns || hasDesigns.c === 0) {
  console.error('✗ designs 테이블이 없습니다 — Rockury 를 한 번 정상 실행한 뒤 다시 시도하세요.')
  process.exit(1)
}

// 멱등: 이미 있으면 건너뛴다.
const existing = db.prepare('SELECT id FROM designs WHERE id = ?').get(POKEMON_DESIGN.id)
if (existing) {
  console.log(`• 설계 "${POKEMON_DESIGN.id}" 가 이미 있습니다 — 아무것도 하지 않고 종료합니다(멱등).`)
  process.exit(0)
}

const now = new Date().toISOString()

db.exec('BEGIN')
try {
  db.prepare('INSERT INTO designs (id, name, description, dialect, created_at) VALUES (?, ?, ?, ?, ?)').run(
    POKEMON_DESIGN.id,
    POKEMON_DESIGN.name,
    POKEMON_DESIGN.description,
    POKEMON_DESIGN.dialect,
    now
  )

  const insertTable = db.prepare(
    'INSERT INTO tables (id, design_id, name, comment, position, columns, constraints) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  POKEMON_TABLES.forEach((t, i) =>
    insertTable.run(
      t.id,
      t.designId,
      t.name,
      t.comment,
      i,
      JSON.stringify(t.columns),
      JSON.stringify(t.constraints)
    )
  )

  if (withVersion) {
    db.prepare(
      'INSERT INTO versions (id, design_id, number, note, snapshot, locked, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).run(
      `${POKEMON_DESIGN.id}@v0.1.0`,
      POKEMON_DESIGN.id,
      'v0.1.0',
      '포켓몬 TCG 스키마 최초 반영',
      JSON.stringify({ tables: POKEMON_TABLES }),
      now
    )
  }

  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  console.error('✗ 삽입 실패 — 롤백했습니다:', e)
  process.exit(1)
}

const colCount = POKEMON_TABLES.reduce((n, t) => n + t.columns.length, 0)
console.log(`✓ 설계 "${POKEMON_DESIGN.name}" (${POKEMON_DESIGN.dialect}) 삽입 완료`)
console.log(`  · 테이블 ${POKEMON_TABLES.length}개 · 컬럼 ${colCount}개`)
console.log(`  · 버전: ${withVersion ? 'v0.1.0 컷' : '없음(draft 만)'}`)
console.log(`  · DB: ${dbPath}`)
console.log('  Rockury 를 실행하면 컨텍스트 바에서 설계를 고를 수 있습니다.')
