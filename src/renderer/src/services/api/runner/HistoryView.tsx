import { useEffect, useMemo, useState } from 'react'
import { GitCompare, History, RotateCcw } from 'lucide-react'
import { Input } from '@renderer/ui/input'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import { exportTimeline } from '@shared/api/stream'
import { diffRuns, RUN_DIFF_LABEL, summarizeRunDiff, type RunDiffKind } from '@shared/api/runDiff'
import { MASK } from '@shared/api/template'
import { useNav } from '@renderer/nav/useNav'
import {
  RUN_STATUSES,
  RUN_STATUS_LABEL,
  STREAM_DIRECTION_LABEL,
  type RunRecord,
  type RunStatus
} from '@shared/api/types'
import { Button } from '@renderer/ui/button'
import { useApiStore } from '../store'
import { useOpsStore, useOpsSync } from '../ops/store'

/**
 * 스트림 세션 기록의 관측 내용 — **메시지 목록**이다(spec stream.session AC-6).
 *
 * 목록 조회는 본문을 안 읽으므로(5,000건을 매번 파싱하면 메인이 멈춘다) 펼칠 때 하나만
 * 따로 읽는다. 이 화면이 없으면 "세션이 기록으로 남았습니다 — 메시지 12건" 이라고 알린 뒤
 * **그 12건을 앱 어디서도 다시 볼 수 없다.**
 */
