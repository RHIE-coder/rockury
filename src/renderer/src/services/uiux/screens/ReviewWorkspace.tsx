import { Check, MessageSquare, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNav } from '@renderer/nav/useNav'
import { cx } from '@renderer/lib/cx'
import { Button } from '@renderer/ui/button'
import { kindLabel } from '../catalog'
import { findComponent, findSection } from '../tree'
import { useSpecStore, useTree } from '../store'
import type { SurfaceContent, Viewport } from '../types'
import { Preview } from './Preview'
import { ScreensShell } from './ScreensShell'

/**
 * Screens › Review — 화면 위 요소에 **의견을 붙인다.** 명세 정본 `docs/spec/uiux-ia.md` Surface `uiux.screens.review`.
 *
 * 스크린샷을 찍어 화살표를 그려 보내던 일을 대신하는 자리다. 의견은 **좌표가 아니라 요소에**
 * 붙으므로 배치가 바뀌어도 떠내려가지 않고, 에이전트가 "어느 요소에 대한 말인지" 정확히 안다.
 *
 * 미리보기에는 **"의견이 있음"만** 점선으로 표시하고 내용은 옆 목록에서 본다 — 화면 위에 말풍선을
 * 띄우면 정작 고쳐야 할 화면이 가려진다.
 */
export function ReviewWorkspace() {
  return (
    <ScreensShell aside={<NotePanel />}>
      <ReviewPane />
    </ScreensShell>
  )
}

function ReviewPane() {
  const content = useSpecStore((s) => s.content)
  const surfaceId = useSpecStore((s) => s.selectedSurfaceId)
  const selectedNodeId = useSpecStore((s) => s.selectedNodeId)
  const selectNode = useSpecStore((s) => s.selectNode)
  const notes = useSpecStore((s) => s.notes)
  const tree = useTree()
  const viewport = (useNav((s) => s.contextValues['viewport']) ?? 'pc') as Viewport

  const surface = tree.surfaces.find((s) => s.id === surfaceId)
  if (!surface || !content) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <MessageSquare size={22} className="text-muted" />
        <p className="text-[13px] text-muted">왼쪽에서 화면을 고르면 여기서 의견을 남길 수 있어요.</p>
      </div>
    )
  }

  const openTargets = [...new Set(notes.filter((n) => n.resolved === 0 && n.target).map((n) => n.target))]

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="truncate text-[12px] font-semibold tracking-wide text-muted">
          {surface.name}
        </span>
        <span className="shrink-0 text-[11px] text-muted">요소를 눌러 고른 뒤 오른쪽에 남기세요</span>
      </div>
      <div className="min-h-0 flex-1" data-uiux-review={surface.id}>
        <Preview
          content={content}
          viewport={viewport}
          selectedId={selectedNodeId}
          pinnedIds={openTargets}
          onSelect={selectNode}
        />
      </div>
    </div>
  )
}

