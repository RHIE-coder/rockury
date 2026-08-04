import { useState } from 'react'
import { ChevronDown, Loader2, PlugZap, RefreshCw } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import { describeConnectionError } from './connectionProblem'

/**
 * 실 DB 에 연결하지 못했을 때 Remote 화면들이 **함께 쓰는** 알림.
 *
 * 왜 공용인가: 예전엔 화면마다 달랐다 — Definition·Diagram·Object 는 `역설계 실패: <드라이버 원문>`
 * 을 보이고 **Data·Query 는 아무 말도 안 했다.** 그래서 표가 안 뜨는 것이 연결 탓인지 앱 탓인지
 * 알 수 없었다(2026-08-04 사용자 실측 — "앱 문제인 줄 알았다").
 *
 * 세 가지를 한 자리에 둔다: 무엇이 잘못됐나 · 무엇을 확인하나 · 다시 해 보기.
 */
export function ConnectionError({
  connectionName,
  error,
  onRetry,
  retrying = false,
  /** 화면 한가운데를 채울지(본문이 통째로 빌 때) 줄 배너로 얹을지. */
  variant = 'block'
}: {
  connectionName: string
  error: string
  onRetry?: () => void
  retrying?: boolean
  variant?: 'block' | 'inline'
}) {
  const [showRaw, setShowRaw] = useState(false)
  const { reason, hint, raw } = describeConnectionError(error)

  const retry = onRetry && (
    <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
      {retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />} 다시 시도
    </Button>
  )

  if (variant === 'inline') {
    return (
      <div
        data-connection-error
        className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-[12px] text-destructive"
      >
        <PlugZap className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <b className="font-semibold">{connectionName}</b>에 연결할 수 없습니다 — {reason}.
          {hint && <span className="ml-1 opacity-80">{hint}</span>}
        </span>
        {retry}
      </div>
    )
  }

  return (
    <div
      data-connection-error
      className="flex flex-1 items-center justify-center p-8"
    >
      <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-center">
        <PlugZap className="mx-auto mb-3 size-7 text-destructive" />
        <p className="text-[14px] font-semibold text-fg">
          <b>{connectionName}</b>에 연결할 수 없습니다
        </p>
        <p className="mt-1 text-[13px] text-destructive">{reason}</p>
        {hint && <p className="mt-2 text-[12px] text-muted">{hint}</p>}

        <div className="mt-4 flex items-center justify-center gap-2">{retry}</div>

        {raw && (
          <div className="mt-4 text-left">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-muted hover:text-fg"
            >
              <ChevronDown className={cn('size-3 transition', showRaw && 'rotate-180')} />
              서버가 보낸 말
            </button>
            {showRaw && (
              // 원문은 접어 두되 버리지 않는다 — 규칙에 없는 오류는 여기에만 단서가 있다.
              <pre className="mt-1.5 overflow-x-auto rounded bg-panel px-2 py-1.5 font-mono text-[11px] text-muted">
                {raw}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
