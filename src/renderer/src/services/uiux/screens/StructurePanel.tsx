import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Rows3, Trash2 } from 'lucide-react'
import { cx } from '@renderer/lib/cx'
import { Button } from '@renderer/ui/button'
import { COMPONENT_KINDS, ROLE_LABEL, kindLabel, type ComponentRole } from '../catalog'
import { addComponent, addSection, moveComponent, moveSection, removeNode } from '../tree'
import { useSpecStore } from '../store'
import type { SurfaceContent } from '../types'

/**
 * 화면 구조 — 섹션 › 컴포넌트.
 *
 * 저장되는 것은 **좌표가 아니라 순서와 묶음**이다. 여기서는 버튼으로 옮기고 Canvas 에서는
 * 끌어서 옮기지만, 둘 다 같은 순수 함수(`tree.ts`)를 부른다 — 편집 규칙이 화면마다 갈리지 않게.
 */
export function StructurePanel() {
  const content = useSpecStore((s) => s.content)
  const surfaceId = useSpecStore((s) => s.selectedSurfaceId)
  const selectedNodeId = useSpecStore((s) => s.selectedNodeId)
  const selectNode = useSpecStore((s) => s.selectNode)
  const editContent = useSpecStore((s) => s.editContent)
  const [adding, setAdding] = useState<string | null>(null)

  if (!surfaceId || !content) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Rows3 size={22} className="text-muted" />
        <p className="text-[13px] text-muted">왼쪽에서 화면을 고르면 그 구조가 여기 나와요.</p>
      </div>
    )
  }

  const edit = (fn: (c: SurfaceContent) => SurfaceContent): void => void editContent(fn)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[12px] font-semibold tracking-wide text-muted">구조</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => edit((c) => addSection(c).content)}
          title="영역 추가"
        >
          <Plus size={13} /> 영역
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {content.sections.length === 0 && (
          <p className="px-1 py-6 text-center text-[13px] text-muted">
            아직 비어 있어요. 위 <span className="font-medium">영역</span> 을 눌러 시작하세요.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {content.sections.map((section, si) => (
            <div key={section.id} data-spec-section={section.id} className="rounded-md border border-line bg-panel">
              <button
                className={cx(
                  'flex w-full items-center gap-2 px-2.5 py-2 text-left',
                  selectedNodeId === section.id && 'bg-accent/10'
                )}
                onClick={() => selectNode(section.id)}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{section.name}</span>
                <span className="shrink-0 text-[11px] text-muted">{section.id}</span>
                <MoveButtons
                  disabledUp={si === 0}
                  disabledDown={si === content.sections.length - 1}
                  onUp={() => edit((c) => moveSection(c, section.id, si - 1))}
                  onDown={() => edit((c) => moveSection(c, section.id, si + 1))}
                  onDelete={() => edit((c) => removeNode(c, section.id))}
                  deleteTitle="영역 지우기 — 안의 요소도 함께 사라져요"
                />
              </button>

              <div className="border-t border-line/60 px-2 py-1.5">
                {section.components.map((component, ci) => (
                  <button
                    key={component.id}
                    data-spec-component={component.id}
                    className={cx(
                      'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[13px]',
                      selectedNodeId === component.id ? 'bg-accent/10' : 'hover:bg-panel-strong'
                    )}
                    onClick={() => selectNode(component.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {component.label || kindLabel(component.type)}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">{component.type}</span>
                    <MoveButtons
                      disabledUp={ci === 0}
                      disabledDown={ci === section.components.length - 1}
                      onUp={() => edit((c) => moveComponent(c, component.id, section.id, ci - 1))}
                      onDown={() => edit((c) => moveComponent(c, component.id, section.id, ci + 1))}
                      onDelete={() => edit((c) => removeNode(c, component.id))}
                      deleteTitle="요소 지우기"
                    />
                  </button>
                ))}

                {adding === section.id ? (
                  <KindPicker
                    onPick={(type) => {
                      edit((c) => addComponent(c, section.id, type).content)
                      setAdding(null)
                    }}
                    onCancel={() => setAdding(null)}
                  />
                ) : (
                  <button
                    className="mt-0.5 flex w-full items-center gap-1 rounded px-1.5 py-1 text-[12px] text-muted hover:bg-panel-strong hover:text-fg"
                    onClick={() => setAdding(section.id)}
                  >
                    <Plus size={12} /> 요소 추가
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 순서·삭제 — 트리 줄과 구조 줄이 같은 모양을 쓰도록 한 곳에 둔다. */
function MoveButtons(props: {
  disabledUp: boolean
  disabledDown: boolean
  onUp: () => void
  onDown: () => void
  onDelete: () => void
  deleteTitle: string
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <span
        role="button"
        aria-disabled={props.disabledUp}
        title="위로"
        className={cx('rounded p-0.5 text-muted', props.disabledUp ? 'opacity-30' : 'hover:text-fg')}
        onClick={props.disabledUp ? undefined : stop(props.onUp)}
      >
        <ChevronUp size={13} />
      </span>
      <span
        role="button"
        aria-disabled={props.disabledDown}
        title="아래로"
        className={cx('rounded p-0.5 text-muted', props.disabledDown ? 'opacity-30' : 'hover:text-fg')}
        onClick={props.disabledDown ? undefined : stop(props.onDown)}
      >
        <ChevronDown size={13} />
      </span>
      <span
        role="button"
        title={props.deleteTitle}
        className="rounded p-0.5 text-muted hover:text-destructive"
        onClick={stop(props.onDelete)}
      >
        <Trash2 size={12} />
      </span>
    </span>
  )
}

/** 컴포넌트 종류 고르기 — 역할로 묶어 보인다(목록이 길어져도 눈이 길을 잃지 않게). */
function KindPicker({ onPick, onCancel }: { onPick: (type: string) => void; onCancel: () => void }) {
  const roles: ComponentRole[] = ['input', 'action', 'display', 'layout']
  return (
    <div className="mt-1 rounded border border-line bg-canvas p-2">
      {roles.map((role) => (
        <div key={role} className="mb-1.5 last:mb-0">
          <div className="mb-1 text-[11px] font-medium tracking-wide text-muted">
            {ROLE_LABEL[role]}
          </div>
          <div className="flex flex-wrap gap-1">
            {COMPONENT_KINDS.filter((k) => k.role === role).map((k) => (
              <button
                key={k.type}
                className="rounded border border-line px-1.5 py-0.5 text-[12px] hover:border-accent hover:text-accent"
                onClick={() => onPick(k.type)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button className="mt-1 text-[12px] text-muted hover:text-fg" onClick={onCancel}>
        닫기
      </button>
    </div>
  )
}
