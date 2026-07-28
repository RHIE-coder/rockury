import {
  ArrowDownToLine,
  BookOpen,
  FlaskConical,
  GitCompare,
  History as HistoryIcon,
  Inbox,
  Milestone,
  PenTool,
  Plug,
  Plus,
  Radar,
  Route,
  ScrollText,
  Send,
  Server,
  Upload,
  Waves
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Service, WorkspaceComponent } from '@renderer/nav/types'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { RequestsWorkspace } from './studio/RequestsWorkspace'
import { DocsWorkspace } from './studio/DocsWorkspace'
import { CreateSpecDialog } from './specs/CreateSpecDialog'
import { TransferDialog } from './specs/TransferDialog'
import { EnvironmentsView } from './ops/EnvironmentsView'
import { SendView } from './runner/SendView'
import { HistoryView } from './runner/HistoryView'
import { StreamView } from './runner/StreamView'
import { TimelineView } from './versions/TimelineView'
import { DiffView } from './versions/DiffView'
import { DriftView } from './contract/DriftView'
import { AcceptView } from './contract/AcceptView'
import { LogsView } from './contract/LogsView'
import { useApiStore } from './store'
import './ops/store' // 환경 셀렉터 옵션·명세 전환 구독(부수효과 모듈)
import './rehydration' // 에이전트(MCP) 쓰기 → api:changed → 스코프 재조회 구독(부수효과 모듈)

/**
 * API 서비스 IA — 정본 `docs/spec/api-service.md` §3.
 *
 *   설계부(design) : 명세를 짓고 버전을 컷한다. 환경 무관.
 *   운영부(ops)    : active 환경에 대고 쏘고, 그 기록으로 판정한다.
 *
 * 지금 구현된 것: Studio(Requests·Docs) · Versions(Timeline·Diff) · Environments ·
 * Runner(Send·History·Stream) · Contract(Drift·Accept·Logs).
 * 남은 자리(Mocking·Inbox)는 비워 두지 않고 자리표시자로 둔다 — 비우면 IA 가 다시
 * 흔들리고, 자리가 있으면 무엇이 남았는지 화면이 말해 준다.
 */

const soon = (
  icon: LucideIcon,
  depth: string,
  title: string,
  subtitle: string
): WorkspaceComponent => {
  const View = (): React.JSX.Element => (
    <PlaceholderView icon={icon} depth={depth} title={title} subtitle={subtitle} />
  )
  return View
}

export const apiService: Service = {
  id: 'api',
  label: 'API',
  icon: Plug,

  // 명세는 nav 계층이 아니라 컨텍스트 바의 셀렉터다 — depth 를 안 늘린다(spec §3).
  // 옵션은 store.ts 가 런타임에 밀어 넣는다.
  context: [
    {
      id: 'spec',
      label: '명세',
      icon: Plug,
      options: [],
      placeholder: '명세 선택',
      actions: [
        {
          id: 'create-spec',
          label: '새 API 명세…',
          icon: Plus,
          onSelect: () => useApiStore.getState().openCreate()
        },
        {
          id: 'transfer-spec',
          label: '가져오기 · 내보내기…',
          icon: Upload,
          onSelect: () => useApiStore.getState().openTransfer()
        }
      ]
    },
    {
      // **기본 선택이 없다.** 고르기 전에는 실행이 막힌다 — PROD 오조작 방지(guard AC-1).
      // 서비스를 나갔다 오거나 명세를 바꾸면 다시 "선택 안 됨"으로 돌아간다.
      id: 'env',
      label: '환경',
      icon: Server,
      options: [],
      placeholder: '환경 선택',
      activeInAreas: ['ops']
    }
  ],

  modules: [
    {
      id: 'studio',
      label: 'Studio',
      icon: PenTool,
      area: 'design',
      views: [
        { id: 'requests', label: 'Requests', icon: Route, workspace: RequestsWorkspace },
        { id: 'docs', label: 'Docs', icon: BookOpen, workspace: DocsWorkspace },
        {
          id: 'mocking',
          label: 'Mocking',
          icon: FlaskConical,
          workspace: soon(
            FlaskConical,
            'depth 3 · API › Studio › Mocking',
            'Mocking',
            '선언한 응답 모양으로 가짜 서버를 띄웁니다 — 프론트가 백엔드 완성을 안 기다려도 되게. (후속)'
          )
        }
      ]
    },
    {
      id: 'versions',
      label: 'Versions',
      icon: Milestone,
      area: 'design',
      views: [
        { id: 'timeline', label: 'Timeline', icon: Milestone, workspace: TimelineView },
        { id: 'diff', label: 'Diff', icon: GitCompare, workspace: DiffView }
      ]
    },
    {
      id: 'environments',
      label: 'Environments',
      icon: Server,
      area: 'ops',
      workspace: EnvironmentsView
    },
    {
      id: 'runner',
      label: 'Runner',
      icon: Send,
      area: 'ops',
      views: [
        { id: 'send', label: 'Send', icon: Send, workspace: SendView },
        { id: 'history', label: 'History', icon: HistoryIcon, workspace: HistoryView },
        { id: 'stream', label: 'Stream', icon: Waves, workspace: StreamView },
        {
          id: 'inbox',
          label: 'Inbox',
          icon: Inbox,
          workspace: soon(
            Inbox,
            'depth 3 · API › Runner › Inbox',
            'Inbox',
            '웹훅 수신 — 내가 안 보냈는데 들어오는 것. 1차는 이 컴퓨터 안에서만 닿습니다. (후속)'
          )
        }
      ]
    },
    {
      id: 'contract',
      label: 'Contract',
      icon: Radar,
      area: 'ops',
      views: [
        { id: 'drift', label: 'Drift', icon: Radar, workspace: DriftView },
        { id: 'accept', label: 'Accept', icon: ArrowDownToLine, workspace: AcceptView },
        { id: 'logs', label: 'Logs', icon: ScrollText, workspace: LogsView }
      ]
    }
  ],

  // 서비스 오버레이는 하나뿐이라 모달들을 한 조각으로 묶어 마운트한다.
  Overlay: (): React.JSX.Element => (
    <>
      <CreateSpecDialog />
      <TransferDialog />
    </>
  )
}
