import { ArrowDownToLine, Radar, ScrollText } from 'lucide-react'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import { useApiStore } from '../store'
import { useContractStore, useContractSync } from './store'

/**
 * Contract › Logs
 *
 * 판정과 흡수를 **한 타임라인**에 둔다: "왜 이 필드가 명세에 있지"를 되짚으려면
 * 언제 판정했고 언제 받아들였나가 나란히 보여야 한다. 이력은 고쳐지지 않는다.
 */
export function LogsView() {
  useContractSync()
  const spec = useApiStore((s) => s.active)
  const logs = useContractStore((s) => s.logs)

  if (!spec) {
    return (
      <PlaceholderView
        icon={ScrollText}
        title="명세를 먼저 고르세요"
        subtitle="이력은 명세에 속합니다."
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <ScrollText className="size-4 text-muted" />
        <span className="text-[14px] font-semibold text-fg">판정·흡수 이력</span>
        <span className="text-[11.5px] text-muted">— 고쳐지지 않습니다</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {logs.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-muted" data-api-empty="no-log">
            아직 이력이 없어요. Drift 에서 판정을 한 번 돌리면 여기 쌓입니다.
          </p>
        ) : (
          logs.map((l) => (
            <div
              key={l.id}
              data-api-log-kind={l.kind}
              className="flex items-start gap-2 border-b border-line px-4 py-2.5 last:border-b-0"
            >
              <span
                className={cn(
                  'mt-[1px] flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium',
                  l.kind === 'drift' ? 'bg-panel text-muted' : 'bg-accent-soft text-accent'
                )}
              >
                {l.kind === 'drift' ? <Radar className="size-3" /> : <ArrowDownToLine className="size-3" />}
                {l.kind === 'drift' ? '판정' : '흡수'}
              </span>
              {l.grade && (
                <span className="mt-[1px] shrink-0 rounded-full bg-panel px-2 py-0.5 text-[10.5px] text-muted">
                  {l.grade === 'complete' ? '완전' : '관측'}
                </span>
              )}
              <span className="min-w-0 flex-1 text-[12px] break-all text-fg">{l.summary}</span>
              <span className="shrink-0 text-[11px] text-muted">{l.environmentName}</span>
              <span className="w-36 shrink-0 text-right text-[11px] tabular-nums text-muted">
                {new Date(l.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'medium' })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
