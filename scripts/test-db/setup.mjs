// 테스트 DB 기동 — 도커 컨테이너 3개(mysql·mariadb·postgresql)를 띄우고 로컬 SQLite 파일을 만든다.
//
//   npm run db:up       기동(멱등 — 이미 떠 있으면 그대로 둔다)
//   npm run db:status   현황만 본다
//   npm run db:down     정리
//   npm run db:reset    내렸다가 다시 올린다
//   node scripts/test-db/setup.mjs --help   이 사용법
//
// 접속: mysql localhost:13306 · mariadb 13307 · postgresql 15432 (DB testdb / 계정 test / test)
//       sqlite scripts/test-db/data/testdb.sqlite
//
// 전제는 도커가 떠 있는 것. init/*.sql 은 **빈 볼륨에서만** 돌기 때문에, 이미 떠 있는 컨테이너에는
// 스키마 변경이 안 먹는다 — 그때는 `npm run db:reset` 이다.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  SCRIPT_DIR, DATA_DIR, SQLITE_PATH, CONTAINERS,
  log, ok, warn, fail, styleText, dockerEnv
} from './lib.mjs';
import { fileURLToPath } from 'node:url';
import { helpIfAsked } from '../lib/usage.cjs';

helpIfAsked(fileURLToPath(import.meta.url)); // 부수효과보다 먼저 — 늦게 보면 도움말이 실행이 된다

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
    // 앱의 "샘플 DB" 와 같은 SQL 을 쓴다 — 두 벌을 두면 한쪽만 고쳐져 어긋난다.
    const initSql = readFileSync(
      resolve(SCRIPT_DIR, '../../src/main/resources/sample-sqlite.sql'),
      'utf-8'
    );
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

// 3.5 제한 권한 계정 — **볼 수 있는 표가 딱 하나뿐인** 계정을 심는다.
//
// 왜 픽스처에 두나: "역설계 목록에 없다"가 삭제인지 권한인지 가르는 동작(§db-remote.data
// .saved-filter AC-5a)은 **권한이 실제로 빠진 계정**이 없으면 검증할 수 없다. 그런데 앱이 쓰는
// `test` 계정에는 CREATE USER·GRANT 권한이 없어(의도) 검사가 실행 중에 만들 수도 없다.
// init/*.sql 은 빈 볼륨에서만 도므로 이미 떠 있는 컨테이너에는 안 먹는다 → 매번 멱등하게 심는다.
log('Provisioning limited-privilege account (rky_limited)...');
{
  // `roles` 만 볼 수 있다. 나머지 표는 **존재하지만 이 계정 눈에는 안 보인다** — 그 상태가
  // "지워진 표"와 구별돼야 한다는 것이 이 계정의 존재 이유다.
  const sql = [
    "CREATE USER IF NOT EXISTS 'rky_limited'@'%' IDENTIFIED BY 'rky_limited';",
    "REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'rky_limited'@'%';",
    "GRANT SELECT ON testdb.roles TO 'rky_limited'@'%';",
    'FLUSH PRIVILEGES;'
  ].join(' ')
  for (const [name, cli] of [
    ['rockury-test-mysql', 'mysql'],
    ['rockury-test-mariadb', 'mariadb']
  ]) {
    try {
      execSync(`docker exec ${name} ${cli} -uroot -proot -e ${JSON.stringify(sql)}`, {
        stdio: ['ignore', 'ignore', 'ignore'],
        env: dockerEnv()
      });
      ok(`${name}: rky_limited`);
    } catch {
      // 없어도 앱은 멀쩡히 돌아간다 — 이 계정을 쓰는 검사만 못 돈다.
      warn(`${name}: rky_limited 계정을 못 심었습니다(권한 검증 스모크만 영향).`);
    }
  }
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
