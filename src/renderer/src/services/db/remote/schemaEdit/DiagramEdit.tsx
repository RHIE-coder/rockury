import { useCallback } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { Connection } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Plus } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import type { ConnectionDef } from '../../connections/store'
import { DiagramSurface } from '../diagram/DiagramSurface'
import { useDiagramLayout } from '../diagram/useDiagramLayout'
import { SqlView } from '../definition/SqlView'
import { buildFkPatch } from '../../workspaces/diagram/fk'
import { useSchemaEditStore } from './store'
import { EditableTableDetail } from './EditableTableDetail'
import { PreviewBar } from './PreviewBar'

/**
 * Remote › Diagram 편집 모드 — draft(useSchemaEditStore)를 편집 가능한 ERD 로 그린다.
 * 노드 클릭 → 아래 상세보기 서랍(=Definition 편집 화면 그대로), 컬럼 핸들 드래그 → FK 생성,
 * 툴바 `테이블` → 테이블 추가. 하단 미리보기 바로 적용.
 * 캔버스·배치·그룹은 읽기 Diagram·Design 과 **같은 공용 표면**(`DiagramSurface`)을 쓴다.
 */
export function DiagramEdit({ conn }: { conn: ConnectionDef }) {
  const draft = useSchemaEditStore((s) => s.draft)
  const activeId = useSchemaEditStore((s) => s.activeTableId)
  const addTable = useSchemaEditStore((s) => s.addTable)
  const setActiveTable = useSchemaEditStore((s) => s.setActiveTable)
  const addFk = useSchemaEditStore((s) => s.addFk)

  // 배치·그룹은 읽기 Diagram 과 같은 연결 스코프를 공유한다 — 편집 중에 옮긴 자리가 읽기 모드에도 남는다.
  const layout = useDiagramLayout(conn.id, true)

  const onConnectFk = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || !c.sourceHandle) return
      const src = draft.find((t) => t.id === c.source)
      const tgt = draft.find((t) => t.id === c.target)
      if (!src || !tgt) return
      const patch = buildFkPatch(src, c.sourceHandle, tgt)
      if (patch) addFk(src.id, patch)
    },
    [draft, addFk]
  )

  const onSelect = useCallback((id: string | null) => setActiveTable(id ?? ''), [setActiveTable])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!layout.loaded ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted">배치 불러오는 중…</div>
        ) : draft.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-muted">
            편집할 테이블이 없습니다.
            <Button size="sm" variant="outline" onClick={() => addTable(conn.dbType)}>
              <Plus /> 첫 테이블 추가
            </Button>
          </div>
        ) : (
          <ReactFlowProvider key={`${conn.id}:edit:${layout.nonce}`}>
            <DiagramSurface
              tables={draft}
              exportName={conn.name}
              draggable
              editable
              persist
              layout={layout}
              selectedId={activeId}
              onSelect={onSelect}
              onConnectFk={onConnectFk}
              detailSubtitle="라이브 스키마 편집 · 대기 변경"
              detail={(t) => <EditableTableDetail table={t} dialect={conn.dbType} allTables={draft} />}
              sqlDetail={(t) => <SqlView table={t} dialect={conn.dbType} labeled={false} />}
              toolbarExtra={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[12px]"
                  onClick={() => addTable(conn.dbType)}
                >
                  <Plus /> 테이블
                </Button>
              }
            />
          </ReactFlowProvider>
        )}
      </div>
      <PreviewBar dialect={conn.dbType} />
    </div>
  )
}
