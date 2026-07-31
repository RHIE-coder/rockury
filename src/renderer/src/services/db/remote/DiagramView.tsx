import { useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Network, Loader2, Pencil, RefreshCw, LayoutGrid } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { useActiveConnection } from '../connections/store'
import { useRemoteStore } from './store'
import { useScope } from './useScope'
import { buildErd } from './diagram/graph'
import { isolatedTableIds } from './diagram/filter'
import { DiagramSurface } from './diagram/DiagramSurface'
import { useDiagramLayout } from './diagram/useDiagramLayout'
import { TableDetail } from './definition/TableDetail'
import { SqlView } from './definition/SqlView'
import { useSchemaEditStore } from './schemaEdit/store'
import { DiagramEdit } from './schemaEdit/DiagramEdit'

/**
 * Remote › Diagram(운영부 · depth 3, §ops-plan 2e) — 실 DB 를 역설계(introspection)한 ERD.
 * Object 뷰와 같은 `TableDef[]`(useRemoteStore)를 소비하되 그래프로 렌더.
 * 배치·그룹은 **연결(Connection)별**로 영속하고, 화면·캔버스·상세 서랍은 Design ERD 와 같은
 * 공용 표면(`DiagramSurface`)을 쓴다. 정본: `docs/spec/db-remote.md` §db-remote.diagram.
 */
export function DiagramView() {
  const conn = useActiveConnection()
  const connId = conn?.id ?? null

  const tables = useRemoteStore((s) => (connId ? s.byEnv[connId] : undefined))
  const loading = useRemoteStore((s) => (connId ? s.loading[connId] : false))
  const error = useRemoteStore((s) => (connId ? s.error[connId] : null))
  const load = useRemoteStore((s) => s.load)
  // 범위 밖 FK 대상을 카드로 그리고, 그 카드를 누르면 범위에 더한다(§db-remote.scope R3).
  const { availableSchemas, schemaLabel, addSchema } = useScope()

  const editing = useSchemaEditStore((s) => s.editing)
  const editConnId = useSchemaEditStore((s) => s.connId)
  const begin = useSchemaEditStore((s) => s.begin)

  const layout = useDiagramLayout(connId, true)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (connId) void load(connId, connId)
  }, [connId, load])

  // 편집 모드는 **같은 스코프**(연결 id)의 배치·그룹을 고친다 — 편집을 닫고 돌아오면 다시 읽는다.
  // 안 그러면 편집 중에 만든 그룹이 읽기 화면에 안 비친 채로 남는다.
  const isEditingNow = editing && editConnId === connId
  const wasEditing = useRef(false)
  const reload = layout.reload
  useEffect(() => {
    if (wasEditing.current && !isEditingNow) reload()
    wasEditing.current = isEditingNow
  }, [isEditingNow, reload])

  const edgeCount = useMemo(() => (tables ? buildErd(tables).edges.length : 0), [tables])
  // 관계 없는 고립 테이블 — `관계만` 토글이 목록·캔버스에서 함께 숨긴다.
  const isolated = useMemo(() => (tables ? isolatedTableIds(buildErd(tables)) : new Set<string>()), [tables])

  if (!conn) {
    return (
      <PlaceholderView
        icon={Network}
        depth="depth 3 · Remote › Diagram"
        title="연결을 선택하세요"
        subtitle="상단 컨텍스트 바의 Connection 셀렉터에서 대상을 고르면 실 DB 를 역설계해 ERD 로 그립니다."
      />
    )
  }

  const ready = tables && tables.length > 0 && layout.loaded
  const isEditing = editing && editConnId === conn.id

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">
            Diagram <span className="font-normal text-muted">· {conn.name}</span>
          </h2>
          <p className="text-[12px] text-muted">
            {isEditing
              ? '편집 중 — 관계는 컬럼 점을 끌어 연결, 변경은 아래에서 적용'
              : loading
                ? '실 DB 역설계 중…'
                : tables
                  ? `${tables.length}개 테이블 · 관계 ${edgeCount} · Reverse(introspection) ERD`
                  : '역설계 대기'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent">편집 중</span>
          ) : (
            <>
              <Button size="sm" variant="ghost" disabled={loading || !tables} onClick={() => void layout.resetLayout()}>
                <LayoutGrid /> 자동 배치
              </Button>
              <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(conn.id, conn.id, true)}>
                {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} 새로고침
              </Button>
              <Button size="sm" disabled={loading || !tables} onClick={() => begin(conn.id, tables ?? [])}>
                <Pencil /> 편집
              </Button>
            </>
          )}
        </div>
      </div>

      {isEditing ? (
        <DiagramEdit conn={conn} />
      ) : error ? (
        <div className="m-5 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          역설계 실패: {error}
        </div>
      ) : (loading || !layout.loaded) && !tables ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          <Loader2 className="mr-2 size-4 animate-spin" /> 실 DB 스키마를 읽는 중…
        </div>
      ) : ready ? (
        <ReactFlowProvider key={`${conn.id}:${layout.nonce}`}>
          <DiagramSurface
            tables={tables}
            exportName={conn.name}
            draggable
            editable={false}
            persist
            layout={layout}
            selectedId={selected}
            onSelect={setSelected}
            isolated={isolated}
            detailSubtitle="실 DB 역설계 · 읽기"
            scope={{ availableSchemas, schemaLabel, onAddSchema: addSchema }}
            detail={(t, jump) => <TableDetail table={t} dialect={conn.dbType} onJump={jump} />}
            sqlDetail={(t) => <SqlView table={t} dialect={conn.dbType} labeled={false} />}
          />
        </ReactFlowProvider>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">테이블이 없습니다</div>
      )}
    </div>
  )
}
