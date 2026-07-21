import { useState } from 'react'
import { CheckCircle2, Loader2, Pencil, Plug, Plus, Server, Trash2, XCircle } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { useNav } from '@renderer/nav/useNav'
import { cn } from '@renderer/lib/utils'
import { dialectInfo } from '../dialects'
import { useConnectionsStore, type ConnStatus, type ConnectionDef } from './store'

function StatusPill({ status }: { status?: ConnStatus }) {
  const s = status?.state ?? 'idle'
  if (s === 'testing')
    return <span className="flex items-center gap-1.5 text-[11px] text-muted"><Loader2 className="size-3 animate-spin" /> 확인 중…</span>
  if (s === 'ok')
    return <span className="flex items-center gap-1.5 text-[11px] text-success" title={status?.serverVersion}><CheckCircle2 className="size-3" /> 연결됨 · {status?.latencyMs}ms</span>
  if (s === 'error')
    return <span className="flex items-center gap-1.5 text-[11px] text-destructive" title={status?.message}><XCircle className="size-3" /> 실패</span>
  return <span className="flex items-center gap-1.5 text-[11px] text-muted"><span className="size-1.5 rounded-full bg-muted/50" /> 미확인</span>
}

function ConnCard({ conn, active }: { conn: ConnectionDef; active: boolean }) {
  const setContextValue = useNav((s) => s.setContextValue)
  const status = useConnectionsStore((s) => s.statusMap[conn.id])
  const testExisting = useConnectionsStore((s) => s.testExisting)
  const openEdit = useConnectionsStore((s) => s.openEdit)
  const remove = useConnectionsStore((s) => s.remove)
  const [confirming, setConfirming] = useState(false)
  const info = dialectInfo(conn.dbType)
  const target = conn.dbType === 'sqlite' ? conn.database : `${conn.host}:${conn.port}/${conn.database}`

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setContextValue('conn', conn.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setContextValue('conn', conn.id)}
      className={cn(
        'group flex cursor-pointer flex-col gap-2.5 rounded-xl border p-3.5 text-left transition-colors outline-none',
        active ? 'border-accent bg-accent-soft/40 ring-1 ring-accent/30' : 'border-line bg-canvas hover:bg-panel'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13.5px] font-semibold text-fg">{conn.name}</span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <span className="size-1.5 rounded-full" style={{ background: info.dot }} />
            {info.label}
          </span>
        </div>
        {active && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">활성</span>}
      </div>

      <div className="truncate font-mono text-[11.5px] text-muted" title={target}>{target}</div>

      <div className="mt-0.5 flex items-center justify-between border-t border-line pt-2">
        <StatusPill status={status} />
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="size-7 text-muted hover:text-accent" title="연결 테스트" onClick={() => void testExisting(conn.id)}>
            <Plug className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7 text-muted hover:text-fg" title="편집" onClick={() => openEdit(conn)}>
            <Pencil className="size-3.5" />
          </Button>
          {confirming ? (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setConfirming(false)}>취소</Button>
              <Button variant="destructive" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => void remove(conn.id)}>삭제</Button>
            </div>
          ) : (
            <Button variant="ghost" size="icon" className="size-7 text-muted hover:text-destructive" title="삭제" onClick={() => setConfirming(true)}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Connections 모듈(운영부 · depth 2) — 원시 접속 카드 그리드(설계 무관).
 * 카드 클릭 = 활성 Connection(컨텍스트 바 동기화) → Console/Migration 이 이걸 대상으로 동작.
 */
export function ConnectionsView() {
  const connections = useConnectionsStore((s) => s.connections)
  const openCreate = useConnectionsStore((s) => s.openCreate)
  const activeId = useNav((s) => s.contextValues['conn'])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">Connections</h2>
          <p className="text-[12px] text-muted">DB 접속 · 카드를 누르면 활성 연결로 설정됩니다 (설계 없이도 조회·쿼리 가능)</p>
        </div>
        <Button size="sm" onClick={() => openCreate()}>
          <Plus /> 새 연결
        </Button>
      </div>

      {connections.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
            <Server size={24} strokeWidth={1.8} />
          </div>
          <h3 className="text-[15px] font-semibold text-fg">아직 연결이 없어요</h3>
          <p className="max-w-md text-[13px] leading-relaxed text-muted">
            모니터링·조회할 DB 접속을 등록하세요. 설계에 묶지 않아도 Console 에서 바로 쓸 수 있고, 배포/마이그레이션이 필요하면 나중에 설계에 바인딩합니다.
          </p>
          <Button size="sm" className="mt-1" onClick={() => openCreate()}>
            <Plus /> 첫 연결 만들기
          </Button>
        </div>
      ) : (
        <div className="grid flex-1 auto-rows-min gap-3 overflow-auto p-5 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {connections.map((c) => (
            <ConnCard key={c.id} conn={c} active={c.id === activeId} />
          ))}
        </div>
      )}
    </div>
  )
}
