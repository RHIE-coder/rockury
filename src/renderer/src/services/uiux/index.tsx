import {
  Blocks,
  Braces,
  Component,
  FolderKanban,
  Frame,
  GitCompare,
  History,
  ListTree,
  MessageSquare,
  Milestone,
  MonitorSmartphone,
  Paintbrush,
  Palette,
  PenTool,
  Plus,
  ShieldCheck,
  Workflow
} from 'lucide-react'
import { Suspense, lazy } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { Service } from '@renderer/nav/types'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'

/**
 * 화면·스토어는 **지연 로드**한다. 서비스 선언 파일이 스토어를 정적으로 끌면 그 스토어가
 * `nav/useNav` → `nav/registry` 를 타고 **다섯 서비스를 전부** 로드한다 — 그중에는 모듈이
 * 읽히는 순간 `window.rockury` 를 만지는 것이 있어서, 선언만 보려는 곳(단위 테스트)에서 터진다.
 * 선언 파일은 가볍게 유지하는 게 규율이고, 부수 효과로 번들도 쪼개진다.
 */
const withSuspense = (load: () => Promise<{ default: React.ComponentType }>) => {
  const Lazy = lazy(load)
  return function LazyView() {
    return (
      <Suspense fallback={null}>
        <Lazy />
      </Suspense>
    )
  }
}

const SpecWorkspace = withSuspense(() =>
  import('./screens/SpecWorkspace').then((m) => ({ default: m.SpecWorkspace }))
)
const CanvasWorkspace = withSuspense(() =>
  import('./screens/CanvasWorkspace').then((m) => ({ default: m.CanvasWorkspace }))
)
const FeaturesWorkspace = withSuspense(() =>
  import('./screens/FeaturesWorkspace').then((m) => ({ default: m.FeaturesWorkspace }))
)
const FlowsWorkspace = withSuspense(() =>
  import('./screens/FlowsWorkspace').then((m) => ({ default: m.FlowsWorkspace }))
)
const ReviewWorkspace = withSuspense(() =>
  import('./screens/ReviewWorkspace').then((m) => ({ default: m.ReviewWorkspace }))
)
// Style 은 뷰 둘이 같은 컴포넌트를 쓰고 `view` 로 갈린다 — 토큰과 그 결과를 한 화면에서 오가야 해서.
const TokensView = withSuspense(() =>
  import('./screens/StyleWorkspace').then((m) => ({ default: () => <m.StyleWorkspace view="tokens" /> }))
)
const ComponentsView = withSuspense(() =>
  import('./screens/StyleWorkspace').then((m) => ({
    default: () => <m.StyleWorkspace view="components" />
  }))
)
const NodeDialog = withSuspense(() =>
  import('./screens/NodeDialog').then((m) => ({ default: m.NodeDialog }))
)

/** 컨텍스트 바 액션에서 스토어를 부른다 — 위와 같은 이유로 여기서도 정적 import 를 피한다. */
const openProjectDialog = (): void => {
  void import('./store').then((m) =>
    m.useSpecStore.getState().openDialog({ level: 'project', parentId: null })
  )
}

/**
 * UI/UX 서비스 IA (골격). 명세 정본은 `docs/spec/uiux-ia.md`.
 *
 * 제품의 화면과 그 규칙을 설계하는 자리. 코드를 만들지도, 구현이 설계대로인지 판정하지도 않는다 —
 * 판정은 코드를 아는 주체(에이전트)가 하고 이 서비스는 그 결과를 받아 적는다.
 *
 * 설계 대상의 위계는 6층이다:
 *   Project > Application > Service > Surface > Section > Component
 * 여기서 "Service" 는 좌측 레일의 rockury 서비스(uiux·api·db…)가 아니라 설계 대상의 3층
 * (로그인 서비스·상품 관리 서비스…)이다. 주소 체계도 둘로 나뉜다 — 이 서비스 자신의 화면은
 * `uiux.<모듈>[.<뷰>]`, 설계 대상 화면은 `<project>.<application>.<service>.<surface>`.
 *
 * 화면은 아직 placeholder(경로 배지만)다.
 */
const view = (icon: LucideIcon, depth: string, title: string, subtitle: string) => () =>
  <PlaceholderView icon={icon} depth={depth} title={title} subtitle={subtitle} />

