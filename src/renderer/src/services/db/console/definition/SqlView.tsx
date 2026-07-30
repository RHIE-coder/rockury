import { useState } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { generateDdl } from '../../workspaces/definition/ddl'
import { HighlightedSqlLine } from '../../workspaces/definition/HighlightedSql'
import type { TableDef } from '../../workspaces/definition/types'

/**
 * SQL(DDL) 읽기 전용 뷰 — 연결 방언으로 생성한 CREATE 문 + 구문 강조 + 복사.
 * 정본: §db-console.definition.sql. Console › Definition 과 **Diagram 상세보기 서랍**이 같은 것을 쓴다
 * (서랍에서 DDL 이 다르게 보이면 같은 것을 두 번 만든 셈이다).
 */
export function SqlView({
  table,
  dialect,
  labeled = true
}: {
  table: TableDef
  dialect: Parameters<typeof generateDdl>[1]
  /** 이름·출처가 바로 위에서 이미 보이는 자리(상세 서랍)면 false — 머리를 되풀이하지 않고 Copy 만 남긴다. */
  labeled?: boolean
}) {
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
          {labeled && (
            <>
              <span className="font-mono text-[12px] text-fg">{table.name}.sql</span>
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="size-1.5 rounded-full bg-muted/60" />
                실 DB 역설계 · 읽기 전용
              </span>
            </>
          )}
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
