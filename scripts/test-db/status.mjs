// 테스트 DB 상태 확인: 컨테이너 · 전용 네트워크 · SQLite 파일.
import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { SCRIPT_DIR, SQLITE_PATH, log, styleText } from './lib.mjs';

// Docker 컨테이너
log(styleText('bold', 'Docker containers:'));
try {
  const output = execSync('docker compose ps', { cwd: SCRIPT_DIR, encoding: 'utf-8' });
  if (output.trim()) console.log(output);
  else log(`  ${styleText('dim', '(no containers running)')}`);
} catch {
  log(`  ${styleText('dim', 'docker compose not available or no containers')}`);
}

// 전용 네트워크
try {
  const net = execSync(
    "docker network ls --filter name=^rockury-net$ --format '{{.Name}} ({{.Driver}})'",
    { encoding: 'utf-8' }
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
