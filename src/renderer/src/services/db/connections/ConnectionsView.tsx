import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Database, FolderOpen, FolderPlus, GripVertical, Link2, Loader2, PauseCircle, Pencil, Plug, Plus, RefreshCw, Server, Trash2, XCircle } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { useNav, useContextValue } from '@renderer/nav/useNav'
import { cn } from '@renderer/lib/utils'
import { dialectInfo } from '../dialects'
import { DialectMark } from '../DialectMark'
import { useConnectionBindings, useEnvManageStore } from '../environments/store'
import {
  useConnectionsStore,
  useScopedConnections,
  type ConnGroupDef,
  type ConnStatus,
  type ConnectionDef
} from './store'
import { applyMove, bucketByGroup, insertionIndex, reorderList, verticalInsertionIndex, type Rect } from './dnd'
import { sampleButtonLabel } from '@shared/db/samplePlan'

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
  const openManage = useEnvManageStore((s) => s.openManage)
  const bindings = useConnectionBindings(conn.id)
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
            <DialectMark dialect={conn.dbType} />
            {info.label}
            {conn.autoCheckDisabled && (
              <span className="flex items-center gap-0.5 text-[10.5px] text-muted/80" title="Connections 진입·새로고침 시 자동 확인에서 제외됨 (연결 테스트 버튼으로 수동 확인 가능)">
                <PauseCircle className="size-3" /> 자동확인 제외
              </span>
            )}
          </span>
        </div>
        {active && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">활성</span>}
      </div>

      <div className="truncate font-mono text-[11.5px] text-muted" title={target}>{target}</div>

      <div className="mt-0.5 flex items-center justify-between border-t border-line pt-2">
        <StatusPill status={status} />
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-1.5 text-[11px] text-muted hover:text-accent-2" title="설계 바인딩 관리" onClick={() => openManage(conn.id)}>
            <Link2 className="size-3.5" />{bindings.length > 0 && <span className="font-mono">{bindings.length}</span>}
          </Button>
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

/** 그룹 순서 변경 드래그 중 마우스를 따라오는 고스트 — 그룹 헤더 축약본. */
function GhostGroup({ group, count }: { group?: ConnGroupDef; count: number }) {
  if (!group) return null
  return (
    <div className="flex rotate-1 items-center gap-2 rounded-xl border border-accent/60 bg-canvas px-3 py-2 opacity-95 shadow-2xl ring-1 ring-accent/30">
      <FolderOpen className="size-3.5 shrink-0 text-muted" />
      <span className="truncate text-[12.5px] font-bold text-fg">{group.name}</span>
      <span className="rounded-full bg-panel-strong px-1.5 py-px text-[10.5px] font-semibold text-muted">{count}</span>
    </div>
  )
}

/** 드래그 중 마우스를 따라오는 고스트 — 카드 축약본(이름·벤더·대상). */
function GhostCard({ conn }: { conn?: ConnectionDef }) {
  if (!conn) return null
  const info = dialectInfo(conn.dbType)
  const target = conn.dbType === 'sqlite' ? conn.database : `${conn.host}:${conn.port}/${conn.database}`
  return (
    <div className="flex rotate-2 flex-col gap-1.5 rounded-xl border border-accent/60 bg-canvas p-3.5 opacity-95 shadow-2xl ring-1 ring-accent/30">
      <span className="truncate text-[13.5px] font-semibold text-fg">{conn.name}</span>
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
        <DialectMark dialect={conn.dbType} />
        {info.label}
      </span>
      <span className="truncate font-mono text-[11.5px] text-muted">{target}</span>
    </div>
  )
}

interface DragCard {
  connId: string
  w: number
  h: number
  offsetX: number
  offsetY: number
  x: number
  y: number
  target: { groupId: string | null; index: number } | null
}

interface DragGroup {
  groupId: string
  w: number
  h: number
  offsetX: number
  offsetY: number
  x: number
  y: number
  // index=삽입 위치(드래그 그룹 뺀 목록 기준). 카드와 동일하게 원본이 빠지고 그 자리에 점선 자리표시가 들어간다.
  target: { index: number } | null
}

const GRID_CLS = 'grid auto-rows-min gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]'

/**
 * Connections 모듈(운영부 · depth 2) — 원시 접속 카드 그리드(설계 무관) + 그룹 분류.
 * 카드 클릭 = 활성 Connection(컨텍스트 바 동기화) → Remote/Migration 이 이걸 대상으로 동작.
 * 카드 드래그 = 그룹 넣기/빼기/순서 변경 — 고스트가 마우스를 따라오고, 놓일 자리는 점선 플레이스홀더로 미리 보인다.
 */
export function ConnectionsView() {
  // 지금 프로젝트 범위의 접속만 — 무소속(공용)은 늘 남는다.
  const connections = useScopedConnections()
  const groups = useConnectionsStore((s) => s.groups)
  const loaded = useConnectionsStore((s) => s.loaded)
  const openCreate = useConnectionsStore((s) => s.openCreate)
  const testAll = useConnectionsStore((s) => s.testAll)
  const refresh = useConnectionsStore((s) => s.refresh)
  const statusMap = useConnectionsStore((s) => s.statusMap)
  const createGroup = useConnectionsStore((s) => s.createGroup)
  const renameGroup = useConnectionsStore((s) => s.renameGroup)
  const removeGroup = useConnectionsStore((s) => s.removeGroup)
  const sample = useConnectionsStore((s) => s.sample)
  const makeSample = useConnectionsStore((s) => s.makeSample)
  const remakeSample = useConnectionsStore((s) => s.remakeSample)
  const activeId = useContextValue('conn')
  const setActiveConn = useNav((s) => s.setContextValue)

  const [confirmRemake, setConfirmRemake] = useState(false)
  /** 화면에 안 드러나는 결과만 적는다 — 카드가 생기는 것으로 이미 보이면 아무 말도 안 붙인다. */
  const [sampleNote, setSampleNote] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragCard | null>(null)
  // 드롭 시점의 최신 드래그 상태 — updater 안 부수효과 금지(StrictMode 이중 호출) 규약이라 ref 로 미러링.
  const dragRef = useRef<DragCard | null>(null)
  const [groupDrag, setGroupDrag] = useState<DragGroup | null>(null)
  const groupDragRef = useRef<DragGroup | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // Enter 커밋 직후 blur 가 한 번 더 커밋하는 중복 방지용 동기 가드.
  const renameOpenRef = useRef<string | null>(null)
  const containersRef = useRef(new Map<string | null, HTMLDivElement>())
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 페이지 진입 시 1회 전체 자동 확인(로드 완료 후). 리마운트=재진입마다 다시 확인된다.
  useEffect(() => {
    if (loaded) void testAll()
  }, [loaded, testAll])

  const checking = Object.values(statusMap).some((s) => s.state === 'testing')
  const buckets = bucketByGroup(connections, groups.map((g) => g.id))
  const ungrouped = buckets.get(null) ?? []

  const onSample = async () => {
    setSampleNote(null)
    if (sample?.connectionId) {
      setConfirmRemake(true) // 파괴적이다 — 바로 하지 않고 무엇이 지워지는지 먼저 보인다
      return
    }
    try {
      const r = await makeSample()
      if (r.status.connectionId) setActiveConn('conn', r.status.connectionId)
      // 카드가 생기고 골라지는 것으로 이미 보인다 — 파일을 덮지 않았다는 사실만 따로 알린다.
      if (r.made === 'connection') setSampleNote('기존 샘플 파일을 그대로 씁니다')
      if (r.made === 'file') setSampleNote('샘플 파일 다시 만듦')
    } catch (e) {
      setSampleNote(e instanceof Error ? e.message : '샘플 DB 만들기 실패')
    }
  }

  const onRemake = async () => {
    setConfirmRemake(false)
    try {
      await remakeSample()
      // 카드는 그 자리 그대로라 아무 변화가 안 보인다 — 이건 말해 줘야 한다.
      setSampleNote('샘플 파일 다시 만듦')
    } catch (e) {
      setSampleNote(e instanceof Error ? e.message : '샘플 DB 다시 만들기 실패')
    }
  }

  const registerContainer = (key: string | null) => (el: HTMLDivElement | null) => {
    if (el) containersRef.current.set(key, el)
    else containersRef.current.delete(key)
  }

  /** 포인터 아래의 드롭 대상(섹션 + 삽입 인덱스). 섹션 밖이면 null. */
  const computeTarget = (x: number, y: number, draggedId: string): DragCard['target'] => {
    for (const [key, el] of containersRef.current) {
      const r = el.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
      const rects: Rect[] = []
      el.querySelectorAll('[data-conn-id]').forEach((cardEl) => {
        if (cardEl.getAttribute('data-conn-id') === draggedId) return
        rects.push(cardEl.getBoundingClientRect())
      })
      return { groupId: key, index: insertionIndex(rects, { x, y }) }
    }
    return null
  }

  /** 카드 pointerdown — 6px 넘게 움직이면 드래그 시작(그 전엔 평범한 클릭). 버튼 위에서는 시작 안 함. */
  const beginDrag = (e: React.PointerEvent, conn: ConnectionDef): void => {
    if (e.button !== 0) return
    if ((e.target as Element).closest('button')) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const session = {
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      cancelled: false
    }
    const base = {
      connId: conn.id,
      w: rect.width,
      h: rect.height,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey, true)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    const onMove = (ev: PointerEvent): void => {
      if (session.cancelled) return
      if (!session.active) {
        if (Math.hypot(ev.clientX - session.startX, ev.clientY - session.startY) < 6) return
        session.active = true
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'grabbing'
      }
      const next = { ...base, x: ev.clientX, y: ev.clientY, target: computeTarget(ev.clientX, ev.clientY, conn.id) }
      dragRef.current = next
      setDrag(next)
    }
    const onUp = (): void => {
      cleanup()
      const d = dragRef.current
      if (session.active && !session.cancelled && d?.target) {
        const st = useConnectionsStore.getState()
        const orderedIds = applyMove(st.connections, st.groups.map((g) => g.id), d.connId, d.target.groupId, d.target.index)
        void st.move(d.connId, d.target.groupId, orderedIds)
      }
      dragRef.current = null
      setDrag(null)
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      session.cancelled = true
      cleanup()
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey, true)
  }

  /** 포인터 y 아래의 그룹 삽입 위치(드래그 그룹·자리표시 제외). 스크롤 영역 밖이면 null. */
  const computeGroupTarget = (y: number, draggedId: string): DragGroup['target'] => {
    const cr = scrollRef.current?.getBoundingClientRect()
    if (!cr || y < cr.top || y > cr.bottom) return null
    const rects: Array<{ top: number; bottom: number }> = []
    for (const g of groups) {
      if (g.id === draggedId) continue
      const el = containersRef.current.get(g.id)
      if (!el) continue
      const r = el.getBoundingClientRect()
      rects.push({ top: r.top, bottom: r.bottom })
    }
    return { index: verticalInsertionIndex(rects, y) }
  }

  /** 그룹 헤더 그립 pointerdown — 6px 넘게 움직이면 그룹 순서 드래그 시작. */
  const beginGroupDrag = (e: React.PointerEvent, g: ConnGroupDef): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const sectionEl = containersRef.current.get(g.id)
    const rect = sectionEl?.getBoundingClientRect()
    const session = { startX: e.clientX, startY: e.clientY, active: false, cancelled: false }
    const base = {
      groupId: g.id,
      w: rect?.width ?? 280,
      h: rect?.height ?? 96,
      // 그립을 잡은 지점 기준으로 고스트가 손끝에 붙게 — 헤더 높이 안쪽 오프셋.
      offsetX: rect ? e.clientX - rect.left : 16,
      offsetY: rect ? e.clientY - rect.top : 16
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey, true)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    const onMove = (ev: PointerEvent): void => {
      if (session.cancelled) return
      if (!session.active) {
        if (Math.hypot(ev.clientX - session.startX, ev.clientY - session.startY) < 6) return
        session.active = true
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'grabbing'
      }
      const next = { ...base, x: ev.clientX, y: ev.clientY, target: computeGroupTarget(ev.clientY, g.id) }
      groupDragRef.current = next
      setGroupDrag(next)
    }
    const onUp = (): void => {
      cleanup()
      const d = groupDragRef.current
      if (session.active && !session.cancelled && d?.target) {
        const st = useConnectionsStore.getState()
        const orderedIds = reorderList(st.groups.map((x) => x.id), d.groupId, d.target.index)
        void st.reorderGroups(orderedIds)
      }
      groupDragRef.current = null
      setGroupDrag(null)
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      session.cancelled = true
      cleanup()
      groupDragRef.current = null
      setGroupDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey, true)
  }

  const openRename = (id: string): void => {
    renameOpenRef.current = id
    setRenamingId(id)
  }
  const commitRename = (id: string, value: string): void => {
    if (renameOpenRef.current !== id) return
    renameOpenRef.current = null
    setRenamingId(null)
    const name = value.trim()
    const g = groups.find((x) => x.id === id)
    if (name && g && name !== g.name) void renameGroup(id, name)
  }
  const cancelRename = (): void => {
    renameOpenRef.current = null
    setRenamingId(null)
  }
  const addGroup = async (): Promise<void> => {
    const g = await createGroup(`새 그룹 ${groups.length + 1}`)
    openRename(g.id)
  }

  /** 섹션 카드 목록 렌더 — 드래그 중 카드는 빼고, 놓일 자리에 점선 플레이스홀더를 끼워 보여준다. */
  const renderCards = (key: string | null, items: ConnectionDef[]): ReactNode[] => {
    const visible = drag ? items.filter((c) => c.id !== drag.connId) : items
    const nodes: ReactNode[] = visible.map((c) => (
      <div key={c.id} data-conn-id={c.id} onPointerDown={(e) => beginDrag(e, c)}>
        <ConnCard conn={c} active={c.id === activeId} />
      </div>
    ))
    if (drag?.target && drag.target.groupId === key) {
      nodes.splice(
        Math.min(drag.target.index, nodes.length),
        0,
        <div
          key="__placeholder"
          style={{ height: drag.h }}
          className="rounded-xl border-2 border-dashed border-accent/60 bg-accent-soft/30"
        />
      )
    }
    return nodes
  }

  /** 그룹 섹션 하나 렌더. */
  const renderGroupSection = (g: ConnGroupDef): ReactNode => {
    const items = buckets.get(g.id) ?? []
    const isOver = drag?.target?.groupId === g.id
    return (
      <section
        key={g.id}
        ref={registerContainer(g.id)}
        data-conn-group={g.id}
        className={cn(
          'shrink-0 rounded-2xl border bg-panel/30 p-3 transition-colors',
          isOver ? 'border-accent/60 ring-1 ring-accent/30' : 'border-line'
        )}
      >
        <div className="mb-2.5 flex items-center gap-2 px-1">
          <button
            type="button"
            data-group-handle={g.id}
            title="드래그해서 그룹 순서 변경"
            onPointerDown={(e) => beginGroupDrag(e, g)}
            className="-ml-1 flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted/60 outline-none hover:bg-panel-strong hover:text-fg active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </button>
          <FolderOpen className="size-3.5 shrink-0 text-muted" />
          {renamingId === g.id ? (
            <input
              autoFocus
              defaultValue={g.name}
              data-group-rename={g.id}
              className="h-6 w-52 rounded border border-accent/50 bg-canvas px-1.5 text-[12.5px] font-semibold text-fg outline-none focus:border-accent"
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(g.id, (e.target as HTMLInputElement).value)
                else if (e.key === 'Escape') cancelRename()
              }}
              onBlur={(e) => commitRename(g.id, e.target.value)}
            />
          ) : (
            <span className="truncate text-[12.5px] font-bold text-fg">{g.name}</span>
          )}
          <span className="rounded-full bg-panel-strong px-1.5 py-px text-[10.5px] font-semibold text-muted">{items.length}</span>
          <div className="ml-auto flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="size-6 text-muted hover:text-fg" title="그룹 이름 변경" onClick={() => openRename(g.id)}>
              <Pencil className="size-3" />
            </Button>
            {deletingId === g.id ? (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setDeletingId(null)}>취소</Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-6 px-1.5 text-[11px]"
                  onClick={() => {
                    setDeletingId(null)
                    void removeGroup(g.id)
                  }}
                >
                  그룹 삭제
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="icon" className="size-6 text-muted hover:text-destructive" title="그룹 삭제 (연결은 미분류로 이동)" onClick={() => setDeletingId(g.id)}>
                <Trash2 className="size-3" />
              </Button>
            )}
          </div>
        </div>
        <div className={cn(GRID_CLS, 'min-h-14')}>
          {renderCards(g.id, items)}
          {items.length === 0 && !isOver && (
            <div className="col-span-full flex h-14 items-center justify-center rounded-xl border border-dashed border-line text-[12px] text-muted/70">
              비어 있음 — 연결 카드를 끌어다 놓으세요
            </div>
          )}
        </div>
      </section>
    )
  }

  /** 그룹 섹션 목록 — 드래그 중인 그룹은 빼고(고스트가 대신), 놓일 자리에 점선 자리표시를 끼운다(카드와 동일). */
  const renderGroupSections = (): ReactNode[] => {
    const visible = groupDrag ? groups.filter((g) => g.id !== groupDrag.groupId) : groups
    const nodes: ReactNode[] = visible.map((g) => renderGroupSection(g))
    if (groupDrag?.target) {
      nodes.splice(
        Math.min(groupDrag.target.index, nodes.length),
        0,
        <div
          key="__group_placeholder"
          style={{ height: groupDrag.h }}
          className="shrink-0 rounded-2xl border-2 border-dashed border-accent/60 bg-accent-soft/30"
        />
      )
    }
    return nodes
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">Connections</h2>
          <p className="text-[12px] text-muted">DB 접속 · 카드를 누르면 활성 연결, 끌면 그룹·순서를 바꿉니다 (그룹은 왼쪽 손잡이로 위아래 이동)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void onSample()} title="준비물 없이 바로 써 보는 SQLite 샘플 (도커 불필요)">
            <Database className="size-3.5" /> {sampleButtonLabel(sample ?? { path: '', fileExists: false, connectionId: null })}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void addGroup()} title="연결을 묶어 관리할 그룹 만들기">
            <FolderPlus className="size-3.5" /> 새 그룹
          </Button>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={checking} title="목록과 연결 상태를 저장소 기준으로 다시 읽는다 (자동 확인 제외 연결은 미확인으로 표시)">
            <RefreshCw className={cn('size-3.5', checking && 'animate-spin')} /> 새로고침
          </Button>
          <Button size="sm" onClick={() => openCreate()}>
            <Plus /> 새 연결
          </Button>
        </div>
      </div>

      {/* 되돌릴 수 없는 동작이라 무엇이 지워지는지 먼저 보인다 — 경로까지. */}
      {confirmRemake && sample && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-panel-strong px-5 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] text-fg">샘플 DB 를 새로 만듭니다. 이 파일에 넣은 데이터는 사라집니다.</p>
            <p className="truncate font-mono text-[11px] text-muted">{sample.path}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setConfirmRemake(false)}>취소</Button>
          <Button variant="destructive" size="sm" onClick={() => void onRemake()}>다시 만들기</Button>
        </div>
      )}
      {sampleNote && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-2 text-[12px] text-muted">
          <span className="min-w-0 flex-1 truncate">{sampleNote}</span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setSampleNote(null)}>닫기</Button>
        </div>
      )}

      {connections.length === 0 && groups.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
            <Server size={24} strokeWidth={1.8} />
          </div>
          <h3 className="text-[15px] font-semibold text-fg">아직 연결이 없어요</h3>
          <p className="max-w-md text-[13px] leading-relaxed text-muted">
            모니터링·조회할 DB 접속을 등록하세요. 설계에 묶지 않아도 Remote 에서 바로 쓸 수 있고, 배포/마이그레이션이 필요하면 나중에 설계에 바인딩합니다.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Button size="sm" onClick={() => openCreate()}>
              <Plus /> 첫 연결 만들기
            </Button>
            {/* 등록할 DB 가 아직 없는 사람을 위한 탈출구 — 준비물 없이 바로 볼 것이 생긴다. */}
            <Button variant="outline" size="sm" onClick={() => void onSample()}>
              <Database className="size-3.5" /> 샘플 DB 만들기
            </Button>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="flex flex-1 flex-col gap-4 overflow-auto p-5">
          {renderGroupSections()}

          <section
            ref={registerContainer(null)}
            data-conn-group=""
            className={cn(
              'flex min-h-24 flex-1 flex-col rounded-2xl p-1 transition-colors',
              drag?.target && drag.target.groupId === null && 'rounded-2xl bg-accent-soft/20 ring-1 ring-accent/20'
            )}
          >
            {groups.length > 0 && (
              <div className="mb-2 flex items-center gap-2 px-1 text-[11.5px] font-semibold text-muted">
                미분류 <span className="rounded-full bg-panel-strong px-1.5 py-px text-[10.5px]">{ungrouped.length}</span>
              </div>
            )}
            <div className={GRID_CLS}>{renderCards(null, ungrouped)}</div>
          </section>
        </div>
      )}

      {drag &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[100]"
            style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.w }}
          >
            <GhostCard conn={connections.find((c) => c.id === drag.connId)} />
          </div>,
          document.body
        )}

      {groupDrag &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[100]"
            style={{ left: groupDrag.x - groupDrag.offsetX, top: groupDrag.y - groupDrag.offsetY, maxWidth: groupDrag.w }}
          >
            <GhostGroup
              group={groups.find((g) => g.id === groupDrag.groupId)}
              count={buckets.get(groupDrag.groupId)?.length ?? 0}
            />
          </div>,
          document.body
        )}
    </div>
  )
}
