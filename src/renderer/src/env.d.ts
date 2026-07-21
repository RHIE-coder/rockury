/// <reference types="vite/client" />

import 'react'

declare module 'react' {
  interface CSSProperties {
    // Electron 프레임리스 창의 드래그 영역 지정용 (표준 타입에 없어 보강)
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}
