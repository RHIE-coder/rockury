// 테스트 DB 기동: Docker 컨테이너(mysql/mariadb/postgresql) + 로컬 SQLite 파일 생성.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  SCRIPT_DIR, DATA_DIR, SQLITE_PATH, CONTAINERS,
  log, ok, warn, fail, styleText, dockerEnv
} from './lib.mjs';

// 1. Docker 컨테이너 기동 (전용 rockury 네트워크는 compose 가 함께 만든다)
log('Starting Docker containers...');
try {
  execSync('docker compose up -d', { cwd: SCRIPT_DIR, stdio: 'inherit', env: dockerEnv() });
} catch {
  fail('Failed to start Docker containers. Is Docker running?');
  process.exit(1);
}
// Docker 는 빈 볼륨에서만 init/*.sql 을 실행한다.
// 스키마를 고쳤다면 반영을 위해 `npm run db:reset` 이 필요하다.
log(styleText('dim', 'Note: init/*.sql runs only on a fresh volume — use `npm run db:reset` to re-apply schema changes.'));

// 2. SQLite 테스트 DB 생성 (node:sqlite — Node >= 22.5 필요)
if (existsSync(SQLITE_PATH)) {
  warn(`SQLite DB already exists. Run ${styleText('bold', 'npm run db:down')} first to reset.`);
} else {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    warn(
      `node:sqlite unavailable (Node ${process.version}) — SQLite 테스트 DB를 건너뜁니다. ` +
        `Node ${styleText('bold', '>= 22.5')} 에서 다시 실행하세요. (Docker DB는 정상 기동됨)`
    );
  }
  if (DatabaseSync) {
    log('Creating SQLite test database...');
    mkdirSync(DATA_DIR, { recursive: true });

    const db = new DatabaseSync(SQLITE_PATH);
    const initSql = readFileSync(resolve(SCRIPT_DIR, 'init/sqlite/init.sql'), 'utf-8');
    db.exec(initSql);
    db.close();
    ok(`SQLite DB created at: ${styleText('dim', SQLITE_PATH)}`);
  }
}

// 3. 헬스체크 대기
log('Waiting for containers to be healthy...');
const MAX_WAIT = 60_000;
const POLL = 2_000;

for (const name of CONTAINERS) {
  const start = Date.now();
  let healthy = false;

  while (Date.now() - start < MAX_WAIT) {
    try {
      const status = execSync(
        `docker inspect --format='{{.State.Health.Status}}' ${name}`,
        { encoding: 'utf-8', env: dockerEnv() }
      ).trim();
      if (status === 'healthy') {
        healthy = true;
        break;
      }
    } catch {
      // 컨테이너가 아직 준비되지 않음
    }
    await sleep(POLL);
  }

  if (healthy) ok(name);
  else warn(`${name} did not become healthy within ${MAX_WAIT / 1000}s`);
}

// 4. 접속 정보 출력
const b = (s) => styleText('bold', s);
const svc = (s) => styleText('blue', s);
const port = (s) => styleText('yellow', s);
console.log('');
console.log(b('  ╭──────────────────────────────────────────────────────────────╮'));
console.log(b('  │           Test Database Connection Info                       │'));
console.log(b('  │           network: rockury-net (dedicated bridge)             │'));
console.log(b('  ├──────────────────────────────────────────────────────────────┤'));
console.log(`  │  ${svc('MySQL')}       localhost:${port('13306')}  DB: testdb  User: test  Pass: test │`);
console.log(`  │  ${svc('MariaDB')}     localhost:${port('13307')}  DB: testdb  User: test  Pass: test │`);
console.log(`  │  ${svc('PostgreSQL')}  localhost:${port('15432')}  DB: testdb  User: test  Pass: test │`);
console.log(`  │  ${svc('SQLite')}      ${styleText('dim', SQLITE_PATH)}  │`);
console.log(b('  ╰──────────────────────────────────────────────────────────────╯'));
console.log('');
ok(styleText(['green', 'bold'], 'Ready!'));
