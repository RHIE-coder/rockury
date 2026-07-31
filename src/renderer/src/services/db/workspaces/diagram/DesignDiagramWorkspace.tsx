import { useCallback, useMemo, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { Connection } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { GitBranch, Plus, Eye, LayoutGrid, Lock } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { useActiveDesign } from '../../designs/store'
import { useDefinitionStore, useDesignTables, useDesignReadOnly } from '../definition/store'
import { TableForm } from '../definition/TableForm'
import { SqlForm } from '../definition/SqlForm'
import { DiagramSurface } from '../../remote/diagram/DiagramSurface'
import { useDiagramLayout } from '../../remote/diagram/useDiagramLayout'
import { buildFkPatch } from './fk'

/**
 * Design › Diagram(설계부 · depth 3) — 활성 설계의 **가상 ERD 편집기**.
 * 표시는 useDesignTables(Draft/커밋 렌즈), 편집은 useDefinitionStore 액션(저장은 자동 write-through).
 * 관계는 컬럼 핸들을 끌어 생성. 배치·그룹·상세 서랍은 Remote ERD 와 **같은 공용 표면**을 쓰고,
 * 저장 스코프만 설계별(`design:<id>`)이다. 정본: `docs/spec/db-design.md` §db-design.diagram.scope.
 */
export function DesignDiagramWorkspace() {
  const design = useActiveDesign()
  const readOnly = useDesignReadOnly()
  const scoped = useDesignTables()
  const addTable = useDefinitionStore((s) => s.addTable)
  const addView = useDefinitionStore((s) => s.addView)

  // useDesignTables 는 매 렌더 새 배열 → 콘텐츠 기준으로 identity 안정화(재배치 폭주 방지).
  const scopedSig = JSON.stringify(scoped)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tables = useMemo(() => scoped, [scopedSig])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 커밋 버전을 볼 때는 배치·그룹을 저장하지 않는다 — 지나간 버전의 화면을 만졌다고
  // 정본이 바뀌면 안 된다(정본 §db-design.diagram.scope AC-2).
  const layout = useDiagramLayout(design ? `design:${design.id}` : null, !readOnly)

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) useDefinitionStore.getState().setActiveTable(id)
  }, [])

  const handleConnectFk = useCallback(
    (c: Connection) => {
      if (readOnly || !c.source || !c.target || !c.sourceHandle) return
      const src = tables.find((t) => t.id === c.source)
      const tgt = tables.find((t) => t.id === c.target)
      if (!src || !tgt) return
      // 뷰에는 FK 를 걸 수 없다(양쪽 어디든) — 끌어다 놓아도 조용히 무시한다.
      if (src.isView || tgt.isView) return
      const patch = buildFkPatch(src, c.sourceHandle, tgt)
      if (!patch) return
      const st = useDefinitionStore.getState()
      st.setActiveTable(src.id)
      st.addConstraint('fk')
      const newId = useDefinitionStore.getState().openConstraintId
      if (newId) st.updateConstraint(newId, patch)
    },
    [tables, readOnly]
  )

  if (!design) {
    return (
      <PlaceholderView
        icon={GitBranch}
        depth="depth 3 · Design › Diagram"
        title="설계를 선택하세요"
        subtitle="상단 컨텍스트 바의 Design 셀렉터에서 설계를 고르면 그 설계의 테이블을 ERD 로 그리고 편집합니다."
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">
            Diagram <span className="font-normal text-muted">· {design.name}</span>
            {readOnly && (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-panel-strong px-1.5 py-0.5 text-[10px] text-muted">
                <Lock className="size-3" /> 읽기 전용(커밋 버전)
              </span>
            )}
          </h2>
          <p className="text-[12px] text-muted">
            {tables.length}개 테이블 · 가상 ERD {readOnly ? '· 열람' : '· 편집(관계는 컬럼 점을 끌어 연결)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <>
              <Button size="sm" variant="ghost" onClick={() => void layout.resetLayout()}>
                <LayoutGrid /> 자동 배치
              </Button>
              <Button size="sm" variant="outline" onClick={() => addTable(design.id)}>
                <Plus /> 테이블 추가
              </Button>
              <Button size="sm" variant="ghost" onClick={() => addView(design.id)}>
                <Eye /> 뷰 추가
              </Button>
            </>
          )}
        </div>
      </div>

      {!layout.loaded ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">불러오는 중…</div>
      ) : tables.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-muted">
          이 설계에는 테이블이 없습니다.
          {!readOnly && (
            <Button size="sm" variant="outline" onClick={() => addTable(design.id)}>
              <Plus /> 첫 테이블 추가
            </Button>
          )}
        </div>
      ) : (
        <ReactFlowProvider key={`${design.id}:${layout.nonce}`}>
          <DiagramSurface
            tables={tables}
            exportName={design.name}
            draggable={!readOnly}
            editable={!readOnly}
            persist={!readOnly}
            layout={layout}
            selectedId={selectedId}
            onSelect={handleSelect}
            onConnectFk={handleConnectFk}
            detailSubtitle={readOnly ? '설계 · 읽기 전용' : '설계 · 편집'}
            // 서랍 내용은 Definition 화면 그대로 — 같은 편집을 두 자리에서 다르게 하지 않는다.
            detail={() => <TableForm />}
            sqlDetail={() => <SqlForm labeled={false} />}
            // 설계부에서만 — 그룹을 지울 때 소속 테이블까지 지울 수 있다(확인 문구 입력).
            //   설계 테이블은 이 앱이 가진 도면이라 여기서 지우는 게 자연스럽다.
            //   실 DB 는 안 건드린다(반영은 Migration 몫).
            onDeleteTables={(ids) => {
              const st = useDefinitionStore.getState()
              for (const id of ids) st.deleteTable(id)
            }}
          />
        </ReactFlowProvider>
      )}
    </div>
  )
}
