import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * 순수 로직(도메인 함수) 단위 테스트 — node 환경, DOM/Electron 불필요.
 * 테스트는 대상 모듈 옆 *.test.ts 로 두고 상대 경로로 임포트한다.
 * 단, 대상 모듈이 공용(@shared)·렌더러(@renderer) 별칭을 쓰면 vitest 도 같은 별칭을 풀어야 한다.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    // src 순수 로직 + e2e 안전 불변식(격리) 가드 + scripts 순수 계산(워크트리 계획 등)
    // + 하네스 훅의 판정(.harness) — 가드가 조용히 헐거워지는 것을 가드로 막는다.
    include: [
      'src/**/*.test.ts',
      'e2e/**/*.test.ts',
      'scripts/**/*.test.ts',
      '.harness/**/*.test.mjs'
    ],
    environment: 'node'
  }
})
