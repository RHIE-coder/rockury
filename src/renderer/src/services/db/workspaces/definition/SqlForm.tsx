import { AlignLeft, Copy } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { useActiveDesign } from '../../designs/store'
import { useActiveTable } from './store'
import { generateDdl } from './ddl'
import { HighlightedSqlLine } from './HighlightedSql'

/**
 * @param labeled 이름·상태가 바로 위에서 이미 보이는 자리(상세 서랍·크게 보기 모달)면 false —
 *   머리를 되풀이하지 않고 Format·Copy 만 남긴다. Console 쪽 `SqlView` 와 같은 규칙.
 */
export function SqlForm({ labeled = true }: { labeled?: boolean }) {
  const table = useActiveTable()
  const design = useActiveDesign()

  // 부모(DefinitionWorkspace)가 설계 선택·테이블 존재를 보장하지만 방어적으로 가드.
  if (!table || !design) return null

  // DDL 은 설계의 방언 그대로 — 방언은 선택지가 아니라 설계의 고정 속성.
  const lines = generateDdl(table, design.dialect).split('\n')

  return (
    <div className="mx-auto max-w-[1160px] p-5">
      <div className="overflow-hidden rounded-[10px] border border-line">
        <div className="flex h-9 items-center gap-2.5 border-b border-line bg-panel px-3">
          {labeled && (
            <>
              <span className="font-mono text-[12px] text-fg">{table.name}.sql</span>
              <span className="flex items-center gap-1.5 text-[11px] text-success">
                <span className="size-1.5 rounded-full bg-success" />
                Table 폼과 동기화됨
              </span>
            </>
          )}
          <div className="ml-auto flex gap-1.5">
            <Button variant="secondary" size="sm">
              <AlignLeft />
              Format
            </Button>
            <Button variant="secondary" size="sm">
              <Copy />
              Copy
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
