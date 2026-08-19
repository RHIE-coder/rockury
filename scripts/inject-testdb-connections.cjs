// test-db 접속 4개(mysql·mariadb·postgresql·sqlite)를 앱 로컬 DB(rockury.db)의 **접속 목록에
// 넣어 주는** dev 편의 스크립트. 넣는 것은 접속 정보뿐 — 설계·데이터는 건드리지 않는다.
// 같은 이름의 접속이 이미 있으면 건너뛴다(멱등 — 두 번 돌려도 같다).
//
//   npm run db:up                             먼저 test-db 를 띄우고
//   npm run dev:inject-connections            넣는다
//   npm run dev:inject-connections -- --help  이 사용법
//
// Electron 런타임으로 도는 이유: 비밀번호를 앱과 **같은 safeStorage 키**로 암호화해야 앱이 풀 수
// 있다. 그래서 node 가 아니라 electron 으로 띄운다(키체인 접근 권한이 필요할 수 있다).
// 넣은 뒤 앱이 실행 중이면 재시작/리로드해야 목록에 보인다.
//
// 이름에 seed 를 안 쓰는 이유: 이 프로젝트에서 "시드"는 설계가 정의하는 기준 데이터
// (seed_sets · Studio › Seed)를 가리키는 말로 이미 쓰인다. 이건 그것과 아무 상관이 없다.
const { app, safeStorage } = require('electron')
const { DatabaseSync } = require('node:sqlite')
const { randomUUID } = require('node:crypto')
const path = require('path')
const { helpIfAsked } = require('./lib/usage.cjs')

helpIfAsked(__filename) // 앱을 띄우기 전에 — 늦게 보면 도움말 요청이 DB 를 건드린다

const SQLITE_FILE = path.resolve(__dirname, 'test-db/data/testdb.sqlite')

const CONNECTIONS = [
  { name: 'test-mysql', dbType: 'mysql', host: 'localhost', port: 13306, database: 'testdb', user: 'test', password: 'test' },
  { name: 'test-mariadb', dbType: 'mariadb', host: 'localhost', port: 13307, database: 'testdb', user: 'test', password: 'test' },
  { name: 'test-postgresql', dbType: 'postgresql', host: 'localhost', port: 15432, database: 'testdb', user: 'test', password: 'test' },
  { name: 'test-sqlite', dbType: 'sqlite', host: '', port: 0, database: SQLITE_FILE, user: '', password: '' }
]

app.setName('Rockury') // userData 경로 + safeStorage 키를 앱과 일치시킨다.

app.whenReady().then(() => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('✗ safeStorage 를 사용할 수 없습니다(키체인 접근 필요).')
      app.exit(1)
      return
    }

    const file = path.join(app.getPath('userData'), 'rockury.db')
    const db = new DatabaseSync(file)
    // 앱과 동일한 connections 스키마(앱이 아직 안 만들었을 수도 있으니 보장).
    db.exec(`
      CREATE TABLE IF NOT EXISTS connections (
        id                 TEXT PRIMARY KEY,
        name               TEXT NOT NULL,
        db_type            TEXT NOT NULL,
        host               TEXT NOT NULL DEFAULT '',
        port               INTEGER NOT NULL DEFAULT 0,
        database_name      TEXT NOT NULL DEFAULT '',
        db_user            TEXT NOT NULL DEFAULT '',
        encrypted_password TEXT NOT NULL DEFAULT '',
        ssl_enabled        INTEGER NOT NULL DEFAULT 0,
        ssl_config         TEXT,
        sort_order         INTEGER NOT NULL DEFAULT 0,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
    `)

    const existing = new Set(
      (db.prepare('SELECT name FROM connections').all()).map((r) => r.name)
    )
    let { max } = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM connections').get()
    const insert = db.prepare(
      `INSERT INTO connections
         (id, name, db_type, host, port, database_name, db_user, encrypted_password,
          ssl_enabled, ssl_config, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`
    )

    const now = new Date().toISOString()
    let added = 0
    for (const s of CONNECTIONS) {
      if (existing.has(s.name)) {
        console.log(`• 이미 있음: ${s.name}`)
        continue
      }
      const enc = s.password ? safeStorage.encryptString(s.password).toString('base64') : ''
      insert.run(
        `conn_${randomUUID()}`,
        s.name,
        s.dbType,
        s.host,
        s.port,
        s.database,
        s.user,
        enc,
        ++max,
        now,
        now
      )
      console.log(`✔ 추가: ${s.name}  (${s.dbType} ${s.host || s.database}${s.port ? ':' + s.port : ''})`)
      added++
    }
    db.close()
    console.log(`\n완료 — ${added}개 추가. 앱이 실행 중이면 재시작/리로드하세요.`)
    app.exit(0)
  } catch (e) {
    console.error('✗ 넣기 실패:', e && e.message ? e.message : e)
    app.exit(1)
  }
})