export const uiuxService: Service = {
  id: 'uiux',
  label: 'UI/UX',
  icon: Palette,
  // 서비스 전역 오버레이 — 위계 노드 만들기·고치기 모달(컨텍스트 바 액션·트리·빈 상태 CTA 로 열린다).
  Overlay: NodeDialog,
  context: [
    {
      // 프로젝트(쿠팡·배민…)는 런타임 데이터 — `services/uiux/store` 가 옵션을 주입한다.
      id: 'project',
      label: 'Project',
      icon: FolderKanban,
      placeholder: '프로젝트 선택',
      options: [],
      actions: [
        {
          id: 'create-project',
          label: '새 프로젝트…',
          icon: Plus,
          onSelect: openProjectDialog
        }
      ]
    },
    {
      // 설계 스냅샷 렌즈. DB 서비스의 Version 과 같은 뜻 — Draft(편집 중) / 커밋 버전(읽기 전용).
      id: 'version',
      label: 'Version',
      icon: History,
      defaultOptionId: 'draft',
      options: [{ id: 'draft', label: 'Draft', hint: '편집 중' }]
    },
    {
      // 뷰포트는 화면을 세 벌 만드는 게 아니라 같은 화면의 다른 렌즈다(한 Surface + 뷰포트별 덮어쓰기).
      // 세 벌로 나누면 정합성이 즉시 무너진다.
      id: 'viewport',
      label: 'Viewport',
      icon: MonitorSmartphone,
      defaultOptionId: 'pc',
      options: [
        { id: 'pc', label: 'PC' },
        { id: 'tablet', label: '태블릿' },
        { id: 'mobile', label: '모바일' }
      ]
    }
  ],
  // Application 은 컨텍스트 셀렉터가 아니다 — 전역으로 올리면 앱을 넘나드는 흐름
  // (판매자 앱 등록 → 관리자 앱 승인 → 이용자 앱 노출)이 끊긴다. Screens·Flows 화면 헤더의 필터로 둔다.
  //
  // 모듈에 area 를 주지 않는다: DB 서비스는 설계부/운영부로 갈리지만 이 서비스는 전부 설계부다.
  modules: [
    {
      // 첫 칸인 이유: 새 데이터를 거의 안 만들면서(트리는 화면들에서 도출) 상태 집계의 뼈대이고,
      // 사람과 에이전트 양쪽의 목차다. 제품 소개 한 줄도 여기 헤더로 접는다.
      id: 'features',
      label: 'Features',
      icon: Blocks,
      workspace: FeaturesWorkspace
    },
    {
      id: 'screens',
      label: 'Screens',
      icon: Frame,
      views: [
        { id: 'canvas', label: 'Canvas', icon: PenTool, workspace: CanvasWorkspace },
        { id: 'spec', label: 'Spec', icon: ListTree, workspace: SpecWorkspace },
        { id: 'review', label: 'Review', icon: MessageSquare, workspace: ReviewWorkspace }
      ]
    },
    {
      id: 'flows',
      label: 'Flows',
      icon: Workflow,
      workspace: FlowsWorkspace
    },
    {
      id: 'rules',
      label: 'Rules',
      icon: ShieldCheck,
      workspace: view(
        ShieldCheck,
        'depth 2 · UI/UX › Rules',
        'Rules',
        '값 제약·검증 피드백·활성 조건과, 그 규칙이 어느 계층에서 흘러왔는지.'
      )
    },
    {
      id: 'style',
      label: 'Style',
      icon: Paintbrush,
      views: [
        { id: 'tokens', label: 'Tokens', icon: Braces, workspace: TokensView },
        { id: 'components', label: 'Components', icon: Component, workspace: ComponentsView }
      ]
    },
    {
      id: 'versions',
      label: 'Versions',
      icon: History,
      views: [
        {
          id: 'timeline',
          label: 'Timeline',
          icon: Milestone,
          workspace: view(
            Milestone,
            'depth 3 · Versions › Timeline',
            'Timeline',
            '설계 스냅샷의 흐름 — 언제 무엇이 컷됐나.'
          )
        },
        {
          id: 'diff',
          label: 'Diff',
          icon: GitCompare,
          workspace: view(
            GitCompare,
            'depth 3 · Versions › Diff',
            'Diff',
            '두 버전의 차이 — 화면·흐름·규칙·토큰 단위로.'
          )
        }
      ]
    }
  ]
}
