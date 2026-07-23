import { useEffect, useMemo, useState } from 'react'
import { Code2, Copy, Eye, Loader2, RefreshCw, Search, Table2, TableProperties } from 'lucide-react'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { dialectInfo } from '../dialects'
import { generateDdl } from '../workspaces/definition/ddl'
import { HighlightedSqlLine } from '../workspaces/definition/HighlightedSql'
import type { TableDef } from '../workspaces/definition/types'
import { useActiveConnection } from '../connections/store'
import { useConsoleStore } from './store'
import { filterTables, resolveActiveTable } from './definition/select'
import { TableDetail } from './definition/TableDetail'

/** 좌측 서브사이드바 — 라이브 테이블 목록 + 검색. 클릭 시 active 테이블 전환(읽기 전용). */
function TablesSidebar({
  tables,
  activeId,
  onSelect
}: {
  tables: TableDef[]
  activeId: string | null
  onSelect: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => filterTables(tables, q), [tables, q])

  return (
    <div className="flex h-full flex-col">
      <div className="relative px-2.5 pb-1.5 pt-2.5">
        <Search size={13} className="absolute left-[18px] top-1/2 -translate-y-[3px] text-muted" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="테이블/컬럼 검색…"
          className="h-7 pl-7 text-[12px]"
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
        {shown.length === 0 && (
          <li className="px-2 py-4 text-center text-[11.5px] italic text-muted">
            {tables.length === 0 ? '테이블이 없어요' : '검색 결과가 없어요'}
          </li>
        )}
        {shown.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
                t.id === activeId ? 'bg-accent-soft font-semibold text-accent' : 'text-fg hover:bg-panel-strong'
              )}
            >
              {t.isView ? (
                <Eye className="size-3.5 shrink-0 opacity-70" />
              ) : (
                <Table2 className="size-3.5 shrink-0 opacity-70" />
              )}
              <span className="truncate">{t.name}</span>
              <span
                className={cn(
                  'ml-auto text-[10.5px] tabular-nums',
                  t.id === activeId ? 'text-accent/70' : 'text-muted'
                )}
              >
                {t.columns.length}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** [Table|SQL] 표현 토글. */
function FormToggle({ form, onChange }: { form: 'table' | 'sql'; onChange: (f: 'table' | 'sql') => void }) {
  const items: { id: 'table' | 'sql'; label: string; icon: typeof TableProperties }[] = [
    { id: 'table', label: 'Table', icon: TableProperties },
    { id: 'sql', label: 'SQL', icon: Code2 }
  ]
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-line bg-canvas p-0.5">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={form === id}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
            form === id ? 'bg-accent text-white' : 'text-muted hover:bg-panel-strong hover:text-fg'
          )}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  )
}

