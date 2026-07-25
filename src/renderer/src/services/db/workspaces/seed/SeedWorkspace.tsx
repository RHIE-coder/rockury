import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Braces, Info, Layers, Plus, Sprout, Trash2 } from 'lucide-react'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { useNav } from '@renderer/nav/useNav'
import { autoColumnWidths } from '../../console/data/colWidth'
import { useActiveDesign, useDesignsStore } from '../../designs/store'
import { useDesignTables, useStudioReadOnly } from '../definition/store'
import type { Column, TableDef } from '../definition/types'
import { missingRequiredCells, isVariableCell, seedVariables, validateSeedRows, type SeedRowIssue } from './seedRows'
import { seedColumnHints } from './columnHint'
import { naturalKeyBacking, seedSetStatus } from './seedSet'
import { SeedSetDialog } from './SeedSetDialog'
import { setKey, useActiveSeedSet, useDesignSeedSets, useSeedStore } from './store'
import {
  STRENGTH_GROUP_LABEL,
  STRENGTH_HINT,
  STRENGTH_LABEL,
  type SeedRow,
  type SeedSet,
  type SeedStrength
} from './types'

/**
 * Studio › Seed — 기준 데이터(시드) 저작 화면. 정본: `docs/spec/db-studio.md` Surface `db-studio.seed`.
 * 실 DB 를 건드리지 않는다 — 저장은 로컬 설계 저장소뿐(Studio 공통 불변식).
 */

/** 컬럼 머리에 보일 타입 라벨 글자 상한 — 넘으면 잘라 그리고 전체는 툴팁으로. */
const TYPE_LABEL_MAX = 18

