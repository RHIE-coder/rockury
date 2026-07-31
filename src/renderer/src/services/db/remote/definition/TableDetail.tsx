import { Table2, Eye, Plus } from 'lucide-react'
import { Badge } from '@renderer/ui/badge'
import { dialectInfo, type DialectId } from '../../dialects'
import type { Constraint, ConstraintKind, TableDef } from '../../workspaces/definition/types'
import { keyBadgesOf, checkColumnIds, resolveColumns } from '../../workspaces/definition/derive'
import { FkPolicyChips } from '../../workspaces/definition/FkPolicyChips'
import { qualifiedName, refTarget, type TableRef } from '../../schemaRef'
import { outsideRefOf, outsideReason, type OutsideRef } from '../outsideRef'

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
 * Remote › Definition 상세(읽기 전용) — 활성 테이블의 컬럼 그리드 + 제약 목록.
 * 라이브 introspection TableDef 를 소비하며 편집 없음. FK 참조는 클릭 시 대상 테이블로 점프.
 */
export function TableDetail({
  table,
  dialect,
  onJump,
  outsideRefs = [],
  schemaLabel = '스키마',
  onAddSchema
}: {
  table: TableDef
  dialect: DialectId
  /** 참조 대상으로 이동 — 스키마까지 받는다(이름만 넘기면 동명 테이블로 잘못 간다). */
  onJump?: (target: TableRef) => void
  /** 이 화면의 범위 밖 참조들(§db-remote.scope R3). 없으면 밖 표시를 안 그린다. */
  outsideRefs?: OutsideRef[]
  schemaLabel?: string
  /** 범위 밖 대상을 눌렀을 때 그 스키마를 범위에 더한다. */
  onAddSchema?: (schema: string) => void
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
            {/* 앱 전역은 user-select:none 이라 이름을 끌어 고를 수 없었다(2026-07-30 피드백) —
                테이블 이름은 쿼리에 붙여 쓰는 값이라 `selectable` 로 선택·복사를 연다. */}
            {/* 스키마는 이름 앞에 흐리게 — 범위를 켜면 `card`(entity)와 `cards`(public)가
                함께 있어, 제목만으로는 어느 쪽을 보고 있는지 알 수 없다. */}
            <span className="selectable truncate font-mono">
              {table.schema && <span className="text-muted">{table.schema}.</span>}
              {table.name}
            </span>
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
                      <FkTargetLink
                        table={table}
                        con={con}
                        outside={outsideRefOf(outsideRefs, table, con.id)}
                        schemaLabel={schemaLabel}
                        onJump={onJump}
                        onAddSchema={onAddSchema}
                      />
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

/**
 * FK 참조 대상 링크 — 범위 안이면 그 테이블로 이동하고, **범위 밖이면 왜 밖인지 말한다.**
 * 밖인데도 그냥 링크로 두면 눌러도 아무 일이 없어 "고장"으로 읽힌다(§db-remote.scope R3).
 */
function FkTargetLink({
  table,
  con,
  outside,
  schemaLabel,
  onJump,
  onAddSchema
}: {
  table: TableDef
  con: Constraint
  outside?: OutsideRef
  schemaLabel: string
  onJump?: (target: TableRef) => void
  onAddSchema?: (schema: string) => void
}) {
  const target = refTarget(table, con)
  if (!target) return null
  // 스키마가 다를 때만 접두어를 보인다 — 같은 스키마면 시끄럽다.
  const label = (con.refSchema ?? table.schema) !== table.schema ? qualifiedName(target) : con.refTable
  const addable = outside?.kind === 'addable' && !!target.schema && !!onAddSchema

  if (!outside) {
    return (
      <button
        type="button"
        // e2e 가 구조 대신 이 훅으로 참조 링크를 집는다 — 지우면 스모크가 깨진다.
        // 값은 **이름만**이다(한정 이름이 아니라) — 스키마가 하나뿐인 화면에서 훅 값이 바뀌면
        // 기존 스모크가 통째로 깨진다.
        data-fk-jump={con.refTable}
        onClick={() => onJump?.(target)}
        className="rounded font-mono text-accent underline-offset-2 hover:underline"
        title={`${qualifiedName(target)} 로 이동`}
      >
        {label}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span
        data-fk-outside={qualifiedName(target)}
        className="font-mono text-muted line-through decoration-muted/40"
        title={outsideReason(outside, schemaLabel)}
      >
        {label}
      </span>
      {addable ? (
        <button
          type="button"
          onClick={() => onAddSchema!(target.schema!)}
          className="inline-flex items-center gap-0.5 rounded border border-accent/40 px-1 py-px text-[10px] font-semibold text-accent transition-colors hover:bg-accent-soft"
          title={`${schemaLabel} "${target.schema}" 을 범위에 더해요`}
        >
          <Plus className="size-2.5" /> 범위에 더하기
        </button>
      ) : (
        <span
          className="rounded border border-line px-1 py-px text-[10px] text-muted"
          title={outsideReason(outside, schemaLabel)}
        >
          범위 밖
        </span>
      )}
    </span>
  )
}
