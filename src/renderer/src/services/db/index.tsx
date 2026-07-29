import {
  ArrowRightLeft,
  BookOpen,
  Boxes,
  Database,
  FileDiff,
  FileText,
  GitBranch,
  GitCompare,
  History,
  Layers,
  Milestone,
  Monitor,
  Network,
  PenTool,
  Play,
  Pencil,
  Plus,
  Radar,
  ScrollText,
  Server,
  ShieldCheck,
  Shuffle,
  Sprout,
  Table2,
  TableProperties,
  Terminal
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Service } from '@renderer/nav/types'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { DefinitionWorkspace } from './workspaces/definition/DefinitionWorkspace'
import { DefinitionToolbar } from './workspaces/definition/DefinitionToolbar'
import { StudioDiagramWorkspace } from './workspaces/diagram/StudioDiagramWorkspace'
import { SeedWorkspace } from './workspaces/seed/SeedWorkspace'
import { DesignDialogs } from './designs/DesignDialogs'
import { useDesignsStore } from './designs/store'
import { TimelineView } from './versions/TimelineView'
import { VersionDiffView } from './versions/VersionDiffView'
import { VersionLens } from './versions/VersionLens'
import { ConnectionsView } from './connections/ConnectionsView'
import { ObjectView } from './console/ObjectView'
import { DiagramView } from './console/DiagramView'
import { DefinitionView } from './console/DefinitionView'
import { QueryView } from './console/QueryView'
import { DataView } from './console/DataView'
import { CollectionView } from './console/CollectionView'
import { HistoryView } from './console/HistoryView'
import { DriftView, PlanView, RunView, LogsView } from './migration/views'
import { CompareView } from './migration/CompareView'
import { SeedOpsView } from './migration/SeedOpsView'
import './rehydration' // 에이전트(MCP) 쓰기 → store:changed → 스코프 재조회 구독(부수효과 모듈)

/**
 * DB 서비스 IA (확정본).
 *
 *   설계부(design) : 버전 중심. 도면을 짓고 버전을 컷한다. Env 무관.
 *   운영부(ops)    : active Env 중심. Connection 에 붙어 조회/반영한다.
 *   공통(common)   : Reference.
 *
 * 두 부서는 정의된 문으로만 오간다:
 *   설계→운영  Versions 에서 컷한 버전을 Migration 이 Environment 에 반영
 *   운영→설계  Migration/Drift 가 캡처한 변경을 Versions 에 새 버전으로 되먹임
 *
 * depth 는 Service→Module→View 3단이며, Design·시점·Connection 은 nav 계층이 아니라
 * 모듈 줄의 구획 뱃지가 든 ambient 셀렉터다(설계 뱃지 = 설계+시점, 운영 뱃지 = 연결).
 */
const view = (icon: LucideIcon, depth: string, title: string, subtitle: string) => () =>
  <PlaceholderView icon={icon} depth={depth} title={title} subtitle={subtitle} />

