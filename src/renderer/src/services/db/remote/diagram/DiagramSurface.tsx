import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { Connection } from '@xyflow/react'
import { qualifiedName, sameTable, type TableRef } from '../../schemaRef'
import type { TableDef } from '../../workspaces/definition/types'
import { DiagramTablePanel } from './DiagramTablePanel'
import { DiagramGroupPanel } from './DiagramGroupPanel'
import { DiagramDrawer } from './DiagramDrawer'
import { ErdCanvas, ToggleChip, type ErdCanvasProps } from './ErdCanvas'
import { visibleTables } from './group'
import type { DiagramLayoutApi } from './useDiagramLayout'

/** 목록·상세에서 다른 테이블로 날아갈 때의 이동(포커싱) 규칙 — 패널 클릭과 같은 값. */
const FOCUS = { duration: 400, padding: 0.55, maxZoom: 1.1 }

export interface DiagramSurfaceProps {
  /** 필터 전 전체 테이블. */
  tables: TableDef[]
  exportName: string
  /** 배치를 바꿀 수 있는가(노드·그룹 이동, 그룹 만들기·소속 변경). */
  draggable: boolean
  /** 스키마(FK)를 고칠 수 있는가. */
  editable: boolean
  persist: boolean
  layout: DiagramLayoutApi
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** 관계 없는 테이블 id — 주면 `관계만` 토글이 생긴다. */
  isolated?: Set<string>
  onConnectFk?: (c: Connection) => void
  /**
   * 상세보기 서랍의 [Table] 내용 — Definition 화면을 그대로 넘긴다.
   * `jump` 는 "다른 테이블로 가라"는 통로다: Definition 의 점프가 다이어그램에서는 캔버스 이동이 된다.
   */
  detail: (table: TableDef, jump: (ref: TableRef) => void) => ReactNode
  /** 상세보기 서랍의 [SQL] 내용(DDL 원문). */
  sqlDetail: (table: TableDef) => ReactNode
  detailSubtitle?: string
  /** 툴바에 끼울 추가 조작(편집 모드의 `테이블` 추가 등). */
  toolbarExtra?: ReactNode
  /** 범위(scope) — 주면 범위 밖 FK 대상을 이름 카드로 그린다. 그대로 ErdCanvas 로 흘린다. */
  scope?: ErdCanvasProps['scope']
  /**
   * 주면 그룹 지우기 확인에 "테이블도 함께 지우기" 가 생긴다(설계부 전용 — 확인 문구 입력).
   * 운영부는 안 준다: 실 DB 테이블은 편집 모드의 DDL·트랜잭션 게이트로만 지운다.
   */
  onDeleteTables?: (tableIds: string[]) => void
}

/**
 * ERD 화면 한 벌 — [좌측 패널(테이블·제약·그룹) | 캔버스 + 아래 상세보기 서랍].
 * Design › Diagram · Remote › Diagram(읽기/편집) 셋이 이걸 그대로 쓴다.
 * ⚠ `ReactFlowProvider` **안쪽**에 놓아야 한다(패널·캔버스가 같은 flow 를 본다).
 * 정본: `docs/spec/db-remote.md` §db-remote.diagram.
 */
