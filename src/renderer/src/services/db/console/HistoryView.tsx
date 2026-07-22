import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, History as HistoryIcon, RefreshCw, Search, Trash2 } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { useNav } from '@renderer/nav/useNav'
import { useActiveConnection } from '../connections/store'
import { useQueryStore, type HistoryRow } from './query/store'

const PAGE_SIZES = [25, 50, 100] as const
type SourceFilter = 'all' | 'query' | 'data' | 'collection'
const SOURCES: SourceFilter[] = ['all', 'query', 'data', 'collection']

const SOURCE_BADGE: Record<string, string> = {
  query: 'bg-sky-100 text-sky-700',
  data: 'bg-amber-100 text-amber-700',
  collection: 'bg-violet-100 text-violet-700'
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(+d)) return iso
  return d.toLocaleString()
}

/**
 * Console › History — Query/Data/Collection 실행 이력(다중 소스). 독립 뷰(소스가 셋 다라 Query 하위가 아님).
 * 소스 필터 + SQL 검색 + 페이지네이션. 행 클릭 시 SQL 을 Query 에디터로 보낸다.
 */
export function HistoryView() {
  const conn = useActiveConnection()
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [src, setSrc] = useState<SourceFilter>('all')
  const [q, setQ] = useState('')
  const [pageSize, setPageSize] = useState<number>(25)
  const [page, setPage] = useState(0)

  const load = async (): Promise<void> => {
    if (!conn) return
    setLoading(true)
    try {
      const r = (await window.rockury.query.historyList(conn.id)) as HistoryRow[]
      setRows(r)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    setPage(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id])

  if (!conn) {
    return <PlaceholderView icon={HistoryIcon} depth="depth 3 · Console › History" title="연결을 선택하세요" subtitle="Connection 셀렉터에서 대상을 고르면 실행 이력을 볼 수 있습니다." />
  }

  const query = q.trim().toLowerCase()
  const filtered = rows.filter((r) => (src === 'all' || r.source === src) && (!query || r.sql.toLowerCase().includes(query)))
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize)

  const openInQuery = (sql: string): void => {
    useQueryStore.getState().setSql(sql)
    useNav.getState().selectView('query')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-2.5">
        <div className="flex items-center gap-1.5">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setSrc(s); setPage(0) }}
              className={cn('rounded px-2 py-0.5 text-[11px] font-semibold uppercase outline-none', src === s ? 'bg-accent text-white' : 'bg-panel-strong text-muted hover:text-fg')}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1">
            <Search className="size-3.5 text-muted" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Search SQL…" className="w-48 bg-transparent text-[12px] outline-none" />
          </div>
          <Button size="sm" variant="ghost" title="새로고침" onClick={() => void load()}>
            {loading ? <RefreshCw className="animate-spin" /> : <RefreshCw />}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" title="이력 비우기" onClick={() => { void window.rockury.query.historyClear(conn.id).then(load) }}>
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-panel">
            <tr className="text-left text-muted">
              <th className="border-b border-line px-4 py-2 font-medium">Time</th>
              <th className="border-b border-line px-3 py-2 font-medium">Source</th>
              <th className="border-b border-line px-3 py-2 font-medium">SQL</th>
              <th className="border-b border-line px-3 py-2 text-right font-medium">Rows</th>
              <th className="border-b border-line px-3 py-2 text-right font-medium">Speed</th>
              <th className="border-b border-line px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-panel/60" onClick={() => openInQuery(r.sql)} title="클릭: SQL 을 Query 에디터로">
                <td className="whitespace-nowrap border-b border-line/50 px-4 py-1.5 text-muted">{fmtTime(r.createdAt)}</td>
                <td className="border-b border-line/50 px-3 py-1.5">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', SOURCE_BADGE[r.source] ?? 'bg-panel-strong text-muted')}>{r.source}</span>
                </td>
                <td className="max-w-[520px] truncate border-b border-line/50 px-3 py-1.5 font-mono" title={r.sql}>{r.sql}</td>
                <td className="border-b border-line/50 px-3 py-1.5 text-right font-mono text-muted">{r.affectedRows != null ? r.affectedRows : r.rowCount}</td>
                <td className="border-b border-line/50 px-3 py-1.5 text-right font-mono text-muted">{r.execMs != null ? `${r.execMs}ms` : '—'}</td>
                <td className="border-b border-line/50 px-3 py-1.5">
                  <span className="flex items-center gap-1.5">
                    <span className={cn('size-1.5 rounded-full', r.status === 'success' ? 'bg-success' : 'bg-destructive')} />
                    <span className={cn('font-mono text-[10px] uppercase', r.status === 'success' ? 'text-muted' : 'text-destructive')}>{r.kind || r.status}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="py-10 text-center text-[13px] text-muted">이력이 없습니다</div>}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-line px-5 py-2 text-[12px] text-muted">
        <span>{filtered.length} items</span>
        <div className="flex items-center gap-2">
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }} className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] outline-none">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}/p</option>)}
          </select>
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="disabled:opacity-40"><ChevronLeft className="size-4" /></button>
          <span>{page + 1} / {pageCount}</span>
          <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40"><ChevronRight className="size-4" /></button>
        </div>
      </div>
    </div>
  )
}
