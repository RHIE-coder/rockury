import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { Input } from '@renderer/ui/input'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import { RUN_STATUSES, RUN_STATUS_LABEL, type RunRecord, type RunStatus } from '@shared/api/types'
import { useApiStore } from '../store'
import { useOpsStore, useOpsSync } from '../ops/store'

/**
 * Runner › History — `docs/spec/api-runner.md` § history.
 *
 * 이 목록이 이 앱이 AI 에게 댈 수 있는 두 조각 중 하나다("사람이 쓰면서 쌓인 관측").
 * 그래서 **지나간 기록은 안 고친다** — 읽기와 재실행만 있다.
 */

function fmt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'medium' })
}

function RunRow({ run, open, onToggle }: { run: RunRecord; open: boolean; onToggle: () => void }) {
  return (
    <div data-api-run-row={run.requestName} className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-panel"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{run.requestName}</span>
        <span className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-[10.5px] text-muted">
          {run.environmentName}
        </span>
        <span
          data-api-run-status={run.status}
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium',
            run.status === 'ok' ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'
          )}
        >
          {RUN_STATUS_LABEL[run.status]}
          {run.httpStatus !== null && ` ${run.httpStatus}`}
        </span>
        <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted">{run.durationMs}ms</span>
        <span className="w-36 shrink-0 text-right text-[11px] tabular-nums text-muted">{fmt(run.createdAt)}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 bg-panel px-4 py-3 text-[11.5px]" data-api-run-detail>
          <div className="font-mono break-all text-fg">
            <b>{run.request.method}</b> {run.request.url}
          </div>
          {Object.keys(run.request.headers).length > 0 && (
            <div className="font-mono break-all text-muted">
              {Object.entries(run.request.headers).map(([k, v]) => (
                <div key={k}>
                  {k}: {v}
                </div>
              ))}
            </div>
          )}
          {run.error && <div className="text-danger">{run.error}</div>}
          {run.response && (
            <pre className="max-h-56 overflow-auto rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-fg">
              {run.response.body || '(본문 없음)'}
            </pre>
          )}
          <span className="text-muted">
            기준 버전: {run.baseVersion ?? 'Draft (버전 컷 전)'} · 이 기록은 고쳐지지 않습니다
          </span>
        </div>
      )}
    </div>
  )
}

export function HistoryView() {
  useOpsSync()
  const spec = useApiStore((s) => s.active)
  const runs = useOpsStore((s) => s.runs)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<RunStatus | ''>('')
  const [openId, setOpenId] = useState<string | null>(null)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return runs.filter(
      (r) =>
        (!needle ||
          r.requestName.toLowerCase().includes(needle) ||
          r.environmentName.toLowerCase().includes(needle)) &&
        (!status || r.status === status)
    )
  }, [runs, q, status])

  if (!spec) {
    return (
      <PlaceholderView
        icon={History}
        depth="depth 3 · API › Runner › History"
        title="명세를 먼저 고르세요"
        subtitle="기록은 명세에 속합니다 — 상단 컨텍스트 바에서 명세를 고르세요."
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <History className="size-4 text-muted" />
        <span className="text-[14px] font-semibold text-fg">실행 기록</span>
        <span className="text-[11.5px] text-muted">— 실제로 쏴 보고 받은 것</span>
        <span className="flex-1" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="요청·환경 검색"
          data-api-history-search
          className="h-7 w-48 text-[12px]"
        />
        <select
          value={status}
          data-api-history-status
          className="h-7 rounded-md border border-line bg-canvas px-1.5 text-[12px] text-fg"
          onChange={(e) => setStatus(e.target.value as RunStatus | '')}
        >
          <option value="">모든 상태</option>
          {RUN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {RUN_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-muted" data-api-empty="no-run">
            {runs.length === 0
              ? '아직 쏴 본 기록이 없어요. Send 에서 요청을 한 번 보내면 여기 쌓입니다.'
              : '검색·필터에 걸리는 기록이 없어요.'}
          </p>
        ) : (
          shown.map((r) => (
            <RunRow key={r.id} run={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} />
          ))
        )}
      </div>
    </div>
  )
}
