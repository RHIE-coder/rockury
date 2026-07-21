import { useEffect, useState } from 'react'
import { AlertTriangle, History, Loader2, Play, Route, Terminal, WandSparkles, X } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { SqlEditor } from '@renderer/ui/SqlEditor'
import { useActiveConnection } from '../connections/store'
import { useConsoleStore } from './store'
import { buildSchemaMap, formatSql } from './query/schema'
import { useQueryStore } from './query/store'

const MAX_ROWS = 500

/** 셀 값 표시 — NULL/객체/원시값 구분. */
function cell(v: unknown): { text: string; muted?: boolean } {
  if (v === null || v === undefined) return { text: 'NULL', muted: true }
  if (typeof v === 'object') return { text: JSON.stringify(v) }
  return { text: String(v) }
}

/**
 * Console › Query(운영부 · depth 3) — 활성 환경에 SQL 을 실행한다.
 * ⭐ DML 은 트랜잭션 게이트: 실행하면 영향 행수를 먼저 보여주고 사용자가 커밋/롤백을 결정한다.
 * DDL 은 즉시 실행되며 자동 커밋 경고를 띄운다(MySQL 롤백 불가).
 */
export function QueryView() {
  const conn = useActiveConnection()
  const tables = useConsoleStore((s) => (conn ? s.byEnv[conn.id] : undefined))
  const loadIntro = useConsoleStore((s) => s.load)
  const history = useQueryStore((s) => s.history)
  const loadHistory = useQueryStore((s) => s.loadHistory)
  const [showHistory, setShowHistory] = useState(false)
  useEffect(() => {
    if (conn) {
      void loadIntro(conn.id, conn.id)
      void loadHistory(conn.id)
    }
  }, [conn, loadIntro, loadHistory])

  const sql = useQueryStore((s) => s.sql)
  const setSql = useQueryStore((s) => s.setSql)
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
  const canRun = !loading && sql.trim().length > 0 && !tx

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">
            Query <span className="font-normal text-muted">· {conn.name}</span>
          </h2>
          <p className="text-[12px] text-muted">SQL 실행 · DML 은 커밋 전 확인, DDL 은 자동 커밋</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={showHistory ? 'soft' : 'ghost'}
            title="쿼리 히스토리"
            onClick={() => setShowHistory((v) => !v)}
          >
            <History /> 히스토리
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!sql.trim()}
            title="SQL 정형화"
            onClick={() => setSql(formatSql(sql, conn.dbType))}
          >
            <WandSparkles /> 포맷
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!sql.trim() || explaining || loading}
            title="실행 계획(EXPLAIN) — 실제 반영 없음"
            onClick={() => void runExplain(conn.id)}
          >
            {explaining ? <Loader2 className="animate-spin" /> : <Route />} EXPLAIN
          </Button>
          <Button size="sm" disabled={!canRun} onClick={() => void run(conn.id)}>
            {loading ? <Loader2 className="animate-spin" /> : <Play />} 실행
            <span className="ml-1 text-[10px] opacity-70">⌘↵</span>
          </Button>
        </div>
      </div>

      {/* SQL 편집기 — CodeMirror (스키마 자동완성 + 하이라이트) */}
      <div className="h-44 shrink-0 overflow-auto border-b border-line px-2 py-1">
        <SqlEditor
          value={sql}
          onChange={setSql}
          onRun={() => canRun && void run(conn.id)}
          schema={buildSchemaMap(tables ?? [])}
          dialect={conn.dbType}
          placeholder="SELECT * FROM users LIMIT 10;"
        />
      </div>

      {/* 히스토리 패널 — 클릭 시 에디터로 불러오기(rky 의 TODO 완성) */}
      {showHistory && (
        <div className="max-h-56 shrink-0 overflow-auto border-b border-line bg-panel/40">
          {history.length === 0 ? (
            <div className="px-5 py-3 text-[12px] text-muted">히스토리가 없습니다</div>
          ) : (
            history.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  setSql(h.sql)
                  setShowHistory(false)
                }}
                className="flex w-full items-center gap-2 border-b border-line/50 px-5 py-1.5 text-left outline-none hover:bg-panel"
              >
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    h.status === 'success' ? 'bg-success' : 'bg-destructive'
                  )}
                />
                <span className="w-10 shrink-0 font-mono text-[10px] uppercase text-muted">{h.kind}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg" title={h.sql}>
                  {h.sql}
                </span>
                <span className="shrink-0 text-[10.5px] text-muted">
                  {h.affectedRows != null ? `${h.affectedRows}행` : `${h.rowCount}행`}
                  {h.execMs != null ? ` · ${h.execMs}ms` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {/* 트랜잭션 게이트 바 */}
      {tx && (
        <div
          className={cn(
            'flex shrink-0 items-center gap-3 border-b px-5 py-2.5 text-[12.5px]',
            tx.destructive
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-accent/30 bg-accent-soft/50 text-fg'
          )}
        >
          {tx.destructive && <AlertTriangle className="size-4 shrink-0 text-destructive" />}
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{tx.verb}</span> 실행됨 · 영향{' '}
            <span className="font-mono font-semibold">{tx.affectedRows}</span>행 · 아직 커밋되지
            않았습니다
            {tx.destructive && ' — WHERE 절이 없어 전체가 영향받습니다'}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void rollback()}>
            롤백
          </Button>
          <Button
            size="sm"
            variant={tx.destructive ? 'destructive' : 'default'}
            onClick={() => void confirm()}
          >
            커밋
          </Button>
        </div>
      )}

      {ddlWarning && !tx && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-5 py-2 text-[12px] text-muted">
          <AlertTriangle className="size-3.5" /> DDL 은 즉시 자동 커밋되었습니다(롤백 불가).
        </div>
      )}

      {explain && (
        <div className="shrink-0 border-b border-line bg-panel/50 px-5 py-2">
          <div className="flex items-center gap-1.5 text-[12px] text-fg">
            <Route className="size-3.5 text-accent" />
            <span className="font-semibold">실행 계획</span>
            {explain.summary && <span className="text-muted">· {explain.summary}</span>}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-muted" title={explain.explainSql}>
            {explain.explainSql}
          </div>
        </div>
      )}

      {error && (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-5 py-2.5 text-[12px] text-destructive">
          <span className="min-w-0 flex-1 whitespace-pre-wrap font-mono">{error}</span>
          <button type="button" onClick={dismissError} className="shrink-0 opacity-70 hover:opacity-100">
            <X className="size-3.5" />
          </button>
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
                    <th
                      key={c}
                      className="border-b border-line px-3 py-1.5 text-left font-mono font-semibold text-fg"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, i) => (
                  <tr key={i} className="hover:bg-panel/60">
                    <td className="border-b border-line/50 px-2 py-1 text-right font-mono text-muted">
                      {i + 1}
                    </td>
                    {result.columns.map((c) => {
                      const { text, muted } = cell(row[c])
                      return (
                        <td
                          key={c}
                          className={cn(
                            'max-w-[360px] truncate border-b border-line/50 px-3 py-1 font-mono',
                            muted ? 'italic text-muted' : 'text-fg'
                          )}
                          title={text}
                        >
                          {text}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-2 text-[11px] text-muted">
              {result.rowCount}행
              {rows.length > MAX_ROWS && ` · 상위 ${MAX_ROWS}행만 표시`}
              {typeof result.executionTimeMs === 'number' && ` · ${result.executionTimeMs}ms`}
            </div>
          </div>
        ) : result ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-[13px] text-muted">
            <span>
              {typeof result.affectedRows === 'number'
                ? `${result.affectedRows}행 영향`
                : '결과 집합 없음'}
            </span>
            <span className="text-[11px]">{result.executionTimeMs}ms</span>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-muted">
            SQL 을 실행하면 결과가 여기 표시됩니다
          </div>
        )}
      </div>
    </div>
  )
}
