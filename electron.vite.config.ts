import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 이 빌드가 나온 **소스 루트** 경로를 메인·렌더러에 박아 넣는다.
 * 병렬 개발에서 "지금 이 앱은 어느 워크트리 것인가"를 알기 위한 유일한 근거다 —
 * 런타임의 `app.getAppPath()` 는 빌드 산출물(out/main)을 가리켜 쓸 수 없다.
 * 보기 좋은 이름으로 바꾸는 규칙은 `src/shared/sourceLabel.ts` 하나뿐이다.
 */
const SOURCE_ROOT = JSON.stringify(__dirname)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __SOURCE_ROOT__: SOURCE_ROOT },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    // 개발 중에만 타이틀바에 소스 폴더를 보인다 — 다섯 워크트리 중 어느 앱인지 화면으로 구분.
    define: { __SOURCE_ROOT__: SOURCE_ROOT },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
