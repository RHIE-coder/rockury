import { ArrowRight, Minus, PenLine, Plus } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { ChangeStatus, FieldChange, SchemaDiff } from './diff'
import { isEmptyDiff } from './diff'

/**
 * SchemaDiff 상세 렌더러(공용) — 요약 칩 + 테이블별 변경 카드.
 * Versions › Version Diff 와 Migration › Compare 가 같은 화면 문법을 공유한다.
 * 아래 StatusTag·ChangeLine·SummaryChip 은 **diff 화면 문법의 정본**이라 export 한다 —
 * 시드 diff 패널(SeedDiffPanel)이 같은 표기를 다시 만들지 않고 이걸 쓴다.
 */
const STATUS_STYLE: Record<ChangeStatus, { chip: string; icon: typeof Plus; label: string }> = {
  added: { chip: 'bg-success-soft text-success', icon: Plus, label: '추가' },
  removed: { chip: 'bg-danger/10 text-danger', icon: Minus, label: '삭제' },
  modified: { chip: 'bg-info-soft text-info', icon: PenLine, label: '변경' }
}

export function StatusTag({ status }: { status: ChangeStatus }) {
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
export function ChangeLine({ c }: { c: FieldChange }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px]">
      <span className="w-20 shrink-0 text-muted">{c.field}</span>
      <span className="font-mono text-danger/80 line-through">{c.before}</span>
      <ArrowRight className="size-3 shrink-0 text-muted" />
      <span className="font-mono text-success">{c.after}</span>
    </div>
  )
}

export function SummaryChip({ n, label, tone }: { n: number; label: string; tone: string }) {
  if (n === 0) return null
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', tone)}>
      {label} {n}
    </span>
  )
}

/** diff 전체 패널 — 비었으면 emptyText 한 줄, 아니면 요약 칩 + 테이블 카드. */
export function SchemaDiffPanel({ diff, emptyText }: { diff: SchemaDiff; emptyText: string }) {
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {isEmptyDiff(diff) ? (
          <span className="rounded-full bg-panel-strong px-2 py-0.5 text-[11px] text-muted">{emptyText}</span>
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
  )
}
