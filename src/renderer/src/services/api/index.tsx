import { FlaskConical, Plug, Route } from 'lucide-react'
import type { Service } from '@renderer/nav/types'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'

const EndpointsWorkspace = () => (
  <PlaceholderView
    icon={Route}
    depth="depth 2 · API › Endpoints"
    title="Endpoints"
    subtitle="Swagger 스타일의 엔드포인트 탐색/문서 화면. (후속 마일스톤)"
  />
)
const TestingWorkspace = () => (
  <PlaceholderView
    icon={FlaskConical}
    depth="depth 2 · API › Testing"
    title="Testing"
    subtitle="요청 작성 및 응답 검증 도구."
  />
)

export const apiService: Service = {
  id: 'api',
  label: 'API',
  icon: Plug,
  modules: [
    { id: 'endpoints', label: 'Endpoints', icon: Route, workspace: EndpointsWorkspace },
    { id: 'testing', label: 'Testing', icon: FlaskConical, workspace: TestingWorkspace }
  ]
}
