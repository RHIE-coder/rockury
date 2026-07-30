import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Code2, Maximize2, TableProperties } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/ui/dialog'
import { cn } from '@renderer/lib/utils'

/**
 * 상세보기 서랍 — 캔버스에서 고른 테이블의 상세를 **캔버스 아래**에서 보인다.
 * 정본: §db-console.diagram.detail.
 *
 * 내용은 여기서 만들지 않는다 — Definition 화면(`TableDetail`·`EditableTableDetail`·`TableForm`)을
 * 그대로 받아 그린다. 같은 편집을 두 자리에서 다르게 하지 않기 위해서다.
 * 좁아서 다 못 보면 `크게 보기` 로 **같은 내용**을 모달에 띄운다.
 */
export function DiagramDrawer({
  title,
  subtitle,
  open,
  onOpenChange,
  form,
  onFormChange,
  table,
  sql
}: {
  /** 서랍 머리에 쓸 이름(고른 테이블). 없으면 안내만 보인다. */
  title: string | null
  subtitle?: string
  open: boolean
  onOpenChange: (v: boolean) => void
  form: 'table' | 'sql'
  onFormChange: (f: 'table' | 'sql') => void
  /** [Table] 내용 — Definition 화면 그대로. */
  table: ReactNode
  /** [SQL] 내용 — DDL 원문. */
  sql: ReactNode
}) {
  const [big, setBig] = useState(false)
  const body = form === 'table' ? table : sql

  return (
    <>
      <div
        data-diagram-drawer={open ? 'open' : 'closed'}
        className={cn(
          'flex shrink-0 flex-col border-t border-line bg-canvas',
          open ? 'h-[42%] min-h-[220px]' : 'h-auto'
        )}
      >
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-2.5">
          <button
            type="button"
            data-drawer-toggle
            title={open ? '서랍 접기' : '서랍 펴기'}
            onClick={() => onOpenChange(!open)}
            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[12px] font-semibold text-fg hover:bg-panel-strong"
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
            상세
          </button>
          {/* 아무것도 안 고른 상태에선 머리에 '상세' 한 마디만 둔다 — 안내는 서랍 안에서 한다. */}
          {title && (
            <>
              <span className="min-w-0 truncate font-mono text-[12px] text-fg" title={title}>
                {title}
              </span>
              {subtitle && <span className="shrink-0 text-[11px] text-muted">· {subtitle}</span>}
            </>
          )}

          {open && title && (
            <div className="ml-auto flex items-center gap-1">
              <FormToggle form={form} onChange={onFormChange} />
              <button
                type="button"
                data-drawer-expand
                title="크게 보기"
                onClick={() => setBig(true)}
                className="rounded p-1 text-muted hover:bg-panel-strong hover:text-fg"
              >
                <Maximize2 className="size-3.5" />
              </button>
            </div>
          )}
        </div>

        {open && (
          <div className="min-h-0 flex-1 overflow-auto">
            {title ? (
              body
            ) : (
              <p className="px-4 py-6 text-center text-[12px] text-muted">선택된 테이블 없음</p>
            )}
          </div>
        )}
      </div>

      {/* 크게 보기 — 다른 화면이 아니라 **같은 내용**을 넓게 본다. */}
      <Dialog open={big} onOpenChange={setBig}>
        <DialogContent
          data-drawer-modal
          className="flex h-[86vh] max-w-[min(1240px,94vw)] flex-col gap-0 p-0"
        >
          <DialogHeader className="shrink-0 border-b border-line px-4 py-2.5">
            <DialogTitle className="flex items-center gap-2 font-mono text-[13px]">
              {title}
              <span className="font-sans text-[11px] font-normal text-muted">{subtitle}</span>
              <span className="ml-auto pr-4">
                <FormToggle form={form} onChange={onFormChange} />
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto">{body}</div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** [Table|SQL] 표현 토글 — Definition 화면과 같은 문법. */
function FormToggle({
  form,
  onChange
}: {
  form: 'table' | 'sql'
  onChange: (f: 'table' | 'sql') => void
}) {
  const items = [
    { id: 'table' as const, label: 'Table', icon: TableProperties },
    { id: 'sql' as const, label: 'SQL', icon: Code2 }
  ]
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-line bg-canvas p-0.5">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          data-drawer-form={id}
          onClick={() => onChange(id)}
          aria-pressed={form === id}
          className={cn(
            'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium transition-colors',
            form === id ? 'bg-accent text-white' : 'text-muted hover:bg-panel-strong hover:text-fg'
          )}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  )
}