/** 좌측 사이드바 — 시드 세트 목록. 자연키 없는 세트는 경고 표식을 단다. */
function SeedSetSidebar({ sets, activeKey, onPick }: { sets: SeedSet[]; activeKey: string; onPick: (k: string) => void }) {
  if (sets.length === 0) {
    return <div className="px-3 py-4 text-[12px] text-muted">아직 시드 세트가 없어요</div>
  }
  const sorted = [...sets].sort((a, b) => a.tableName.localeCompare(b.tableName))
  return (
    <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
      {sorted.map((s) => {
        const k = setKey(s)
        const active = k === activeKey
        return (
          <button
            key={k}
            type="button"
            data-seed-set-row={s.tableName}
            onClick={() => onPick(k)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors',
              active ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-panel-strong'
            )}
          >
            <Sprout className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-muted')} />
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{s.tableName}</span>
            {seedSetStatus(s) === 'no-natural-key' && (
              <span
                data-seed-needs-key
                title="자연키가 필요해요"
                className="flex shrink-0 items-center gap-0.5 rounded bg-warning-soft px-1 py-0.5 text-[10px] font-semibold text-warning"
              >
                <AlertTriangle className="size-2.5" />
                자연키
              </span>
            )}
            <span className="shrink-0 text-[11px] tabular-nums text-muted">{s.rows.length}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 설계 미선택 빈 상태 — Definition 과 같은 문법. */
function NoDesignState() {
  const openCreate = useDesignsStore((s) => s.openCreate)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3.5 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
        <Layers size={22} />
      </div>
      <div>
        <div className="text-[14px] font-semibold text-fg">설계를 선택하세요</div>
        <p className="mt-1 max-w-72 text-[12px] leading-relaxed text-muted">
          시드는 설계가 정의하는 기준 데이터예요. 상단 컨텍스트 바에서 설계를 고르거나 새로 만들어요.
        </p>
      </div>
      <Button size="sm" onClick={openCreate}>
        <Plus />새 설계 만들기
      </Button>
    </div>
  )
}

/** 세트 없음 빈 상태 — 테이블에서 세트를 만들도록 유도. */
function NoSeedSetState({ onCreate, hasTables }: { onCreate: () => void; hasTables: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3.5 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
        <Sprout size={22} />
      </div>
      <div>
        <div className="text-[14px] font-semibold text-fg">아직 시드 세트가 없어요</div>
        <p className="mt-1 max-w-80 text-[12px] leading-relaxed text-muted">
          시드는 테이블을 만들 때 처음부터 있어야 하는 기준 데이터예요(권한·역할·코드표).
          {hasTables ? ' 관리할 테이블을 골라 시작해요.' : ' 먼저 Definition 에서 테이블을 만들어요.'}
        </p>
      </div>
      {hasTables && (
        <Button size="sm" onClick={onCreate}>
          <Plus />
          테이블에서 시드 세트 만들기
        </Button>
      )}
    </div>
  )
}

/** 셀 편집기 — 값 입력 + NULL 토글. Enter 확정 / Esc 취소. */
function CellEditor({
  initial,
  onCommit,
  onCancel
}: {
  initial: string | null
  onCommit: (v: string | null) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(initial ?? '')
  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit(v)
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={() => onCommit(v)}
        className="h-6 rounded-sm px-1 font-mono text-[12px]"
      />
      <button
        type="button"
        title="NULL 로 두기"
        // mousedown 으로 처리 — Input 의 blur(=확정)가 먼저 일어나면 이 클릭이 사라진다.
        onMouseDown={(e) => {
          e.preventDefault()
          onCommit(null)
        }}
        className="shrink-0 rounded border border-line px-1 text-[10px] font-semibold text-muted hover:bg-panel-strong"
      >
        NULL
      </button>
    </div>
  )
}

/** 값 표시 — NULL 은 흐린 이탤릭, 변수는 표식을 붙인다(Data 뷰와 같은 표기). */
function CellValue({ v }: { v: string | null | undefined }) {
  if (v == null) return <span className="font-mono text-[12px] italic text-muted/60">NULL</span>
  if (isVariableCell(v))
    return (
      <span data-seed-variable-cell className="flex items-center gap-1">
        <Braces className="size-3 shrink-0 text-accent-2" />
        <span className="truncate font-mono text-[12px] text-accent-2">{v}</span>
      </span>
    )
  if (v === '') return <span className="text-[12px] text-muted/50">—</span>
  return <span className="truncate font-mono text-[12px] text-fg">{v}</span>
}

/** 선언 바 — '설계에 없는 행' 처리 · 변수 목록 · 자연키 경고. 컬럼 단위 선언(KEY/무시)은 그리드 헤더에 있다. */
function DeclarationBar({
  set,
  table,
  readOnly
}: {
  set: SeedSet
  table: TableDef | undefined
  readOnly: boolean
}) {
  const setStrength = useSeedStore((s) => s.setStrength)
  const variables = useMemo(() => seedVariables(set.rows), [set.rows])
  const needsKey = seedSetStatus(set) === 'no-natural-key'
  // 자연키를 UNIQUE 가 뒷받침하지 않으면 반영 단계에서 UPSERT 를 못 쓴다 — 그 사실을 지금 알린다.
  const backing = useMemo(
    () => (table ? naturalKeyBacking(table, set.naturalKey) : { backed: false }),
    [table, set.naturalKey]
  )

  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] font-semibold text-fg">{set.tableName}</span>
        <span className="text-[11px] text-muted">
          자연키 <span className="font-mono text-fg">{set.naturalKey.join(', ') || '없음'}</span>
        </span>
        {set.ignoredColumns.length > 0 && (
          <span className="text-[11px] text-muted">
            무시 <span className="font-mono">{set.ignoredColumns.join(', ')}</span>
          </span>
        )}

        <div className="ml-auto flex items-center gap-1" title={STRENGTH_HINT[set.strength]}>
          <span className="text-[11px] text-muted">{STRENGTH_GROUP_LABEL}</span>
          {(['ensure', 'authoritative'] as SeedStrength[]).map((v) => (
            <button
              key={v}
              type="button"
              disabled={readOnly}
              data-seed-strength={v}
              onClick={() => setStrength(v)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                set.strength === v ? 'bg-accent text-white' : 'bg-panel-strong text-muted hover:text-fg',
                readOnly && 'cursor-default opacity-60'
              )}
            >
              {STRENGTH_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {needsKey && (
        <div className="flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-[11.5px] text-warning">
          <AlertTriangle className="size-3.5 shrink-0" />
          자연키를 고르세요 — 행의 정체성이 없으면 버전 비교와 실 DB 반영의 기준이 없어요. 아래 컬럼 머리의
          <span className="font-semibold">KEY</span> 를 누르면 지정됩니다.
        </div>
      )}

      {set.strength === 'authoritative' && (
        <div className="flex items-center gap-1.5 rounded-md bg-panel-strong px-2 py-1 text-[11.5px] text-muted">
          <AlertTriangle className="size-3.5 shrink-0 text-warning" />
          {STRENGTH_HINT.authoritative}
        </div>
      )}

      {/* 자연키는 있지만 그걸 보장하는 UNIQUE 가 설계에 없을 때 — 오류가 아니라 안내(반영 단계 함의). */}
      {!needsKey && !backing.backed && (
        <div
          data-seed-key-unbacked
          className="flex items-start gap-1.5 rounded-md bg-panel-strong px-2 py-1 text-[11.5px] text-muted"
        >
          <Info className="mt-[1px] size-3.5 shrink-0" />
          <span>
            자연키 <span className="font-mono text-fg">{set.naturalKey.join(', ')}</span> 에 UNIQUE 제약이
            없어요. 지금 저작·비교는 문제없지만, 실 DB 에 반영할 때 UPSERT(있으면 고치고 없으면 넣기)를 쓸 수
            없어 "찾아서 넣기"로 내려가고 동시에 실행되면 같은 행이 두 번 들어갈 수 있어요. Definition 에서 이
            컬럼 구성에 UNIQUE 를 추가하는 걸 권해요.
          </span>
        </div>
      )}

      {variables.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">필요한 변수</span>
          {variables.map((v) => (
            <span
              key={v}
              data-seed-variable={v}
              className="rounded bg-accent-2-soft px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent-2"
            >
              {v}
            </span>
          ))}
          <span className="text-[11px] text-muted/80">
            값은 환경에 두고 반영할 때 채워요 — 비밀값을 여기 평문으로 넣지 마세요.
          </span>
        </div>
      )}
    </div>
  )
}

/** 행 저작 그리드 — 컬럼 머리에서 자연키(KEY)·무시 컬럼을 선언한다. */
function SeedGrid({ set, table, readOnly }: { set: SeedSet; table: TableDef | undefined; readOnly: boolean }) {
  const editing = useSeedStore((s) => s.editing)
  const setEditing = useSeedStore((s) => s.setEditing)
  const updateCell = useSeedStore((s) => s.updateCell)
  const deleteRow = useSeedStore((s) => s.deleteRow)
  const toggleKeyColumn = useSeedStore((s) => s.toggleKeyColumn)
  const toggleIgnored = useSeedStore((s) => s.toggleIgnored)

  const columns: Column[] = table?.columns ?? []
  const issues = useMemo(() => validateSeedRows(set.rows, set.naturalKey), [set.rows, set.naturalKey])
  // 컬럼 제약(PK/FK/UK/IDX/CHK · 필수 여부 · 상세)을 그리드 머리에서 바로 보인다 — Definition 화면과
  // 왕복하지 않게. 파생은 Definition 정본 로직 재사용(columnHint).
  const hints = useMemo(() => (table ? seedColumnHints(table) : []), [table])
  const hintOf = useMemo(() => new Map(hints.map((h) => [h.name, h])), [hints])
  const required = useMemo(() => hints.filter((h) => h.required).map((h) => h.name), [hints])
  const missing = useMemo(() => missingRequiredCells(set.rows, required), [set.rows, required])
  const widths = useMemo(
    () =>
      autoColumnWidths(
        columns.map((c) => {
          const h = hintOf.get(c.name)
          return {
            name: c.name,
            // 긴 타입 하나가 컬럼 폭을 독차지하면 정작 값이 안 보인다 — 라벨을 잘라 계산·표시하고
            // 전체는 툴팁으로 본다(표시와 계산이 같은 상한을 쓴다).
            typeLabel: c.type.slice(0, TYPE_LABEL_MAX),
            // 헤더가 차지하는 자리: 제약 배지 + CHK + 필수 + KEY·무시 토글 2개.
            badges: 2 + (h?.badges.length ?? 0) + (h?.hasCheck ? 1 : 0) + (h?.required ? 1 : 0),
            trailingPx: 8
          }
        }),
        set.rows.map((r) => r.values)
      ),
    [columns, hintOf, set.rows]
  )

  if (!table) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="size-5 text-warning" />
        <div className="text-[13px] font-semibold text-fg">
          <span className="font-mono">{set.tableName}</span> 테이블이 설계에 없어요
        </div>
        <p className="max-w-80 text-[12px] text-muted">
          테이블 이름이 바뀌었거나 지워졌어요. Definition 에서 테이블을 되살리거나 이 세트를 지우세요.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-max border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr>
            <th className="w-10 border-b border-r border-line px-2 py-1.5 text-[10px] font-semibold text-muted">
              #
            </th>
            {columns.map((c) => {
              const isKey = set.naturalKey.includes(c.name)
              const isIgnored = set.ignoredColumns.includes(c.name)
              const hint = hintOf.get(c.name)
              return (
                <th
                  key={c.id}
                  data-seed-col={c.name}
                  style={{ width: widths[c.name], minWidth: widths[c.name] }}
                  className={cn('border-b border-r border-line px-2 py-1', isIgnored && 'opacity-55')}
                >
                  <div className="flex items-center gap-1" title={hint?.detail}>
                    <span className="min-w-0 truncate font-mono text-[12px] font-semibold text-fg">{c.name}</span>
                    {/* 제약 배지 — 서비스 공통 불변식대로 텍스트만(복합키는 위치 번호). */}
                    {hint?.badges.map((b) => (
                      <span
                        key={b}
                        data-seed-col-badge={b}
                        className="shrink-0 rounded bg-panel-strong px-1 text-[9.5px] font-bold text-fg/70"
                      >
                        {b}
                      </span>
                    ))}
                    {hint?.hasCheck && (
                      <span className="shrink-0 rounded bg-panel-strong px-1 text-[9.5px] font-bold text-fg/70">
                        CHK
                      </span>
                    )}
                    {/* 필수 = NOT NULL·기본값 없음 → 비우면 반영 단계에서 INSERT 가 실패한다. */}
                    {hint?.required && (
                      <span
                        data-seed-col-required
                        className="shrink-0 rounded bg-warning-soft px-1 text-[9.5px] font-bold text-warning"
                      >
                        필수
                      </span>
                    )}
                    {/* 읽기 전용에선 토글이 없으니 상태를 배지로 보인다(편집 중엔 토글 자체가 배지 역할). */}
                    {readOnly && isKey && (
                      <span className="shrink-0 rounded bg-accent-soft px-1 text-[9.5px] font-bold text-accent">
                        KEY
                      </span>
                    )}
                    {readOnly && isIgnored && (
                      <span className="shrink-0 rounded bg-panel-strong px-1 text-[9.5px] font-bold text-muted">
                        무시
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {/* 긴 타입은 **문자열 자체를** 줄여 그린다 — 표가 max-content 로 커지는 표라
                        CSS 말줄임만으로는 컬럼이 타입 라벨 길이만큼 벌어진다(ENUM 이 값 자리를 먹음). */}
                    <span className="min-w-0 text-[10px] text-muted" title={c.type}>
                      {c.type.length > TYPE_LABEL_MAX ? `${c.type.slice(0, TYPE_LABEL_MAX)}…` : c.type}
                    </span>
                    {!readOnly && (
                      <span className="ml-auto flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          data-seed-key-toggle={c.name}
                          title="자연키로 지정/해제 — 행의 정체성을 잡는 컬럼"
                          onClick={() => toggleKeyColumn(c.name)}
                          className={cn(
                            'rounded px-1 text-[9.5px] font-bold transition-colors',
                            isKey ? 'bg-accent text-white' : 'text-muted hover:bg-panel-strong hover:text-fg'
                          )}
                        >
                          KEY
                        </button>
                        <button
                          type="button"
                          data-seed-ignore-toggle={c.name}
                          title="비교에서 무시할 컬럼으로 지정/해제"
                          onClick={() => toggleIgnored(c.name)}
                          className={cn(
                            'rounded px-1 text-[9.5px] font-bold transition-colors',
                            isIgnored ? 'bg-fg text-white' : 'text-muted hover:bg-panel-strong hover:text-fg'
                          )}
                        >
                          무시
                        </button>
                      </span>
                    )}
                  </div>
                </th>
              )
            })}
            <th className="w-9 border-b border-line" />
          </tr>
        </thead>
        <tbody>
          {set.rows.map((r, i) => (
            <SeedGridRow
              key={r.id}
              row={r}
              index={i}
              columns={columns}
              widths={widths}
              issue={issues[r.id]}
              missing={missing[r.id]}
              ignored={set.ignoredColumns}
              readOnly={readOnly}
              editing={editing}
              onEdit={setEditing}
              onCommit={(col, v) => {
                updateCell(r.id, col, v)
                setEditing(null)
              }}
              onDelete={() => deleteRow(r.id)}
            />
          ))}
          {set.rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 2} className="px-3 py-8 text-center text-[12px] text-muted">
                아직 시드 행이 없어요 — 위의 <span className="font-semibold">행 추가</span> 로 시작해요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function SeedGridRow({
  row,
  index,
  columns,
  widths,
  issue,
  missing,
  ignored,
  readOnly,
  editing,
  onEdit,
  onCommit,
  onDelete
}: {
  row: SeedRow
  index: number
  columns: Column[]
  widths: Record<string, number>
  issue: SeedRowIssue | undefined
  /** 필수인데 비어 있는 컬럼 이름들. */
  missing: string[] | undefined
  ignored: string[]
  readOnly: boolean
  editing: string | null
  onEdit: (k: string | null) => void
  onCommit: (column: string, v: string | null) => void
  onDelete: () => void
}) {
  const missingSet = new Set(missing ?? [])
  // 행 경고 문구 — 자연키 문제와 필수 빈 칸을 한 줄로 합쳐 보인다(둘 다면 둘 다 알려야 한다).
  const rowMessage = [issue?.message, missingSet.size ? `필수 값이 비었어요: ${[...missingSet].join(', ')}` : null]
    .filter(Boolean)
    .join(' / ')

  return (
    <tr
      data-seed-row={row.id}
      data-seed-row-issue={issue?.kind}
      data-seed-row-missing={missingSet.size ? [...missingSet].join(',') : undefined}
      className={cn('group', (issue || missingSet.size) && 'bg-danger/5')}
    >
      <td className="border-b border-r border-line px-2 py-1 text-[11px] tabular-nums text-muted">
        <span className="flex items-center gap-1">
          {index + 1}
          {rowMessage && (
            <span title={rowMessage}>
              <AlertTriangle className="size-3 text-danger" />
            </span>
          )}
        </span>
      </td>
      {columns.map((c) => {
        const key = `${row.id}::${c.name}`
        const isEditing = editing === key
        return (
          <td
            key={c.id}
            data-seed-cell={c.name}
            style={{ width: widths[c.name], maxWidth: widths[c.name] }}
            onClick={() => !readOnly && !isEditing && onEdit(key)}
            className={cn(
              'border-b border-r border-line px-2 py-1 align-middle',
              ignored.includes(c.name) && 'opacity-55',
              // 필수인데 빈 셀 — 반영 단계에서 터지기 전에 그 자리에서 보인다.
              missingSet.has(c.name) && 'bg-danger/10 ring-1 ring-inset ring-danger/40',
              !readOnly && 'cursor-text'
            )}
          >
            {isEditing ? (
              <CellEditor
                initial={row.values[c.name] ?? null}
                onCommit={(v) => onCommit(c.name, v)}
                onCancel={() => onEdit(null)}
              />
            ) : (
              <CellValue v={row.values[c.name]} />
            )}
          </td>
        )
      })}
      <td className="border-b border-line px-1 py-1 text-right">
        {!readOnly && (
          <button
            type="button"
            title="행 삭제"
            data-seed-row-delete={row.id}
            onClick={onDelete}
            className="rounded p-1 text-muted opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </td>
    </tr>
  )
}

/** Studio › Seed 워크스페이스 — [시드 세트 목록 | 선언 바 + 행 그리드]. 활성 Design 스코프. */
export function SeedWorkspace() {
  const design = useActiveDesign()
  const tables = useDesignTables()
  const sets = useDesignSeedSets()
  const active = useActiveSeedSet()
  const readOnly = useStudioReadOnly()
  const versionId = useNav((s) => s.contextValues['version'])
  const activeKey = useSeedStore((s) => s.activeKey)
  const setActive = useSeedStore((s) => s.setActive)
  const addSet = useSeedStore((s) => s.addSet)
  const removeSet = useSeedStore((s) => s.removeSet)
  const addRow = useSeedStore((s) => s.addRow)
  const [pickOpen, setPickOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // 활성 세트 재조정 — 앱을 다시 켜면 activeKey 는 비어 있는데 화면은 첫 세트를 보여준다.
  // 그 상태로 편집하면 스토어가 대상 세트를 못 찾아 **조용히 아무 일도 안 한다**(회귀: 재시작 후
  // 행 추가가 먹지 않던 문제). 화면이 보고 있는 세트를 스토어에 알려 맞춘다
  // (definition 의 reconcileActiveTable 과 같은 취지).
  const effectiveKey = active ? setKey(active) : ''
  useEffect(() => {
    if (effectiveKey && effectiveKey !== activeKey) setActive(effectiveKey)
  }, [effectiveKey, activeKey, setActive])

  if (!design) return <NoDesignState />

  const activeTable = active ? tables.find((t) => t.name === active.tableName) : undefined

  return (
    <WorkspacePanels
      autoSaveId="db.seed"
      sidebarTitle="SEED SETS"
      sidebarActions={
        readOnly ? undefined : (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="시드 세트 추가"
            onClick={() => setPickOpen(true)}
          >
            <Plus className="size-4" />
          </Button>
        )
      }
      sidebar={
        <SeedSetSidebar
          sets={sets}
          activeKey={effectiveKey || activeKey}
          onPick={(k) => setActive(k)}
        />
      }
    >
      <div className="flex h-full flex-col">
        {readOnly && versionId && (
          <div className="flex items-center gap-2 border-b border-line bg-accent-2-soft px-4 py-1.5 text-[12px] text-accent-2">
            <span className="font-medium">읽기 전용</span>
            <span className="font-mono font-semibold">{versionId}</span>
            <span className="text-accent-2/80">컷된 버전의 시드를 보고 있어요.</span>
          </div>
        )}

        {!active ? (
          <NoSeedSetState onCreate={() => setPickOpen(true)} hasTables={tables.length > 0} />
        ) : (
          <>
            <DeclarationBar set={active} table={activeTable} readOnly={readOnly} />
            {!readOnly && (
              <div className="flex items-center gap-2 border-b border-line px-4 py-1.5">
                <Button variant="soft" size="sm" onClick={addRow} disabled={!activeTable}>
                  <Plus />행 추가
                </Button>
                <span className="text-[11px] text-muted">{active.rows.length}행</span>
                <div className="ml-auto flex items-center gap-1">
                  {confirmDelete ? (
                    <>
                      <span className="text-[11px] text-muted">세트를 지울까요?</span>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                        취소
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          removeSet(setKey(active))
                          setConfirmDelete(false)
                        }}
                      >
                        세트 삭제
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                      <Trash2 />
                      세트 삭제
                    </Button>
                  )}
                </div>
              </div>
            )}
            <SeedGrid set={active} table={activeTable} readOnly={readOnly} />
          </>
        )}
      </div>

      <SeedSetDialog
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        tables={tables}
        sets={sets}
        onPick={(t) => addSet(t)}
      />
    </WorkspacePanels>
  )
}
