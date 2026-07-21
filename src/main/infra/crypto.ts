import type { SafeStorage } from 'electron'

/**
 * 자격증명 암호화 — Electron safeStorage(OS 키체인) 기반.
 *
 * electron 은 **지연 로드**한다 — 이 모듈을 import 해도(예: queryService 를 vitest 에서 테스트)
 * encrypt/decrypt 를 실제로 호출하지 않는 한 electron 을 로드하지 않는다(테스트 가능성).
 * 평문 비밀번호는 절대 로컬 DB 에 저장하지 않고, 여기서 암호화한 base64 만 넣는다.
 */
function safeStorage(): SafeStorage {
  return (require('electron') as typeof import('electron')).safeStorage
}

/** 평문 → base64 암호문 (SQLite TEXT 저장용). */
export function encrypt(plaintext: string): string {
  const s = safeStorage()
  if (!s.isEncryptionAvailable()) throw new Error('이 시스템에서는 암호화를 사용할 수 없습니다.')
  return s.encryptString(plaintext).toString('base64')
}

/** base64 암호문 → 평문. */
export function decrypt(encrypted: string): string {
  const s = safeStorage()
  if (!s.isEncryptionAvailable()) throw new Error('이 시스템에서는 암호화를 사용할 수 없습니다.')
  return s.decryptString(Buffer.from(encrypted, 'base64'))
}
