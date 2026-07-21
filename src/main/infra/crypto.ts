import { safeStorage } from 'electron'

/**
 * 자격증명 암호화 — Electron safeStorage(OS 키체인) 기반.
 * rky-mvp `infrastructure/crypto.ts` verbatim 이식(§ops-plan Phase 0).
 *
 * 평문 비밀번호는 절대 로컬 DB 에 저장하지 않는다. 여기서 암호화한 base64 문자열만
 * `environments.encrypted_password` 에 넣고, 사용 직전(연결 테스트/실행)에만 복호화한다.
 */

/** 평문 → base64 암호문 (SQLite TEXT 저장용). */
export function encrypt(plaintext: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 시스템에서는 암호화를 사용할 수 없습니다.')
  }
  const encrypted = safeStorage.encryptString(plaintext)
  return encrypted.toString('base64')
}

/** base64 암호문 → 평문. */
export function decrypt(encrypted: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 시스템에서는 암호화를 사용할 수 없습니다.')
  }
  const buffer = Buffer.from(encrypted, 'base64')
  return safeStorage.decryptString(buffer)
}