function SessionMessages({ run }: { run: RunRecord }) {
  const [full, setFull] = useState<RunRecord | null>(null)
  useEffect(() => {
    let alive = true
    void window.rockury.apiOps.getRun(run.specId, run.id).then((r) => {
      if (alive) setFull(r)
    })
    return () => {
      alive = false
    }
  }, [run.specId, run.id])

  const messages = full?.messages ?? null
  return (
    <div className="flex flex-col gap-1.5" data-api-run-messages>
      <div className="flex items-center gap-2">
        <span className="text-muted">주고받은 메시지 {run.messageCount ?? 0}건</span>
        {messages && messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10.5px]"
            data-api-run-export
            onClick={() => void navigator.clipboard.writeText(exportTimeline(messages))}
          >
            전체 내보내기
          </Button>
        )}
      </div>
      {messages === null ? (
        <span className="text-muted">불러오는 중…</span>
      ) : messages.length === 0 ? (
        <span className="text-muted">세션은 열렸지만 오간 메시지가 없습니다.</span>
      ) : (
        <div className="max-h-56 overflow-auto rounded-md border border-line bg-canvas">
          {messages.map((m) => (
            <div
              key={m.seq}
              data-api-run-msg={m.direction}
              className="flex items-start gap-2 border-b border-line px-2 py-1 font-mono text-[11px] last:border-b-0"
            >
              <span className="w-10 shrink-0 text-muted">{STREAM_DIRECTION_LABEL[m.direction]}</span>
              <span className="w-16 shrink-0 tabular-nums text-muted">{m.at.slice(11, 19)}</span>
              {m.event && <span className="shrink-0 text-muted">{m.event}</span>}
              <span className="min-w-0 flex-1 break-all whitespace-pre-wrap text-fg">{m.data}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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

function RunRow({
  run,
  open,
  picked,
  onToggle,
  onPick,
  onRerun
}: {
  run: RunRecord
  open: boolean
  /** 비교로 고른 자리(1=기준·2=비교). 안 골랐으면 null. */
  picked: 1 | 2 | null
  onToggle: () => void
  onPick: () => void
  onRerun: (() => void) | null
}) {
  return (
    <div data-api-run-row={run.requestName} className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-1 pr-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left hover:bg-panel"
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
      {/* 비교는 **두 개를 고르는 일**이라 행마다 자리표를 준다 — 순서가 뜻을 갖기 때문이다
          (기준 → 비교). 눌린 자리가 보이지 않으면 어느 쪽이 기준인지 모른다. */}
      <Button
        variant={picked ? 'secondary' : 'ghost'}
        size="sm"
        className="h-6 w-14 shrink-0 px-1 text-[10.5px]"
        data-api-run-pick={picked ?? ''}
        title={picked === 1 ? '비교의 기준' : picked === 2 ? '비교 대상' : '비교로 고르기'}
        onClick={onPick}
      >
        <GitCompare className="size-3" /> {picked === 1 ? '기준' : picked === 2 ? '비교' : '고르기'}
      </Button>
      {onRerun && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-1.5 text-[10.5px]"
          data-api-run-rerun
          title="같은 파라미터로 다시 보냅니다 — 지나간 기록은 안 바뀌고 새 기록이 하나 생깁니다."
          onClick={onRerun}
        >
          <RotateCcw className="size-3" /> 다시 실행
        </Button>
      )}
      </div>
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
          {/**
            * 스트림 세션은 정상 종료도 이 칸에 이유를 적는다("사용자가 끊었습니다") —
            * 실패 여부는 `status` 가 가른다. 있으면 빨갛게 칠하면 성공한 세션이 실패처럼 보인다.
            */}
          {run.error && (
            <div className={run.status === 'ok' ? 'text-muted' : 'text-danger'}>{run.error}</div>
          )}
          {run.shape !== 'unary' && <SessionMessages run={run} />}
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

/** 두 Run 비교 결과 — 판정(선언 대 실제)과 다르다. 여기는 **실제 대 실제**다. */
function ComparePanel({ a, b, onClear }: { a: RunRecord; b: RunRecord; onClear: () => void }) {
  const d = useMemo(() => diffRuns(a, b), [a, b])
  const style: Record<RunDiffKind, string> = {
    added: 'bg-accent-soft text-accent',
    removed: 'bg-danger-soft text-danger',
    changed: 'bg-accent-2-soft text-accent-2'
  }
  return (
    <div className="flex flex-col gap-2 border-b border-line bg-panel px-4 py-3" data-api-run-compare>
      <div className="flex items-center gap-2 text-[12px]">
        <GitCompare className="size-3.5 text-muted" />
        <span className="font-semibold text-fg">두 실행 비교</span>
        <span className="font-mono text-[11px] text-muted">
          {fmt(a.createdAt)} → {fmt(b.createdAt)}
        </span>
        <span className="flex-1" />
        <span data-api-run-compare-summary className="text-[11.5px] text-muted">
          {summarizeRunDiff(d)}
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={onClear}>
          닫기
        </Button>
      </div>

      {d.meta.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-api-run-compare-meta>
          {d.meta.map((m) => (
            <span key={m.path} className="rounded-full bg-canvas px-2 py-0.5 text-[10.5px] text-muted">
              {m.path}: {m.before} → {m.after}
            </span>
          ))}
        </div>
      )}

      {/* **비교할 수 없었다는 사실을 "같다" 로 바꾸지 않는다.** */}
      {d.unavailable ? (
        <p className="text-[11.5px] text-muted" data-api-run-compare-unavailable>
          {d.unavailable}
        </p>
      ) : d.fields.length === 0 ? (
        <p className="text-[11.5px] text-muted">응답 본문의 필드가 모두 같습니다.</p>
      ) : (
        <div className="max-h-56 overflow-auto rounded-md border border-line bg-canvas">
          {d.fields.map((f) => (
            <div
              key={`${f.kind}:${f.path}`}
              data-api-run-compare-field={f.kind}
              className="flex items-start gap-2 border-b border-line px-2.5 py-1 font-mono text-[11px] last:border-b-0"
            >
              <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px]', style[f.kind])}>
                {RUN_DIFF_LABEL[f.kind]}
              </span>
              <span className="min-w-0 flex-1 break-all text-fg">{f.path}</span>
              {f.before !== undefined && <span className="shrink-0 text-muted">{f.before}</span>}
              {f.before !== undefined && f.after !== undefined && <span className="text-muted">→</span>}
              {f.after !== undefined && <span className="shrink-0 text-fg">{f.after}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function HistoryView() {
  useOpsSync()
  const spec = useApiStore((s) => s.active)
  const runs = useOpsStore((s) => s.runs)
  const send = useOpsStore((s) => s.send)
  const setCallValues = useOpsStore((s) => s.setCallValues)
  const selectRequest = useApiStore((s) => s.selectRequest)
  const setContextValue = useNav((s) => s.setContextValue)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<RunStatus | ''>('')
  const [openId, setOpenId] = useState<string | null>(null)
  /** 비교로 고른 두 기록. **순서가 뜻을 갖는다** — 먼저 고른 것이 기준이다. */
  const [picks, setPicks] = useState<string[]>([])
  /** 다시 실행이 못 되살린 것을 알리는 한 줄. 조용히 넘어가면 `••••` 가 나간다. */
  const [rerunNote, setRerunNote] = useState<string | null>(null)

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

  /** 고르기 토글 — 세 번째를 고르면 기준을 밀어내고 새것이 비교가 된다(늘 최근 둘). */
  const pick = (id: string): void => {
    setPicks((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2)
    )
  }

  const compareA = runs.find((r) => r.id === picks[0]) ?? null
  const compareB = runs.find((r) => r.id === picks[1]) ?? null

  /**
   * 다시 실행 (spec history.list AC-3) — **같은 파라미터로** 보낸다.
   * 지나간 기록은 안 바뀐다(Run 은 불변) — 새 기록이 하나 더 생길 뿐이다.
   * 스트림·수신 기록에는 안 붙인다: 세션을 "다시 트는 것"은 같은 뜻이 아니고,
   * 웹훅은 우리가 보내는 것이 아니다.
   */
  const rerun = (run: RunRecord): void => {
    if (!spec) return
    // 지나간 호출 파라미터를 되살린다 — 조립된 주소에서는 되돌릴 수 없어서(치환은 한 방향이다)
    // 기록이 파라미터를 따로 들고 있다(spec send.observe AC-1).
    const masked = Object.entries(run.call).filter(([, v]) => v.includes(MASK))
    setCallValues(
      run.requestName,
      // 가려진 값은 **되살리지 않고 비운다** — `••••` 를 그대로 보내면 서버가 받는 것이 거짓이 된다.
      Object.fromEntries(Object.entries(run.call).map(([k, v]) => [k, v.includes(MASK) ? '' : v]))
    )
    selectRequest(run.requestName)
    setContextValue('env', run.environmentId)

    if (masked.length > 0) {
      // 조용히 보내면 `••••` 가 나간다. 무엇을 못 되살렸는지 지목하고 사람에게 넘긴다.
      setRerunNote(
        `${run.requestName} 의 파라미터를 되살렸지만 비밀 표식 값 ${masked
          .map(([k]) => k)
          .join(', ')} 은(는) 기록에 가려져 있어 못 되살렸습니다 — Send 에서 채우고 보내세요.`
      )
      return
    }
    setRerunNote(null)
    void send({ specId: spec.id, requestName: run.requestName, environmentId: run.environmentId })
  }

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

      {rerunNote && (
        <div
          data-api-rerun-note
          className="flex items-start gap-2 border-b border-line bg-panel px-4 py-2 text-[11.5px] text-muted"
        >
          <RotateCcw className="mt-[2px] size-3.5 shrink-0" />
          <span className="flex-1">{rerunNote}</span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setRerunNote(null)}>
            닫기
          </Button>
        </div>
      )}

      {compareA && compareB && (
        <ComparePanel a={compareA} b={compareB} onClear={() => setPicks([])} />
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-muted" data-api-empty="no-run">
            {runs.length === 0
              ? '아직 쏴 본 기록이 없어요. Send 에서 요청을 한 번 보내면 여기 쌓입니다.'
              : '검색·필터에 걸리는 기록이 없어요.'}
          </p>
        ) : (
          shown.map((r) => (
            <RunRow
              key={r.id}
              run={r}
              open={openId === r.id}
              picked={picks[0] === r.id ? 1 : picks[1] === r.id ? 2 : null}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              onPick={() => pick(r.id)}
              onRerun={r.shape === 'unary' ? () => rerun(r) : null}
            />
          ))
        )}
      </div>
    </div>
  )
}
