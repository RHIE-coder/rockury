import {
  ArrowRightLeft,
  BookOpen,
  Boxes,
  Database,
  DownloadCloud,
  FileDiff,
  FileText,
  GitBranch,
  GitCompare,
  History,
  Layers,
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
import { DesignDiagramWorkspace } from './workspaces/diagram/DesignDiagramWorkspace'
import { SeedWorkspace } from './workspaces/seed/SeedWorkspace'
// 설계부의 Query·Collection 은 운영부와 **같은 컴포넌트**다 — 접속이 필요한 동작만 잠긴다.
// 한때 설계부용으로 줄인 화면을 따로 뒀는데, 옮기라고 한 것을 새로 만든 것이라 되돌렸다(2026-08-05).
import { DesignQueryView } from './remote/QueryView'
import { DesignCollectionView } from './remote/CollectionView'
import { DesignDialogs } from './designs/DesignDialogs'
import { DesignScopeSelector } from './designs/DesignScopeSelector'
import { useDesignsStore } from './designs/store'
import { VersionsView } from './versions/VersionsView'
import { ScopeSelector } from './connections/ScopeSelector'
import { VersionLens } from './versions/VersionLens'
import { ConnectionsView } from './connections/ConnectionsView'
import { ObjectView } from './remote/ObjectView'
import { GrantView } from './remote/GrantView'
import { DiagramView } from './remote/DiagramView'
import { DefinitionView } from './remote/DefinitionView'
import { QueryView } from './remote/QueryView'
import { DataView } from './remote/DataView'
import { CollectionView } from './remote/CollectionView'
import { HistoryView } from './remote/HistoryView'
import { DiagnoseView, ImportView, PlanView, RunView, LogsView } from './migration/views'
import { CompareView } from './migration/CompareView'
import { SeedOpsView } from './migration/SeedOpsView'
import './rehydration' // 에이전트(MCP) 쓰기 → store:changed → 스코프 재조회 구독(부수효과 모듈)

/**
 * DB 서비스 IA (확정본).
 *
 *   설계부(design) : Design. 버전 중심으로 도면을 짓고 버전을 컷한다. Env 무관.
 *   운영부(ops)    : Remote. active Env 중심. Connection 에 붙어 조회/반영한다.
 *   건너가는 자리   : Migration. 어느 부서도 아니다.
 *
 * 모듈 줄은 이 셋뿐이다(2026-08-03 사용자 요청) — Versions·Reference 는 Design 안 뷰로 내려갔다.
 *
 * 두 부서는 정의된 문으로만 오간다:
 *   설계→운영  Design › Versions 에서 컷한 버전을 Migration 이 Environment 에 반영
 *   운영→설계  Migration/Drift 가 캡처한 변경을 Design › Versions 에 새 버전으로 되먹임
 *
 * depth 는 Service→Module→View 3단이며, Design·시점·Connection·범위는 nav 계층이 아니라
 * **구획 손잡이**가 든 ambient 셀렉터다(설계 손잡이 = 설계+시점, 운영 손잡이 = 연결+범위).
 * 그 구획을 쓰는 모듈을 보는 동안에만 뜬다. 자리는 모듈 줄 양끝이다 — 왼쪽이 설계, 오른쪽이 운영.
 */
const view = (icon: LucideIcon, depth: string, title: string, subtitle: string) => () =>
  <PlaceholderView icon={icon} depth={depth} title={title} subtitle={subtitle} />

export const dbService: Service = {
  id: 'db',
  label: 'DB',
  icon: Database,
  // 서비스 전역 오버레이 — 설계 생성/관리 모달(컨텍스트 바 액션·빈 상태 CTA 로 열린다).
  Overlay: DesignDialogs,
  // 상단 컨텍스트 바는 **없다**(2026-07-30 사용자 결정). 넷 다 `area` 를 달아 구획 손잡이로
  // 갔다 — 설계 손잡이가 설계와 그 시점을, 운영 손잡이가 연결과 범위를 든다. 줄이 하나 줄고,
  // 대상이 자기 구획 안에 들어가 있으면 소속을 글자로 설명할 필요가 없다.
  // 손잡이 자리 이력: 모듈 줄 → 뷰 탭 줄 오른쪽 끝(2026-08-02) → **모듈 줄 양끝**(2026-08-05).
  // 2026-08-02 에 내렸던 이유는 "맨 위에 못박혀 있어 설계 화면에 연결이, 운영 화면에 설계가 늘
  // 같이 떠 있다"였는데, 그건 자리가 아니라 **늘 뜨는 것**이 문제였다. 지금은 어느 자리에 있든
  // 그것을 쓰는 화면에서만 뜬다(`handlesFor`). 그래서 양옆이 비어 있는 모듈 줄로 다시 올렸고,
  // 뷰 탭 줄은 탭에만 쓴다.
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
      // 자리 이력: 상단 바(~2026-07-29) → Design 도구줄 → 설계 뱃지 손잡이(2026-07-30).
      id: 'lens',
      label: '시점',
      area: 'design',
      options: [],
      Render: VersionLens
    },
    {
      // 설계 범위 — 그 설계에서 볼 스키마들. 시점 바로 뒤 칸이다(2026-08-03 사용자 요청:
      // "Remote 화면처럼 스키마를 고를 항목이 없다 — 버전 옆에 붙여 달라").
      // 운영부의 `scope` 와 같은 개념이지만 목록의 출처가 다르다: 실 DB 가 아니라 **설계 안
      // 테이블**에서 뽑는다(연결이 없어도 뜬다). 값은 설계에 저장된다.
      id: 'design-scope',
      label: '범위',
      area: 'design',
      options: [],
      Render: DesignScopeSelector
    },
    {
      // 연결(1급)도 런타임 데이터 → connections/store 가 옵션을 주입한다.
      // Remote 는 이 연결만으로 동작하고, Migration 은 여기에 active Design 을 더해 바인딩한다.
      id: 'conn',
      label: 'Connection',
      area: 'ops',
      icon: Server,
      placeholder: '연결 선택',
      options: []
    },
    {
      // 범위(scope) — 그 연결에서 볼 스키마들. 운영 손잡이의 연결 바로 뒤 칸이고, 셸이 값을 들지 않고 서비스가
      // 직접 그린다(`Render`): 목록이 활성 연결에 딸려 바뀌고, 벤더마다 층 수가 다르며,
      // 다중 선택이라 일반 셀렉터(값 하나)로는 안 된다. 값은 연결에 저장된다.
      id: 'scope',
      label: '범위',
      area: 'ops',
      options: [],
      Render: ScopeSelector
    }
  ],
  modules: [
    // Overview 는 **없앴다**(2026-07-30 사용자 결정). 하려던 일("설계 하나가 환경마다 몇 버전으로
    // 나가 있나")은 Connections 의 바인딩 목록과 Migration › Drift 가 이미 나눠 갖고 있었고,
    // 빈 화면인 채로 첫 자리를 차지해 DB 서비스의 첫인상이 빈 화면이었다. 이제 Design 으로 착지한다.

    // ── 설계부 ──────────────────────────────────────────────────────────────
    {
      id: 'design',
      label: 'Design',
      icon: PenTool,
      area: 'design',
      // 손잡이는 모듈 줄 **왼쪽 위**에 선다(2026-08-05 사용자 요청). 설계부 화면이라 설계 손잡이
      // 하나만 뜨고, 자리는 그 부서가 서 있는 쪽(`ModuleTabs.handleAt`)을 그대로 따른다.
      handleLayout: 'sides',
      views: [
        // 시점 손잡이는 여기 없다 — 설계 손잡이가 들고 있어 이 줄 전 뷰에서 늘 같은 자리다.
        // Diagram·Seed 는 그래서 도구줄 자체가 없어졌다(손잡이 하나만 세우던 줄이었다).
        { id: 'definition', label: 'Definition', icon: TableProperties, workspace: DefinitionWorkspace, Toolbar: DefinitionToolbar },
        { id: 'diagram', label: 'Diagram', icon: GitBranch, workspace: DesignDiagramWorkspace },
        { id: 'seed', label: 'Seed', icon: Sprout, workspace: SeedWorkspace },
        // 라이브러리(저장쿼리·컬렉션) — **준비 전용**. 소속이 연결에서 설계로 옮겨져서 생긴
        // 자리다(2026-08-04 사용자 요청 · `@shared/db/libraryOwner`): 여기서 짜 두면 그 설계에
        // 물린 연결들(DEV·STG·PROD)이 Remote 에서 **같은 한 벌**을 본다. 실행은 여기 없다.
        { id: 'query', label: 'Query', icon: Terminal, workspace: DesignQueryView },
        { id: 'collection', label: 'Collection', icon: Layers, workspace: DesignCollectionView },
        { id: 'mocking', label: 'Mocking', icon: Shuffle, workspace: view(Shuffle, 'depth 3 · Design › Mocking', 'Mocking', '목업 데이터 생성 규칙을 설정한다') },
        { id: 'documenting', label: 'Documenting', icon: FileText, workspace: view(FileText, 'depth 3 · Design › Documenting', 'Documenting', '스키마 문서를 작성/생성한다') },
        { id: 'validation', label: 'Validation', icon: ShieldCheck, workspace: view(ShieldCheck, 'depth 3 · Design › Validation', 'Validation', '설계 단계 제약/무결성 규칙을 검증한다') },
        // Versions·Reference 는 2026-08-03 사용자 요청으로 **모듈에서 여기 뷰로 내려왔다** —
        // 맨 윗줄에 다섯 칸이 서 있으니 "지금 어느 부서에 있나"가 안 읽혔다. 이제 윗줄은
        // `Design ——Migration—— Remote` 세 칸이고, 설계부에서 하는 일은 전부 이 줄 안에 있다.
        //
        // Versions 는 뷰 둘(Timeline·Version Diff)이었는데 **한 뷰로 접었다**: 비교는 타임라인에서
        // 두 줄을 고르면 그 아래에 열린다. 따로 뜬 화면이던 동안은 이미 보고 있던 목록을
        // 셀렉트로 한 번 더 골라야 했다.
        { id: 'versions', label: 'Versions', icon: History, workspace: VersionsView },
        // Reference 는 원래 어느 부서도 아닌 `common` 모듈이었다. Design 안으로 들어오면서
        // 설계 손잡이가 딸려 뜬다 — 문서에 설계를 고르는 자리가 붙는 셈이지만, 문서를 찾는 일은
        // 설계를 보다 생기지 실 DB 를 만지다 생기지 않는다(2026-08-01 자리 결정과 같은 이유).
        { id: 'reference', label: 'Reference', icon: BookOpen, workspace: view(BookOpen, 'depth 3 · Design › Reference', 'Reference', '데이터 사전/문서(reference)') }
      ]
    },

    // ── 건너가는 자리 ────────────────────────────────────────────────────────
    // 줄 한가운데. 설계와 실 DB 를 **견줘서** 계획을 만드는 유일한 모듈이라 어느 쪽 묶음에도
    // 넣지 않고 사이에 세운다. 모양은 `ModuleTabs.ModuleTrigger` 가 준다(테두리 두른 문).
    //
    // 구획이 `common` 인 이유: 어느 부서도 아니기 때문이다. `ops` 로 적어 뒀던 동안은 강조색이
    // 운영 테라코타로 나와, "사이에 세운다"는 이 주석과 화면이 서로 다른 말을 했다
    // (2026-08-02 사용자 피드백 — 중립색이면 좋겠다). 색은 구획을 따라오므로 여기만 고치면 된다.
    {
      id: 'migration',
      label: 'Migration',
      icon: ArrowRightLeft,
      area: 'common',
      slot: 'center',
      // 손잡이만 구획을 안 따른다 — 설계와 실 DB 를 **견주는** 모듈이라 둘 다 골라야 일이 된다.
      // `common` 기본값을 그냥 두면 정작 필요한 손잡이가 둘 다 사라진다.
      handles: ['design', 'ops'],
      // 손잡이 둘이 **함께** 뜨는 유일한 화면이라, 한 줄로 늘어놓으면 탭이 설 자리가 없다.
      // 그래서 여기서만 좌우로 갈라 두 단 카드로 접는다(2026-08-04 사용자 요청).
      // 다른 화면은 이 값을 안 적어 예전 모양 그대로다 — 손잡이는 다섯 서비스가 함께 쓴다.
      handleLayout: 'sides',
      /**
       * 뷰 줄은 **흐름 순서**다: 진단 → 계획 → 실행 → (되먹임) → 기록.
       *
       * 2026-08-10 재편: 예전엔 Drift 와 Plan 이 갈라져 각자 **다른 짝**을 견줬다
       * (Drift 는 기준선↔실제, Plan 은 설계↔실제). 그래서 어느 탭에 있느냐에 따라 "무엇과
       * 무엇"이 달라져, 사용자가 매번 다시 읽어야 했다("화면이 꼬였다").
       *
       * 이제 모든 탭 위에 상태 줄 하나(`Design vX ── Remote vY`)가 서고, **진단**이 그 사이의
       * 차이를 두 갈래(설계가 앞선 것 / DB 가 샌 것)로 갈라 보여 준다. Drift 탭은 진단에
       * 흡수됐고, 맵핑(이 연결이 몇 버전인가)은 진단의 첫 상태가 됐다.
       *
       * 비교만 진단 묶음에 남는다 — 실제↔실제라 축이 다르고, 설계가 없어도 되는 유일한 뷰다.
       */
      views: [
        /*
         * 묶음이 셋이다: **도구**(보는 것) · 설계 → 실제 · 실제 → 설계(하는 것, 방향별).
         * 기록만 있던 묶음은 없앴다 — 항목 하나짜리 묶음은 이름이 항목 이름과 겹쳐
         * 줄 하나를 그냥 먹는다(2026-08-12 사용자).
         */
        { id: 'diagnose', label: '진단', icon: Radar, workspace: DiagnoseView, group: '도구' },
        // 실DB↔실DB 비교(예: 개발기↔운영기) — 설계 무관, 연결 2개만 필요.
        { id: 'compare', label: '비교', icon: GitCompare, workspace: CompareView, group: '도구' },
        { id: 'logs', label: '기록', icon: ScrollText, workspace: LogsView, group: '도구' },
        { id: 'plan', label: '계획', icon: FileDiff, workspace: PlanView, group: '설계 → 실제', groupTone: 'design' },
        { id: 'run', label: '실행', icon: Play, workspace: RunView, group: '설계 → 실제', groupTone: 'design' },
        // 시드 반영 — 스키마(계획/실행)와 갈라 둔다: 대상이 데이터고 게이트도 따로다.
        { id: 'seed', label: 'Seed', icon: Sprout, workspace: SeedOpsView, group: '설계 → 실제', groupTone: 'design' },
        // 되먹임의 문 — 진단·맵핑이 "만들어야 한다"고 판정했을 때 부르는 조치이기도 하다.
        { id: 'import', label: '가져오기', icon: DownloadCloud, workspace: ImportView, group: '실제 → 설계', groupTone: 'ops' }
      ]
    },

    // ── 운영부 ──────────────────────────────────────────────────────────────
    {
      id: 'remote',
      label: 'Remote',
      icon: Monitor,
      area: 'ops',
      slot: 'end',
      // 운영 손잡이는 모듈 줄 **오른쪽 위**(2026-08-05 사용자 요청) — Design 과 좌우로 짝을 이룬다.
      handleLayout: 'sides',
      views: [
        // Connections 는 형제 모듈이 아니라 **Remote 의 첫 뷰**다(2026-07-30 사용자 결정).
        // 연결을 고르는 일이 곧 Remote 가 무엇을 보여줄지 정하는 일이라, 나머지 뷰와 같은 줄
        // 맨 왼쪽에 둔다 — Remote 에 **처음** 들어오면 대상 고르기로 착지하고, 고른 뒤 오른쪽 뷰로
        // 파고든다. 두 번째부터는 마지막에 보던 뷰로 돌아온다(`nav/recall` · 2026-07-30 피드백).
        { id: 'connections', label: 'Connections', icon: Server, workspace: ConnectionsView },
        { id: 'definition', label: 'Definition', icon: TableProperties, workspace: DefinitionView },
        { id: 'diagram', label: 'Diagram', icon: Network, workspace: DiagramView },
        { id: 'data', label: 'Data', icon: Table2, workspace: DataView },
        { id: 'query', label: 'Query', icon: Terminal, workspace: QueryView },
        { id: 'collection', label: 'Collection', icon: Layers, workspace: CollectionView },
        { id: 'history', label: 'History', icon: History, workspace: HistoryView },
        { id: 'object', label: 'Object', icon: Boxes, workspace: ObjectView },
        // 뷰 줄 맨 뒤 — 조회·편집이 아니라 운영 관리 성격(§db-remote.grants)
        { id: 'grants', label: 'Grant', icon: ShieldCheck, workspace: GrantView }
      ]
    }
  ]
}
