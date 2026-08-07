import { useEffect, useState } from 'react'
import { AlertTriangle, Bookmark, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { useOutsideClose } from '@renderer/lib/useOutsideClose'
import { SearchSelect, type SearchOption } from '@renderer/ui/search-select'
import { FILTER_OPS, NO_VALUE_OPS, type Filter, type SavedFilterRecord } from '@shared/db/savedFilter'
import type { TableRef } from '../../schemaRef'
import { savedFilterStatus } from './savedFilter'
import { useSavedFilterStore } from './savedFilterStore'

/** 연산자 라벨 — 기호만 늘어놓으면 `>=` 와 `<=` 를 눈으로 헷갈린다. 검색은 기호·말 둘 다 걸린다. */
const OP_LABELS: Record<string, string> = {
  '=': '= 같다',
  '!=': '!= 같지 않다',
  '>': '> 크다',
  '<': '< 작다',
  '>=': '>= 크거나 같다',
  '<=': '<= 작거나 같다',
  LIKE: 'LIKE 비슷하다',
  'IS NULL': 'IS NULL 비어 있다',
  'IS NOT NULL': 'IS NOT NULL 비어 있지 않다'
}

const OP_OPTIONS: SearchOption[] = FILTER_OPS.map((o) => ({ value: o, label: OP_LABELS[o] ?? o }))

const emptyRow = (columns: readonly string[]): Filter => ({
  column: columns[0] ?? '',
  op: '=',
  value: ''
})

/**
 * 필터 바(§db-remote.data.filter · data.saved-filter).
 *
 * `DataView` 에서 떼어 낸 이유가 둘이다. ⑴ 저장 필터까지 들어오면서 이 부품만으로도 커졌고
 * ⑵ 예전엔 **표를 바꿔도 이 부품이 다시 만들어지지 않아** 안에 든 조건 초안이 남았다
 * (스토어는 비어 있는데 화면엔 남의 표 조건이 떠 있었다). 지금은 부르는 쪽이 표 키를 `key` 로
 * 주고, 조건의 정본은 스토어다 — 초안은 "적용 전 편집 중인 값"이라는 뜻만 남는다.
 */
export function FilterBar({
  connectionId,
  table,
  columns,
  columnTypes,
  filters,
  enabled,
  onApply,
  onToggleEnabled
}: {
  connectionId: string
  table: TableRef
  columns: string[]
  /** 컬럼명 → 타입 라벨. 검색 카드에서 이름 옆에 흐리게 붙는다(고를 때 참고). */
  columnTypes?: Record<string, string>
  filters: Filter[]
  enabled: boolean
  onApply: (filters: Filter[]) => void
  onToggleEnabled: (enabled: boolean) => void
}) {
  const [draft, setDraft] = useState<Filter[]>(filters.length ? filters : [emptyRow(columns)])
  const saved = useSavedFilterStore()

  useEffect(() => {
    void saved.load(connectionId, table)
    // 표가 바뀌면 부르는 쪽이 `key` 로 이 부품을 새로 만든다 — 여기선 연결·표만 본다.
  }, [connectionId, table.schema, table.name])

  const set = (i: number, patch: Partial<Filter>): void =>
    setDraft((ds) => ds.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  const colOptions: SearchOption[] = columns.map((c) => ({
    value: c,
    label: c,
    hint: columnTypes?.[c]
  }))

  const applySaved = (rec: SavedFilterRecord): void => {
    setDraft(rec.filters.length ? rec.filters : [emptyRow(columns)])
    onApply(rec.filters)
  }

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-line bg-panel/40 px-4 py-2">
      <div className="flex items-center gap-2">
        {/* 조건을 지우지 않고 잠시 안 거는 스위치(§AC-3) — "지우기"와 뜻이 다르다. */}
        <button
          type="button"
          role="switch"
          data-filter-toggle={enabled ? 'on' : 'off'}
          aria-checked={enabled}
          onClick={() => onToggleEnabled(!enabled)}
          title={enabled ? '끄면 조건을 그대로 둔 채 전체 목록을 봅니다' : '아까 그 조건을 다시 겁니다'}
          className="flex items-center gap-1.5 text-[11px] text-muted hover:text-fg"
        >
          <span
            className={cn(
              'relative h-3.5 w-6 rounded-full transition-colors',
              enabled ? 'bg-accent' : 'bg-line'
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 size-2.5 rounded-full bg-canvas transition-all',
                enabled ? 'left-3' : 'left-0.5'
              )}
            />
          </span>
          {/* "적용"(버튼)과 글자가 겹치지 않게 켬/끔으로 짝을 맞춘다 — 같은 줄에 비슷한 말이
              둘이면 무엇을 누르는지 헷갈린다. 효과는 title 이 말한다. */}
          {enabled ? '조건 켬' : '조건 끔'}
        </button>

        <span className="h-3.5 w-px bg-line" />

        <SavedFilterMenu
          connectionId={connectionId}
          table={table}
          columns={columns}
          current={draft}
          onPick={applySaved}
        />
      </div>

      {saved.error && (
        <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          <span className="min-w-0 flex-1">{saved.error}</span>
          <button type="button" onClick={saved.dismissError} className="shrink-0 opacity-70 hover:opacity-100">
            <X className="size-3" />
          </button>
        </div>
      )}

      {draft.map((f, i) => (
        <div key={i} data-filter-row={i} className="flex items-center gap-1.5 text-[12px]">
          <SearchSelect
            hook="filter-column"
            value={f.column}
            options={colOptions}
            onChange={(v) => set(i, { column: v })}
            placeholder="컬럼"
            searchPlaceholder="컬럼 검색"
            className="w-44"
            mono
          />
          <SearchSelect
            hook="filter-op"
            value={f.op}
            options={OP_OPTIONS}
            onChange={(v) => set(i, { op: v as Filter['op'] })}
            searchPlaceholder="연산자 검색"
            className="w-40"
          />
          {!NO_VALUE_OPS.includes(f.op) && (
            <Input
              value={f.value}
              onChange={(e) => set(i, { value: e.target.value })}
              placeholder="값"
              className="h-7 w-40 text-[12px]"
            />
          )}
          <button
            type="button"
            title="이 조건 지우기"
            onClick={() => setDraft((ds) => (ds.length > 1 ? ds.filter((_, j) => j !== i) : [emptyRow(columns)]))}
            className="text-muted hover:text-destructive"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}

      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setDraft((ds) => [...ds, emptyRow(columns)])}>
          <Plus /> 조건
        </Button>
        <Button size="sm" onClick={() => onApply(draft)}>
          적용
        </Button>
        {filters.length > 0 && (
          // "끄기"(조건은 남김)와 갈라 읽히도록 이름에 대상을 밝힌다.
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft([emptyRow(columns)])
              onApply([])
            }}
          >
            조건 지우기
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * 저장 필터 목록(§db-remote.data.saved-filter). 컬럼이 사라져 못 쓰는 항목은 **빨갛게** 두고
 * 적용을 막되 지우지는 않는다 — 조건을 고쳐 되살릴 수 있어야 한다(§AC-4).
 */
function SavedFilterMenu({
  connectionId,
  table,
  columns,
  current,
  onPick
}: {
  connectionId: string
  table: TableRef
  columns: string[]
  current: Filter[]
  onPick: (rec: SavedFilterRecord) => void
}) {
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const boxRef = useOutsideClose<HTMLDivElement>(open, () => setOpen(false))
  const { items, save, rename, remove } = useSavedFilterStore()

  // 값이 채워진 조건만 저장 대상 — 빈 줄까지 담으면 되살렸을 때 쓸모없는 줄이 딸려 온다.
  const usable = current.filter((f) => f.column && (NO_VALUE_OPS.includes(f.op) || f.value !== ''))

  const commitSave = (): void => {
    const trimmed = name.trim()
    if (!trimmed || usable.length === 0) return
    void save(connectionId, table, trimmed, usable)
    setName('')
    setNaming(false)
  }

  return (
    <div ref={boxRef} className="relative flex items-center gap-1.5">
      <button
        type="button"
        data-saved-filters
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted hover:text-accent"
      >
        <Bookmark className="size-3" /> 저장한 필터{items.length > 0 && ` (${items.length})`}
      </button>

      {naming ? (
        <span className="flex items-center gap-1">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSave()
              if (e.key === 'Escape') setNaming(false)
            }}
            placeholder="필터 이름"
            className="h-6 w-32 text-[11px]"
          />
          <button type="button" onClick={commitSave} className="text-accent disabled:opacity-40" disabled={!name.trim()}>
            <Check className="size-3.5" />
          </button>
          <button type="button" onClick={() => setNaming(false)} className="text-muted hover:text-fg">
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={usable.length === 0}
          title={usable.length === 0 ? '저장할 조건이 없습니다' : '지금 조건을 이름 붙여 저장'}
          data-save-filter
          onClick={() => setNaming(true)}
          className="text-[11px] text-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          저장
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-md border border-line bg-canvas p-1 shadow-lg">
          {items.length === 0 ? (
            <div className="px-2 py-3 text-center text-[11px] text-muted">저장한 필터 없음</div>
          ) : (
            items.map((rec) => {
              const status = savedFilterStatus(rec, columns)
              return (
                <div
                  key={rec.id}
                  data-saved-filter={rec.name}
                  data-saved-filter-broken={status.ok ? undefined : ''}
                  className={cn(
                    'group rounded px-1.5 py-1',
                    status.ok ? 'hover:bg-panel' : 'border border-destructive/40 bg-destructive/5'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {editing === rec.id ? (
                      <Input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editName.trim()) {
                            void rename(rec, editName.trim())
                            setEditing(null)
                          }
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        onBlur={() => setEditing(null)}
                        className="h-6 flex-1 text-[11px]"
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={!status.ok}
                        title={status.ok ? '이 조건으로 바꿔 적용' : '컬럼이 없어 적용할 수 없습니다'}
                        onClick={() => {
                          onPick(rec)
                          setOpen(false)
                        }}
                        className={cn(
                          'flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]',
                          status.ok ? 'hover:text-accent' : 'cursor-not-allowed text-destructive'
                        )}
                      >
                        {!status.ok && <AlertTriangle className="size-3 shrink-0" />}
                        <span className="min-w-0 truncate">{rec.name}</span>
                        <span className="shrink-0 text-[10px] text-muted">조건 {rec.filters.length}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      title="이름 바꾸기"
                      onClick={() => {
                        setEditing(rec.id)
                        setEditName(rec.name)
                      }}
                      className="shrink-0 text-muted opacity-0 hover:text-accent group-hover:opacity-100"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      type="button"
                      title="지우기"
                      onClick={() => void remove(connectionId, table, rec.id)}
                      className="shrink-0 text-muted opacity-0 hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                  {!status.ok && (
                    // 왜 못 쓰는지 밝힌다 — 안 밝히면 사용자는 저장이 깨진 줄로만 안다(§AC-4).
                    <div className="mt-0.5 pl-4 text-[10px] text-destructive">
                      <span className="font-mono">{status.missing.join(', ')}</span> 컬럼이 없어 적용할 수 없습니다
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
