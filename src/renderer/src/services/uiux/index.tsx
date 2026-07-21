import { Component, Frame, Palette } from 'lucide-react'
import type { Service } from '@renderer/nav/types'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'

const CanvasWorkspace = () => (
  <PlaceholderView
    icon={Frame}
    depth="depth 2 · UI/UX › Canvas"
    title="Canvas"
    subtitle="Figma 스타일의 UI 설계 캔버스가 이곳에 들어옵니다. (후속 마일스톤)"
  />
)
const ComponentsWorkspace = () => (
  <PlaceholderView
    icon={Component}
    depth="depth 2 · UI/UX › Components"
    title="Components"
    subtitle="재사용 컴포넌트/디자인 시스템 라이브러리."
  />
)

export const uiuxService: Service = {
  id: 'uiux',
  label: 'UI/UX',
  icon: Palette,
  modules: [
    { id: 'canvas', label: 'Canvas', icon: Frame, workspace: CanvasWorkspace },
    { id: 'components', label: 'Components', icon: Component, workspace: ComponentsWorkspace }
  ]
}
