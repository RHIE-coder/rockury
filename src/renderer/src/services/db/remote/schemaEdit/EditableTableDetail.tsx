import { ArrowDown, ArrowUp, MoreHorizontal, Plus, Trash2, Table2, Eye } from 'lucide-react'
import { Badge } from '@renderer/ui/badge'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { Checkbox } from '@renderer/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/ui/dropdown-menu'
import { dialectInfo, type DialectId } from '../../dialects'
import { DialectMark } from '../../DialectMark'
import type { ConstraintKind, FkAction, TableDef } from '../../workspaces/definition/types'
import { keyBadgesOf, resolveColumns } from '../../workspaces/definition/derive'
import { IMPLIED_FK_ACTION, type FkPolicyKind } from '../../workspaces/definition/fkPolicy'
import { useSchemaEditStore } from './store'

const GRID =
  '28px minmax(120px,1.2fr) minmax(120px,1.2fr) 104px 44px minmax(90px,0.9fr) minmax(110px,1.3fr) 32px'
const GRID_MIN_W = 700
const FK_ACTIONS: FkAction[] = ['RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'NO ACTION']
const KIND_VARIANT: Record<ConstraintKind, 'pk' | 'uk' | 'fk' | 'idx' | 'check'> = {
  pk: 'pk',
  uk: 'uk',
  fk: 'fk',
  idx: 'idx',
  check: 'check'
}

/**
 * FK 정책 선택 — 어느 정책인지 라벨을 앞에 붙인다(`DEL:`/`UPD:` 축약은 Definition 표기와 어긋나 폐기).
 * 값이 없으면 DB 가 실제로 적용하는 NO ACTION 을 골라 둔 것으로 보인다.
 */
function FkActionSelect({
  kind,
  value,
  onChange
}: {
  kind: FkPolicyKind
  value?: FkAction
  onChange: (v: FkAction) => void
}) {
  return (
    <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
      {kind}
      <select
        value={value ?? IMPLIED_FK_ACTION}
        onChange={(e) => onChange(e.target.value as FkAction)}
        className="h-7 rounded-md border border-line bg-canvas px-1.5 font-mono text-[11px] normal-case text-fg outline-none focus:border-accent"
      >
        {FK_ACTIONS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </label>
  )
}

/** 편집 가능한 컬럼 행 ⋯ 메뉴 — 이동·키 토글·삭제. */
function ColumnMenu({
  colId,
  index,
  count,
  hasKind
}: {
  colId: string
  index: number
  count: number
  hasKind: (k: 'pk' | 'uk' | 'idx') => boolean
}) {
  const s = useSchemaEditStore()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-6" aria-label="컬럼 메뉴">
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem disabled={index === 0} onSelect={() => s.moveColumn(colId, -1)}>
          <ArrowUp />위로
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === count - 1} onSelect={() => s.moveColumn(colId, 1)}>
          <ArrowDown />아래로
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>키 (제약으로 반영)</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={hasKind('pk')} onCheckedChange={() => s.togglePk(colId)} onSelect={(e) => e.preventDefault()}>
          Primary Key
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={hasKind('uk')} onCheckedChange={() => s.toggleUnique(colId)} onSelect={(e) => e.preventDefault()}>
          Unique
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={hasKind('idx')} onCheckedChange={() => s.toggleIndex(colId)} onSelect={(e) => e.preventDefault()}>
          Index
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => s.deleteColumn(colId)}>
          <Trash2 />삭제
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Remote › Definition 편집 상세 — draft 활성 테이블을 인라인 편집한다.
 * 값 변경은 즉시 draft(useSchemaEditStore)에 반영되고, 라이브 DB 적용은 PreviewBar 가 담당.
 */
export function EditableTableDetail({ table, dialect, allTables }: { table: TableDef; dialect: DialectId; allTables: TableDef[] }) {
  const s = useSchemaEditStore()
  const badgeMap = keyBadgesOf(table)

  const colKinds = (colId: string) => new Set((badgeMap.get(colId) ?? []).map((b) => b.kind))

  return (
    <div className="mx-auto max-w-[1160px] px-5 py-4">
      {/* 헤더 (편집) */}
      <div className="mb-3.5 flex items-center gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {table.isView ? <Eye className="size-4 shrink-0 text-muted" /> : <Table2 className="size-4 shrink-0 text-muted" />}
          <Input
            value={table.name}
            onChange={(e) => s.updateTable({ name: e.target.value })}
            placeholder="테이블명"
            className="h-8 w-56 font-mono text-[14px] font-semibold"
          />
          <span
            title="연결 방언 — DDL 은 이 벤더 구문"
            className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-panel px-1.5 py-0.5 text-[10px] font-semibold text-muted"
          >
            <DialectMark dialect={dialect} />
            {dialectInfo(dialect).label}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" onClick={s.addColumn}>
            <Plus />컬럼 추가
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="테이블 메뉴">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>제약 추가</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => s.addConstraint('fk')}>Foreign Key</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => s.addConstraint('uk')}>Unique</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => s.addConstraint('idx')}>Index</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => s.addConstraint('check')}>Check</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => s.deleteTable(table.id)}>
                <Trash2 />테이블 삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Input
        value={table.comment}
        onChange={(e) => s.updateTable({ comment: e.target.value })}
        placeholder="테이블 설명"
        className="mb-3 h-7 w-full max-w-md text-[12px]"
      />

      {/* 컬럼 그리드 (편집) */}
      <div className="overflow-x-auto rounded-[10px] border border-line">
        <div style={{ minWidth: GRID_MIN_W }}>
          <div className="grid items-center bg-panel text-[11px] font-semibold uppercase tracking-wide text-muted" style={{ gridTemplateColumns: GRID, minHeight: 30 }}>
            <div className="px-1 text-right">#</div>
            <div className="px-1">Name</div>
            <div className="px-1">Type</div>
            <div className="px-1">Keys</div>
            <div className="text-center">Null</div>
            <div className="px-1">Default</div>
            <div className="px-1">Comment</div>
            <div />
          </div>

          {table.columns.map((c, i) => (
            <div key={c.id} className="group grid items-center border-b border-line last:border-b-0 hover:bg-panel/60" style={{ gridTemplateColumns: GRID, minHeight: 36 }}>
              <div className="px-1 text-right text-[11px] tabular-nums text-muted">{i + 1}</div>
              <div className="px-1">
                <Input value={c.name} onChange={(e) => s.updateColumn(c.id, { name: e.target.value })} placeholder="컬럼명" className="h-7 font-mono text-[12px]" />
              </div>
              <div className="px-1">
                <Input value={c.type} onChange={(e) => s.updateColumn(c.id, { type: e.target.value })} placeholder="타입" className="h-7 font-mono text-[12px]" />
              </div>
              <div className="flex flex-wrap gap-1 px-1">
                {(badgeMap.get(c.id) ?? []).map((b) => (
                  <Badge key={b.kind} variant={b.kind} className="px-1.5 py-0.5 text-[10px]">
                    {b.kind.toUpperCase()}
                    {b.pos != null && <span className="opacity-70">·{b.pos}</span>}
                  </Badge>
                ))}
              </div>
              <div className="flex justify-center">
                <Checkbox checked={c.nullable} onCheckedChange={() => s.toggleNullable(c.id)} aria-label="nullable" />
              </div>
              <div className="px-1">
                <Input
                  value={c.defaultValue ?? ''}
                  onChange={(e) => s.updateColumn(c.id, { defaultValue: e.target.value.trim() === '' ? null : e.target.value })}
                  placeholder="—"
                  className="h-7 font-mono text-[12px]"
                />
              </div>
              <div className="px-1">
                <Input value={c.comment} onChange={(e) => s.updateColumn(c.id, { comment: e.target.value })} placeholder="설명" className="h-7 text-[12px]" />
              </div>
              <div className="flex justify-center text-transparent group-hover:text-muted">
                <ColumnMenu colId={c.id} index={i} count={table.columns.length} hasKind={(k) => colKinds(c.id).has(k)} />
              </div>
            </div>
          ))}
          <div className="border-t border-dashed border-line px-3 py-2">
            <Button variant="soft" size="sm" onClick={s.addColumn}>
              <Plus />컬럼 추가
            </Button>
          </div>
        </div>
      </div>

      {/* 제약 편집 */}
      {table.constraints.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Constraints</div>
          <div className="flex flex-col gap-1.5">
            {table.constraints.map((con) => {
              const cols = resolveColumns(table, con).map((r) => r.name)
              return (
                <div key={con.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-canvas px-3 py-1.5 text-[12px]">
                  <Badge variant={KIND_VARIANT[con.kind]} className="px-1.5 py-0.5 text-[10px]">
                    {con.kind.toUpperCase()}
                  </Badge>
                  <Input
                    value={con.name}
                    onChange={(e) => s.updateConstraint(con.id, { name: e.target.value })}
                    className="h-7 w-48 font-mono text-[12px]"
                    placeholder="제약명"
                  />
                  {cols.length > 0 && <span className="font-mono text-muted">({cols.join(', ')})</span>}
                  {con.kind === 'fk' && (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-accent-2">→</span>
                      <select
                        value={con.refTable ?? ''}
                        onChange={(e) => s.updateConstraint(con.id, { refTable: e.target.value })}
                        className="h-7 rounded-md border border-line bg-canvas px-1.5 font-mono text-[12px] text-fg outline-none focus:border-accent"
                      >
                        <option value="">참조 테이블…</option>
                        {allTables.map((t) => (
                          <option key={t.id} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={(con.refColumns ?? []).join(', ')}
                        onChange={(e) =>
                          s.updateConstraint(con.id, {
                            refColumns: e.target.value.split(',').map((x) => x.trim()).filter(Boolean)
                          })
                        }
                        placeholder="참조 컬럼(쉼표)"
                        className="h-7 w-40 font-mono text-[12px]"
                      />
                      {/* 정책은 ON DELETE·ON UPDATE 둘 다 편집한다 — 한쪽만 두면 나머지가 DB 기본값으로
                          조용히 남아 Definition 표기(FkPolicyChips)와 어긋난다. */}
                      <FkActionSelect
                        kind="ON DELETE"
                        value={con.onDelete}
                        onChange={(v) => s.updateConstraint(con.id, { onDelete: v })}
                      />
                      <FkActionSelect
                        kind="ON UPDATE"
                        value={con.onUpdate}
                        onChange={(v) => s.updateConstraint(con.id, { onUpdate: v })}
                      />
                    </span>
                  )}
                  {con.kind === 'check' && (
                    <Input
                      value={con.expression ?? ''}
                      onChange={(e) => s.updateConstraint(con.id, { expression: e.target.value })}
                      placeholder="CHECK 식"
                      className="h-7 w-64 font-mono text-[12px]"
                    />
                  )}
                  <Button variant="ghost" size="icon" className="ml-auto size-6" aria-label="제약 삭제" onClick={() => s.deleteConstraint(con.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
