import { useEffect, useState } from 'react'
import { ArrowLeft, Code2, Loader2, Pencil, Plus, RefreshCw, TableProperties } from 'lucide-react'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { dialectInfo } from '../dialects'
import { qualifiedName, sameTable, type TableRef } from '../schemaRef'
import { classifyOutsideRefs } from './outsideRef'
import { useScope } from './useScope'
import { TableSidePanel } from '../TableSidePanel'
import { useActiveConnection } from '../connections/store'
import { useRemoteStore } from './store'
import { useRemoteFocus, useRemoteFocusStore } from './focus'
import { resolveActiveTable } from './definition/select'
import { TableDetail } from './definition/TableDetail'
import { SqlView } from './definition/SqlView'
import { useSchemaEditStore } from './schemaEdit/store'
import { EditableTableDetail } from './schemaEdit/EditableTableDetail'
import { PreviewBar } from './schemaEdit/PreviewBar'

/** [Table|SQL] 표현 토글. */
function FormToggle({ form, onChange }: { form: 'table' | 'sql'; onChange: (f: 'table' | 'sql') => void }) {
  const items: { id: 'table' | 'sql'; label: string; icon: typeof TableProperties }[] = [
    { id: 'table', label: 'Table', icon: TableProperties },
    { id: 'sql', label: 'SQL', icon: Code2 }
  ]
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-line bg-canvas p-0.5">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={form === id}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
            form === id ? 'bg-accent text-white' : 'text-muted hover:bg-panel-strong hover:text-fg'
          )}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * Remote › Definition(운영부 · depth 3) — 실 DB 를 역설계(introspection)한 스키마 정의를
 * Design Definition 과 같은 상세 화면(테이블 목록 | 컬럼·제약 그리드 / SQL·DDL)으로 브라우징·편집.
 * Diagram/Object 와 같은 `TableDef[]`(useRemoteStore)를 공유. 편집은 draft(useSchemaEditStore)에 쌓여
 * baseline↔draft diff DDL 미리보기 → tx 게이트 적용 → 재역설계(스키마 변경은 Migration 도 있지만 여기선 직접).
 */
