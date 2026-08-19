// 테스트 DB 현황 — 컨테이너·전용 네트워크·SQLite 파일이 있는지만 본다. 아무것도 바꾸지 않는다.
//
//   npm run db:status
//   node scripts/test-db/status.mjs --help   이 사용법
import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { SCRIPT_DIR, SQLITE_PATH, log, styleText, dockerEnv } from './lib.mjs';
import { fileURLToPath } from 'node:url';
import { helpIfAsked } from '../lib/usage.cjs';

helpIfAsked(fileURLToPath(import.meta.url)); // 부수효과보다 먼저 — 늦게 보면 도움말이 실행이 된다

// Docker 컨테이너
log(styleText('bold', 'Docker containers:'));
try {
  const output = execSync('docker compose ps', { cwd: SCRIPT_DIR, encoding: 'utf-8', env: dockerEnv() });
  if (output.trim()) console.log(output);
  else log(`  ${styleText('dim', '(no containers running)')}`);
} catch {
  log(`  ${styleText('dim', 'docker compose not available or no containers')}`);
}

// 전용 네트워크
try {
  const net = execSync(
    "docker network ls --filter name=^rockury-net$ --format '{{.Name}} ({{.Driver}})'",
    { encoding: 'utf-8', env: dockerEnv() }
  ).trim();
  log(`${styleText('bold', 'Network:')} ${net ? `${styleText('green', '●')} ${net}` : `${styleText('red', '●')} rockury-net network not found`}`);
} catch {
  log(`${styleText('bold', 'Network:')} ${styleText('dim', 'docker not available')}`);
}

// SQLite
if (existsSync(SQLITE_PATH)) {
  const size = statSync(SQLITE_PATH).size;
  log(`${styleText('bold', 'SQLite:')} ${styleText('green', '●')} ${styleText('dim', SQLITE_PATH)} ${styleText('yellow', `(${(size / 1024).toFixed(1)} KB)`)}`);
} else {
  log(`${styleText('bold', 'SQLite:')} ${styleText('red', '●')} not created`);
}