/** SQL(DDL) 읽기 전용 뷰 — 연결 방언으로 생성한 CREATE 문 + 구문 강조 + 복사. */
function SqlView({ table, dialect }: { table: TableDef; dialect: Parameters<typeof generateDdl>[1] }) {
  const [copied, setCopied] = useState(false)
  const ddl = generateDdl(table, dialect)
  const lines = ddl.split('\n')

  const copy = (): void => {
    void navigator.clipboard?.writeText(ddl).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {}
    )
  }

  return (
    <div className="mx-auto max-w-[1160px] p-5">
      <div className="overflow-hidden rounded-[10px] border border-line">
        <div className="flex h-9 items-center gap-2.5 border-b border-line bg-panel px-3">
          <span className="font-mono text-[12px] text-fg">{table.name}.sql</span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="size-1.5 rounded-full bg-muted/60" />
            실 DB 역설계 · 읽기 전용
          </span>
          <div className="ml-auto flex gap-1.5">
            <Button variant="secondary" size="sm" onClick={copy}>
              <Copy />
              {copied ? '복사됨 ✓' : 'Copy'}
            </Button>
          </div>
        </div>

        <div className="flex bg-canvas">
          <div className="shrink-0 select-none border-r border-line bg-panel py-3.5 text-right font-mono text-[12px] leading-[1.75] tabular-nums text-muted/70">
            {lines.map((_, i) => (
              <div key={i} className="pl-3.5 pr-2.5">
                {i + 1}
              </div>
            ))}
          </div>
          <pre className="selectable flex-1 overflow-x-auto px-4 py-3.5 font-mono text-[12px] leading-[1.75] text-fg">
            {lines.map((l, i) => (
              <div key={i}>
                <HighlightedSqlLine line={l} />
              </div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  )
}

/**
 * Console › Definition(운영부 · depth 3) — 실 DB 를 역설계(introspection)한 스키마 정의를
 * Studio Definition 과 같은 상세 화면(테이블 목록 | 컬럼·제약 그리드 / SQL·DDL)으로 브라우징.
 * Diagram/Object 와 같은 `TableDef[]`(useConsoleStore)를 공유하며 **읽기 전용**(스키마 변경은 Migration 담당).
 */
export function DefinitionView() {
  const conn = useActiveConnection()
  const connId = conn?.id ?? null

  const tables = useConsoleStore((s) => (connId ? s.byEnv[connId] : undefined))
  const loading = useConsoleStore((s) => (connId ? s.loading[connId] : false))
  const error = useConsoleStore((s) => (connId ? s.error[connId] : null))
  const load = useConsoleStore((s) => s.load)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [form, setForm] = useState<'table' | 'sql'>('table')

  useEffect(() => {
    if (connId) void load(connId, connId)
  }, [connId, load])

  if (!conn) {
    return (
      <PlaceholderView
        icon={TableProperties}
        depth="depth 3 · Console › Definition"
        title="연결을 선택하세요"
        subtitle="상단 컨텍스트 바의 Connection 셀렉터에서 대상을 고르면 실 DB 를 역설계해 스키마 정의(컬럼·제약·DDL)를 보여줍니다."
      />
    )
  }

  const list = tables ?? []
  const active = resolveActiveTable(list, activeId)

  const jumpTo = (name: string): void => {
    const target = list.find((t) => t.name === name)
    if (target) {
      setActiveId(target.id)
      setForm('table')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">
            Definition <span className="font-normal text-muted">· {conn.name}</span>
          </h2>
          <p className="text-[12px] text-muted">
            {loading
              ? '실 DB 역설계 중…'
              : tables
                ? `${tables.length}개 테이블 · Reverse(introspection) · 읽기 전용`
                : '역설계 대기'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FormToggle form={form} onChange={setForm} />
          <span
            title="연결 방언"
            className="flex items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-medium text-fg"
          >
            <span className="size-2 rounded-full" style={{ background: dialectInfo(conn.dbType).dot }} />
            {dialectInfo(conn.dbType).label}
          </span>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(conn.id, conn.id, true)}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} 새로고침
          </Button>
        </div>
      </div>

      {error ? (
        <div className="m-5 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          역설계 실패: {error}
        </div>
      ) : loading && !tables ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          <Loader2 className="mr-2 size-4 animate-spin" /> 실 DB 스키마를 읽는 중…
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">테이블이 없습니다</div>
      ) : (
        <div className="min-h-0 flex-1">
          <WorkspacePanels autoSaveId="db.console.definition" sidebarTitle="TABLES" sidebar={
            <TablesSidebar tables={list} activeId={active?.id ?? null} onSelect={setActiveId} />
          }>
            <div className="h-full overflow-auto">
              {active ? (
                form === 'table' ? (
                  <TableDetail table={active} dialect={conn.dbType} onJump={jumpTo} />
                ) : (
                  <SqlView table={active} dialect={conn.dbType} />
                )
              ) : (
                <div className="flex h-full items-center justify-center text-[13px] text-muted">
                  테이블을 선택하세요
                </div>
              )}
            </div>
          </WorkspacePanels>
        </div>
      )}
    </div>
  )
}
