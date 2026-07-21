import { AlertTriangle, Loader2, Play, Terminal, X } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { useNav } from '@renderer/nav/useNav'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { useActiveDesign } from '../designs/store'
import { useDesignEnvironments } from '../environments/store'
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
  const design = useActiveDesign()
  const envId = useNav((s) => s.contextValues['env'])
  const environments = useDesignEnvironments(design?.id ?? null)
  const env = environments.find((e) => e.id === envId) ?? null

  const sql = useQueryStore((s) => s.sql)
  const setSql = useQueryStore((s) => s.setSql)
  const result = useQueryStore((s) => s.result)
  const error = useQueryStore((s) => s.error)
  const loading = useQueryStore((s) => s.loading)
  const ddlWarning = useQueryStore((s) => s.ddlWarning)
  const tx = useQueryStore((s) => s.tx)
  const run = useQueryStore((s) => s.run)
  const confirm = useQueryStore((s) => s.confirm)
  const rollback = useQueryStore((s) => s.rollback)
  const dismissError = useQueryStore((s) => s.dismissError)

  if (!design) {
    return (
      <PlaceholderView
        icon={Terminal}
        depth="depth 3 · Console › Query"
        title="설계를 먼저 선택하세요"
        subtitle="운영부는 설계에 소속된 환경을 기준으로 동작합니다."
      />
    )
  }
  if (!envId || !env) {
    return (
      <PlaceholderView
        icon={Terminal}
        depth="depth 3 · Console › Query"
        title="환경을 선택하세요"
        subtitle="상단 컨텍스트 바의 Env 셀렉터에서 대상 환경을 고르면 SQL 을 실행할 수 있습니다."
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
            Query <span className="font-normal text-muted">· {env.name}</span>
          </h2>
          <p className="text-[12px] text-muted">SQL 실행 · DML 은 커밋 전 확인, DDL 은 자동 커밋</p>
        </div>
        <Button size="sm" disabled={!canRun} onClick={() => void run(envId)}>
          {loading ? <Loader2 className="animate-spin" /> : <Play />} 실행
          <span className="ml-1 text-[10px] opacity-70">⌘↵</span>
        </Button>
      </div>

      {/* SQL 편집기(간이) */}
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canRun) {
            e.preventDefault()
            void run(envId)
          }
        }}
        spellCheck={false}
        placeholder="SELECT * FROM users LIMIT 10;"
        className="h-40 shrink-0 resize-none border-b border-line bg-canvas px-5 py-3 font-mono text-[13px] leading-relaxed text-fg outline-none placeholder:text-muted"
      />

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
