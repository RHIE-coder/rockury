import { AlertTriangle, Sprout } from 'lucide-react'
import { ChangeLine, StatusTag, SummaryChip } from './SchemaDiffPanel'
import { isEmptySeedDiff, type SeedDiff } from './seedDiff'

/**
 * 시드 diff 렌더러 — 세트별 카드(선언 변경 + 행 변경).
 * 표기(상태 태그·변경 줄·요약 칩)는 스키마 diff 패널의 정본 컴포넌트를 그대로 쓴다(중복 구현 금지).
 * 정본: `docs/spec/db-design.md` Section `db-design.seed.version-diff`.
 */

export function SeedDiffPanel({ diff }: { diff: SeedDiff }) {
  if (isEmptySeedDiff(diff)) return null

  return (
    <section data-seed-diff className="mt-5">
      <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-fg">
        <Sprout className="size-4 text-muted" />
        시드(기준 데이터)
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <SummaryChip n={diff.summary.setsAdded} label="세트 +" tone="bg-success-soft text-success" />
        <SummaryChip n={diff.summary.setsModified} label="세트 ~" tone="bg-info-soft text-info" />
        <SummaryChip n={diff.summary.setsRemoved} label="세트 −" tone="bg-danger/10 text-danger" />
        <SummaryChip n={diff.summary.rowsAdded} label="행 +" tone="bg-success-soft text-success" />
        <SummaryChip n={diff.summary.rowsModified} label="행 ~" tone="bg-info-soft text-info" />
        <SummaryChip n={diff.summary.rowsRemoved} label="행 −" tone="bg-danger/10 text-danger" />
      </div>

      <div className="flex flex-col gap-2">
        {diff.sets.map((s) => (
          <div key={s.tableName} data-seed-diff-set={s.tableName} className="overflow-hidden rounded-[10px] border border-line">
            <div className="flex items-center gap-2 bg-panel px-3 py-2">
              <StatusTag status={s.status} />
              <span className="font-mono text-[13px] font-semibold text-fg">{s.tableName}</span>
              {!s.comparable && s.status === 'modified' && (
                <span
                  className="ml-auto flex items-center gap-1 rounded bg-warning-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-warning"
                  title="짝짓기 기준이 없거나 양쪽 선언이 달라 행을 짝지을 수 없어요"
                >
                  <AlertTriangle className="size-3" />
                  행 비교 불가
                </span>
              )}
            </div>

            {s.status === 'modified' && (
              <div className="flex flex-col gap-2 px-3 py-2.5">
                {s.declarationChanges.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">선언</span>
                    {s.declarationChanges.map((c) => (
                      <ChangeLine key={c.field} c={c} />
                    ))}
                  </div>
                )}

                {s.rows.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">행</span>
                    {s.rows.map((r) => (
                      <div key={r.key} className="flex flex-col gap-0.5 rounded-md bg-panel/60 px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <StatusTag status={r.status} />
                          <span className="truncate font-mono text-[12px] text-fg">{r.label}</span>
                        </div>
                        {r.changes.map((c) => (
                          <ChangeLine key={c.field} c={c} />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
