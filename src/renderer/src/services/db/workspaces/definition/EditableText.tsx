import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { Input } from '@renderer/ui/input'
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
  readOnly,
  full
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
  /** 표의 "전문 보기" — 자르지 않고 줄을 바꿔 전부 보인다. */
  full?: boolean
}) {
  const editing = useDefinitionStore((s) => s.editing)
  const setEditing = useDefinitionStore((s) => s.setEditing)
  const isEditing = editing === editKey
  const [draft, setDraft] = useState(value)
  const [hi, setHi] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
   * "전문 보기"가 켜지면 자르지 않고 줄을 바꾼다 — 높이도 고정을 푼다.
   * 호버 툴팁(`title`)은 그대로 두되, 그것만으로는 부족했다: 마우스를 올려야 나오는 것은
   * 사용자에게 **없는 것과 같다**(2026-08-12: "전체 내용을 볼 수 있는 방법이 없어").
   */
  const box = full
    ? 'min-h-7 w-full items-center whitespace-pre-wrap break-words rounded px-1 py-1 text-left'
    : 'h-7 w-full items-center truncate rounded px-1 text-left'

  // 읽기 전용: 정적 텍스트. (훅은 모두 위에서 호출된 뒤라 훅 순서 불변)
  if (readOnly) {
    return (
      <div
        title={warnTitle ?? (value || undefined)}
        className={cn(
          'flex',
          box,
          mono ? 'font-mono text-[12px] text-fg' : 'text-[13px] text-fg',
          className
        )}
      >
        {warnTitle && value && (
          <AlertTriangle size={11} className="mr-1 shrink-0 text-warning" aria-label="advisory" />
        )}
        {value ? value : <span className="text-muted/40">{placeholder ?? '—'}</span>}
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
    <button
      type="button"
      onClick={() => setEditing(editKey)}
      title={warnTitle ?? (value || undefined)} // 잘린 텍스트는 호버로도 전문 확인
      className={cn(
        'flex transition-colors hover:bg-panel-strong/60',
        box,
        mono ? 'font-mono text-[12px] text-fg' : 'text-[13px] text-fg',
        className
      )}
    >
      {warnTitle && value && (
        <AlertTriangle size={11} className="mr-1 shrink-0 text-warning" aria-label="advisory" />
      )}
      {value ? value : <span className="text-muted/50">{placeholder ?? '—'}</span>}
    </button>
  )
}
