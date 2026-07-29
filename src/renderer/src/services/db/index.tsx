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
  LayoutDashboard,
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
import { StudioLensToolbar } from './versions/VersionLens'
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
 *   공통(common)   : Overview · Reference.
 *
 * 두 부서는 정의된 문으로만 오간다:
 *   설계→운영  Versions 에서 컷한 버전을 Migration 이 Environment 에 반영
 *   운영→설계  Migration/Drift 가 캡처한 변경을 Versions 에 새 버전으로 되먹임
 *
 * 화면은 아직 placeholder(경로 배지만). depth 는 Service→Module→View 3단이며
 * Design/Env 는 nav 계층이 아니라 상단 컨텍스트 바의 ambient 셀렉터다.
 */
const view = (icon: LucideIcon, depth: string, title: string, subtitle: string) => () =>
  <PlaceholderView icon={icon} depth={depth} title={title} subtitle={subtitle} />

export const dbService: Service = {
  id: 'db',
  label: 'DB',
  icon: Database,
  // 서비스 전역 오버레이 — 설계 생성/관리 모달(컨텍스트 바 액션·빈 상태 CTA 로 열린다).
  Overlay: DesignDialogs,
  context: [
    {
      // 설계는 런타임 데이터 — designs/store 가 contextOptions 레지스트리로 옵션을 주입한다.
      // 벤더(방언)는 설계의 고정 속성이라 옵션 hint/dot 으로 함께 노출된다.
      id: 'design',
      label: 'Design',
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
    // 버전 렌즈(Draft ↔ 커밋 버전)는 **여기 없다.** 2026-07-29 사용자 결정으로 Studio 도구줄로
    // 내렸다(`versions/VersionLens.tsx`). 이 바의 다른 칸은 "무엇을 대상으로 하느냐"인데 렌즈만
    // "그 대상을 언제 시점으로 보느냐"라 성격이 달랐고, 읽는 화면도 Studio 셋뿐이라 운영부에서는
    // 아무 일도 안 했다. 상태는 `versions/store.ts` 의 `lens` 가 든다.
    {
      // 연결(1급)도 런타임 데이터 → connections/store 가 옵션을 주입한다. 운영부에서만 활성.
      // Console 은 이 연결만으로 동작하고, Migration 은 여기에 active Design 을 더해 바인딩한다.
      id: 'conn',
      label: 'Connection',
      icon: Server,
      activeInAreas: ['ops'],
      placeholder: '연결 선택',
      options: []
    }
  ],
  modules: [
    // ── 공통 ────────────────────────────────────────────────────────────────
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      area: 'common',
      workspace: view(LayoutDashboard, 'depth 2 · DB › Overview', 'Overview', '현재 Design 의 전 환경 상태(환경별 적용버전·드리프트)를 한눈에')
    },

    // ── 설계부 ──────────────────────────────────────────────────────────────
    {
      id: 'studio',
      label: 'Studio',
      icon: PenTool,
      area: 'design',
      views: [
        // 시점 손잡이(Version 렌즈)는 그것을 읽는 세 뷰에만 붙는다 —
        // Definition 은 자기 도구줄이 이미 있고, Diagram·Seed 는 손잡이만 있는 도구줄을 쓴다.
        // 아래 Mocking·Documenting·Validation 은 아직 화면이 없어 붙이지 않는다.
        { id: 'definition', label: 'Definition', icon: TableProperties, workspace: DefinitionWorkspace, Toolbar: DefinitionToolbar },
        { id: 'diagram', label: 'Diagram', icon: GitBranch, workspace: StudioDiagramWorkspace, Toolbar: StudioLensToolbar },
        { id: 'seed', label: 'Seed', icon: Sprout, workspace: SeedWorkspace, Toolbar: StudioLensToolbar },
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