export const dbService: Service = {
  id: 'db',
  label: 'DB',
  icon: Database,
  // 서비스 전역 오버레이 — 설계 생성/관리 모달(컨텍스트 바 액션·빈 상태 CTA 로 열린다).
  Overlay: DesignDialogs,
  // 상단 컨텍스트 바는 **없다**(2026-07-30 사용자 결정). 셋 다 `area` 를 달아 모듈 줄의
  // 구획 뱃지 손잡이로 갔다 — '설계' 뱃지가 설계와 그 시점을, '운영' 뱃지가 연결을 든다.
  // 대상이 자기 구획 안에 들어가 있으면 소속을 글자로 설명할 필요가 없고, 줄도 하나 줄어든다.
  context: [
    {
      // 설계는 런타임 데이터 — designs/store 가 contextOptions 레지스트리로 옵션을 주입한다.
      // 벤더(방언)는 설계의 고정 속성이라 옵션 hint/dot 으로 함께 노출된다.
      id: 'design',
      label: 'Design',
      area: 'design',
      icon: Layers,
      placeholder: '설계 선택',
      options: [],
      actions: [
        {
          id: 'create-design',
          label: '새 설계…',
          icon: Plus,
          onSelect: () => useDesignsStore.getState().openCreate()
        },
        {
          id: 'manage-designs',
          label: '설계 관리…',
          icon: Pencil,
          onSelect: () => useDesignsStore.getState().openManage()
        }
      ]
    },
    {
      // 시점 렌즈(Draft ↔ 커밋 버전) — 설계 바로 뒤 칸. 셸이 값을 들지 않고 서비스가 직접 그린다
      // (`Render`): 목록이 활성 설계에 딸려 바뀌고 드롭다운 모양도 다르다. 상태는 `versions/store.ts`.
      // 자리 이력: 상단 바(~2026-07-29) → Studio 도구줄 → 설계 뱃지 손잡이(2026-07-30).
      id: 'lens',
      label: '시점',
      area: 'design',
      options: [],
      Render: VersionLens
    },
    {
      // 연결(1급)도 런타임 데이터 → connections/store 가 옵션을 주입한다.
      // Console 은 이 연결만으로 동작하고, Migration 은 여기에 active Design 을 더해 바인딩한다.
      id: 'conn',
      label: 'Connection',
      area: 'ops',
      icon: Server,
      placeholder: '연결 선택',
      options: []
    }
  ],
  modules: [
    // Overview 는 **없앴다**(2026-07-30 사용자 결정). 하려던 일("설계 하나가 환경마다 몇 버전으로
    // 나가 있나")은 Connections 의 바인딩 목록과 Migration › Drift 가 이미 나눠 갖고 있었고,
    // 빈 화면인 채로 첫 자리를 차지해 DB 서비스의 첫인상이 빈 화면이었다. 이제 Studio 로 착지한다.

    // ── 설계부 ──────────────────────────────────────────────────────────────
    {
      id: 'studio',
      label: 'Studio',
      icon: PenTool,
      area: 'design',
      views: [
        // 시점 손잡이는 여기 없다 — 설계 뱃지가 들고 있어 Studio·Versions 전 뷰에서 늘 같은 자리다.
        // Diagram·Seed 는 그래서 도구줄 자체가 없어졌다(손잡이 하나만 세우던 줄이었다).
        { id: 'definition', label: 'Definition', icon: TableProperties, workspace: DefinitionWorkspace, Toolbar: DefinitionToolbar },
        { id: 'diagram', label: 'Diagram', icon: GitBranch, workspace: StudioDiagramWorkspace },
        { id: 'seed', label: 'Seed', icon: Sprout, workspace: SeedWorkspace },
        { id: 'mocking', label: 'Mocking', icon: Shuffle, workspace: view(Shuffle, 'depth 3 · Studio › Mocking', 'Mocking', '목업 데이터 생성 규칙을 설정한다') },
        { id: 'documenting', label: 'Documenting', icon: FileText, workspace: view(FileText, 'depth 3 · Studio › Documenting', 'Documenting', '스키마 문서를 작성/생성한다') },
        { id: 'validation', label: 'Validation', icon: ShieldCheck, workspace: view(ShieldCheck, 'depth 3 · Studio › Validation', 'Validation', '설계 단계 제약/무결성 규칙을 검증한다') }
      ]
    },
    {
      id: 'versions',
      label: 'Versions',
      icon: History,
      area: 'design',
      views: [
        { id: 'timeline', label: 'Timeline', icon: Milestone, workspace: TimelineView },
        { id: 'diff', label: 'Version Diff', icon: GitCompare, workspace: VersionDiffView }
      ]
    },

    // ── 운영부 ──────────────────────────────────────────────────────────────
    {
      id: 'connections',
      label: 'Connections',
      icon: Server,
      area: 'ops',
      workspace: ConnectionsView
    },
    {
      id: 'console',
      label: 'Console',
      icon: Monitor,
      area: 'ops',
      views: [
        { id: 'definition', label: 'Definition', icon: TableProperties, workspace: DefinitionView },
        { id: 'diagram', label: 'Diagram', icon: Network, workspace: DiagramView },
        { id: 'data', label: 'Data', icon: Table2, workspace: DataView },
        { id: 'query', label: 'Query', icon: Terminal, workspace: QueryView },
        { id: 'collection', label: 'Collection', icon: Layers, workspace: CollectionView },
        { id: 'history', label: 'History', icon: History, workspace: HistoryView },
        { id: 'object', label: 'Object', icon: Boxes, workspace: ObjectView }
      ]
    },
    {
      id: 'migration',
      label: 'Migration',
      icon: ArrowRightLeft,
      area: 'ops',
      views: [
        { id: 'drift', label: 'Drift', icon: Radar, workspace: DriftView },
        { id: 'plan', label: 'Plan', icon: FileDiff, workspace: PlanView },
        // 시드 반영·되먹임 — 스키마(Plan/Run)와 갈라 둔다: 대상이 데이터고 게이트도 따로다.
        { id: 'seed', label: 'Seed', icon: Sprout, workspace: SeedOpsView },
        { id: 'run', label: 'Run', icon: Play, workspace: RunView },
        // 실DB↔실DB 비교(DEV·STG·PROD) — 설계 무관, 연결 2개만 필요.
        { id: 'compare', label: 'Compare', icon: GitCompare, workspace: CompareView },
        { id: 'logs', label: 'Logs', icon: ScrollText, workspace: LogsView }
      ]
    },

    // ── 공통 ────────────────────────────────────────────────────────────────
    {
      id: 'reference',
      label: 'Reference',
      icon: BookOpen,
      area: 'common',
      workspace: view(BookOpen, 'depth 2 · DB › Reference', 'Reference', '데이터 사전/문서(reference)')
    }
  ]
}
