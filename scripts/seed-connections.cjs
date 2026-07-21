// dev 편의 — test-db(4벤더) Connection 을 앱 로컬 DB(rockury.db)에 미리 심는다.
// 비밀번호는 앱과 동일한 safeStorage 키로 암호화해야 앱이 복호화할 수 있으므로,
// 반드시 Electron 런타임에서 실행한다:  npm run db:seed-connections
// (사전: npm run db:up 으로 test-db 기동. 앱이 실행 중이면 시드 후 앱을 재시작/리로드.)
const { app, safeStorage } = require('electron')
const { DatabaseSync } = require('node:sqlite')
const { randomUUID } = require('node:crypto')
const path = require('path')

const SQLITE_FILE = path.resolve(__dirname, 'test-db/data/testdb.sqlite')

const SEEDS = [
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
    for (const s of SEEDS) {
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
    console.error('✗ 시드 실패:', e && e.message ? e.message : e)
    app.exit(1)
  }
})
