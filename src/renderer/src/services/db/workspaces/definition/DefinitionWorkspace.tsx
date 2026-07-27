import { ArrowLeft, Eye, Layers, Lock, Plus, Table2, TableProperties, X } from 'lucide-react'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { Button } from '@renderer/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/ui/dropdown-menu'
import { useNav } from '@renderer/nav/useNav'
import { TableSidePanel } from '../../TableSidePanel'
import { useActiveDesign, useDesignsStore } from '../../designs/store'
import { useDefinitionStore, useDesignTables, useStudioReadOnly } from './store'
import { TableForm } from './TableForm'
import { SqlForm } from './SqlForm'

/** 좌측 서브사이드바 — [테이블/뷰 목록 | 제약 목록] 탭. 클릭 시 active 테이블 전환. */
function TablesSidebar() {
  const tables = useDesignTables()
  const activeId = useDefinitionStore((s) => s.activeTableId)
  const setActive = useDefinitionStore((s) => s.setActiveTable)

  return (
    <TableSidePanel
      tables={tables}
      activeId={activeId}
      onPick={(t) => setActive(t.id)}
      searchPlaceholder="테이블/컬럼 검색…"
      emptyText="아직 테이블이 없어요"
    />
  )
}

/** 사이드바 + 버튼 — 테이블과 뷰 중 무엇을 만들지 고른다. */
function AddMenu({ designId }: { designId: string }) {
  const addTable = useDefinitionStore((s) => s.addTable)
  const addView = useDefinitionStore((s) => s.addView)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-6" aria-label="테이블 추가">
          <Plus className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem data-definition-add="table" onSelect={() => addTable(designId)}>
          <Table2 />
          테이블 추가
        </DropdownMenuItem>
        <DropdownMenuItem data-definition-add="view" onSelect={() => addView(designId)}>
          <Eye />뷰 추가
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** FK 바로가기로 점프했을 때 뜨는 "이전 테이블로 돌아가기" 오버레이. */
function ReturnOverlay() {
  const returnTo = useDefinitionStore((s) => s.returnTo)
  const returnBack = useDefinitionStore((s) => s.returnBack)
  const clearReturnTo = useDefinitionStore((s) => s.clearReturnTo)
  if (!returnTo) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-canvas py-1 pl-1 pr-1.5 shadow-lg">
        <Button variant="soft" size="sm" className="rounded-full" onClick={returnBack}>
          <ArrowLeft />
          <span className="font-mono">{returnTo.tableName}</span> 로 돌아가기
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-full"
          aria-label="닫기"
          onClick={clearReturnTo}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

/** 설계 미선택 빈 상태 — 컨텍스트 바에서 고르거나 새 설계 생성으로 유도. */
function NoDesignState() {
  const openCreate = useDesignsStore((s) => s.openCreate)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3.5 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
        <Layers size={22} />
      </div>
      <div>
        <div className="text-[14px] font-semibold text-fg">설계를 선택하세요</div>
        <p className="mt-1 max-w-72 text-[12px] leading-relaxed text-muted">
          상단 컨텍스트 바에서 설계를 고르거나, 새 설계를 만들어 시작해요. 벤더(방언)는 설계가
          가집니다.
        </p>
      </div>
      <Button size="sm" onClick={openCreate}>
        <Plus />새 설계 만들기
      </Button>
    </div>
  )
}

/** 설계는 있지만 테이블이 없는 빈 상태. */
function NoTablesState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3.5 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
        <TableProperties size={22} />
      </div>
      <div>
        <div className="text-[14px] font-semibold text-fg">이 설계엔 아직 테이블이 없어요</div>
        <p className="mt-1 max-w-72 text-[12px] leading-relaxed text-muted">
          첫 테이블을 추가해 스키마 설계를 시작해요.
        </p>
      </div>
      <Button size="sm" onClick={onAdd}>
        <Plus />
        테이블 추가
      </Button>
    </div>
  )
}

/** 과거 버전 열람 중임을 알리는 읽기 전용 배너 — Draft 로 복귀 액션 포함. */
function ReadOnlyBanner({ version }: { version: string }) {
  const setContextValue = useNav((s) => s.setContextValue)
  return (
    <div className="flex items-center gap-2 border-b border-line bg-accent-2-soft px-4 py-1.5 text-[12px] text-accent-2">
      <Lock className="size-3.5" />
      <span className="font-medium">읽기 전용</span>
      <span className="font-mono font-semibold">{version}</span>
      <span className="text-accent-2/80">과거 버전을 보고 있어요 — 편집하려면 Draft 로 전환하세요.</span>
      <button
        type="button"
        onClick={() => setContextValue('version', 'draft')}
        className="ml-auto rounded-md bg-accent-2 px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-2/90"
      >
        Draft 로 전환
      </button>
    </div>
  )
}

/** Studio › Definition 워크스페이스 — [테이블·뷰/제약 사이드 패널 | Table/SQL 폼]. 활성 Design 스코프. */
export function DefinitionWorkspace() {
  const design = useActiveDesign()
  const tables = useDesignTables()
  const readOnly = useStudioReadOnly()
  const versionId = useNav((s) => s.contextValues['version'])
  const form = useDefinitionStore((s) => s.form)
  const addTable = useDefinitionStore((s) => s.addTable)

  if (!design) return <NoDesignState />

  return (
    <WorkspacePanels
      autoSaveId="db.definition"
      sidebarTitle="SCHEMA"
      sidebarActions={readOnly ? undefined : <AddMenu designId={design.id} />}
      sidebar={<TablesSidebar />}
    >
      <div className="flex h-full flex-col">
        {readOnly && versionId && <ReadOnlyBanner version={versionId} />}
        <div className="min-h-0 flex-1">
          {tables.length === 0 ? (
            readOnly ? (
              <div className="flex h-full items-center justify-center text-[13px] text-muted">
                이 버전에는 테이블이 없어요.
              </div>
            ) : (
              <NoTablesState onAdd={() => addTable(design.id)} />
            )
          ) : (
            <div className="relative h-full">
              <div className="h-full overflow-auto">
                {form === 'table' ? <TableForm /> : <SqlForm />}
              </div>
              <ReturnOverlay />
            </div>
          )}
        </div>
      </div>
    </WorkspacePanels>
  )
}
