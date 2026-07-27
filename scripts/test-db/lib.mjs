// 테스트 DB 스크립트 공통 유틸 — 외부 의존성 없이 node 표준 라이브러리만 사용.
import { styleText } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(SCRIPT_DIR, 'data');
export const SQLITE_PATH = resolve(DATA_DIR, 'testdb.sqlite');

export const CONTAINERS = [
  'rockury-test-mysql',
  'rockury-test-mariadb',
  'rockury-test-postgresql'
];

/**
 * docker 실행용 PATH — Docker Desktop 의 자격 헬퍼(docker-credential-*)가 PATH 에 없으면
 * `docker compose up` 이 이미지를 못 당겨온다("error getting credentials ... docker-credential-desktop").
 * docker 를 homebrew 로 깔면(`/opt/homebrew/bin/docker`) 헬퍼만 Docker.app 안에 남아 흔히 겪는다
 * → 헬퍼가 있는 표준 위치를 PATH 뒤에 덧붙여 준다(사용자 설정 파일은 건드리지 않는다).
 */
export function dockerEnv() {
  const extra = [
    '/Applications/Docker.app/Contents/Resources/bin', // macOS Docker Desktop
    '/usr/local/bin',
    '/opt/homebrew/bin'
  ].filter((d) => existsSync(d));
  const parts = (process.env.PATH ?? '').split(':');
  const add = extra.filter((d) => !parts.includes(d));
  return add.length ? { ...process.env, PATH: [...parts, ...add].join(':') } : process.env;
}

const tag = styleText('cyan', '[test-db]');
export const log = (msg) => console.log(`${tag} ${msg}`);
export const ok = (msg) => console.log(`${tag} ${styleText('green', '✔')} ${msg}`);
export const warn = (msg) => console.log(`${tag} ${styleText('yellow', '⚠')} ${msg}`);
export const fail = (msg) => console.error(`${tag} ${styleText('red', '✖')} ${msg}`);
export { styleText };
