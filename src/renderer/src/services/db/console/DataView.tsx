import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Filter as FilterIcon,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
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
import { canEdit, pkColumns, type Filter } from './data/sqlBuilder'
import { columnKind } from './data/cellKind'
import { toCsv, toJson, toSqlInsert } from './data/exportRows'
import { PAGE_SIZES, rowKey, useDataStore } from './data/store'

function display(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
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
 * Console › Data — 실 DB 행 조회/편집(§ops 향상).
 * 페이지크기·정렬·필터, 타입별 셀 에디터(날짜 NOW/불리언/UUID/JSON 모달/FK 룩업)+NULL 토글,
 * Export(CSV/JSON/SQL). 편집 커밋은 트랜잭션+파라미터 바인드(기존). PK 없으면 읽기전용.
 */
export function DataView() {
  const conn = useActiveConnection()
  const connId = conn?.id ?? null
  const tables = useConsoleStore((s) => (connId ? s.byEnv[connId] : undefined))
  const introLoading = useConsoleStore((s) => (connId ? s.loading[connId] : false))
  const loadIntro = useConsoleStore((s) => s.load)
  const d = useDataStore()
  const dialect = conn?.dbType

  const [showFilters, setShowFilters] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [jsonEdit, setJsonEdit] = useState<{ key: string; col: string; text: string } | null>(null)
  const [fkEdit, setFkEdit] = useState<{ key: string; col: string; ref: { table: string; column: string } } | null>(null)

  useEffect(() => {
    if (connId) void loadIntro(connId, connId)
  }, [connId, loadIntro])

  if (!conn) {
    return <PlaceholderView icon={Table2} depth="depth 3 · Console › Data" title="연결을 선택하세요" subtitle="Connection 셀렉터에서 대상을 고르면 실 DB 테이블을 조회/편집할 수 있습니다." />
  }

  const selected: TableDef | null = tables?.find((t) => t.name === d.table) ?? null
  const editable = selected ? canEdit(selected) : false
  const pk = selected ? pkColumns(selected) : []
  const fks = selected ? fkMap(selected) : {}
  const pendingCount = d.pendingCount()
  const statements = selected && dialect ? d.buildStatements(dialect, selected) : []

  return (
    <div className="flex h-full min-h-0">
      {/* 좌: 테이블 목록 */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <span>테이블</span>
          {introLoading && <Loader2 className="size-3 animate-spin" />}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {(tables ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => dialect && void d.selectTable(connId!, dialect, t)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px] outline-none hover:bg-panel',
                t.name === d.table ? 'bg-accent-soft/50 text-accent' : 'text-fg'
              )}
            >
              <Table2 className="size-3.5 shrink-0 opacity-60" />
              <span className="truncate">{t.name}</span>
              {!canEdit(t) && <Lock className="ml-auto size-3 shrink-0 opacity-40" />}
            </button>
          ))}
          {tables && tables.length === 0 && <div className="px-3 py-2 text-[12px] text-muted">테이블 없음</div>}
        </div>
      </aside>

      {/* 우: 그리드 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted">왼쪽에서 테이블을 선택하세요</div>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-semibold text-fg">{selected.name}</span>
                {!editable && (
                  <span className="flex items-center gap-1 rounded-full bg-panel-strong px-2 py-0.5 text-[10.5px] text-muted">
                    <Lock className="size-3" /> 읽기전용 (PK 없음)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
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
                    {editable && <th className="w-8 border-b border-line px-1 py-1.5" />}
                    {selected.columns.map((c) => {
                      const sorted = d.orderBy?.column === c.name ? d.orderBy.direction : null
                      return (
                        <th key={c.id} className="border-b border-line px-3 py-1.5 text-left font-mono font-semibold text-fg">
                          <button type="button" onClick={() => dialect && void d.toggleSort(connId!, dialect, selected, c.name)} className="flex items-center gap-1 outline-none hover:text-accent" title="정렬">
                            {c.name}
                            {pk.includes(c.name) && <span className="text-[10px] text-accent-2">PK</span>}
                            {fks[c.name] && <KeyRound className="size-3 text-accent" />}
                            {sorted === 'ASC' && <ChevronUp className="size-3" />}
                            {sorted === 'DESC' && <ChevronDown className="size-3" />}
                          </button>
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
                      <tr key={ri} className={cn('hover:bg-panel/50', deleted && 'opacity-40 line-through')}>
                        {editable && (
                          <td className="border-b border-line/50 px-1 py-0.5 text-center">
                            <button type="button" title={deleted ? '삭제 취소' : '행 삭제'} onClick={() => d.toggleDelete(key)} className={cn('text-muted hover:text-destructive', deleted && 'text-destructive')}>
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        )}
                        {selected.columns.map((c) => {
                          const has = !!(edited && c.name in edited)
                          const val = edited && c.name in edited ? edited[c.name] : row[c.name]
                          if (!editable) {
                            return (
                              <td key={c.id} className={cn('max-w-[320px] truncate border-b border-line/50 px-3 py-1 font-mono', row[c.name] == null ? 'italic text-muted' : 'text-fg')} title={display(row[c.name])}>
                                {row[c.name] == null ? 'NULL' : display(row[c.name])}
                              </td>
                            )
                          }
                          return (
                            <td key={c.id} className="border-b border-line/50 p-0">
                              <EditableCell
                                kind={columnKind(c.type)}
                                value={val}
                                changed={has}
                                fk={fks[c.name]}
                                disabled={!!deleted}
                                onChange={(v) => d.editCell(key, c.name, v)}
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
                        <td className="border-b border-line/50 px-1 py-0.5 text-center">
                          <button type="button" title="추가 취소" onClick={() => d.removeInsert(ins.tempId)} className="text-muted hover:text-destructive"><X className="size-3.5" /></button>
                        </td>
                        {selected.columns.map((c) => (
                          <td key={c.id} className="border-b border-line/50 p-0">
                            <input value={display(ins.values[c.name])} placeholder="(기본값)" onChange={(e) => d.editInsert(ins.tempId, c.name, e.target.value)} className="w-full min-w-[80px] bg-transparent px-3 py-1 font-mono text-[12px] text-success outline-none focus:bg-success-soft" />
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
              {d.rows.length === 0 && !d.loading && <div className="py-8 text-center text-[13px] text-muted">행이 없습니다</div>}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-line px-4 py-2 text-[12px] text-muted">
              <div className="flex items-center gap-2">
                <span>{d.rows.length}행 · 페이지 {d.page + 1}</span>
                <select value={d.pageSize} onChange={(e) => dialect && void d.setPageSize(connId!, dialect, selected, Number(e.target.value))} className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] outline-none">
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}/p</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" disabled={d.page === 0 || d.loading} onClick={() => dialect && void d.setPage(connId!, dialect, selected, d.page - 1)}><ChevronLeft /></Button>
                <Button size="sm" variant="ghost" disabled={d.rows.length < d.pageSize || d.loading} onClick={() => dialect && void d.setPage(connId!, dialect, selected, d.page + 1)}><ChevronRight /></Button>
              </div>
            </div>
          </>
        )}
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
        <FkLookup connectionId={conn.id} dialect={dialect} refTo={fkEdit.ref} onPick={(v) => { d.editCell(fkEdit.key, fkEdit.col, v); setFkEdit(null) }} onClose={() => setFkEdit(null)} />
      )}
    </div>
  )
}

/** 타입별 편집 셀 — NULL 토글 + 종류별 위젯. */
function EditableCell({
  kind,
  value,
  changed,
  fk,
  disabled,
  onChange,
  onJson,
  onFk
}: {
  kind: ReturnType<typeof columnKind>
  value: unknown
  changed: boolean
  fk?: { table: string; column: string }
  disabled: boolean
  onChange: (v: unknown) => void
  onJson: () => void
  onFk: (ref: { table: string; column: string }) => void
}) {
  const isNull = value === null
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const base = cn('w-full min-w-[80px] bg-transparent px-3 py-1 font-mono text-[12px] outline-none focus:bg-accent-soft/40', changed ? 'text-accent-2' : 'text-fg')
  const nullBtn = (
    <button type="button" title="NULL 로 설정" disabled={disabled} onClick={() => onChange(null)} className="px-1 text-[10px] text-muted hover:text-destructive">∅</button>
  )

  if (isNull) {
    return (
      <div className="flex items-center">
        <input value="" placeholder="NULL" disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(base, 'italic')} />
      </div>
    )
  }
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
      <input value={text} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={base} />
      {kind === 'date' && <button type="button" disabled={disabled} onClick={() => onChange(new Date().toISOString())} className="px-1 text-[10px] text-muted hover:text-accent" title="현재 시각">NOW</button>}
      {kind === 'uuid' && <button type="button" disabled={disabled} onClick={() => onChange(crypto.randomUUID())} className="px-1 text-[10px] text-muted hover:text-accent" title="UUID 생성">gen</button>}
      {fk && <button type="button" disabled={disabled} onClick={() => onFk(fk)} className="px-1 text-muted hover:text-accent" title={`${fk.table} 참조`}><KeyRound className="size-3" /></button>}
      {nullBtn}
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

/** FK 룩업 모달 — 참조 테이블을 조회해 값 선택. */
function FkLookup({ connectionId, dialect, refTo, onPick, onClose }: { connectionId: string; dialect: string; refTo: { table: string; column: string }; onPick: (v: unknown) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [cols, setCols] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const q = dialect === 'mysql' || dialect === 'mariadb' ? '`' : '"'
  useEffect(() => {
    void (async () => {
      try {
        const r = await window.rockury.query.run(connectionId, `SELECT * FROM ${q}${refTo.table}${q} LIMIT 100`)
        setRows(r.rows)
        setCols(r.columns)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, refTo.table])

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>참조 선택 · {refTo.table} ({refTo.column})</DialogTitle>
        </DialogHeader>
        {err ? (
          <div className="rounded bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{err}</div>
        ) : (
          <div className="mt-2 max-h-[60vh] overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-panel">
                <tr>{cols.map((c) => <th key={c} className={cn('border-b border-line px-2 py-1 text-left font-mono', c === refTo.column && 'text-accent')}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="cursor-pointer hover:bg-accent-soft/40" onClick={() => onPick(row[refTo.column])}>
                    {cols.map((c) => (
                      <td key={c} className={cn('max-w-[220px] truncate border-b border-line/50 px-2 py-1 font-mono', c === refTo.column ? 'font-semibold text-accent' : 'text-muted')}>{display(row[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <div className="py-6 text-center text-[12px] text-muted">행이 없습니다</div>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
