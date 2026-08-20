import { useEffect, useMemo, useState } from 'react'
import { Button } from '@renderer/ui/button'
import { Checkbox } from '@renderer/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { displayName, hasMultipleSchemas } from '../../schemaRef'
import { buildColumnCopy, rowSummary, type ColumnCollision } from './copyColumns'
import { parseColumns } from './pasteColumns'
import type { ColumnSetRecord } from '@shared/db/columnSet'
import { mintDefinitionId, useDefinitionStore } from './store'
import type { TableDef } from './types'

/**
 * **이 표의 컬럼을 다른 표들에 한 번에 넣는** 모달 (2026-08-20 사용자 요청:
 * "동일 컬럼을 여러 테이블에 추가할 때… 엑셀이라면 복사해서 붙여넣기로 처리할 텐데").
 *
 * 출처는 **지금 보고 있는 표로 고정**이다 — 이 창은 그 표의 메뉴에서 열리고, 다른 표에서
 * 뿌리고 싶으면 그 표를 열면 된다. 출처 고르는 칸을 하나 더 두면 "지금 보는 표"와 "고른 표"가
 * 어긋날 수 있고, 그 어긋남은 넣고 나서야 드러난다.
 *
 * 뷰(view)는 대상에서 뺀다 — 뷰의 결과 컬럼은 본문 SELECT 가 정하는 것이라 밖에서 꽂을 수 없다.
 *
 * 컬럼을 **어디서 가져오나**는 둘이다(2026-08-20):
 *  · `이 표에서` — 지금 보고 있는 표의 컬럼을 고른다.
 *  · `붙여넣기` — 엑셀·DDL·이 앱의 복사 글자를 붙인다(해석 규칙은 `pasteColumns`).
 *  · `묶음` — 저장해 둔 컬럼 세트에서 꺼낸다. 묶음은 **설계에 안 매인다**(재활용이 존재 이유).
 * 창을 둘로 가르지 않은 이유: "넣을 표 고르기 · 겹치면 어떻게 · 미리보기"가 둘 다 똑같다.
 * 문을 둘 만들면 사람이 어느 문으로 들어가야 하는지부터 정해야 한다.
 */
