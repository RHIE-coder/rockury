import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  History,
  Loader2,
  Play,
  Route,
  Save,
  Search,
  Table2,
  Terminal,
  WandSparkles,
  X
} from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { SqlEditor } from '@renderer/ui/SqlEditor'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/ui/dialog'
import type { TableDef } from '../workspaces/definition/types'
import type { DialectId } from '../dialects'
import { useActiveConnection } from '../connections/store'
import { useConsoleStore } from './store'
import { columnKeyKinds } from './introspection'
import { badgeLabels } from './data/columnMeta'
import { buildSchemaMap, formatSql } from './query/schema'
import { applyKeywords, extractKeywords } from './query/keywords'
import { parseExplainTree } from './query/explainTree'
import { toCsv, toJson } from './data/exportRows'
import { useQueryStore } from './query/store'

const MAX_ROWS = 500

function cell(v: unknown): { text: string; muted?: boolean } {
  if (v === null || v === undefined) return { text: 'NULL', muted: true }
  if (typeof v === 'object') return { text: JSON.stringify(v) }
  return { text: String(v) }
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
 * Console › Query(운영부 · depth 3) — 활성 환경에 SQL 을 실행한다(§ops 향상, 레거시 이관).
 * 파라미터화 쿼리({{키워드}}), 스키마 사이드 패널(클릭 삽입·테이블 미리보기), EXPLAIN 트리,
 * 결과 export(CSV/JSON), 히스토리 검색/필터, 라이브러리 쿼리 자동저장.
 * DML 은 트랜잭션 게이트, DDL 은 즉시 자동 커밋 경고.
 */
export function QueryView() {
  const conn = useActiveConnection()
  const tables = useConsoleStore((s) => (conn ? s.byEnv[conn.id] : undefined))
  const loadIntro = useConsoleStore((s) => s.load)
  const history = useQueryStore((s) => s.history)
  const loadHistory = useQueryStore((s) => s.loadHistory)
  const [showHistory, setShowHistory] = useState(false)
  const [showSchema, setShowSchema] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (conn) {
      void loadIntro(conn.id, conn.id)
      void loadHistory(conn.id)
    }
  }, [conn, loadIntro, loadHistory])

  const sql = useQueryStore((s) => s.sql)
  const setSql = useQueryStore((s) => s.setSql)
  const activeSavedQueryId = useQueryStore((s) => s.activeSavedQueryId)
  const activeSavedConn = useQueryStore((s) => s.activeSavedConn)
  const result = useQueryStore((s) => s.result)
  const error = useQueryStore((s) => s.error)
  const loading = useQueryStore((s) => s.loading)
  const ddlWarning = useQueryStore((s) => s.ddlWarning)
  const tx = useQueryStore((s) => s.tx)
  const explaining = useQueryStore((s) => s.explaining)
  const explain = useQueryStore((s) => s.explain)
  const run = useQueryStore((s) => s.run)
  const runExplain = useQueryStore((s) => s.runExplain)
  const confirm = useQueryStore((s) => s.confirm)
  const rollback = useQueryStore((s) => s.rollback)
  const dismissError = useQueryStore((s) => s.dismissError)

  // 파라미터 키워드
  const keywords = useMemo(() => extractKeywords(sql), [sql])
  const [kw, setKw] = useState<Record<string, string>>({})
  const missing = keywords.filter((k) => !(kw[k]?.trim()))

  // 라이브러리 쿼리 자동저장(디바운스 1s). 저장쿼리가 속한 연결에서만 — 다른 연결 작업물이 덮어쓰지 않도록.
  useEffect(() => {
    if (!activeSavedQueryId || activeSavedConn !== conn?.id) return
    const t = setTimeout(() => {
      void window.rockury.savedQueries.updateQuery(activeSavedQueryId, { sql })
    }, 1000)
    return () => clearTimeout(t)
  }, [sql, activeSavedQueryId, activeSavedConn, conn?.id])

  if (!conn) {
    return (
      <PlaceholderView
        icon={Terminal}
        depth="depth 3 · Console › Query"
        title="연결을 선택하세요"
        subtitle="상단 컨텍스트 바의 Connection 셀렉터에서 대상을 고르면 SQL 을 실행할 수 있습니다."
      />
    )
  }

  const rows = result?.rows ?? []
  const shown = rows.slice(0, MAX_ROWS)
  const canRun = !loading && sql.trim().length > 0 && !tx && missing.length === 0
  const effectiveSql = (): string => applyKeywords(sql, kw)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">
            Query <span className="font-normal text-muted">· {conn.name}</span>
            {activeSavedQueryId && <span className="ml-2 text-[11px] text-accent">· 자동저장</span>}
          </h2>
          <p className="text-[12px] text-muted">DML 커밋 확인 · DDL 자동 커밋 · {'{{키워드}}'} 파라미터</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant={showSchema ? 'soft' : 'ghost'} title="스키마 패널" onClick={() => setShowSchema((v) => !v)}>
            <Table2 /> 스키마
          </Button>
          <Button size="sm" variant={showHistory ? 'soft' : 'ghost'} title="쿼리 히스토리" onClick={() => setShowHistory((v) => !v)}>
            <History /> 히스토리
          </Button>
          <Button size="sm" variant="outline" disabled={!sql.trim()} title="SQL 정형화" onClick={() => setSql(formatSql(sql, conn.dbType))}>
            <WandSparkles /> 포맷
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!sql.trim()}
            title="쿼리 라이브러리에 저장 (Collection 탭)"
            onClick={async () => {
              const name = sql.trim().split('\n')[0].slice(0, 40)
              const q = await window.rockury.savedQueries.createQuery({ connectionId: conn.id, folderId: null, name, sql })
              // 새로 만든 쿼리로 자동저장을 재링크 — 이전에 열려 있던 저장쿼리를 덮어쓰지 않도록.
              useQueryStore.getState().loadSaved(q.id, sql, conn.id)
            }}
          >
            <Save /> 저장
          </Button>
          <Button size="sm" variant="outline" disabled={!sql.trim() || explaining || loading || missing.length > 0} title="실행 계획(EXPLAIN)" onClick={() => void runExplain(conn.id, effectiveSql())}>
            {explaining ? <Loader2 className="animate-spin" /> : <Route />} EXPLAIN
          </Button>
          <Button size="sm" disabled={!canRun} onClick={() => void run(conn.id, effectiveSql())}>
            {loading ? <Loader2 className="animate-spin" /> : <Play />} 실행
            <span className="ml-1 text-[10px] opacity-70">⌘↵</span>
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {showSchema && (
          <SchemaPanel
            tables={tables ?? []}
            onInsert={(name) => setSql(sql + (sql && !sql.endsWith(' ') ? ' ' : '') + name)}
            onPreview={(t) => setPreview(t)}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* SQL 편집기 */}
          <div className="h-44 shrink-0 overflow-auto border-b border-line px-2 py-1">
            <SqlEditor
              value={sql}
              onChange={setSql}
              onRun={() => canRun && void run(conn.id, effectiveSql())}
              schema={buildSchemaMap(tables ?? [])}
              dialect={conn.dbType}
              placeholder="SELECT * FROM users WHERE id = {{userId}};"
            />
          </div>

          {/* 파라미터 키워드 입력 */}
          {keywords.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel/40 px-5 py-2 text-[12px]">
              <span className="text-muted">파라미터:</span>
              {keywords.map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <span className="font-mono text-[11px] text-accent">{`{{${k}}}`}</span>
                  <Input
                    value={kw[k] ?? ''}
                    onChange={(e) => setKw((v) => ({ ...v, [k]: e.target.value }))}
                    placeholder="값"
                    className="h-7 w-32 text-[12px]"
                  />
                </label>
              ))}
              {missing.length > 0 && <span className="text-[11px] text-destructive">미입력: {missing.join(', ')}</span>}
            </div>
          )}

          {/* 히스토리 패널 — 종류 필터 + 검색 + 클릭 Re-run */}
          {showHistory && <HistoryPanel history={history} onPick={(s) => { setSql(s); setShowHistory(false) }} />}

          {/* 트랜잭션 게이트 */}
          {tx && (
            <div className={cn('flex shrink-0 items-center gap-3 border-b px-5 py-2.5 text-[12.5px]', tx.destructive ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-accent/30 bg-accent-soft/50 text-fg')}>
              {tx.destructive && <AlertTriangle className="size-4 shrink-0 text-destructive" />}
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{tx.verb}</span> 실행됨 · 영향 <span className="font-mono font-semibold">{tx.affectedRows}</span>행 · 아직 커밋되지 않았습니다
                {tx.destructive && ' — WHERE 절이 없어 전체가 영향받습니다'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void rollback()}>롤백</Button>
              <Button size="sm" variant={tx.destructive ? 'destructive' : 'default'} onClick={() => void confirm()}>커밋</Button>
            </div>
          )}

          {ddlWarning && !tx && (
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-5 py-2 text-[12px] text-muted">
              <AlertTriangle className="size-3.5" /> DDL 은 즉시 자동 커밋되었습니다(롤백 불가).
            </div>
          )}

          {explain && <ExplainPanel explain={explain} dialect={conn.dbType} />}

          {error && (
            <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-5 py-2.5 text-[12px] text-destructive">
              <span className="min-w-0 flex-1 whitespace-pre-wrap font-mono">{error}</span>
              <button type="button" onClick={dismissError} className="shrink-0 opacity-70 hover:opacity-100"><X className="size-3.5" /></button>
            </div>
          )}

          {/* 결과 */}
          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="flex h-full items-center justify-center text-[13px] text-muted">
                <Loader2 className="mr-2 size-4 animate-spin" /> 실행 중…
              </div>
            ) : result && result.columns.length > 0 ? (
              <div className="overflow-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead className="sticky top-0 bg-panel">
                    <tr>
                      <th className="border-b border-line px-2 py-1.5 text-right font-medium text-muted">#</th>
                      {result.columns.map((c) => (
                        <th key={c} className="border-b border-line px-3 py-1.5 text-left font-mono font-semibold text-fg">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row, i) => (
                      <tr key={i} className="hover:bg-panel/60">
                        <td className="border-b border-line/50 px-2 py-1 text-right font-mono text-muted">{i + 1}</td>
                        {result.columns.map((c) => {
                          const { text, muted } = cell(row[c])
                          return (
                            <td key={c} className={cn('max-w-[360px] truncate border-b border-line/50 px-3 py-1 font-mono', muted ? 'italic text-muted' : 'text-fg')} title={text}>{text}</td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center gap-3 px-5 py-2 text-[11px] text-muted">
                  <span>
                    {result.rowCount}행
                    {rows.length > MAX_ROWS && ` · 상위 ${MAX_ROWS}행만 표시`}
                    {typeof result.executionTimeMs === 'number' && ` · ${result.executionTimeMs}ms`}
                  </span>
                  <button type="button" className="flex items-center gap-1 hover:text-accent" onClick={() => download('query-result.csv', toCsv(result.columns, rows), 'text/csv')}><Download className="size-3" /> CSV</button>
                  <button type="button" className="flex items-center gap-1 hover:text-accent" onClick={() => download('query-result.json', toJson(rows), 'application/json')}><Download className="size-3" /> JSON</button>
                </div>
              </div>
            ) : result ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-[13px] text-muted">
                <span>{typeof result.affectedRows === 'number' ? `${result.affectedRows}행 영향` : '결과 집합 없음'}</span>
                <span className="text-[11px]">{result.executionTimeMs}ms</span>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-[13px] text-muted">SQL 을 실행하면 결과가 여기 표시됩니다</div>
            )}
          </div>
        </div>
      </div>

      {preview && <TablePreviewModal connectionId={conn.id} dialect={conn.dbType} table={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

/** 스키마 사이드 패널 — 테이블/컬럼 트리 + 검색 + 클릭 삽입 + 테이블 미리보기. */
function SchemaPanel({ tables, onInsert, onPreview }: { tables: TableDef[]; onInsert: (name: string) => void; onPreview: (table: string) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const query = q.trim().toLowerCase()
  const filtered = tables.filter((t) => !query || t.name.toLowerCase().includes(query) || t.columns.some((c) => c.name.toLowerCase().includes(query)))
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line">
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-2">
        <Search className="size-3.5 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="테이블/컬럼 검색" className="w-full bg-transparent text-[12px] outline-none" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {filtered.map((t) => {
          const kinds = columnKeyKinds(t)
          const expanded = open[t.name] ?? !!query
          return (
            <div key={t.id}>
              <div className="flex items-center gap-1 px-2 py-1 text-[12px]">
                <button type="button" onClick={() => setOpen((o) => ({ ...o, [t.name]: !expanded }))} className="text-muted">
                  {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
                <button type="button" onClick={() => onInsert(t.name)} className="min-w-0 flex-1 truncate text-left font-mono font-semibold text-fg hover:text-accent" title="에디터에 삽입">
                  {t.name}
                </button>
                {t.isView && <span className="rounded bg-accent-soft px-1 text-[9px] font-bold text-accent">V</span>}
                <button type="button" onClick={() => onPreview(t.name)} className="text-muted hover:text-accent" title="미리보기(SELECT * LIMIT 50)"><Table2 className="size-3" /></button>
              </div>
              {expanded &&
                t.columns.map((c) => {
                  const badges = badgeLabels(kinds.get(c.id))
                  return (
                    <button key={c.id} type="button" onClick={() => onInsert(c.name)} className="flex w-full items-center gap-1.5 py-0.5 pl-8 pr-2 text-left font-mono text-[11px] text-muted hover:bg-panel hover:text-accent">
                      {badges.map((b) => <span key={b} className="rounded bg-accent-soft px-1 text-[8.5px] font-bold text-accent">{b}</span>)}
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="shrink-0 text-[10px] opacity-60">{c.type}</span>
                    </button>
                  )
                })}
            </div>
          )
        })}
        {filtered.length === 0 && <div className="px-3 py-2 text-[11.5px] text-muted">일치 없음</div>}
      </div>
    </aside>
  )
}

/** 히스토리 패널 — 종류 필터 + 검색 + 클릭 Re-run. */
function HistoryPanel({ history, onPick }: { history: { id: string; sql: string; kind: string; status: string; rowCount: number; affectedRows: number | null; execMs: number | null }[]; onPick: (sql: string) => void }) {
  const [kind, setKind] = useState<'all' | 'read' | 'dml' | 'ddl'>('all')
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const rows = history.filter((h) => (kind === 'all' || h.kind === kind) && (!query || h.sql.toLowerCase().includes(query)))
  return (
    <div className="max-h-56 shrink-0 overflow-auto border-b border-line bg-panel/40">
      <div className="sticky top-0 flex items-center gap-1.5 border-b border-line/50 bg-panel/80 px-5 py-1.5">
        {(['all', 'read', 'dml', 'ddl'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cn('rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase outline-none', kind === k ? 'bg-accent text-white' : 'bg-panel-strong text-muted hover:text-fg')}>{k}</button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Search className="size-3 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" className="w-28 bg-transparent text-[11px] outline-none" />
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-3 text-[12px] text-muted">히스토리가 없습니다</div>
      ) : (
        rows.map((h) => (
          <button key={h.id} type="button" onClick={() => onPick(h.sql)} className="flex w-full items-center gap-2 border-b border-line/50 px-5 py-1.5 text-left outline-none hover:bg-panel">
            <span className={cn('size-1.5 shrink-0 rounded-full', h.status === 'success' ? 'bg-success' : 'bg-destructive')} />
            <span className="w-10 shrink-0 font-mono text-[10px] uppercase text-muted">{h.kind}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg" title={h.sql}>{h.sql}</span>
            <span className="shrink-0 text-[10.5px] text-muted">
              {h.affectedRows != null ? `${h.affectedRows}행` : `${h.rowCount}행`}
              {h.execMs != null ? ` · ${h.execMs}ms` : ''}
            </span>
          </button>
        ))
      )}
    </div>
  )
}

/** EXPLAIN 패널 — 요약 + 재귀 트리. */
function ExplainPanel({ explain, dialect }: { explain: { summary: string; planRows: Record<string, unknown>[]; explainSql: string }; dialect: DialectId }) {
  const [open, setOpen] = useState(true)
  const tree = parseExplainTree(explain.planRows, dialect)
  return (
    <div className="max-h-64 shrink-0 overflow-auto border-b border-line bg-panel/50 px-5 py-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[12px] text-fg outline-none">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Route className="size-3.5 text-accent" />
        <span className="font-semibold">실행 계획</span>
        {explain.summary && <span className="text-muted">· {explain.summary}</span>}
      </button>
      {open && (
        <div className="mt-1.5">
          {tree ? <JsonTree data={tree} /> : <div className="font-mono text-[11px] text-muted">{explain.explainSql}</div>}
        </div>
      )}
    </div>
  )
}

/** 재귀 JSON 트리 — 접기/펼치기(EXPLAIN 계획용, 방언 무관). */
function JsonTree({ data, depth = 0, label }: { data: unknown; depth?: number; label?: string }) {
  const [open, setOpen] = useState(depth < 3)
  const isObj = data !== null && typeof data === 'object'
  if (!isObj) {
    return (
      <div style={{ paddingLeft: depth * 12 }} className="font-mono text-[11px] leading-relaxed">
        {label != null && <span className="text-muted">{label}: </span>}
        <span className="text-fg">{String(data)}</span>
      </div>
    )
  }
  const entries: [string, unknown][] = Array.isArray(data) ? data.map((v, i) => [String(i), v]) : Object.entries(data as Record<string, unknown>)
  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 font-mono text-[11px] text-muted outline-none hover:text-fg">
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label != null ? label : Array.isArray(data) ? `[${entries.length}]` : '{ }'}
      </button>
      {open && entries.map(([k, v]) => <JsonTree key={k} data={v} depth={depth + 1} label={k} />)}
    </div>
  )
}

/** 테이블 미리보기 모달 — SELECT * … LIMIT 50. */
function TablePreviewModal({ connectionId, dialect, table, onClose }: { connectionId: string; dialect: string; table: string; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [cols, setCols] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const q = dialect === 'mysql' || dialect === 'mariadb' ? '`' : '"'
  const ref = useRef(table)
  useEffect(() => {
    void (async () => {
      try {
        const r = await window.rockury.query.run(connectionId, `SELECT * FROM ${q}${ref.current}${q} LIMIT 50`)
        setRows(r.rows)
        setCols(r.columns)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>미리보기 · {table} (상위 50행)</DialogTitle>
        </DialogHeader>
        {err ? (
          <div className="rounded bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{err}</div>
        ) : (
          <div className="mt-2 max-h-[60vh] overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-panel">
                <tr>{cols.map((c) => <th key={c} className="border-b border-line px-2 py-1 text-left font-mono">{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-panel/60">
                    {cols.map((c) => {
                      const { text, muted } = cell(row[c])
                      return <td key={c} className={cn('max-w-[220px] truncate border-b border-line/50 px-2 py-1 font-mono', muted ? 'italic text-muted' : 'text-fg')} title={text}>{text}</td>
                    })}
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
