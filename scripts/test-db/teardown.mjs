// 테스트 DB 정리 — 컨테이너·볼륨·전용 네트워크를 지우고 SQLite 데이터 폴더를 통째로 지운다.
//
//   npm run db:down     정리
//   node scripts/test-db/teardown.mjs --help   이 사용법
//
// 지우는 것: 컨테이너 3개 · 볼륨(= 그 안의 테스트 데이터 전부) · scripts/test-db/data/ 폴더.
// 앱 로컬 DB(rockury.db)와 네 실제 DB 는 이 스크립트의 시야 밖이다 — 손대지 않는다.
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { SCRIPT_DIR, DATA_DIR, log, ok, warn, styleText, dockerEnv } from './lib.mjs';
import { fileURLToPath } from 'node:url';
import { helpIfAsked } from '../lib/usage.cjs';

helpIfAsked(fileURLToPath(import.meta.url)); // 부수효과보다 먼저 — 늦게 보면 도움말이 실행이 된다

// 1. Docker 컨테이너 + 볼륨 제거 (compose 가 만든 rockury 네트워크도 함께 제거된다)
log('Stopping Docker containers...');
try {
  execSync('docker compose down -v', { cwd: SCRIPT_DIR, stdio: 'inherit', env: dockerEnv() });
  ok('Docker containers removed');
} catch {
  warn('docker compose down failed (containers may not exist)');
}

// 2. SQLite 테스트 DB 제거
if (existsSync(DATA_DIR)) {
  rmSync(DATA_DIR, { recursive: true, force: true });
  ok('Removed SQLite test data');
} else {
  log('No SQLite data to remove');
}

ok(styleText(['green', 'bold'], 'Cleanup complete'));
