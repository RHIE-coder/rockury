import { defineConfig } from 'vitest/config'

/**
 * 순수 로직(도메인 함수) 단위 테스트 — node 환경, DOM/Electron 불필요.
 * 테스트는 대상 모듈 옆 *.test.ts 로 두고 상대 경로로 임포트한다(@renderer 별칭 불필요).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
