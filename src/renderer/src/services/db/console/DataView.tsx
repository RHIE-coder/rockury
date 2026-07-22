import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Columns3,
  Copy,
  Download,
  Eye,
  Filter as FilterIcon,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { SqlEditor } from '@renderer/ui/SqlEditor'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@renderer/ui/dialog'
import type { Constraint, TableDef } from '../workspaces/definition/types'
import { useActiveConnection } from '../connections/store'
import { useConsoleStore } from './store'
import { columnKeyKinds, splitTablesAndViews } from './introspection'
import { canEdit, pkColumns, type Filter } from './data/sqlBuilder'
import { columnKind } from './data/cellKind'
import { badgeLabels, typeLabel } from './data/columnMeta'
import { genUuid } from './data/genValue'
import { normalizeDateTime, nowDateTime } from './data/timeValue'
import { formatDateCell, timezoneOptions, TZ_MODES, type TzMode } from './data/timezone'
import {
  countByKind,
  filterByKind,
  flattenConstraints,
  KIND_FILTERS,
  type KindFilter
} from './constraintsView'
import { toCsv, toJson, toSqlInsert } from './data/exportRows'
import { PAGE_SIZES, rowKey, useDataStore } from './data/store'

function display(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 클립보드 복사(실패 무시 — 권한/환경 제약). */
function copy(text: string): void {
  try {
    void navigator.clipboard?.writeText(text)
  } catch {
    // 무시
  }
}

/** FK 컬럼명 → 참조 {table, column} (constraints 에서). */
function fkMap(t: TableDef): Record<string, { table: string; column: string }> {
  const byId = new Map(t.columns.map((c) => [c.id, c.name]))
  const map: Record<string, { table: string; column: string }> = {}
  for (const k of t.constraints.filter((c): c is Constraint => c.kind === 'fk')) {
    k.columns.forEach((ref, i) => {
      const name = byId.get(ref.columnId)
      const refCol = k.refColumns?.[i]
      if (name && k.refTable && refCol) map[name] = { table: k.refTable, column: refCol }
    })
  }
  return map
}

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Console › Data — 실 DB 행 조회/편집(§ops 향상, 레거시 이관).
 * 테이블/뷰 분리 목록, Constraint 탭(읽기 전용), 키 배지(PK/FK/UK/IDX 텍스트)+타입 라벨,
 * 타입별 셀 도우미(시간값 NOW/OK/ESC · UUID 생성 · NULL · JSON 모달 · FK 룩업), 타임존 3-way,
 * 셀/행 복사, 컬럼 표시/숨김, 미저장 변경 가드. 편집 커밋은 트랜잭션+파라미터 바인드. PK 없으면 읽기전용.
 */
export function DataView() {
  const conn = useActiveConnection()
  const connId = conn?.id ?? null
  const tables = useConsoleStore((s) => (connId ? s.byEnv[connId] : undefined))
  const introLoading = useConsoleStore((s) => (connId ? s.loading[connId] : false))
  const loadIntro = useConsoleStore((s) => s.load)
  const d = useDataStore()
  const dialect = conn?.dbType

  const [tab, setTab] = useState<'tables' | 'constraints'>('tables')
  const [showFilters, setShowFilters] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [showCols, setShowCols] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [tzMode, setTzMode] = useState<TzMode>('UTC')
  const [tz, setTz] = useState<string>(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [showTz, setShowTz] = useState(false)
  const [cfilter, setCfilter] = useState<KindFilter>('ALL')
  const [jsonEdit, setJsonEdit] = useState<{ key: string; col: string; text: string } | null>(null)
  const [fkEdit, setFkEdit] = useState<{ key: string; col: string; ref: { table: string; column: string }; insert?: string } | null>(null)

  useEffect(() => {
    if (connId) void loadIntro(connId, connId)
  }, [connId, loadIntro])

  // 연결이 바뀌면 이전 연결에서 열린 커밋 대기 트랜잭션을 롤백한다(고아 tx/락 방지).
  useEffect(() => {
    const s = useDataStore.getState()
    if (s.tx) void s.rollback()
  }, [connId])

  // 테이블이 바뀌면 컬럼 숨김 상태 초기화.
  useEffect(() => {
    setHidden(new Set())
  }, [d.table])

  if (!conn) {
    return <PlaceholderView icon={Table2} depth="depth 3 · Console › Data" title="연결을 선택하세요" subtitle="Connection 셀렉터에서 대상을 고르면 실 DB 테이블을 조회/편집할 수 있습니다." />
  }

  const all = tables ?? []
  const { tables: baseTables, views } = splitTablesAndViews(all)
  const constraints = flattenConstraints(all)
  const counts = countByKind(constraints)
  const filteredConstraints = filterByKind(constraints, cfilter)

  const selected: TableDef | null = all.find((t) => t.name === d.table) ?? null
  const editable = selected ? canEdit(selected) : false
  const pk = selected ? pkColumns(selected) : []
  const fks = selected ? fkMap(selected) : {}
  const keyKinds = selected ? columnKeyKinds(selected) : new Map()
  const pendingCount = d.pendingCount()
  const statements = selected && dialect ? d.buildStatements(dialect, selected) : []
  const shownColumns = selected ? selected.columns.filter((c) => !hidden.has(c.name)) : []

  /** 테이블 전환 — 미저장 변경/커밋 대기 트랜잭션이 있으면 확인(가드). selectTable 이 열린 tx 를 롤백한다. */
  const pickTable = (t: TableDef): void => {
    if (!dialect || !connId) return
    if ((pendingCount > 0 || d.tx) && !window.confirm('저장하지 않은 변경/커밋 대기 중인 트랜잭션이 있습니다. 롤백하고 이동할까요?')) return
    void d.selectTable(connId, dialect, t)
  }

  const copyRow = (row: Record<string, unknown>): void => {
    const obj: Record<string, unknown> = {}
    for (const c of selected!.columns) obj[c.name] = row[c.name] ?? null
    copy(JSON.stringify(obj, null, 2))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 탭 바 — Tables / Constraints */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1.5">
        <button
          type="button"
          onClick={() => setTab('tables')}
          className={cn('rounded px-2.5 py-1 text-[12px] font-medium outline-none', tab === 'tables' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg')}
        >
          Tables <span className="opacity-70">{all.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('constraints')}
          className={cn('rounded px-2.5 py-1 text-[12px] font-medium outline-none', tab === 'constraints' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg')}
        >
          Constraints <span className="opacity-70">{constraints.length}</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 좌: Tables 탭 = 테이블/뷰 목록, Constraints 탭 = 제약 목록 */}
        {tab === 'tables' ? (
          <aside className="flex w-56 shrink-0 flex-col border-r border-line">
            <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <span>테이블</span>
              {introLoading && <Loader2 className="size-3 animate-spin" />}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {baseTables.map((t) => (
                <TableRow key={t.id} t={t} active={t.name === d.table} onPick={() => pickTable(t)} />
              ))}
              {views.length > 0 && (
                <div className="mt-1 flex items-center gap-1.5 border-t border-line px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                  <Eye className="size-3" /> Views <span className="opacity-70">{views.length}</span>
                </div>
              )}
              {views.map((t) => (
                <TableRow key={t.id} t={t} active={t.name === d.table} onPick={() => pickTable(t)} isView />
              ))}
              {all.length === 0 && <div className="px-3 py-2 text-[12px] text-muted">테이블 없음</div>}
            </div>
          </aside>
        ) : (
          <aside className="flex w-72 shrink-0 flex-col border-r border-line">
            <div className="flex flex-wrap gap-1 border-b border-line px-2 py-2">
              {KIND_FILTERS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCfilter(k)}
                  className={cn('rounded px-1.5 py-0.5 text-[10.5px] font-semibold outline-none', cfilter === k ? 'bg-accent text-white' : 'bg-panel-strong text-muted hover:text-fg')}
                >
                  {k === 'ALL' ? 'ALL' : k.toUpperCase()} {counts[k]}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {filteredConstraints.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    const t = all.find((x) => x.name === c.table)
                    if (t) pickTable(t)
                  }}
                  className={cn('flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-1.5 text-left outline-none hover:bg-panel', c.table === d.table && 'bg-accent-soft/40')}
                >
                  <span className="flex items-center gap-1.5">
                    <KindBadge kind={c.kind} />
                    <span className="min-w-0 truncate font-mono text-[11.5px] text-fg">{c.name}</span>
                  </span>
                  <span className="truncate font-mono text-[10.5px] text-muted">
                    {c.table} · {c.columns.join(', ')}
                  </span>
                  {c.refLabel && <span className="truncate font-mono text-[10.5px] text-accent">{c.refLabel}</span>}
                </button>
              ))}
              {filteredConstraints.length === 0 && <div className="px-3 py-2 text-[12px] text-muted">제약 없음</div>}
            </div>
          </aside>
        )}

        {/* 우: 그리드 */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
              {tab === 'constraints' ? '왼쪽에서 제약을 선택하면 해당 테이블을 봅니다' : '왼쪽에서 테이블을 선택하세요'}
            </div>
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] font-semibold text-fg">{selected.name}</span>
                  {selected.isView && (
                    <span className="flex items-center gap-1 rounded-full bg-panel-strong px-2 py-0.5 text-[10.5px] text-muted"><Eye className="size-3" /> 뷰</span>
                  )}
                  {!editable && (
                    <span className="flex items-center gap-1 rounded-full bg-panel-strong px-2 py-0.5 text-[10.5px] text-muted">
                      <Lock className="size-3" /> 읽기전용 (PK 없음)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {/* 타임존 3-way */}
                  <div className="relative">
                    <Button size="sm" variant="ghost" title="날짜 표시(UTC/LOCAL/TIMESTAMP)" onClick={() => setShowTz((v) => !v)}>
                      <Clock /> {tzMode}
                    </Button>
                    {showTz && (
                      <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-line bg-canvas p-1.5 text-[12px] shadow-lg">
                        {TZ_MODES.map((m) => (
                          <button key={m} type="button" onClick={() => { setTzMode(m); if (m !== 'LOCAL') setShowTz(false) }} className={cn('block w-full rounded px-2 py-1 text-left outline-none hover:bg-panel', tzMode === m && 'text-accent')}>
                            {m}
                          </button>
                        ))}
                        {tzMode === 'LOCAL' && (
                          <select value={tz} onChange={(e) => setTz(e.target.value)} className="mt-1 w-full rounded border border-line bg-canvas px-1.5 py-1 text-[11px] outline-none">
                            {timezoneOptions().map((z) => <option key={z} value={z}>{z}</option>)}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <Button size="sm" variant="ghost" title="컬럼 표시/숨김" onClick={() => setShowCols((v) => !v)}>
                      <Columns3 />
                    </Button>
                    {showCols && (
                      <div className="absolute right-0 top-full z-20 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-line bg-canvas p-1.5 text-[12px] shadow-lg">
                        <div className="mb-1 flex gap-1.5 px-1">
                          <button type="button" className="text-[11px] text-accent" onClick={() => setHidden(new Set())}>전체 표시</button>
                          <button type="button" className="text-[11px] text-muted" onClick={() => setHidden(new Set(selected.columns.map((c) => c.name)))}>전체 숨김</button>
                        </div>
                        {selected.columns.map((c) => (
                          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-panel">
                            <input
                              type="checkbox"
                              checked={!hidden.has(c.name)}
                              onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(c.name)) n.delete(c.name); else n.add(c.name); return n })}
                            />
                            <span className="truncate font-mono text-[11px]">{c.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button size="sm" variant={showFilters ? 'soft' : 'ghost'} onClick={() => setShowFilters((v) => !v)}>
                    <FilterIcon /> 필터{d.filters.length ? ` (${d.filters.length})` : ''}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setExportOpen((v) => !v)}>
                    <Download /> Export
                  </Button>
                  {editable && (
                    <Button size="sm" variant="ghost" onClick={() => d.addRow()}>
                      <Plus /> 행
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={d.loading} onClick={() => dialect && void d.load(connId!, dialect, selected)}>
                    {d.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} 새로고침
                  </Button>
                </div>
              </div>

              {exportOpen && (
                <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel/50 px-4 py-2 text-[12px]">
                  <span className="text-muted">내보내기:</span>
                  <Button size="sm" variant="outline" onClick={() => { download(`${selected.name}.csv`, toCsv(d.columns, d.rows), 'text/csv'); setExportOpen(false) }}>CSV</Button>
                  <Button size="sm" variant="outline" onClick={() => { download(`${selected.name}.json`, toJson(d.rows), 'application/json'); setExportOpen(false) }}>JSON</Button>
                  <Button size="sm" variant="outline" onClick={() => { if (dialect) download(`${selected.name}.sql`, toSqlInsert(dialect, selected.name, d.columns, d.rows), 'text/plain'); setExportOpen(false) }}>SQL</Button>
                  <span className="text-[11px] text-muted">현재 페이지 {d.rows.length}행</span>
                </div>
              )}

              {showFilters && (
                <FilterBar columns={selected.columns.map((c) => c.name)} filters={d.filters} onChange={(f) => dialect && void d.setFilters(connId!, dialect, selected, f)} />
              )}

              {editable && pendingCount > 0 && !d.tx && (
                <div className="shrink-0 border-b border-line bg-panel/60 px-4 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-fg">대기 변경 <span className="font-semibold">{pendingCount}</span>건 · SQL {statements.length}문</span>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => d.discard()}>취소</Button>
                      <Button size="sm" disabled={d.loading || statements.length === 0} onClick={() => dialect && void d.save(connId!, dialect, selected)}>저장(트랜잭션)</Button>
                    </div>
                  </div>
                  <div className="mt-1.5 max-h-24 overflow-auto rounded bg-canvas p-2 font-mono text-[11px] leading-relaxed text-muted">
                    {statements.map((s, i) => (
                      <div key={i} className="truncate" title={`${s.sql}  ·  [${s.params.map(display).join(', ')}]`}>
                        {s.sql}
                        {s.params.length > 0 && <span className="text-accent"> · [{s.params.map(display).join(', ')}]</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {d.tx && (
                <div className="flex shrink-0 items-center gap-3 border-b border-accent/30 bg-accent-soft/50 px-4 py-2.5 text-[12.5px]">
                  <span className="min-w-0 flex-1">{d.tx.statements}개 문 실행됨 · 영향 <span className="font-mono font-semibold">{d.tx.affected}</span>행 · 아직 커밋되지 않았습니다</span>
                  <Button size="sm" variant="ghost" onClick={() => void d.rollback()}>롤백</Button>
                  <Button size="sm" onClick={() => dialect && void d.confirm(connId!, dialect, selected)}>커밋</Button>
                </div>
              )}

              {d.error && (
                <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-[12px] text-destructive">
                  <span className="min-w-0 flex-1 whitespace-pre-wrap font-mono">{d.error}</span>
                  <button type="button" onClick={d.dismissError} className="shrink-0 opacity-70 hover:opacity-100"><X className="size-3.5" /></button>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead className="sticky top-0 bg-panel">
                    <tr>
                      <th className="w-14 border-b border-line px-2 py-1.5 text-right font-medium text-muted">#</th>
                      {editable && <th className="w-8 border-b border-line px-1 py-1.5" />}
                      {shownColumns.map((c) => {
                        const sorted = d.orderBy?.column === c.name ? d.orderBy.direction : null
                        const badges = badgeLabels(keyKinds.get(c.id))
                        return (
                          <th key={c.id} className="border-b border-line px-3 py-1.5 text-left align-top font-mono font-semibold text-fg">
                            <button type="button" onClick={() => dialect && void d.toggleSort(connId!, dialect, selected, c.name)} className="flex items-center gap-1.5 outline-none hover:text-accent" title="정렬">
                              {badges.map((b) => <span key={b} className="rounded bg-accent-soft px-1 text-[9px] font-bold text-accent">{b}</span>)}
                              <span>{c.name}</span>
                              {sorted === 'ASC' && <ChevronUp className="size-3" />}
                              {sorted === 'DESC' && <ChevronDown className="size-3" />}
                            </button>
                            <div className="mt-0.5 text-[10px] font-normal lowercase text-muted">{typeLabel(c.type)}</div>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((row, ri) => {
                      const key = rowKey(pk, row)
                      const deleted = editable && d.deletes[key]
                      const edited = d.edits[key]
                      return (
                        <tr key={ri} className={cn('group hover:bg-panel/50', deleted && 'opacity-40 line-through')}>
                          <td className="border-b border-line/50 px-2 py-1 text-right font-mono text-muted">
                            <button type="button" title="행을 JSON 으로 복사" onClick={() => copyRow(row)} className="outline-none hover:text-accent">{ri + 1}</button>
                          </td>
                          {editable && (
                            <td className="border-b border-line/50 px-1 py-0.5 text-center">
                              <button type="button" title={deleted ? '삭제 취소' : '행 삭제'} onClick={() => d.toggleDelete(key)} className={cn('text-muted hover:text-destructive', deleted && 'text-destructive')}>
                                <Trash2 className="size-3.5" />
                              </button>
                            </td>
                          )}
                          {shownColumns.map((c) => {
                            const has = !!(edited && c.name in edited)
                            const val = edited && c.name in edited ? edited[c.name] : row[c.name]
                            const kind = columnKind(c.type)
                            if (!editable) {
                              const shownVal = row[c.name] == null ? 'NULL' : kind === 'date' ? formatDateCell(row[c.name], tzMode, tz) : display(row[c.name])
                              return (
                                <td key={c.id} className="group/cell relative max-w-[320px] border-b border-line/50 px-3 py-1 font-mono">
                                  <span className={cn('block truncate', row[c.name] == null ? 'italic text-muted' : 'text-fg')} title={display(row[c.name])}>{shownVal}</span>
                                  {row[c.name] != null && (
                                    <button type="button" title="셀 값 복사" onClick={() => copy(display(row[c.name]))} className="absolute right-1 top-1/2 hidden -translate-y-1/2 text-muted hover:text-accent group-hover/cell:block"><Copy className="size-3" /></button>
                                  )}
                                </td>
                              )
                            }
                            return (
                              <td key={c.id} className="border-b border-line/50 p-0">
                                <EditableCell
                                  kind={kind}
                                  value={val}
                                  changed={has}
                                  fk={fks[c.name]}
                                  disabled={!!deleted}
                                  tzMode={tzMode}
                                  tz={tz}
                                  onChange={(v) => d.editCell(key, c.name, v)}
                                  onReset={() => d.resetCell(key, c.name)}
                                  onJson={() => setJsonEdit({ key, col: c.name, text: display(val) })}
                                  onFk={(ref) => setFkEdit({ key, col: c.name, ref })}
                                />
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}

                    {editable &&
                      d.inserts.map((ins) => (
                        <tr key={ins.tempId} className="bg-success-soft/40">
                          <td className="border-b border-line/50 px-2 py-1 text-right font-mono text-[10px] font-bold text-success">NEW</td>
                          <td className="border-b border-line/50 px-1 py-0.5 text-center">
                            <button type="button" title="추가 취소" onClick={() => d.removeInsert(ins.tempId)} className="text-muted hover:text-destructive"><X className="size-3.5" /></button>
                          </td>
                          {shownColumns.map((c) => (
                            <td key={c.id} className="border-b border-line/50 p-0">
                              <NewCell
                                kind={columnKind(c.type)}
                                value={ins.values[c.name]}
                                fk={fks[c.name]}
                                onFk={(ref) => setFkEdit({ key: ins.tempId, col: c.name, ref, insert: ins.tempId })}
                                onChange={(v) => d.editInsert(ins.tempId, c.name, v)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
                {d.rows.length === 0 && !d.loading && <div className="py-8 text-center text-[13px] text-muted">행이 없습니다</div>}
              </div>

              {/* Constraints 탭 — 현재 테이블 제약 패널(읽기 전용) */}
              {tab === 'constraints' && (
                <TableConstraintsPanel table={selected} />
              )}

              <div className="flex shrink-0 items-center justify-between border-t border-line px-4 py-2 text-[12px] text-muted">
                <div className="flex items-center gap-2">
                  <span>{d.rows.length}행 · 페이지 {d.page + 1}</span>
                  <select value={d.pageSize} onChange={(e) => dialect && void d.setPageSize(connId!, dialect, selected, Number(e.target.value))} className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] outline-none">
                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}/p</option>)}
                  </select>
                  <button type="button" title="행 JSON 복사(현재 페이지)" onClick={() => copy(toJson(d.rows))} className="flex items-center gap-1 text-muted hover:text-accent"><Copy className="size-3" /> 복사</button>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={d.page === 0 || d.loading} onClick={() => dialect && void d.setPage(connId!, dialect, selected, d.page - 1)}><ChevronLeft /></Button>
                  <Button size="sm" variant="ghost" disabled={d.rows.length < d.pageSize || d.loading} onClick={() => dialect && void d.setPage(connId!, dialect, selected, d.page + 1)}><ChevronRight /></Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={!!jsonEdit} onOpenChange={(o) => !o && setJsonEdit(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>JSON 편집 · {jsonEdit?.col}</DialogTitle>
          </DialogHeader>
          {jsonEdit && (
            <div className="mt-2 h-72 overflow-auto rounded border border-line px-2 py-1">
              <SqlEditor value={jsonEdit.text} onChange={(t) => setJsonEdit((v) => (v ? { ...v, text: t } : v))} language="json" />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setJsonEdit(null)}>취소</Button>
            <Button size="sm" onClick={() => { if (jsonEdit) { d.editCell(jsonEdit.key, jsonEdit.col, jsonEdit.text); setJsonEdit(null) } }}>적용</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {fkEdit && dialect && (
        <FkLookup
          connectionId={conn.id}
          dialect={dialect}
          sourceCol={fkEdit.col}
          refTo={fkEdit.ref}
          onPick={(v) => {
            // 신규행이면 insert 버퍼, 기존행이면 edits 버퍼로.
            if (fkEdit.insert) d.editInsert(fkEdit.insert, fkEdit.col, v)
            else d.editCell(fkEdit.key, fkEdit.col, v)
            setFkEdit(null)
          }}
          onClose={() => setFkEdit(null)}
        />
      )}
    </div>
  )
}

/** 좌측 목록 행 — 테이블/뷰. 컬럼 수 + 뷰 V 배지 + 편집불가 lock. */
function TableRow({ t, active, onPick, isView }: { t: TableDef; active: boolean; onPick: () => void; isView?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px] outline-none hover:bg-panel', active ? 'bg-accent-soft/50 text-accent' : 'text-fg')}
    >
      {isView ? <Eye className="size-3.5 shrink-0 opacity-60" /> : <Table2 className="size-3.5 shrink-0 opacity-60" />}
      <span className="min-w-0 flex-1 truncate">{t.name}</span>
      {isView && <span className="rounded bg-accent-soft px-1 text-[9px] font-bold text-accent">V</span>}
      {!isView && !canEdit(t) && <Lock className="size-3 shrink-0 opacity-40" />}
      <span className="shrink-0 text-[10.5px] text-muted">{t.columns.length}</span>
    </button>
  )
}

/** 제약 종류 텍스트 배지(PK/FK/UK/IDX/CHECK). 열쇠 이모지 금지. */
function KindBadge({ kind }: { kind: Constraint['kind'] }) {
  const color: Record<Constraint['kind'], string> = {
    pk: 'bg-amber-100 text-amber-700',
    fk: 'bg-sky-100 text-sky-700',
    uk: 'bg-emerald-100 text-emerald-700',
    idx: 'bg-violet-100 text-violet-700',
    check: 'bg-rose-100 text-rose-700'
  }
  return <span className={cn('shrink-0 rounded px-1 text-[9px] font-bold uppercase', color[kind])}>{kind}</span>
}

/** 현재 테이블 제약 패널(읽기 전용) — Type/Name/Columns/Reference. */
function TableConstraintsPanel({ table }: { table: TableDef }) {
  const [open, setOpen] = useState(true)
  const list = flattenConstraints([table])
  return (
    <div className="shrink-0 border-t border-line bg-panel/40">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-4 py-1.5 text-left text-[12px] font-semibold text-fg outline-none">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} Constraints <span className="text-muted">{list.length}</span>
      </button>
      {open && (
        <div className="max-h-40 overflow-auto px-2 pb-2">
          <table className="w-full border-collapse text-[11.5px]">
            <thead className="text-left text-muted">
              <tr>
                <th className="px-2 py-1 font-medium">Type</th>
                <th className="px-2 py-1 font-medium">Name</th>
                <th className="px-2 py-1 font-medium">Columns</th>
                <th className="px-2 py-1 font-medium">Reference</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-t border-line/50">
                  <td className="px-2 py-1"><KindBadge kind={c.kind} /></td>
                  <td className="px-2 py-1 font-mono">{c.name}</td>
                  <td className="px-2 py-1 font-mono text-muted">{c.columns.join(', ')}</td>
                  <td className="px-2 py-1 font-mono text-accent">{c.refLabel ?? '—'}</td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={4} className="px-2 py-2 text-center text-muted">제약 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** 타입별 편집 셀 — NULL 토글 + 종류별 도우미(시간값/UUID/JSON/FK). */
function EditableCell({
  kind,
  value,
  changed,
  fk,
  disabled,
  tzMode,
  tz,
  onChange,
  onReset,
  onJson,
  onFk
}: {
  kind: ReturnType<typeof columnKind>
  value: unknown
  changed: boolean
  fk?: { table: string; column: string }
  disabled: boolean
  tzMode: TzMode
  tz: string
  onChange: (v: unknown) => void
  onReset: () => void
  onJson: () => void
  onFk: (ref: { table: string; column: string }) => void
}) {
  const base = cn('w-full min-w-[80px] bg-transparent px-3 py-1 font-mono text-[12px] outline-none focus:bg-accent-soft/40', changed ? 'text-accent-2' : 'text-fg')
  const nullBtn = (
    <button type="button" title="NULL 로 설정" disabled={disabled} onClick={() => onChange(null)} className="px-1 text-[10px] text-muted hover:text-destructive">NULL</button>
  )

  // FK 컬럼은 종류/NULL 무관하게 항상 참조 선택 트리거를 보인다(값 클릭 또는 FK 버튼 → 모달).
  if (fk) {
    const isNull = value === null
    const t = isNull ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    return (
      <div className="flex items-center">
        <input value={t} placeholder="NULL" readOnly disabled={disabled} title={t} onClick={() => !disabled && onFk(fk)} className={cn(base, isNull && 'italic', 'cursor-pointer')} />
        <button type="button" disabled={disabled} onClick={() => onFk(fk)} className="shrink-0 px-1 text-[10px] font-bold text-sky-600 hover:text-accent" title={`${fk.table} 참조 선택`}>FK</button>
        {nullBtn}
      </div>
    )
  }

  if (kind === 'date') return <DateCell value={value} changed={changed} disabled={disabled} tzMode={tzMode} tz={tz} onChange={onChange} onReset={onReset} />
  if (kind === 'uuid') return <UuidCell value={value} changed={changed} disabled={disabled} onChange={onChange} />

  if (value === null) {
    return (
      <div className="flex items-center">
        <input value="" placeholder="NULL" disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(base, 'italic')} />
      </div>
    )
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (kind === 'boolean') {
    return (
      <div className="flex items-center">
        <select value={text} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(base, 'appearance-none')}>
          <option value="true">true</option>
          <option value="false">false</option>
          <option value="1">1</option>
          <option value="0">0</option>
        </select>
        {nullBtn}
      </div>
    )
  }
  if (kind === 'json') {
    return (
      <div className="flex items-center">
        <button type="button" disabled={disabled} onClick={onJson} className={cn(base, 'truncate text-left underline decoration-dotted')} title={text}>{text || '{ }'}</button>
        {nullBtn}
      </div>
    )
  }
  return (
    <div className="flex items-center">
      <input value={text} disabled={disabled} title={text} onChange={(e) => onChange(e.target.value)} className={base} />
      {nullBtn}
    </div>
  )
}

/** 시간값 도우미 — YYYY-MM-DD HH:mm:ss[.SSS] 입력 + NOW/OK/ESC. */
function DateCell({ value, changed, disabled, tzMode, tz, onChange, onReset }: {
  value: unknown; changed: boolean; disabled: boolean; tzMode: TzMode; tz: string
  onChange: (v: unknown) => void; onReset: () => void
}) {
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const escaping = useRef(false)
  const isNull = value === null
  const raw = isNull ? '' : String(value)
  const shown = focused || isNull ? raw : formatDateCell(value, tzMode, tz)
  const keep = (e: React.MouseEvent): void => e.preventDefault() // 버튼 클릭이 input blur 를 먼저 일으키지 않도록
  return (
    <div className="relative flex items-center">
      <input
        ref={ref}
        value={shown}
        disabled={disabled}
        placeholder="YYYY-MM-DD HH:mm:ss[.SSS]"
        onFocus={() => setFocused(true)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setFocused(false)
          if (escaping.current) { escaping.current = false; return }
          const n = normalizeDateTime(raw)
          if (n) onChange(n)
        }}
        className={cn('w-full min-w-[120px] bg-transparent px-3 py-1 font-mono text-[12px] outline-none focus:bg-accent-soft/40', changed ? 'text-accent-2' : isNull ? 'italic text-muted' : 'text-fg')}
      />
      {focused && (
        <div className="absolute left-0 top-full z-20 mt-0.5 flex items-center gap-1 rounded border border-line bg-canvas px-1.5 py-1 shadow-lg">
          <span className="font-mono text-[9.5px] text-muted">YYYY-MM-DD HH:mm:ss[.SSS]</span>
          <button type="button" onMouseDown={keep} onClick={() => onChange(nowDateTime())} className="rounded bg-panel-strong px-1.5 py-0.5 text-[10px] font-semibold text-fg hover:text-accent">NOW</button>
          <button type="button" onMouseDown={keep} onClick={() => ref.current?.blur()} className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">OK</button>
          <button type="button" onMouseDown={keep} onClick={() => { escaping.current = true; onReset(); ref.current?.blur() }} className="rounded bg-panel-strong px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:text-fg">ESC</button>
        </div>
      )}
    </div>
  )
}

/** UUID 도우미 — 값 입력 + UUID(생성)/NULL 칩. */
function UuidCell({ value, changed, disabled, onChange }: {
  value: unknown; changed: boolean; disabled: boolean; onChange: (v: unknown) => void
}) {
  const [focused, setFocused] = useState(false)
  const isNull = value === null
  const text = isNull ? '' : String(value)
  const keep = (e: React.MouseEvent): void => e.preventDefault()
  return (
    <div className="relative flex items-center">
      <input
        value={text}
        disabled={disabled}
        placeholder="NULL"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value)}
        className={cn('w-full min-w-[220px] bg-transparent px-3 py-1 font-mono text-[12px] outline-none focus:bg-accent-soft/40', changed ? 'text-accent-2' : isNull ? 'italic text-muted' : 'text-fg')}
      />
      {focused && (
        <div className="absolute left-0 top-full z-20 mt-0.5 flex items-center gap-1 rounded border border-line bg-canvas px-1.5 py-1 shadow-lg">
          <button type="button" onMouseDown={keep} onClick={() => onChange(genUuid())} className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">UUID</button>
          <button type="button" onMouseDown={keep} onClick={() => onChange(null)} className="rounded bg-panel-strong px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:text-fg">NULL</button>
        </div>
      )}
    </div>
  )
}

/** 신규행 셀 — 도우미(UUID/NOW/FK 참조) 붙은 입력. */
function NewCell({ kind, value, fk, onFk, onChange }: { kind: ReturnType<typeof columnKind>; value: unknown; fk?: { table: string; column: string }; onFk?: (ref: { table: string; column: string }) => void; onChange: (v: unknown) => void }) {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return (
    <div className="flex items-center">
      <input value={text} placeholder="(기본값)" onChange={(e) => onChange(e.target.value)} className="w-full min-w-[80px] bg-transparent px-3 py-1 font-mono text-[12px] text-success outline-none focus:bg-success-soft" />
      {fk && onFk && <button type="button" onClick={() => onFk(fk)} className="shrink-0 px-1 text-[10px] font-bold text-sky-600 hover:text-accent" title={`${fk.table} 참조 선택`}>FK</button>}
      {!fk && kind === 'uuid' && <button type="button" onClick={() => onChange(genUuid())} className="px-1 text-[10px] text-muted hover:text-accent" title="UUID 생성">UUID</button>}
      {!fk && kind === 'date' && <button type="button" onClick={() => onChange(nowDateTime())} className="px-1 text-[10px] text-muted hover:text-accent" title="현재 시각">NOW</button>}
    </div>
  )
}

/** 필터 바 — 컬럼/연산자/값 행 추가·삭제. */
function FilterBar({ columns, filters, onChange }: { columns: string[]; filters: Filter[]; onChange: (f: Filter[]) => void }) {
  const [draft, setDraft] = useState<Filter[]>(filters.length ? filters : [{ column: columns[0] ?? '', op: '=', value: '' }])
  const set = (i: number, patch: Partial<Filter>): void => setDraft((ds) => ds.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-line bg-panel/40 px-4 py-2">
      {draft.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[12px]">
          <select value={f.column} onChange={(e) => set(i, { column: e.target.value })} className="rounded border border-line bg-canvas px-1.5 py-1 font-mono text-[11px] outline-none">
            {columns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={f.op} onChange={(e) => set(i, { op: e.target.value as Filter['op'] })} className="rounded border border-line bg-canvas px-1.5 py-1 text-[11px] outline-none">
            {['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IS NULL', 'IS NOT NULL'].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {f.op !== 'IS NULL' && f.op !== 'IS NOT NULL' && (
            <Input value={f.value} onChange={(e) => set(i, { value: e.target.value })} placeholder="값" className="h-7 w-40 text-[12px]" />
          )}
          <button type="button" onClick={() => setDraft((ds) => ds.filter((_, j) => j !== i))} className="text-muted hover:text-destructive"><X className="size-3.5" /></button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setDraft((ds) => [...ds, { column: columns[0] ?? '', op: '=', value: '' }])}><Plus /> 조건</Button>
        <Button size="sm" onClick={() => onChange(draft)}>적용</Button>
        {filters.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setDraft([{ column: columns[0] ?? '', op: '=', value: '' }]); onChange([]) }}>초기화</Button>}
      </div>
    </div>
  )
}

/**
 * FK 룩업 모달 — 참조 테이블을 조회해 값 선택(레거시 이관).
 * 제목에 소스 컬럼→대상 표기, 참조 컬럼 검색(서버사이드 LIKE), 페이지네이션,
 * 행 선택 후 Apply · Set NULL · Cancel.
 */
const FK_PAGE = 50
function FkLookup({ connectionId, dialect, sourceCol, refTo, onPick, onClose }: { connectionId: string; dialect: string; sourceCol: string; refTo: { table: string; column: string }; onPick: (v: unknown) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [cols, setCols] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [sel, setSel] = useState<number | null>(null)

  const qc = dialect === 'mysql' || dialect === 'mariadb' ? '`' : '"'
  const qid = (n: string): string => `${qc}${n.split(qc).join(qc + qc)}${qc}`
  const ph = dialect === 'postgresql' ? '$1' : '?'
  const textType = dialect === 'mysql' || dialect === 'mariadb' ? 'CHAR' : 'TEXT'

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setErr(null)
      setSel(null)
      try {
        const params: unknown[] = []
        let where = ''
        if (q.trim()) {
          where = ` WHERE CAST(${qid(refTo.column)} AS ${textType}) LIKE ${ph}`
          params.push(`%${q.trim()}%`)
        }
        const sql = `SELECT * FROM ${qid(refTo.table)}${where} ORDER BY ${qid(refTo.column)} LIMIT ${FK_PAGE} OFFSET ${page * FK_PAGE}`
        const r = await window.rockury.query.runParams(connectionId, sql, params)
        setRows(r.rows)
        setCols(r.columns)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, refTo.table, refTo.column, q, page])

  const applySearch = (): void => { setPage(0); setQ(draft) }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            참조 선택 · <span className="font-mono text-accent-2">{sourceCol}</span> <span className="text-muted">→ {refTo.table}.{refTo.column}</span>
          </DialogTitle>
        </DialogHeader>

        {/* 검색 (참조 컬럼 기준, 서버사이드) */}
        <div className="mt-1 flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5">
          <Search className="size-3.5 text-muted" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
            placeholder={`${refTo.column} 검색…`}
            className="w-full bg-transparent text-[12px] outline-none"
          />
          {draft && <button type="button" onClick={applySearch} className="text-[11px] text-accent">검색</button>}
        </div>

        {err ? (
          <div className="mt-2 rounded bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{err}</div>
        ) : (
          <div className="mt-2 max-h-[52vh] overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-panel">
                <tr>{cols.map((c) => <th key={c} className={cn('border-b border-line px-2 py-1 text-left font-mono', c === refTo.column && 'text-accent')}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    onClick={() => setSel(i)}
                    onDoubleClick={() => onPick(row[refTo.column])}
                    className={cn('cursor-pointer', sel === i ? 'bg-accent-soft' : 'hover:bg-accent-soft/40')}
                  >
                    {cols.map((c) => (
                      <td key={c} className={cn('max-w-[220px] truncate border-b border-line/50 px-2 py-1 font-mono', c === refTo.column ? 'font-semibold text-accent' : 'text-muted')} title={display(row[c])}>{display(row[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && <div className="py-6 text-center text-[12px] text-muted"><Loader2 className="mx-auto size-4 animate-spin" /></div>}
            {!loading && rows.length === 0 && <div className="py-6 text-center text-[12px] text-muted">행이 없습니다</div>}
          </div>
        )}

        {/* 페이지네이션 + 액션 */}
        <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
          <div className="flex items-center gap-2 text-[11.5px] text-muted">
            <span>{rows.length} rows</span>
            <button type="button" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))} className="disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <span>{page + 1}</span>
            <button type="button" disabled={rows.length < FK_PAGE || loading} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40"><ChevronRight className="size-4" /></button>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => onPick(null)}>Set NULL</Button>
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={sel === null} onClick={() => sel !== null && onPick(rows[sel][refTo.column])}>Apply</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
