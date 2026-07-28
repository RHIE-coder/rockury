import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Layers,
  LogOut,
  Plus,
  Table2,
  Trash2
} from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import type { TableDef } from '../../workspaces/definition/types'
import { GROUP_COLORS } from './GroupErdNode'
import { GROUP_PALETTE, groupColor, groupOfTable, setMembership, type DiagramGroup } from './group'
import { GroupDeleteDialog } from './GroupDeleteDialog'

/**
 * 좌측 사이드 패널의 `그룹` 탭 — 정본: §db-console.diagram.group-panel.
 * 그룹 만들기·이름 바꾸기·색·지우기·접기·`그룹만 보기` 가 여기 모인다.
 * 캔버스에서 끌어 넣는 것과 **같은 멤버십**을 건드린다(소속의 정본은 하나다).
 */
export function DiagramGroupPanel({
  tables,
  groups,
  onGroupsChange,
  onPatchGroup,
  onCreateGroup,
  onDeleteGroup,
  onlyGroups,
  onToggleOnly,
  activeTableId,
  onPickTable,
  editable,
  onDeleteTables
}: {
  tables: TableDef[]
  groups: DiagramGroup[]
  onGroupsChange: (next: DiagramGroup[]) => void
  onPatchGroup: (id: string, patch: Partial<DiagramGroup>) => void
  onCreateGroup: () => string
  onDeleteGroup: (id: string) => void
  /** `그룹만 보기` 로 켠 그룹들. 비어 있으면 전체 보기. */
  onlyGroups: Set<string>
  onToggleOnly: (id: string) => void
  activeTableId: string | null
  onPickTable: (t: TableDef) => void
  editable: boolean
  /**
   * 주면 지우기 확인에 "테이블도 함께 지우기" 가 생긴다(설계부 전용).
   * 운영부는 안 준다 — 실 DB 테이블을 지우는 길은 편집 모드의 DDL·트랜잭션 게이트뿐이다.
   */
  onDeleteTables?: (tableIds: string[]) => void
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  /**
   * 지우기 확인 다이얼로그의 대상 그룹 id — 되돌리기가 없어서 손이 미끄러지면 모아 둔 소속 목록이
   * 통째로 날아간다. 설계부에서는 소속 테이블까지 지울지도 여기서 묻는다(문구 입력).
   * ⚠ 시스템(브라우저) 확인 창은 쓰지 않는다 — 이 Electron 창에서 그건 자동 검사를 멈춰 세운다.
   */
  const [deleting, setDeleting] = useState<string | null>(null)

  const byId = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables])
  const ungrouped = useMemo(
    () => tables.filter((t) => !groupOfTable(groups, t.id)),
    [tables, groups]
  )

  const toggleOpen = (id: string): void =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div data-diagram-group-panel className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-2.5 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          그룹 {groups.length}
        </span>
        {editable && (
          <Button
            size="sm"
            variant="ghost"
            data-group-create
            className="h-6 px-1.5 text-[11px]"
            onClick={() => {
              const id = onCreateGroup()
              setOpenIds((prev) => new Set(prev).add(id))
              setRenaming(id)
            }}
          >
            <Plus className="size-3" /> 그룹
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
        {groups.length === 0 && (
          <p className="px-2 py-4 text-center text-[11.5px] italic leading-relaxed text-muted">
            아직 그룹이 없어요.
            {editable && (
              <>
                <br />
                위 <span className="not-italic font-semibold">+ 그룹</span> 으로 만들고, 캔버스에서
                테이블을 그 영역 안으로 끌어다 놓으세요.
              </>
            )}
          </p>
        )}

        {groups.map((g, i) => {
          const key = groupColor(g, i)
          const c = GROUP_COLORS[key]
          const open = openIds.has(g.id)
          const members = g.tableIds.map((id) => byId.get(id)).filter((t): t is TableDef => !!t)
          const only = onlyGroups.has(g.id)
          return (
            <div key={g.id} data-group-row={g.name} className="mb-1 rounded-md border border-line bg-canvas">
              <div className="flex items-center gap-1 px-1.5 py-1">
                <button
                  type="button"
                  title={open ? '목록 접기' : '목록 펴기'}
                  onClick={() => toggleOpen(g.id)}
                  className="shrink-0 rounded p-0.5 text-muted hover:text-fg"
                >
                  {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
                <span
                  className="size-3 shrink-0 rounded-sm border"
                  style={{ background: c.bar, borderColor: c.border }}
                />
                {renaming === g.id ? (
                  <input
                    autoFocus
                    value={g.name}
                    onChange={(e) => onPatchGroup(g.id, { name: e.target.value })}
                    onBlur={() => setRenaming(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') setRenaming(null)
                    }}
                    className="selectable min-w-0 flex-1 rounded border border-accent bg-canvas px-1 py-0.5 text-[12px] text-fg outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    title={editable ? '두 번 누르면 이름을 바꿔요' : g.name}
                    onDoubleClick={() => editable && setRenaming(g.id)}
                    onClick={() => toggleOpen(g.id)}
                    className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-fg"
                  >
                    {g.name || '이름 없는 그룹'}
                  </button>
                )}
                <span className="shrink-0 rounded bg-panel-strong px-1 text-[10px] font-bold tabular-nums text-muted">
                  {g.tableIds.length}
                </span>
                <button
                  type="button"
                  aria-pressed={only}
                  data-group-only={g.name}
                  title="이 그룹만 캔버스에 보기"
                  onClick={() => onToggleOnly(g.id)}
                  className={cn(
                    'shrink-0 rounded p-0.5',
                    only ? 'bg-accent text-white' : 'text-muted/60 hover:text-fg'
                  )}
                >
                  <Eye className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-pressed={g.collapsed}
                  data-group-collapse={g.name}
                  title={g.collapsed ? '캔버스에서 펴기' : '캔버스에서 접기'}
                  onClick={() => onPatchGroup(g.id, { collapsed: !g.collapsed })}
                  className={cn(
                    'shrink-0 rounded p-0.5',
                    g.collapsed ? 'bg-accent text-white' : 'text-muted/60 hover:text-fg'
                  )}
                >
                  <Layers className="size-3.5" />
                </button>
                {editable && (
                  <button
                    type="button"
                    data-group-delete={g.name}
                    title="그룹 지우기 — 확인 창이 뜹니다"
                    onClick={() => setDeleting(g.id)}
                    className="shrink-0 rounded p-0.5 text-muted/50 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>

              {open && (
                <div className="border-t border-line/70 px-1.5 py-1">
                  {editable && (
                    <div className="flex flex-wrap items-center gap-1 pb-1.5">
                      {g.w != null && (
                        <button
                          type="button"
                          data-group-autosize={g.name}
                          title="상자 크기를 다시 소속에 맞춰 자동으로"
                          onClick={() => onPatchGroup(g.id, { w: undefined, h: undefined })}
                          className="mr-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:text-fg"
                        >
                          자동 크기
                        </button>
                      )}
                      {GROUP_PALETTE.map((p) => (
                        <button
                          key={p}
                          type="button"
                          title="그룹 색"
                          onClick={() => onPatchGroup(g.id, { color: p })}
                          style={{ background: GROUP_COLORS[p].bar, borderColor: GROUP_COLORS[p].border }}
                          className={cn(
                            'size-4 rounded-sm border',
                            key === p && 'ring-2 ring-accent ring-offset-1'
                          )}
                        />
                      ))}
                    </div>
                  )}
                  {members.length === 0 ? (
                    <p className="px-1 py-1.5 text-[11px] italic text-muted">
                      비어 있어요 — 캔버스에서 테이블을 이 영역으로 끌어다 놓으세요.
                    </p>
                  ) : (
                    members.map((t) => (
                      <MemberRow
                        key={t.id}
                        table={t}
                        active={t.id === activeTableId}
                        onPick={() => onPickTable(t)}
                        onRemove={
                          editable ? () => onGroupsChange(setMembership(groups, t.id, null)) : undefined
                        }
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}

        {ungrouped.length > 0 && (
          <div className="mt-2">
            <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
              그룹 없음 {ungrouped.length}
            </div>
            {ungrouped.map((t) => (
              <MemberRow
                key={t.id}
                table={t}
                active={t.id === activeTableId}
                onPick={() => onPickTable(t)}
                addTo={
                  editable && groups.length > 0
                    ? (gid) => onGroupsChange(setMembership(groups, t.id, gid))
                    : undefined
                }
                groups={groups}
              />
            ))}
          </div>
        )}
      </div>

      <p className="shrink-0 border-t border-line px-3 py-2 text-[10.5px] leading-relaxed text-muted">
        그룹 이름표를 끌면 안의 테이블이 같이 움직여요.
      </p>

      <GroupDeleteDialog
        group={groups.find((g) => g.id === deleting) ?? null}
        memberNames={(groups.find((g) => g.id === deleting)?.tableIds ?? [])
          .map((id) => byId.get(id)?.name)
          .filter((n): n is string => !!n)}
        onClose={() => setDeleting(null)}
        onDeleteGroupOnly={() => {
          const id = deleting
          setDeleting(null)
          if (id) onDeleteGroup(id)
        }}
        onDeleteWithTables={
          onDeleteTables
            ? (tableIds) => {
                const id = deleting
                setDeleting(null)
                if (!id) return
                onDeleteTables(tableIds)
                onDeleteGroup(id)
              }
            : undefined
        }
      />
    </div>
  )
}

function MemberRow({
  table,
  active,
  onPick,
  onRemove,
  addTo,
  groups
}: {
  table: TableDef
  active: boolean
  onPick: () => void
  onRemove?: () => void
  addTo?: (groupId: string) => void
  groups?: DiagramGroup[]
}) {
  return (
    <div
      data-group-member={table.name}
      className={cn(
        'flex items-center gap-1.5 rounded px-1.5 py-0.5',
        active ? 'bg-accent-soft' : 'hover:bg-panel'
      )}
    >
      {table.isView ? (
        <Eye className="size-3 shrink-0 text-muted" />
      ) : (
        <Table2 className="size-3 shrink-0 text-muted" />
      )}
      <button
        type="button"
        onClick={onPick}
        className={cn(
          'min-w-0 flex-1 truncate text-left font-mono text-[11.5px]',
          active ? 'font-semibold text-accent' : 'text-fg'
        )}
      >
        {table.name}
      </button>
      {onRemove && (
        <button
          type="button"
          title="그룹에서 빼기"
          onClick={onRemove}
          className="shrink-0 rounded p-0.5 text-muted/50 hover:text-destructive"
        >
          <LogOut className="size-3" />
        </button>
      )}
      {addTo && groups && (
        <select
          title="그룹에 넣기"
          data-group-add={table.name}
          // 값을 React 가 붙들지 않는다(비제어) — 고른 뒤 스스로 빈 값으로 되돌린다.
          // 제어 컴포넌트로 두면 값이 늘 ""라 React 가 "안 바뀌었다"고 보고 변경을 흘릴 수 있다.
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value
            e.target.value = ''
            if (v) addTo(v)
          }}
          className="h-5 shrink-0 rounded border border-line bg-canvas text-[10px] text-muted outline-none"
        >
          <option value="">넣기…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name || g.id}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
