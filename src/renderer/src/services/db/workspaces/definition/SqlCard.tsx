import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Copy, Download } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import type { DialectId } from '../../dialects'
import { downloadText } from '../../download'
import { hasMultipleSchemas } from '../../schemaRef'
import { generateDdl } from './ddl'
import { generateSchemaScript } from './schemaScript'
import { sqlFileName, type SqlScope } from './sqlFile'
import { HighlightedSqlLine } from './HighlightedSql'
import type { TableDef } from './types'

/** 범위 토글 — 상단 [Table|SQL] 토글과 같은 모양의 작은 판. */
function ScopeToggle({
  scope,
  onChange,
  count
}: {
  scope: SqlScope
  onChange: (s: SqlScope) => void
  count: number
}) {
  const items: { id: SqlScope; label: string }[] = [
    { id: 'table', label: '이 테이블' },
    { id: 'schema', label: `전체 ${count}` }
  ]
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-line bg-canvas p-0.5">
      {items.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          data-sql-scope={id}
          onClick={() => onChange(id)}
          aria-pressed={scope === id}
          className={cn(
            'rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-colors',
            scope === id ? 'bg-accent text-white' : 'text-muted hover:bg-panel-strong hover:text-fg'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * SQL(DDL) 카드 — 설계부(Design › Definition)와 운영부(Remote › Definition)가 **같은 것을 쓴다**.
 * 한쪽에서 DDL 이 다르게 보이면 같은 것을 두 번 만든 셈이다.
 * 하는 일: 범위(이 테이블/전체 스키마) · 구문 강조 · 복사 · `.sql` 저장.
 * 방언은 선택지가 아니라 설계·연결의 고정 속성이라 부르는 쪽이 정해 넘긴다.
 */
export function SqlCard({
  table,
  dialect,
  allTables,
  schemaName,
  labeled = true,
  badge
}: {
  table: TableDef
  dialect: DialectId
  /** 있으면 범위 토글이 생긴다 — 없으면 이 테이블 하나만 다루는 자리(상세 서랍·크게 보기). */
  allTables?: TableDef[]
  /** 전체 범위일 때의 파일 이름 — 설계 이름/연결 이름. */
  schemaName?: string
  /** 이름·상태가 바로 위에서 이미 보이는 자리면 false — 머리를 되풀이하지 않고 단추만 남긴다. */
  labeled?: boolean
  badge?: ReactNode
}) {
  const [scope, setScope] = useState<SqlScope>('table')
  const [copied, setCopied] = useState(false)

  // 목록에서 다른 테이블을 고르면 = "이것을 보자" — 전체 스크립트를 보던 중이었어도 그 테이블로 돌아온다
  // (안 그러면 눌러도 화면이 그대로라 "안 먹었다"로 읽힌다).
  useEffect(() => setScope('table'), [table.id])

  const scopable = !!allTables && allTables.length > 0
  const whole = scopable && scope === 'schema'
  // 스키마 전체는 수십 테이블 × 수십 줄이다 — 복사 표시 같은 재렌더마다 다시 만들지 않는다.
  // 스키마가 둘 이상인 목록에서만 한정 이름을 쓴다 — 한 테이블만 볼 때도 전체 스크립트와
  // 같은 모양이어야 복사해 붙여도 맞는다.
  const qualify = hasMultipleSchemas(allTables ?? [table])
  const sql = useMemo(
    () => (whole ? generateSchemaScript(allTables!, dialect) : generateDdl(table, dialect, { qualify })),
    [whole, allTables, table, dialect, qualify]
  )
  const lines = useMemo(() => sql.split('\n'), [sql])
  const fileName = sqlFileName(whole ? 'schema' : 'table', table.name, schemaName)

  const copy = (): void => {
    void navigator.clipboard?.writeText(sql).then(
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
          {labeled && (
            <>
              <span className="font-mono text-[12px] text-fg">{fileName}</span>
              {badge}
            </>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {scopable && <ScopeToggle scope={scope} onChange={setScope} count={allTables!.length} />}
            <Button variant="secondary" size="sm" onClick={copy}>
              <Copy />
              {copied ? '복사됨 ✓' : 'Copy'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadText(fileName, sql, 'application/sql')}
            >
              <Download />
              저장
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
          <pre className="flex-1 overflow-x-auto px-4 py-3.5 font-mono text-[12px] leading-[1.75] text-fg">
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
