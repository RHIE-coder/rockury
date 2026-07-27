// 테스트 DB 정리: 컨테이너/볼륨/전용 네트워크 제거 + SQLite 데이터 삭제.
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { SCRIPT_DIR, DATA_DIR, log, ok, warn, styleText, dockerEnv } from './lib.mjs';

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
