import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/ui/dialog'
import { rowToJson, viewCell } from './rowDetail'

/**
 * 결과 행 상세 — Query·Collection 의 결과 표에서 행을 누르면 뜬다.
 * 표에서는 칸이 잘려(`truncate`) 긴 값을 못 읽는다. 여기서는 **자르지 않고** 세로로 펴 보이고,
 * JSON 은 들여써서 보인다. 정본: `docs/spec/db-remote.md` §db-remote.result-grid.row-detail.
 */
export function RowDetailDialog({
  columns,
  rows,
  index,
  onIndexChange,
  onClose
}: {
  columns: string[]
  rows: Record<string, unknown>[]
  /** 지금 보고 있는 행(0-기준). */
  index: number
  onIndexChange: (next: number) => void
  onClose: () => void
}) {
  const row = rows[index]
  const [copied, setCopied] = useState(false)

  // 행을 넘기면 "복사됨" 표시를 지운다 — 다른 행을 보며 이전 행의 표시가 남아 있으면 거짓말이다.
  useEffect(() => setCopied(false), [index])

  // ← → 로 행을 넘긴다. 값이 많은 행을 훑을 때 매번 닫았다 여는 것은 상세보기가 아니다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      if (e.key === 'ArrowRight' && index < rows.length - 1) onIndexChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, rows.length, onIndexChange])

  if (!row) return null

  const copyRow = (): void => {
    try {
      void navigator.clipboard?.writeText(rowToJson(columns, row))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 무시 — 권한·환경 제약
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" data-row-detail>
        <DialogHeader>
          <DialogTitle>
            {index + 1}행<span className="ml-2 text-[12px] font-normal text-muted">/ {rows.length}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            data-row-detail-prev
            disabled={index === 0}
            onClick={() => onIndexChange(index - 1)}
          >
            <ChevronLeft /> 이전
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-row-detail-next
            disabled={index >= rows.length - 1}
            onClick={() => onIndexChange(index + 1)}
          >
            다음 <ChevronRight />
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={copyRow}>
            <Copy /> {copied ? '복사됨 ✓' : '행 복사(JSON)'}
          </Button>
        </div>

        <div className="mt-1 max-h-[60vh] overflow-auto rounded-md border border-line">
          <table className="w-full border-collapse text-[12px]">
            <tbody>
              {columns.map((c) => {
                const v = viewCell(row[c])
                return (
                  <tr key={c} className="border-b border-line/60 last:border-b-0 align-top">
                    <th
                      scope="row"
                      className="w-40 shrink-0 border-r border-line/60 bg-panel/50 px-3 py-2 text-left align-top font-mono text-[11.5px] font-semibold text-fg"
                    >
                      {c}
                    </th>
                    <td className="px-3 py-2" data-row-detail-cell={c}>
                      {v.kind === 'null' ? (
                        <span className="font-mono text-[11.5px] italic text-muted">NULL</span>
                      ) : v.kind === 'json' ? (
                        // 긴 JSON 은 세로로만 늘린다 — 가로로 넘치면 표 밖으로 밀려난다.
                        <pre className="selectable max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-panel/60 p-2 font-mono text-[11.5px] text-fg">
                          {v.text}
                        </pre>
                      ) : (
                        <span className="selectable whitespace-pre-wrap break-all font-mono text-[11.5px] text-fg">
                          {v.text}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
