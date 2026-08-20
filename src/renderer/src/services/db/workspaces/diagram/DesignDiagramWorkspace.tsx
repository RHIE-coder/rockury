import { useCallback, useMemo, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { Connection } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { GitBranch, Plus, Eye, Layers, LayoutGrid, Lock, CopyPlus } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { useActiveDesign, useDesignsStore } from '../../designs/store'
import { useDefinitionStore, useScopedDesignTables, useDesignReadOnly } from '../definition/store'
import { TableForm } from '../definition/TableForm'
import { SqlForm } from '../definition/SqlForm'
import { DiagramSurface } from '../../remote/diagram/DiagramSurface'
import { useDiagramLayout } from '../../remote/diagram/useDiagramLayout'
import { buildFkPatch } from './fk'
import { ImportTablesDialog } from './ImportTablesDialog'

/**
 * Design › Diagram(설계부 · depth 3) — 활성 설계의 **가상 ERD 편집기**.
 * 표시는 useScopedDesignTables(Draft/커밋 렌즈 + 스키마 범위), 편집은 useDefinitionStore 액션(저장은 자동 write-through).
 * 관계는 컬럼 핸들을 끌어 생성. 배치·그룹·상세 서랍은 Remote ERD 와 **같은 공용 표면**을 쓰고,
 * 저장 스코프만 설계별(`design:<id>`)이다.
 */
export function DesignDiagramWorkspace() {
  const design = useActiveDesign()
  const readOnly = useDesignReadOnly()
  const scoped = useScopedDesignTables()
  const addTable = useDefinitionStore((s) => s.addTable)
  const addView = useDefinitionStore((s) => s.addView)

  const [importOpen, setImportOpen] = useState(false)
  /*
   * 가져올 것이 **어디에든** 있어야 손잡이를 연다. 예전엔 "다른 설계가 있나"만 봤는데,
   * 이제 자기 자신도 출처가 된다(복붙) — 이 설계에 표가 하나라도 있으면 열 이유가 있다.
   */
  const hasOtherDesign = useDesignsStore((s) => s.designs.some((d) => d.id !== design?.id))
  const canImport = hasOtherDesign || scoped.length > 0

  // useDesignTables 는 매 렌더 새 배열 → 콘텐츠 기준으로 identity 안정화(재배치 폭주 방지).
  const scopedSig = JSON.stringify(scoped)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tables = useMemo(() => scoped, [scopedSig])

  /**
   * 고른 표는 이 화면 것이 아니라 **설계부가 함께 쓰는 값**이다(`useDefinitionStore.activeTableId`) —
   * Definition 과 Diagram 을 오가도 보던 표가 그대로다(2026-08-04 사용자 요청). 로컬 state 로
   * 들고 있던 동안은 Diagram 에 들어올 때마다 고름이 풀렸다.
   *
   * 여기 들어올 때 상세 서랍이 저절로 열리지는 않는다 — 서랍은 `DiagramSurface` 가 **누른 순간**만 연다.
   */
  const selectedId = useDefinitionStore((s) => s.activeTableId) || null
  // 커밋 버전을 볼 때는 배치·그룹을 저장하지 않는다 — 지나간 버전의 화면을 만졌다고
  // 정본이 바뀌면 안 된다(정본 §db-design.diagram.scope AC-2).
  const layout = useDiagramLayout(design ? `design:${design.id}` : null, !readOnly)

  // 빈 캔버스를 눌러 고름을 풀면 Definition 도 함께 푼다 — 한 값을 둘이 보는 이상 한쪽만
  // 남겨 둘 수 없다(그 경우 Definition 은 예전처럼 목록 첫 표로 돌아간다).
  const handleSelect = useCallback((id: string | null) => {
    useDefinitionStore.getState().setActiveTable(id ?? '')
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
              {/* 그룹도 여기서 만든다 — 왼쪽 `그룹` 탭을 열어야만 만들 수 있으면 못 찾는다.
                  상자는 지금 보고 있는 자리에 생긴다(§diagram.group AC-6). */}
              <Button size="sm" variant="ghost" data-group-create-toolbar onClick={() => layout.createGroup()}>
                <Layers /> 그룹 추가
              </Button>
              {canImport && (
                <Button
                  size="sm"
                  variant="ghost"
                  data-import-tables
                  title="다른 설계의 테이블을 이 설계로 복제"
                  onClick={() => setImportOpen(true)}
                >
                  <CopyPlus /> 가져오기
                </Button>
              )}
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
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => addTable(design.id)}>
                <Plus /> 첫 테이블 추가
              </Button>
              {canImport && (
                <Button size="sm" variant="ghost" data-import-tables onClick={() => setImportOpen(true)}>
                  <CopyPlus /> 가져오기
                </Button>
              )}
            </div>
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

      <ImportTablesDialog open={importOpen} onOpenChange={setImportOpen} target={design} />
    </div>
  )
}
