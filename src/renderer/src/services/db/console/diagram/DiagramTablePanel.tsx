import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { TableListPanel } from '../../TableListPanel'
import type { TableDef } from '../../workspaces/definition/types'

/** 클릭한 테이블이 화면 한가운데 오도록 하되, 너무 확대되지 않게 상한을 둔다. */
const FOCUS = { duration: 400, padding: 0.55, maxZoom: 1.1 }

/**
 * Diagram 좌측 테이블 목록 패널 — Console › Data 사이드바와 같은 구성(테이블/뷰 분리).
 * 항목을 누르면 그 노드를 선택하고 캔버스를 그 노드로 옮긴다(포커싱).
 * `useReactFlow` 를 쓰므로 반드시 `ReactFlowProvider` **안쪽**에 놓아야 한다.
 */
export function DiagramTablePanel({
  tables,
  selectedId,
  onSelect
}: {
  tables: TableDef[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const rf = useReactFlow()

  const focus = useCallback(
    (t: TableDef) => {
      onSelect(t.id)
      // 필터로 캔버스에서 빠진 테이블이면 이동할 노드가 없다 — 선택만 하고 조용히 넘어간다.
      if (!rf.getNode(t.id)) return
      void rf.fitView({ nodes: [{ id: t.id }], ...FOCUS })
    },
    [rf, onSelect]
  )

  return (
    <aside
      data-diagram-table-panel
      className="flex w-56 shrink-0 flex-col border-r border-line bg-canvas"
    >
      <div className="shrink-0 px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        테이블 목록
      </div>
      <TableListPanel
        tables={tables}
        activeId={selectedId}
        onPick={focus}
        emptyText="테이블이 없어요"
        footer={
          <p className="shrink-0 border-t border-line px-3 py-2 text-[10.5px] leading-relaxed text-muted">
            항목을 누르면 해당 테이블로 이동해요.
          </p>
        }
      />
    </aside>
  )
}