/** 오른쪽 — 지금 고른 요소에 의견 남기기 + 이 화면의 의견 목록. */
function NotePanel() {
  const content = useSpecStore((s) => s.content)
  const surfaceId = useSpecStore((s) => s.selectedSurfaceId)
  const selectedNodeId = useSpecStore((s) => s.selectedNodeId)
  const selectNode = useSpecStore((s) => s.selectNode)
  const notes = useSpecStore((s) => s.notes)
  const addNote = useSpecStore((s) => s.addNote)
  const toggleNote = useSpecStore((s) => s.toggleNote)
  const removeNote = useSpecStore((s) => s.removeNote)
  const [body, setBody] = useState('')
  const [showResolved, setShowResolved] = useState(false)

  if (!surfaceId || !content) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[13px] text-muted">
        고른 화면이 없어요.
      </div>
    )
  }

  const submit = (): void => {
    if (!body.trim()) return
    void addNote(selectedNodeId ?? '', body)
    setBody('')
  }

  const open = notes.filter((n) => n.resolved === 0)
  const resolved = notes.filter((n) => n.resolved === 1)
  const shown = showResolved ? [...open, ...resolved] : open

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[12px] font-semibold tracking-wide text-muted">의견</span>
        {resolved.length > 0 && (
          <button
            className="text-[11px] text-muted hover:text-fg"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? '해결한 것 숨기기' : `해결한 것 ${resolved.length}개 보기`}
          </button>
        )}
      </div>

      <div className="shrink-0 border-b border-line p-3">
        <div className="mb-1.5 text-[12px] text-muted">
          {selectedNodeId ? (
            <>
              <span className="font-medium text-fg">{targetLabel(content, selectedNodeId)}</span> 에 남깁니다
            </>
          ) : (
            '이 화면 전체에 남깁니다 — 요소를 누르면 그 요소에 붙습니다'
          )}
        </div>
        <textarea
          data-uiux-note-input
          className="h-16 w-full resize-none rounded-md border border-line bg-canvas px-2 py-1.5 text-[13px] outline-none focus:border-accent"
          placeholder="여기를 이렇게 고쳐 주세요"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // 줄바꿈은 그대로 두고, 보내기는 손을 하나 더 얹어야 한다(실수로 날아가지 않게).
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[11px] text-muted">⌘/Ctrl + Enter</span>
          <Button size="sm" disabled={!body.trim()} onClick={submit}>
            남기기
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {shown.length === 0 && (
          <p className="px-1 py-6 text-center text-[13px] text-muted">아직 의견이 없어요.</p>
        )}
        <ul className="flex flex-col gap-1.5">
          {shown.map((note) => {
            const gone = note.target !== '' && !targetExists(content, note.target)
            return (
              <li
                key={note.id}
                data-uiux-note={note.id}
                className={cx(
                  'group rounded-md border border-line bg-canvas p-2',
                  note.resolved === 1 && 'opacity-55'
                )}
              >
                <button
                  className="mb-1 flex w-full items-center gap-1.5 text-left"
                  onClick={() => note.target && selectNode(note.target)}
                >
                  <span
                    className={cx(
                      'truncate text-[11px]',
                      gone ? 'text-destructive' : note.target ? 'text-accent' : 'text-muted'
                    )}
                  >
                    {note.target
                      ? gone
                        ? `${note.target} (지워진 요소)`
                        : targetLabel(content, note.target)
                      : '화면 전체'}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <span
                      role="button"
                      title={note.resolved === 1 ? '다시 열기' : '해결로 표시'}
                      className="rounded p-1 text-muted hover:text-fg"
                      onClick={(e) => {
                        e.stopPropagation()
                        void toggleNote(note.id, note.resolved === 0)
                      }}
                    >
                      {note.resolved === 1 ? <RotateCcw size={12} /> : <Check size={13} />}
                    </span>
                    <span
                      role="button"
                      title="지우기"
                      className="rounded p-1 text-muted hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeNote(note.id)
                      }}
                    >
                      <Trash2 size={12} />
                    </span>
                  </span>
                </button>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{note.body}</p>
              </li>
            )
          })}
        </ul>
      </div>

      <p className="shrink-0 border-t border-line p-3 text-[12px] leading-relaxed text-muted">
        여기 남긴 의견은 에이전트가 MCP 로 읽습니다 — 좌표가 아니라 요소에 붙어 있어 어느 것에 대한
        말인지 정확히 전달됩니다.
      </p>
    </div>
  )
}

/** 요소 id → 사람이 읽는 이름. 지워진 요소면 id 를 그대로(무엇이 사라졌는지 보이게). */
function targetLabel(content: SurfaceContent, target: string): string {
  const found = findComponent(content, target)
  if (found) return found.component.label || kindLabel(found.component.type)
  const section = findSection(content, target)
  if (section) return section.name || target
  return target
}

function targetExists(content: SurfaceContent, target: string): boolean {
  return findComponent(content, target) !== null || findSection(content, target) !== null
}