export function AddColumnsDialog({
  open,
  onOpenChange,
  source
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 컬럼을 꺼내 올 표 — 지금 보고 있는 표. */
  source: TableDef
}) {
  const allTables = useDefinitionStore((s) => s.tables)
  const applyTables = useDefinitionStore((s) => s.applyTables)

  const [pickedCols, setPickedCols] = useState<string[]>([])
  const [pickedTargets, setPickedTargets] = useState<string[]>([])
  const [onCollision, setOnCollision] = useState<ColumnCollision>('skip')
  const [mode, setMode] = useState<SourceMode>('table')
  const [pasted, setPasted] = useState('')
  const [sets, setSets] = useState<ColumnSetRecord[]>([])
  const [setId, setSetId] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')

  useEffect(() => {
    if (!open) return
    setPickedCols([])
    setPickedTargets([])
    setOnCollision('skip')
    setMode('table')
    setPasted('')
    setSetId(null)
    setSaveName('')
    // 다른 창에서 만든 묶음도 보여야 한다 — 열 때마다 저장소에서 다시 읽는다.
    void window.rockury.columnSets.list().then(setSets)
  }, [open, source.id])

  // 기본 타입은 `addColumn` 이 쓰는 것과 같게 — 타입 없이 이름만 붙여넣었을 때 채운다.
  const parsed = useMemo(() => parseColumns(pasted, 'VARCHAR(255)'), [pasted])

  /*
   * 붙여넣은 것은 **다 고른 상태**로 시작한다 — 붙였다는 것 자체가 "이걸 넣겠다"는 뜻이다.
   * 글자가 바뀌면 다시 맞춘다: 임시 id 가 자리 순번이라, 안 맞추면 고른 것이 엉뚱한 줄로 옮겨간다.
   */
  useEffect(() => {
    if (mode !== 'paste') return
    setPickedCols(parsed.columns.map((c) => c.id))
  }, [mode, parsed])

  const candidates = useMemo(
    () => allTables.filter((t) => t.designId === source.designId && t.id !== source.id && !t.isView),
    [allTables, source.designId, source.id]
  )
  const multiSchema = useMemo(() => hasMultipleSchemas(candidates), [candidates])

  /** 고른 묶음의 컬럼 — 저장된 것엔 id 가 없으니 화면에서 쓸 임시 id 를 붙인다. */
  const setColumns = useMemo(() => {
    const hit = sets.find((s) => s.id === setId)
    return (hit?.columns ?? []).map((c, i) => ({ ...c, id: `set-${i}` }))
  }, [sets, setId])

  const available = mode === 'table' ? source.columns : mode === 'paste' ? parsed.columns : setColumns

  // 묶음을 고르면 그 안의 컬럼을 다 고른 상태로 — 묶음을 고른 것 자체가 "이걸 넣겠다"는 뜻이다.
  useEffect(() => {
    if (mode !== 'set') return
    setPickedCols(setColumns.map((c) => c.id))
  }, [mode, setColumns])

  const columns = useMemo(
    () => available.filter((c) => pickedCols.includes(c.id)),
    [available, pickedCols]
  )
  const targets = useMemo(
    () => candidates.filter((t) => pickedTargets.includes(t.id)),
    [candidates, pickedTargets]
  )

  // 미리보기는 **넣을 때와 같은 계산**이다 — 발급기만 버리는 것으로 바꿔 끼운다.
  const preview = useMemo(
    () => buildColumnCopy({ columns, targets: candidates, onCollision, mintId: () => 'preview' }),
    [columns, candidates, onCollision]
  )
  const rowOf = useMemo(() => new Map(preview.rows.map((r) => [r.tableId, r])), [preview])
  const changing = targets.length > 0 && columns.length > 0
    ? preview.rows.filter((r) => pickedTargets.includes(r.tableId) && (r.added.length > 0 || r.overwritten.length > 0)).length
    : 0

  const toggle = (list: string[], set: (v: string[]) => void, id: string): void =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const submit = (): void => {
    const result = buildColumnCopy({ columns, targets, onCollision, mintId: () => mintDefinitionId('col') })
    applyTables(result.tables)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-addcols-dialog className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>다른 테이블에도 넣기</DialogTitle>
          <DialogDescription>
            {mode === 'table' && (
              <>
                <b className="font-semibold text-fg">{source.name}</b> 의 컬럼을 고른 테이블에 그대로 더합니다.
              </>
            )}
            {mode === 'paste' && <>붙여넣은 컬럼을 고른 테이블에 그대로 더합니다.</>}
            {mode === 'set' && <>저장해 둔 묶음의 컬럼을 고른 테이블에 그대로 더합니다.</>}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Section
            title="넣을 컬럼"
            count={pickedCols.length}
            right={
              <div className="flex overflow-hidden rounded border border-line">
                {(
                  [
                    ['table', '이 표에서'],
                    ['paste', '붙여넣기'],
                    ['set', '묶음']
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    data-addcols-mode={m}
                    onClick={() => {
                      setMode(m)
                      setPickedCols([])
                    }}
                    className={cn(
                      'px-1.5 py-0.5 text-[10.5px] outline-none transition-colors',
                      mode === m ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-panel'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {mode === 'paste' && (
              <div className="border-b border-line p-2">
                <textarea
                  data-addcols-paste
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  spellCheck={false}
                  placeholder={'엑셀·DDL·복사한 컬럼 줄을 붙여넣으세요\ncreated_at\tDATETIME\tNOT NULL'}
                  className="h-20 w-full resize-none rounded border border-line bg-canvas px-2 py-1.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                {/* 못 읽은 줄은 **말해 준다** — 조용히 빠지면 넣고 나서야 빈 것을 안다. */}
                {parsed.dropped.length > 0 && (
                  <p data-addcols-dropped={parsed.dropped.length} className="mt-1 truncate text-[10.5px] text-accent-2">
                    못 읽은 줄 {parsed.dropped.length}개: {parsed.dropped.join(' · ')}
                  </p>
                )}
              </div>
            )}
            {mode === 'set' && (
              <div className="flex flex-wrap gap-1 border-b border-line p-2">
                {sets.length === 0 ? (
                  <span className="px-1 py-0.5 text-[11.5px] text-muted">저장해 둔 묶음 없음</span>
                ) : (
                  sets.map((s) => (
                    <span key={s.id} className="flex items-center overflow-hidden rounded border border-line">
                      <button
                        type="button"
                        data-addcols-set={s.name}
                        aria-pressed={setId === s.id}
                        onClick={() => setSetId(s.id)}
                        className={cn(
                          'px-2 py-0.5 text-[11.5px] outline-none transition-colors',
                          setId === s.id ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-panel'
                        )}
                      >
                        {s.name}
                        <span className="ml-1 text-[10px] text-muted">{s.columns.length}</span>
                      </button>
                      {/* 지우기는 묶음마다 — 관리 화면을 따로 만들 만큼의 일이 아니다. */}
                      <button
                        type="button"
                        data-addcols-set-delete={s.name}
                        aria-label={`${s.name} 묶음 삭제`}
                        onClick={() => {
                          void window.rockury.columnSets.delete(s.id).then(() => {
                            setSets((prev) => prev.filter((x) => x.id !== s.id))
                            if (setId === s.id) setSetId(null)
                          })
                        }}
                        className="border-l border-line px-1.5 py-0.5 text-[11px] text-muted outline-none hover:text-danger"
                      >
                        ✕
                      </button>
                    </span>
                  ))
                )}
              </div>
            )}
            {available.length === 0 ? (
              <Empty>
                {mode === 'paste' ? '붙여넣은 것 없음' : mode === 'set' ? '묶음을 고르세요' : '컬럼 없음'}
              </Empty>
            ) : (
              available.map((c) => (
                <Row
                  key={c.id}
                  hook="data-addcols-col"
                  value={c.name}
                  checked={pickedCols.includes(c.id)}
                  onToggle={() => toggle(pickedCols, setPickedCols, c.id)}
                >
                  {/*
                    이름이 먼저다 — 타입을 `shrink-0` 으로 두면 `ENUM('pending','confirmed',…)` 같은
                    긴 타입이 자리를 다 먹어 **이름이 통째로 사라진다**(2026-08-20 실측).
                    그래서 이름은 안 줄고(`shrink-0`), 좁아지면 타입이 먼저 잘린다.
                  */}
                  <span className="shrink-0 truncate font-mono text-[12.5px] text-fg">{c.name}</span>
                  <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-muted">{c.type}</span>
                </Row>
              ))
            )}
          </Section>

          <Section title="넣을 테이블" count={pickedTargets.length}>
            {candidates.length === 0 ? (
              <Empty>다른 테이블 없음</Empty>
            ) : (
              candidates.map((t) => {
                const summary = rowOf.get(t.id)
                return (
                  <Row
                    key={t.id}
                    hook="data-addcols-target"
                    value={t.name}
                    checked={pickedTargets.includes(t.id)}
                    onToggle={() => toggle(pickedTargets, setPickedTargets, t.id)}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">
                      {displayName(t, multiSchema)}
                    </span>
                    {/* 고른 표에만 결과를 적는다 — 안 고른 줄에까지 적으면 목록이 글자로 덮인다. */}
                    {pickedTargets.includes(t.id) && summary && (
                      <span
                        data-addcols-summary={rowSummary(summary)}
                        className="min-w-0 shrink-[2] truncate font-mono text-[10.5px] text-accent-2"
                      >
                        {rowSummary(summary)}
                      </span>
                    )}
                  </Row>
                )
              })
            )}
          </Section>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[12px] text-fg">
          이름이 겹치면
          <div className="flex overflow-hidden rounded-md border border-line">
            {(
              [
                ['skip', '그대로 두기'],
                ['overwrite', '값 덮어쓰기']
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={onCollision === mode}
                data-addcols-collision={mode}
                onClick={() => setOnCollision(mode)}
                className={cn(
                  'px-2.5 py-1 text-[11.5px] outline-none transition-colors',
                  onCollision === mode ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-panel'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {/* 덮어쓸 때만 밝힌다 — 이름·자리는 안 건드리고 값만 간다는 것이 자명하지 않다. */}
          {onCollision === 'overwrite' && (
            <span className="min-w-0 truncate text-[11px] text-muted">
              타입·NULL·기본값·설명만 갑니다 (걸린 제약은 그대로)
            </span>
          )}
        </div>

        {mode !== 'set' && columns.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <input
              data-addcols-save-name
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="고른 컬럼을 묶음으로 저장 (이름)"
              className="min-w-0 flex-1 rounded border border-line bg-canvas px-2 py-1 text-[12px] text-fg outline-none placeholder:text-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-addcols-save
              disabled={saveName.trim() === ''}
              onClick={() => {
                // 저장은 **id 를 뺀 값**만 — 넣을 때 대상마다 새로 발급하므로 담아 둘 뜻이 없다.
                const payload = columns.map(({ name, type, nullable, defaultValue, comment }) => ({
                  name,
                  type,
                  nullable,
                  defaultValue,
                  comment
                }))
                void window.rockury.columnSets.create(saveName.trim(), payload).then((made) => {
                  setSets((prev) => [...prev, made].sort((a, b) => a.name.localeCompare(b.name)))
                  setSaveName('')
                })
              }}
            >
              묶음으로 저장
            </Button>
          </div>
        )}

        <DialogFooter className="mt-4 items-center">
          <span className="mr-auto text-[12px] text-muted">{changing > 0 ? `${changing}개 테이블이 바뀝니다` : ''}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button type="button" size="sm" data-addcols-submit={changing} disabled={changing === 0} onClick={submit}>
            넣기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 컬럼을 어디서 가져오나 — 이 표에서 고르거나, 붙여넣거나. */
type SourceMode = 'table' | 'paste' | 'set'

function Section({
  title,
  count,
  right,
  children
}: {
  title: string
  count: number
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-1 flex items-center gap-1.5 px-0.5 text-[11px] text-muted">
        <span>{title}</span>
        {count > 0 && <span className="tabular-nums">{count}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="max-h-[34vh] min-h-[9rem] overflow-auto rounded-lg border border-line">{children}</div>
    </div>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="py-10 text-center text-[12.5px] text-muted">{children}</div>
)

function Row({
  hook,
  value,
  checked,
  onToggle,
  children
}: {
  hook: string
  value: string
  checked: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <label
      {...{ [hook]: value }}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-1.5 last:border-b-0',
        checked ? 'bg-accent-soft' : 'hover:bg-panel'
      )}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      {children}
    </label>
  )
}