export function DefinitionView() {
  const conn = useActiveConnection()
  const connId = conn?.id ?? null

  const tables = useRemoteStore((s) => (connId ? s.byEnv[connId] : undefined))
  const loading = useRemoteStore((s) => (connId ? s.loading[connId] : false))
  const error = useRemoteStore((s) => (connId ? s.error[connId] : null))
  const load = useRemoteStore((s) => s.load)

  const editing = useSchemaEditStore((s) => s.editing)
  const editConnId = useSchemaEditStore((s) => s.connId)
  const draft = useSchemaEditStore((s) => s.draft)
  const editActiveId = useSchemaEditStore((s) => s.activeTableId)
  const begin = useSchemaEditStore((s) => s.begin)
  const setEditActive = useSchemaEditStore((s) => s.setActiveTable)
  const addTableEdit = useSchemaEditStore((s) => s.addTable)

  // 고른 표는 이 화면 것이 아니라 **운영부가 함께 쓰는 값**이다 — Diagram·Data 로 옮겨도 그대로다.
  const activeId = useRemoteFocus(connId)
  const setFocus = useRemoteFocusStore((s) => s.setFocus)
  const setActiveId = (id: string | null): void => setFocus(connId, id)
  const [form, setForm] = useState<'table' | 'sql'>('table')
  /** FK 를 눌러 건너온 자리 — "…로 돌아가기"가 이걸 든다. 사이드바로 직접 고르면 지운다. */
  const [returnTo, setReturnTo] = useState<{ id: string; label: string } | null>(null)
  const { availableSchemas, schemaLabel, addSchema } = useScope()

  useEffect(() => {
    if (connId) void load(connId, connId)
  }, [connId, load])

  if (!conn) {
    return (
      <PlaceholderView
        icon={TableProperties}
        depth="depth 3 · Remote › Definition"
        title="연결을 선택하세요"
        subtitle="상단 컨텍스트 바의 Connection 셀렉터에서 대상을 고르면 실 DB 를 역설계해 스키마 정의(컬럼·제약·DDL)를 보여줍니다."
      />
    )
  }

  const list = tables ?? []
  const outsideRefs = classifyOutsideRefs(list, availableSchemas)
  const isEditing = editing && editConnId === conn.id
  const active = resolveActiveTable(list, activeId)
  const editActive = draft.find((t) => t.id === editActiveId) ?? draft[0]

  // 참조 대상으로 이동 — 이름만으로 찾으면 다른 스키마의 동명 테이블로 간다.
  // 범위 밖 참조는 여기까지 오지 않는다(상세가 링크 대신 "범위에 더하기"를 그린다).
  const jumpTo = (ref: TableRef): void => {
    const target = list.find((t) => sameTable(t, ref))
    if (!target) return
    // 건너오기 전 자리를 남긴다 — 스키마를 넘나들면 어디서 왔는지 금세 잃는다.
    if (active && active.id !== target.id) setReturnTo({ id: active.id, label: qualifiedName(active) })
    setActiveId(target.id)
    setForm('table')
  }

  const readyToEdit = !loading && !error

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">
            Definition <span className="font-normal text-muted">· {conn.name}</span>
          </h2>
          <p className="text-[12px] text-muted">
            {isEditing
              ? '편집 중 — 변경은 아래 미리보기에서 적용해요'
              : loading
                ? '실 DB 역설계 중…'
                : tables
                  ? `${tables.length}개 테이블 · Reverse(introspection)`
                  : '역설계 대기'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && <FormToggle form={form} onChange={setForm} />}
          <span
            title="연결 방언"
            className="flex items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-medium text-fg"
          >
            <span className="size-2 rounded-full" style={{ background: dialectInfo(conn.dbType).dot }} />
            {dialectInfo(conn.dbType).label}
          </span>
          {isEditing ? (
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent">
              편집 중
            </span>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(conn.id, conn.id, true)}>
                {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} 새로고침
              </Button>
              <Button size="sm" disabled={!readyToEdit} onClick={() => begin(conn.id, list, active?.id)}>
                <Pencil /> 편집
              </Button>
            </>
          )}
        </div>
      </div>

      {error && !isEditing ? (
        <div className="m-5 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          역설계 실패: {error}
        </div>
      ) : loading && !tables && !isEditing ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          <Loader2 className="mr-2 size-4 animate-spin" /> 실 DB 스키마를 읽는 중…
        </div>
      ) : !isEditing && list.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">테이블이 없습니다</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <WorkspacePanels
              autoSaveId="db.console.definition"
              collapsible
              sidebarTitle="SCHEMA"
              sidebarActions={
                isEditing ? (
                  <Button variant="ghost" size="icon" className="size-6" aria-label="테이블 추가" onClick={() => addTableEdit(conn.dbType)}>
                    <Plus className="size-4" />
                  </Button>
                ) : undefined
              }
              sidebar={
                isEditing ? (
                  <TableSidePanel
                    tables={draft}
                    activeId={editActive?.id ?? null}
                    onPick={(t) => setEditActive(t.id)}
                    searchPlaceholder="테이블/컬럼 검색…"
                  />
                ) : (
                  <TableSidePanel
                    tables={list}
                    activeId={active?.id ?? null}
                    onPick={(t) => {
                      setActiveId(t.id)
                      // 손으로 고른 것은 "건너온" 것이 아니다 — 돌아갈 자리를 지운다.
                      setReturnTo(null)
                    }}
                    searchPlaceholder="테이블/컬럼/스키마 검색…"
                  />
                )
              }
            >
              <div className="relative h-full overflow-auto">
                {isEditing ? (
                  editActive ? (
                    <EditableTableDetail table={editActive} dialect={conn.dbType} allTables={draft} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[13px] text-muted">
                      좌측 + 로 테이블을 추가하세요
                    </div>
                  )
                ) : active ? (
                  form === 'table' ? (
                    <TableDetail
                      table={active}
                      dialect={conn.dbType}
                      onJump={jumpTo}
                      outsideRefs={outsideRefs}
                      schemaLabel={schemaLabel}
                      onAddSchema={addSchema}
                    />
                  ) : (
                    <SqlView table={active} dialect={conn.dbType} allTables={list} schemaName={conn.name} />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-[13px] text-muted">
                    테이블을 선택하세요
                  </div>
                )}
                {/* 건너온 자리로 되돌아가기 — 스키마를 넘나들면 어디서 왔는지 금세 잃는다.
                    설계부 Definition 의 오버레이와 같은 규칙(§db-remote.scope R3). */}
                {returnTo && !isEditing && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveId(returnTo.id)
                      setReturnTo(null)
                    }}
                    className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1.5 text-[12px] shadow-lg transition-colors hover:bg-panel-strong"
                  >
                    <ArrowLeft className="size-3.5 text-muted" />
                    <span className="font-mono">{returnTo.label}</span> 로 돌아가기
                  </button>
                )}
              </div>
            </WorkspacePanels>
          </div>
          {isEditing && <PreviewBar dialect={conn.dbType} />}
        </div>
      )}
    </div>
  )
}
