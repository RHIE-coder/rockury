import { Cloud, Container, Server } from 'lucide-react'
import type { Service } from '@renderer/nav/types'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'

const OverviewWorkspace = () => (
  <PlaceholderView
    icon={Server}
    depth="depth 2 · Infra › Overview"
    title="Overview"
    subtitle="인프라 상태 대시보드 (서버/컨테이너/클라우드). (후속 마일스톤)"
  />
)
const ContainersWorkspace = () => (
  <PlaceholderView
    icon={Container}
    depth="depth 2 · Infra › Containers"
    title="Containers"
    subtitle="Docker 컨테이너/이미지 관리."
  />
)
const CloudWorkspace = () => (
  <PlaceholderView
    icon={Cloud}
    depth="depth 2 · Infra › Cloud"
    title="Cloud"
    subtitle="AWS 등 클라우드 리소스 연동."
  />
)

export const infraService: Service = {
  id: 'infra',
  label: 'Infra',
  icon: Server,
  modules: [
    { id: 'overview', label: 'Overview', icon: Server, workspace: OverviewWorkspace },
    { id: 'containers', label: 'Containers', icon: Container, workspace: ContainersWorkspace },
    { id: 'cloud', label: 'Cloud', icon: Cloud, workspace: CloudWorkspace }
  ]
}