export function DiagramSurface({
  tables,
  exportName,
  draggable,
  editable,
  persist,
  layout,
  selectedId,
  onSelect,
  isolated,
  onConnectFk,
  detail,
  sqlDetail,
  detailSubtitle,
  toolbarExtra,
  scope,
  onDeleteTables
}: DiagramSurfaceProps) {
  const rf = useReactFlow()
  const [hideIsolated, setHideIsolated] = useState(false)
  /** `그룹만 보기` — 보기 설정이라 저장하지 않는다(화면마다 다르게 보고 싶을 수 있다). */
  const [onlyGroups, setOnlyGroups] = useState<Set<string>>(new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState<'table' | 'sql'>('table')

  const shown = useMemo(
    () => visibleTables(tables, { isolated, hideIsolated, groups: layout.groups, onlyGroups }),
    [tables, isolated, hideIsolated, layout.groups, onlyGroups]
  )
  const allTableIds = useMemo(() => tables.map((t) => t.id), [tables])
  const selected = useMemo(() => tables.find((t) => t.id === selectedId) ?? null, [tables, selectedId])

  /**
   * 테이블을 고르면 서랍을 열고, **선택을 풀면 닫는다**(2026-07-30 사용자 지시).
   * 빈 서랍이 열린 채로 캔버스 높이를 42% 먹고 있으면 "선택된 테이블 없음"만 크게 적힌 칸이 된다.
   */
  const pick = useCallback(
    (id: string | null) => {
      onSelect(id)
      setDrawerOpen(!!id)
    },
    [onSelect]
  )

  /** 고른 테이블로 캔버스를 옮긴다. 필터·접힌 그룹으로 캔버스에 없으면 선택만 하고 넘어간다. */
  const focus = useCallback(
    (id: string) => {
      pick(id)
      if (rf.getNode(id)) void rf.fitView({ nodes: [{ id }], ...FOCUS })
    },
    [pick, rf]
  )

  /** 상세의 FK 참조를 눌렀을 때 — 캔버스를 그 테이블로 옮기고 서랍도 그 테이블로 바꾼다. */
  const jump = useCallback(
    (ref: TableRef) => {
      // 이름만으로 찾으면 다른 스키마의 동명 테이블로 캔버스가 날아간다.
      const t = tables.find((x) => sameTable(x, ref))
      if (t) focus(t.id)
    },
    [tables, focus]
  )

  const toggleOnly = useCallback((id: string) => {
    setOnlyGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div className="flex min-h-0 flex-1">
      <DiagramTablePanel
        tables={shown}
        selectedId={selectedId}
        onSelect={pick}
        groupCount={layout.groups.length}
        groupTab={
          <DiagramGroupPanel
            tables={tables}
            groups={layout.groups}
            onGroupsChange={layout.setGroups}
            onPatchGroup={layout.patchGroup}
            onCreateGroup={layout.createGroup}
            onDeleteGroup={layout.deleteGroup}
            onlyGroups={onlyGroups}
            onToggleOnly={toggleOnly}
            activeTableId={selectedId}
            onPickTable={(t) => focus(t.id)}
            editable={draggable}
            onDeleteTables={onDeleteTables}
          />
        }
      />
      {/* min-h-0 이 없으면 서랍의 최소 높이가 이 열의 높이를 밀어올려 화면 위 머리글까지 밖으로
          밀려난다(높이 42% + 최소 220px). flex 자식의 기본 min-height 는 auto 라 반드시 0 으로 낮춘다. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <ErdCanvas
            tables={shown}
            allTableIds={allTableIds}
            scope={scope}
            exportName={exportName}
            draggable={draggable}
            editable={editable}
            persist={persist}
            onSaveLayout={layout.saveLayout}
            onConnectFk={onConnectFk}
            selectedId={selectedId}
            onSelect={pick}
            storedPositions={layout.storedPositions}
            storedViewport={layout.storedViewport}
            groups={layout.groups}
            onGroupsChange={layout.setGroups}
            toolbarExtra={
              <>
                {isolated && (
                  <ToggleChip
                    active={hideIsolated}
                    onClick={() => setHideIsolated((v) => !v)}
                    title="관계 없는 테이블 숨김"
                  >
                    관계만
                  </ToggleChip>
                )}
                {toolbarExtra}
              </>
            }
          />
        </div>
        <DiagramDrawer
          // 스키마가 섞여 있을 수 있다 — 서랍 머리도 한정 이름으로 말한다.
          title={selected ? qualifiedName(selected) : null}
          subtitle={detailSubtitle}
          // 고른 것이 없으면 서랍은 언제나 닫힌 상태다 — 빈 서랍이 화면을 먹지 않게.
          open={drawerOpen && !!selected}
          onOpenChange={(v) => setDrawerOpen(v && !!selected)}
          form={form}
          onFormChange={setForm}
          table={selected ? detail(selected, jump) : null}
          sql={selected ? sqlDetail(selected) : null}
        />
      </div>
    </div>
  )
}
