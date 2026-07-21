import { ArrowUpRight } from 'lucide-react'
import { Badge } from '@renderer/ui/badge'
import { Button } from '@renderer/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@renderer/ui/hover-card'
import { cn } from '@renderer/lib/utils'
import { useActiveDesign } from '../../designs/store'
import { useActiveTable, useDefinitionStore, useDesignTables } from './store'
import { keyBadgesOf } from './derive'
import type { Constraint } from './types'

/**
 * 그리드 Keys 칸의 FK 배지 — ↗ 아이콘으로 참조를 암시하고,
 * 호버 시 참조 테이블 정보 카드, 카드의 ↗ 버튼으로 해당 테이블로 점프(returnTo 오버레이 발동).
 * FK 참조는 같은 설계 안에서만 해석된다(설계 간 참조 없음).
 */
export function FkBadge({ colId, pos }: { colId: string; pos?: number }) {
  const design = useActiveDesign()
  const table = useActiveTable()
  const tables = useDesignTables()
  const jump = useDefinitionStore((s) => s.jumpToTable)

  if (!table) return null

  const con = table.constraints.find(
    (k) => k.kind === 'fk' && k.columns.some((r) => r.columnId === colId)
  )
  const target = con ? tables.find((t) => t.name === con.refTable) : undefined
  const colName = table.columns.find((c) => c.id === colId)?.name ?? ''
  const idx = con ? con.columns.findIndex((r) => r.columnId === colId) : -1
  const refCol = (con?.refColumns ?? [])[idx] || '?'

  const badge = (
    <Badge
      variant="fk"
      className="cursor-pointer px-1.5 py-0.5 text-[10px] transition-colors hover:brightness-95"
      title={target ? undefined : con ? `→ ${con.refTable || '?'}` : undefined}
    >
      FK
      {pos != null && <span className="opacity-70">·{pos}</span>}
      <ArrowUpRight />
    </Badge>
  )

  if (!con || !target) return badge

  return (
    <HoverCard openDelay={150} closeDelay={120}>
      <HoverCardTrigger asChild>{badge}</HoverCardTrigger>
      <HoverCardContent className="w-72 p-0">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="truncate font-mono text-[12px] font-semibold text-fg">
            {design?.name} / {target.name}
          </span>
          <Button
            variant="soft"
            size="icon"
            className="ml-auto size-6 shrink-0"
            aria-label={`${target.name} 테이블로 이동`}
            onClick={() => jump(target.id)}
          >
            <ArrowUpRight className="size-3.5" />
          </Button>
        </div>
        <div className="flex flex-col gap-1 px-3 py-2">
          {target.comment && <div className="text-[11.5px] text-muted">{target.comment}</div>}
          <div className="text-[11px] tabular-nums text-muted">
            {target.columns.length} columns · {target.constraints.length} constraints
          </div>
          <div className="flex items-center gap-1 font-mono text-[11px] text-fg">
            <span className="font-sans text-muted">참조</span>
            {colName}
            <span className="text-accent-2">→</span>
            <span className="text-accent">
              {target.name}.{refCol}
            </span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * FK 제약 에디터의 참조 테이블 정보 카드 — 전체 이름(design/table) + 컬럼 미리보기.
 * 참조 중인 컬럼은 하이라이트. 참조 대상은 같은 설계 스코프에서만 찾는다.
 */
export function RefTableCard({ con }: { con: Constraint }) {
  const design = useActiveDesign()
  const tables = useDesignTables()
  const jump = useDefinitionStore((s) => s.jumpToTable)
  const target = tables.find((t) => t.name === con.refTable)
  if (!target) return null

  const badges = keyBadgesOf(target)
  const refNames = con.refColumns ?? []

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line bg-canvas">
      <div className="flex items-center gap-2 border-b border-line bg-panel-strong/40 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">참조 테이블</span>
        <span className="truncate font-mono text-[12px] font-semibold text-fg">
          {design?.name} / {target.name}
        </span>
        {target.comment && <span className="truncate text-[11.5px] text-muted">— {target.comment}</span>}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-[11px]"
          onClick={() => jump(target.id)}
        >
          <ArrowUpRight className="size-3.5" />
          이동
        </Button>
      </div>
      <div className="max-h-44 overflow-auto">
        {target.columns.map((c) => {
          const isRef = refNames.includes(c.name)
          return (
            <div
              key={c.id}
              className={cn(
                'grid items-center gap-2 border-b border-line/60 px-3 text-[11.5px] last:border-b-0',
                isRef && 'bg-accent-soft/50'
              )}
              style={{ gridTemplateColumns: 'minmax(110px,1fr) minmax(130px,1.3fr) auto', minHeight: 26 }}
            >
              <span className={cn('truncate font-mono', isRef ? 'font-semibold text-accent' : 'text-fg')}>
                {c.name}
              </span>
              <span className="truncate font-mono text-muted" title={c.type}>
                {c.type}
              </span>
              <span className="flex gap-1">
                {(badges.get(c.id) ?? []).map((b) => (
                  <Badge key={b.kind} variant={b.kind} className="px-1 py-0 text-[9px]">
                    {b.kind.toUpperCase()}
                  </Badge>
                ))}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
