import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TokenStore } from './http'

/**
 * 접속 키(Bearer) 저장소 — OS 키체인 암호화(Electron safeStorage).
 * 평문 토큰을 디스크에 남기지 않기 위한 저장 계층: macOS Keychain / Windows DPAPI /
 * Linux 비밀 서비스로 암호화된 블롭만 userData 에 둔다 — 디스크에 평문 토큰이 없다.
 *
 * 암호화 불가 환경(드묾 — 일부 Linux 헤드리스)은 평문 폴백하되, load 시 복호화 실패는
 * null 로 강등해 새 토큰이 발급되게 한다(연결은 한 번 끊기지만 비밀은 안 샌다).
 */
export function createKeychainTokenStore(dir: string): TokenStore {
  const file = join(dir, 'mcp-token.bin')
  return {
    load(): string | null {
      try {
        if (!existsSync(file)) return null
        const buf = readFileSync(file)
        if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf)
        return buf.toString('utf8') // 평문 폴백으로 저장됐던 경우
      } catch {
        return null // 복호화 실패(키체인 초기화 등) — 새 토큰 발급 유도
      }
    },
    save(token: string): void {
      const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8')
      writeFileSync(file, data, { mode: 0o600 })
    }
  }
}
