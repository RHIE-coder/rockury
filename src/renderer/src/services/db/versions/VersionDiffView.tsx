import { useMemo, useState } from 'react'
import { ArrowRight, GitCompare, Minus, PenLine, Plus } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/ui/select'
import { cn } from '@renderer/lib/utils'
import { useActiveDesign } from '../designs/store'
import { useDesignVersions, type VersionDef } from './store'
import { diffSnapshots, isEmptyDiff, type ChangeStatus, type FieldChange } from './diff'

const STATUS_STYLE: Record<ChangeStatus, { chip: string; icon: typeof Plus; label: string }> = {
  added: { chip: 'bg-success-soft text-success', icon: Plus, label: '추가' },
  removed: { chip: 'bg-danger/10 text-danger', icon: Minus, label: '삭제' },
  modified: { chip: 'bg-info-soft text-info', icon: PenLine, label: '변경' }
}

function StatusTag({ status }: { status: ChangeStatus }) {
  const s = STATUS_STYLE[status]
  const Icon = s.icon
  return (
    <span className={cn('flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold', s.chip)}>
      <Icon className="size-3" />
      {s.label}
    </span>
  )
}

/** field: before → after 한 줄. */
function ChangeLine({ c }: { c: FieldChange }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px]">
      <span className="w-20 shrink-0 text-muted">{c.field}</span>
      <span className="font-mono text-danger/80 line-through">{c.before}</span>
      <ArrowRight className="size-3 shrink-0 text-muted" />
      <span className="font-mono text-success">{c.after}</span>
    </div>
  )
}

function SummaryChip({ n, label, tone }: { n: number; label: string; tone: string }) {
  if (n === 0) return null
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', tone)}>
      {label} {n}
    </span>
  )
}

/** Versions › Version Diff (diff ①) — 두 버전 스냅샷의 스키마 델타. */
export function VersionDiffView() {
  const design = useActiveDesign()
  const versions = useDesignVersions(design?.id ?? null)
  // 기본: base = 이전(둘째 최신), target = 최신
  const [baseId, setBaseId] = useState<string | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)

  const base = versions.find((v) => v.id === baseId) ?? versions[1] ?? null
  const target = versions.find((v) => v.id === targetId) ?? versions[0] ?? null

  const diff = useMemo(
    () => (base && target ? diffSnapshots(base.snapshot, target.snapshot) : null),
    [base, target]
  )

  if (!design) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[13px] text-muted">상단에서 설계를 먼저 선택하세요.</p>
      </div>
    )
  }

  if (versions.length < 2) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <GitCompare className="size-6 text-muted/60" />
        <div className="text-[13px] font-semibold text-fg">비교하려면 버전이 2개 이상 필요해요</div>
        <p className="max-w-72 text-[12px] text-muted">Timeline 에서 버전을 더 컷하세요.</p>
      </div>
    )
  }

  const verSelect = (value: VersionDef | null, onChange: (id: string) => void, label: string) => (
    <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
      {label}
      <Select value={value?.id} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-60 font-mono text-[12px] normal-case tracking-normal">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {versions.map((v) => (
            <SelectItem key={v.id} value={v.id} className="font-mono text-[12px]">
              {v.number}
              {v.note ? ` · ${v.note}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )

  return (
    <div className="mx-auto max-w-[880px] px-5 py-5">
      <div className="mb-3 flex items-center gap-2 text-[16px] font-bold tracking-tight text-fg">
        <GitCompare className="size-4 text-muted" />
        버전 비교
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
        {verSelect(base, setBaseId, '이전')}
        <ArrowRight className="size-4 text-muted" />
        {verSelect(target, setTargetId, '이후')}
      </div>

      {diff && (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {isEmptyDiff(diff) ? (
              <span className="rounded-full bg-panel-strong px-2 py-0.5 text-[11px] text-muted">
                두 버전의 스키마가 동일해요
              </span>
            ) : (
              <>
                <SummaryChip n={diff.summary.tablesAdded} label="테이블 +" tone="bg-success-soft text-success" />
                <SummaryChip n={diff.summary.tablesModified} label="테이블 ~" tone="bg-info-soft text-info" />
                <SummaryChip n={diff.summary.tablesRemoved} label="테이블 −" tone="bg-danger/10 text-danger" />
                <SummaryChip n={diff.summary.columnsAdded} label="컬럼 +" tone="bg-success-soft text-success" />
                <SummaryChip n={diff.summary.columnsModified} label="컬럼 ~" tone="bg-info-soft text-info" />
                <SummaryChip n={diff.summary.columnsRemoved} label="컬럼 −" tone="bg-danger/10 text-danger" />
                <SummaryChip n={diff.summary.constraintsAdded} label="제약 +" tone="bg-success-soft text-success" />
                <SummaryChip n={diff.summary.constraintsModified} label="제약 ~" tone="bg-info-soft text-info" />
                <SummaryChip n={diff.summary.constraintsRemoved} label="제약 −" tone="bg-danger/10 text-danger" />
              </>
            )}
          </div>

          {!isEmptyDiff(diff) && (
            <div className="flex flex-col gap-2">
              {diff.tables.map((t) => (
                <div key={t.id} className="overflow-hidden rounded-[10px] border border-line">
                  <div className="flex items-center gap-2 bg-panel px-3 py-2">
                    <StatusTag status={t.status} />
                    <span className="font-mono text-[13px] font-semibold text-fg">{t.name}</span>
                  </div>

                  {t.status === 'modified' && (
                    <div className="flex flex-col gap-2 px-3 py-2.5">
                      {t.tableChanges.length > 0 && (
                        <div className="flex flex-col gap-1">
                          {t.tableChanges.map((c) => (
                            <ChangeLine key={c.field} c={c} />
                          ))}
                        </div>
                      )}

                      {t.columns.map((col) => (
                        <div key={col.id} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <StatusTag status={col.status} />
                            <span className="font-mono text-[12px] text-fg">{col.name}</span>
                            <span className="text-[10.5px] text-muted">컬럼</span>
                          </div>
                          {col.changes.length > 0 && (
                            <div className="flex flex-col gap-0.5 pl-3">
                              {col.changes.map((c) => (
                                <ChangeLine key={c.field} c={c} />
                              ))}
                            </div>
                          )}
                        </div>
                      ))}

                      {t.constraints.map((con) => (
                        <div key={con.id} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <StatusTag status={con.status} />
                            <span className="font-mono text-[12px] text-fg">{con.name}</span>
                            <span className="rounded bg-panel-strong px-1 py-0.5 font-mono text-[9px] text-muted">
                              {con.kind.toUpperCase()}
                            </span>
                          </div>
                          {con.changes.length > 0 && (
                            <div className="flex flex-col gap-0.5 pl-3">
                              {con.changes.map((c) => (
                                <ChangeLine key={c.field} c={c} />
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
