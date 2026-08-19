import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { Input } from '@renderer/ui/input'
import { ClipToggle, clipBox, useClipped } from '@renderer/ui/clipped'
import { cn } from '@renderer/lib/utils'
import type { Suggestion } from '../../typeCatalog'
import { useDefinitionStore } from './store'

/** 매칭된 부분을 강조해 렌더 (자동완성 드롭다운용). */
function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim()
  const i = q ? text.toUpperCase().indexOf(q.toUpperCase()) : -1
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <span className="font-bold text-accent">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  )
}

/**
 * 클릭 → Input 편집. commit=Enter/blur, cancel=Esc. 편집 상태는 스토어 editing 키로 공유.
 *
 * suggest 가 주어지면 편집 중 자동완성 드롭다운을 띄운다(방언별 타입/디폴트 카탈로그).
 *  - ↑/↓ 이동, Enter 선택, Esc 1회=드롭다운 닫기 · 2회=편집 취소
 *  - 제안은 돕기만 한다 — 목록에 없는 값도 그대로 커밋 가능
 *  - 그리드의 overflow 클리핑을 피해 포털(fixed)로 렌더한다
 */
export function EditableText({
  editKey,
  value,
  onCommit,
  mono,
  placeholder,
  className,
  inputClassName,
  suggest,
  suggestFooter,
  warnTitle,
  readOnly
}: {
  editKey: string
  value: string
  onCommit: (next: string) => void
  mono?: boolean
  placeholder?: string
  className?: string
  inputClassName?: string
  /** 입력값 → 제안 목록. 있으면 편집 중 자동완성 드롭다운이 뜬다. */
  suggest?: (query: string) => Suggestion[]
  /** 드롭다운 하단 안내문 (예: "목록에 없는 타입도 입력 가능"). */
  suggestFooter?: string
  /** 표시 모드에서 ⚠ 배지 + 툴팁 (advisory — 예: 카탈로그에 없는 타입). */
  warnTitle?: string
  /** 읽기 전용(과거 버전 열람 등) — 클릭 편집 비활성, 정적 텍스트로 표시. */
  readOnly?: boolean
}) {
  const editing = useDefinitionStore((s) => s.editing)
  const setEditing = useDefinitionStore((s) => s.setEditing)
  const isEditing = editing === editKey
  const [draft, setDraft] = useState(value)
  const [hi, setHi] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // 잘렸을 때만 이 칸에 펼침 손잡이가 붙는다 — 표 머리의 "전문 보기" 를 대신한다.
  const clip = useClipped<HTMLDivElement>(value)

  useEffect(() => {
    if (isEditing) {
      setDraft(value)
      setHi(0)
      setDismissed(false)
    }
  }, [isEditing, value])

  const items = isEditing && suggest && !dismissed ? suggest(draft) : []
  const open = items.length > 0

  // 드롭다운 위치 — 그리드 overflow 클리핑을 피해 fixed 포털로 띄운다.
  useLayoutEffect(() => {
    if (isEditing && inputRef.current) setRect(inputRef.current.getBoundingClientRect())
  }, [isEditing, draft])

  /**
   * 펼치면 자르지 않고 줄을 바꾼다 — 높이 고정도 함께 푼다.
   * 잘린 글자를 보는 길은 이제 **칸에 붙는 ⌄** 하나다: 호버 툴팁(`title`)은 걷어냈다.
   * 마우스를 올려야 나오는 것은 없는 것과 같고(2026-08-12: "전체 내용을 볼 수 있는 방법이 없어"),
   * 손잡이가 보이는 지금은 같은 일을 두 번 하는 꼴이다(2026-08-12: "내장 tooltip쓰는거 싫어해").
   */
  /*
   * 폭은 **바깥 상자**가 정하고 여기는 남는 자리를 받는다(`flex-1`). `w-full`(=100%)이었을 때
   * 옆에 붙은 ⌄ 만큼이 칸 밖으로 밀려 나가, Comment 칸의 손잡이가 행 ⋯ 메뉴 밑에 깔려
   * **눌리지 않았다**(2026-08-13 실측: `elementFromPoint` 가 "컬럼 메뉴"를 집었다).
   */
  const box = clip.expanded
    ? 'min-h-7 min-w-0 flex-1 items-start rounded px-1 py-1 text-left'
    : 'h-7 min-w-0 flex-1 items-center rounded px-1 text-left'

  /** 글자 본체 — 자르거나 줄을 바꾸는 상자는 **이것**이다(여기를 재서 손잡이를 낼지 정한다). */
  const body = (
    <>
      {warnTitle && value && (
        <AlertTriangle size={11} className="mr-1 mt-1 shrink-0 self-start text-warning" aria-label="advisory" />
      )}
      <span ref={clip.ref} className={cn('min-w-0 flex-1', clipBox(clip.expanded))}>
        {value ? value : <span className="text-muted/50">{placeholder ?? '—'}</span>}
      </span>
    </>
  )

  const toggle = clip.clipped ? <ClipToggle expanded={clip.expanded} onToggle={clip.toggle} /> : null

  // 읽기 전용: 정적 텍스트. 펼침 손잡이는 그대로 — 읽기 전용이라고 글자가 짧아지진 않는다.
  if (readOnly) {
    return (
      <div className="flex min-w-0 items-start gap-0.5">
        <div
          title={warnTitle}
          className={cn(
            'flex',
            box,
            mono ? 'font-mono text-[12px] text-fg' : 'text-[13px] text-fg',
            className
          )}
        >
          {body}
        </div>
        {toggle}
      </div>
    )
  }

  if (isEditing) {
    const commitVal = (v: string) => {
      onCommit(v)
      setEditing(null)
    }
    return (
      <>
        <Input
          ref={inputRef}
          data-edit-input={editKey}
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setHi(0)
            setDismissed(false)
          }}
          onBlur={() => commitVal(draft)}
          onKeyDown={(e) => {
            if (open && e.key === 'ArrowDown') {
              e.preventDefault()
              setHi((hi + 1) % items.length)
            } else if (open && e.key === 'ArrowUp') {
              e.preventDefault()
              setHi((hi - 1 + items.length) % items.length)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              commitVal(open ? items[Math.min(hi, items.length - 1)].insert : draft)
            } else if (e.key === 'Escape') {
              if (open) setDismissed(true)
              else setEditing(null)
            }
          }}
          className={cn('h-7 px-2 py-0 text-[13px]', mono && 'font-mono text-[12px]', inputClassName)}
        />
        {open &&
          rect &&
          createPortal(
            <div
              className="fixed z-50 overflow-hidden rounded-lg border border-line bg-canvas shadow-lg"
              style={{
                top: rect.bottom + 4,
                left: rect.left,
                minWidth: Math.max(rect.width, 260)
              }}
            >
              {items.map((s, i) => (
                <button
                  key={s.insert}
                  type="button"
                  // blur(=commit)보다 클릭이 먼저 처리되도록 mousedown 을 막는다.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commitVal(s.insert)}
                  onMouseEnter={() => setHi(i)}
                  className={cn(
                    'flex w-full items-baseline justify-between gap-5 px-2.5 py-1.5 text-left transition-colors',
                    i === hi && 'bg-accent-soft'
                  )}
                >
                  <span className="font-mono text-[12px] text-fg">
                    {highlightMatch(s.insert, draft)}
                  </span>
                  {(s.hint || s.recommended) && (
                    <span
                      className={cn(
                        'whitespace-nowrap text-[11px]',
                        i === hi ? 'text-accent' : 'text-muted'
                      )}
                    >
                      {s.hint}
                      {s.recommended && ' · 권장'}
                    </span>
                  )}
                </button>
              ))}
              {suggestFooter && (
                <div className="border-t border-line bg-panel px-2.5 py-1.5 text-[10.5px] leading-relaxed text-muted">
                  {suggestFooter}
                </div>
              )}
            </div>,
            document.body
          )}
      </>
    )
  }

  return (
    <div className="flex min-w-0 items-start gap-0.5">
      <button
        type="button"
        data-edit-cell={editKey}
        onClick={() => setEditing(editKey)}
        title={warnTitle}
        className={cn(
          'flex transition-colors hover:bg-panel-strong/60',
          box,
          mono ? 'font-mono text-[12px] text-fg' : 'text-[13px] text-fg',
          className
        )}
      >
        {body}
      </button>
      {toggle}
    </div>
  )
}
