import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { FunctionEnv } from './functions'

/**
 * 메인 프로세스·테스트가 쓰는 실제 함수 환경.
 *
 * 렌더러는 이 파일을 import 하지 않는다 — `node:crypto` 가 없다.
 * 화면은 `cryptoUnavailable` 을 끼운 환경으로 미리보기만 만들고, 진짜 계산은 전송할 때
 * 메인이 한다(functions.ts 머리말 참고).
 */
export const nodeFunctionEnv: FunctionEnv = {
  now: () => Date.now(),
  random: () => Math.random(),
  uuid: () => randomUUID(),
  hash: (algo, data) => createHash(algo).update(data, 'utf8').digest('hex'),
  hmac: (algo, key, data) => createHmac(algo, key).update(data, 'utf8').digest('hex')
}
