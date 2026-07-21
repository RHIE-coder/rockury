// 테스트 DB 스크립트 공통 유틸 — 외부 의존성 없이 node 표준 라이브러리만 사용.
import { styleText } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(SCRIPT_DIR, 'data');
export const SQLITE_PATH = resolve(DATA_DIR, 'testdb.sqlite');

export const CONTAINERS = [
  'rockury-test-mysql',
  'rockury-test-mariadb',
  'rockury-test-postgresql'
];

const tag = styleText('cyan', '[test-db]');
export const log = (msg) => console.log(`${tag} ${msg}`);
export const ok = (msg) => console.log(`${tag} ${styleText('green', '✔')} ${msg}`);
export const warn = (msg) => console.log(`${tag} ${styleText('yellow', '⚠')} ${msg}`);
export const fail = (msg) => console.error(`${tag} ${styleText('red', '✖')} ${msg}`);
export { styleText };
