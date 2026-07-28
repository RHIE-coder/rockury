import { ScreensShell } from './ScreensShell'
import { StructurePanel } from './StructurePanel'

/**
 * Screens › Spec — 화면 구조를 트리·폼으로 짓는다. 명세 정본 `docs/spec/uiux-ia.md` Surface `uiux.screens.spec`.
 *
 * 셸(`[위계 | 가운데 | 속성]`)은 Canvas 와 공유하고 **가운데만 다르다** — 뷰를 바꿔도 위계와
 * 속성이 그대로 남아야 "같은 것을 다른 방식으로 본다"가 성립한다.
 */
export function SpecWorkspace() {
  return (
    <ScreensShell>
      <StructurePanel />
    </ScreensShell>
  )
}
