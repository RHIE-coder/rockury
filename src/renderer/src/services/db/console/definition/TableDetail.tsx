import { Table2, Eye } from 'lucide-react'
import { Badge } from '@renderer/ui/badge'
import { dialectInfo, type DialectId } from '../../dialects'
import type { ConstraintKind, TableDef } from '../../workspaces/definition/types'
import { keyBadgesOf, checkColumnIds, resolveColumns } from '../../workspaces/definition/derive'
import { FkPolicyChips } from '../../workspaces/definition/FkPolicyChips'

// 읽기 전용 컬럼 그리드: # · Name · Type · Keys · Null · Default · Comment
const GRID =
  '32px minmax(110px,1.2fr) minmax(120px,1.2fr) 120px 60px minmax(90px,0.9fr) minmax(120px,1.4fr)'
const GRID_MIN_W = 640

const KIND_VARIANT: Record<ConstraintKind, 'pk' | 'uk' | 'fk' | 'idx' | 'check'> = {
  pk: 'pk',
  uk: 'uk',
  fk: 'fk',
  idx: 'idx',
  check: 'check'
}

/**
 * Console › Definition 상세(읽기 전용) — 활성 테이블의 컬럼 그리드 + 제약 목록.
 * 라이브 introspection TableDef 를 소비하며 편집 없음. FK 참조는 클릭 시 대상 테이블로 점프.
 */
export function TableDetail({
  table,
  dialect,
  onJump
}: {
  table: TableDef
  dialect: DialectId
  onJump?: (tableName: string) => void
}) {
  const badgeMap = keyBadgesOf(table)
  const checkCols = checkColumnIds(table)

  return (
    <div className="mx-auto max-w-[1160px] px-5 py-4">
      {/* 헤더 */}
      <div className="mb-3.5 flex items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[16px] font-bold tracking-tight text-fg">
            {table.isView ? (
              <Eye className="size-4 shrink-0 text-muted" />
            ) : (
              <Table2 className="size-4 shrink-0 text-muted" />
            )}
            <span className="truncate font-mono">{table.name}</span>
            <span
              title="연결 방언 — DDL 은 이 벤더 구문으로 표시돼요"
              className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-panel px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-muted"
            >
              <span className="size-1.5 rounded-full" style={{ background: dialectInfo(dialect).dot }} />
              {dialectInfo(dialect).label}
            </span>
            {table.isView && (
              <span className="shrink-0 rounded-full bg-panel-strong px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                VIEW
              </span>
            )}
          </div>
          {table.comment && <div className="mt-0.5 text-[12px] text-muted">{table.comment}</div>}
        </div>
        <div className="ml-auto flex items-center gap-2.5 whitespace-nowrap text-[11.5px] tabular-nums text-muted">
          <span>{table.columns.length} columns</span>
          <span>·</span>
          <span>{table.constraints.length} constraints</span>
        </div>
      </div>

      {/* 컬럼 그리드 (읽기 전용) */}
      <div className="overflow-x-auto rounded-[10px] border border-line">
        <div style={{ minWidth: GRID_MIN_W }}>
          <div
            className="grid items-center bg-panel text-[11px] font-semibold uppercase tracking-wide text-muted"
            style={{ gridTemplateColumns: GRID, minHeight: 30 }}
          >
            <div className="px-1 text-right">#</div>
            <div className="px-1">Name</div>
            <div className="px-1">Type</div>
            <div className="px-1">Keys</div>
            <div className="text-center">Null</div>
            <div className="px-1">Default</div>
            <div className="px-1">Comment</div>
          </div>

          {table.columns.map((c, i) => {
            const badges = badgeMap.get(c.id) ?? []
            return (
              <div
                key={c.id}
                className="grid items-center border-b border-line last:border-b-0 hover:bg-panel/60"
                style={{ gridTemplateColumns: GRID, minHeight: 34 }}
              >
                <div className="px-1 text-right text-[11px] tabular-nums text-muted">{i + 1}</div>
                <div className="truncate px-1 font-mono text-[12.5px] text-fg">{c.name}</div>
                <div className="truncate px-1 font-mono text-[12px] text-muted">{c.type}</div>
                <div className="flex flex-wrap gap-1 px-1">
                  {badges.map((b) => (
                    <Badge key={b.kind} variant={b.kind} className="px-1.5 py-0.5 text-[10px]">
                      {b.kind.toUpperCase()}
                      {b.pos != null && <span className="opacity-70">·{b.pos}</span>}
                    </Badge>
                  ))}
                  {checkCols.has(c.id) && (
                    <Badge variant="check" className="px-1.5 py-0.5 text-[10px]" title="CHECK 제약에 참여">
                      CHK
                    </Badge>
                  )}
                </div>
                <div className="text-center text-[11px] text-muted">{c.nullable ? 'NULL' : 'NOT NULL'}</div>
                <div className="truncate px-1 font-mono text-[12px] text-muted">
                  {c.defaultValue == null || c.defaultValue === '' ? '—' : c.defaultValue}
                </div>
                <div className="truncate px-1 text-[12px] text-muted">{c.comment || ''}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 제약 목록 (읽기 전용) */}
      {table.constraints.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Constraints
          </div>
          <div className="flex flex-col gap-1.5">
            {table.constraints.map((con) => {
              const cols = resolveColumns(table, con).map((r) => r.name)
              return (
                <div
                  key={con.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-canvas px-3 py-1.5 text-[12px]"
                >
                  <Badge variant={KIND_VARIANT[con.kind]} className="px-1.5 py-0.5 text-[10px]">
                    {con.kind.toUpperCase()}
                  </Badge>
                  <span className="font-mono text-fg">{con.name}</span>
                  {cols.length > 0 && (
                    <span className="font-mono text-muted">({cols.join(', ')})</span>
                  )}
                  {con.kind === 'fk' && con.refTable && (
                    <span className="flex flex-wrap items-center gap-1.5 text-muted">
                      <span className="text-accent-2">→</span>
                      <button
                        type="button"
                        // e2e 가 구조 대신 이 훅으로 참조 링크를 집는다 — 지우면 스모크가 깨진다.
                        data-fk-jump={con.refTable}
                        onClick={() => onJump?.(con.refTable!)}
                        className="rounded font-mono text-accent underline-offset-2 hover:underline"
                        title={`${con.refTable} 로 이동`}
                      >
                        {con.refTable}
                      </button>
                      <span className="font-mono">({(con.refColumns ?? []).join(', ')})</span>
                      <FkPolicyChips con={con} />
                    </span>
                  )}
                  {con.kind === 'check' && con.expression && (
                    <span className="font-mono text-muted">{con.expression}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
