import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Eye, Link2, Unlink } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/ui/select'
import { cn } from '@renderer/lib/utils'
import { dialectInfo } from '../../dialects'
import { designSchemas } from '../../scope'
import { displayName, hasMultipleSchemas, qualifiedName } from '../../schemaRef'
import { useDesignsStore, type DesignDef } from '../../designs/store'
import { DRAFT_LENS, useDesignVersions } from '../../versions/store'
import { mintDefinitionId, useDefinitionStore } from '../definition/store'
import { buildCopy, type CollisionMode, type CopyEntry } from './copyTables'
import type { TableDef } from '../definition/types'

/** "출처의 칸을 그대로" — Radix Select 는 빈 문자열을 값으로 못 써서 표식을 따로 둔다. */
const AS_IS = '__as-is__'

/** 이 줄이 떨어질 자리의 한정 이름 — `service2.orders_copy`. */
const destName = (e: CopyEntry): string => qualifiedName({ schema: e.schema, name: e.finalName })

/** 출처와 달라지나 — 스키마를 옮겼거나 이름이 겹쳐 바뀌었거나. */
const movedOrRenamed = (from: TableDef, e: CopyEntry): boolean =>
  (e.schema ?? '') !== (from.schema ?? '') || e.finalName !== from.name

/** 미리보기용 발급기 — 만든 것을 버리므로 진짜 번호를 소모하지 않는다. */
let previewSeq = 0
const previewMintId = (prefix: 'tbl' | 'col' | 'con'): string => `preview-${prefix}-${previewSeq++}`

/**
 * Design › Diagram — **테이블을 이 설계로 복제**하는 모달. 출처는 다른 설계일 수도 있고
 * **이 설계 자신일 수도 있다**(= 복붙 · 2026-08-20 사용자 요청).
 *
 * 복제이지 동기화가 아니다(2026-08-02 사용자 확인) — 떠 온 뒤로는 원본과 줄이 끊긴다.
 * 그래서 화면 첫 줄이 그 사실부터 말한다: "이어지지 않아요".
 *
 * 조용히 넘기면 안 되는 결정 셋을 여기서 묻는다(판정 로직은 `copyTables.ts`):
 *  - FK 로 엮인 테이블도 함께 가져올 것인가
 *  - 이름이 겹치면 복사본 이름을 줄 것인가, 건너뛸 것인가
 *  - 방언(벤더)이 다르면 타입 문자열이 그대로 넘어온다는 것
 */
export function ImportTablesDialog({
  open,
  onOpenChange,
  target
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: DesignDef
}) {
  const designs = useDesignsStore((s) => s.designs)
  const allTables = useDefinitionStore((s) => s.tables)
  const insertTables = useDefinitionStore((s) => s.insertTables)

  const [sourceId, setSourceId] = useState<string | null>(null)
  const [lens, setLens] = useState<string>(DRAFT_LENS)
  const [picked, setPicked] = useState<string[]>([])
  const [withRelated, setWithRelated] = useState(true)
  const [onCollision, setOnCollision] = useState<CollisionMode>('rename')
  const [into, setInto] = useState<string>(AS_IS)

  const versions = useDesignVersions(sourceId)
  const sourceDesign = designs.find((d) => d.id === sourceId) ?? null

  /*
   * 열 때마다 처음 상태로. designs 를 의존성에 넣지 않는다 — 목록이 갱신될 때마다 고른 것이 풀린다.
   *
   * 기본 출처는 **이 설계 자신**이다(2026-08-20 사용자 요청) — 창을 여는 가장 흔한 이유가
   * 남의 설계에서 떠 오는 것이 아니라 **여기 있는 표를 복붙**하는 것이라서다. 자기 자신을 고르면
   * 이름이 전부 겹치므로 `_copy` 가 붙어 들어온다(그게 복붙의 뜻이다).
   */
  useEffect(() => {
    if (!open) return
    setSourceId(target.id)
    setLens(DRAFT_LENS)
    setPicked([])
    setInto(AS_IS)
  }, [open, target.id])

  const sourceTables = useMemo(() => {
    if (!sourceId) return []
    if (lens === DRAFT_LENS) return allTables.filter((t) => t.designId === sourceId)
    return versions.find((v) => v.number === lens)?.snapshot.tables ?? []
  }, [sourceId, lens, allTables, versions])

  const existing = useMemo(() => allTables.filter((t) => t.designId === target.id), [allTables, target.id])

  /*
   * 받는 설계의 칸 목록 — **선언한 칸 + 실제로 쓰이는 칸**의 합집합이다.
   * 선언만 하고 아직 표가 없는 칸도 골라야 하고(그게 새 칸을 채우는 길이다), 선언 없이
   * 표에만 붙어 있는 칸도 골라야 한다(옛 데이터).
   */
  const intoOptions = useMemo(() => {
    const seen = new Set([...(target.declaredSchemas ?? []), ...designSchemas(existing)])
    return [...seen].filter(Boolean).sort()
  }, [target.declaredSchemas, existing])
  const intoSchema = into === AS_IS ? undefined : into
  /**
   * "그대로"가 무엇인지 **이름으로** 보인다 — `출처 그대로` 라고만 적으면 결과가 뭔지 모른다
   * (2026-08-20 사용자: "이게 뭔 소리인데?"). 출처가 한 스키마면 그 이름을, 안 적혀 있으면
   * "스키마 없음"을, 여러 개면 하나로 못 적으니 "출처에 적힌 대로"로 남긴다.
   */
  const asIsLabel = useMemo(() => {
    const used = designSchemas(sourceTables)
    if (used.length > 1) return '출처에 적힌 대로'
    return `${used[0] ?? '스키마 없음'} (출처와 같음)`
  }, [sourceTables])

  const preview = useMemo(
    () =>
      buildCopy({
        source: sourceTables,
        picked,
        existing,
        withRelated,
        onCollision,
        designId: target.id,
        intoSchema,
        mintId: previewMintId
      }),
    [sourceTables, picked, existing, withRelated, onCollision, target.id, intoSchema]
  )

  const entryById = useMemo(() => new Map(preview.entries.map((e) => [e.id, e])), [preview])
  const multiSchema = useMemo(() => hasMultipleSchemas(sourceTables), [sourceTables])
  const pickedSet = useMemo(() => new Set(picked), [picked])
  const dialectMismatch = sourceDesign != null && sourceDesign.dialect !== target.dialect

  const toggle = (id: string): void =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const submit = (): void => {
    const result = buildCopy({
      source: sourceTables,
      picked,
      existing,
      withRelated,
      onCollision,
      designId: target.id,
      intoSchema,
      mintId: mintDefinitionId
    })
    insertTables(result.tables)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-import-dialog className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>테이블 가져오기</DialogTitle>
          <DialogDescription>
            {sourceId === target.id ? (
              <>
                <b className="font-semibold text-fg">{target.name}</b> 안에서 <b className="font-semibold text-fg">복제</b>
                합니다 — 고른 표가 이름만 바꿔 하나씩 더 생겨요.
              </>
            ) : (
              <>
                <b className="font-semibold text-fg">{target.name}</b> 으로{' '}
                <b className="font-semibold text-fg">복제</b>합니다 — 원본과 이어지지 않아 이후 원본이 바뀌어도
                따라오지 않아요.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex items-center gap-2">
          <Select value={sourceId ?? undefined} onValueChange={(id) => { setSourceId(id); setLens(DRAFT_LENS); setPicked([]) }}>
            <SelectTrigger size="sm" data-import-source={sourceId ?? ''} className="flex-1 text-[13px]">
              <SelectValue placeholder="출처 설계" />
            </SelectTrigger>
            <SelectContent>
              {/* 자기 자신을 맨 위에 둔다 — 복붙이 이 창의 첫 쓰임이라 손이 먼저 닿아야 한다. */}
              {[...designs].sort((a, b) => (a.id === target.id ? -1 : b.id === target.id ? 1 : 0)).map((d) => (
                <SelectItem key={d.id} value={d.id} className="text-[13px]">
                  {d.name}
                  <span className="ml-1.5 text-[11px] text-muted">
                    {d.id === target.id ? '이 설계' : dialectInfo(d.dialect).label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={lens} onValueChange={(l) => { setLens(l); setPicked([]) }}>
            <SelectTrigger size="sm" className="w-44 font-mono text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DRAFT_LENS} className="font-mono text-[12px]">
                Draft
              </SelectItem>
              {versions.map((v) => (
                <SelectItem key={v.id} value={v.number} className="font-mono text-[12px]">
                  {v.number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {intoOptions.length > 0 && (
          <div className="mt-2 flex items-center gap-2 text-[12px] text-fg">
            <span className="shrink-0 text-muted">받는 스키마</span>
            <Select value={into} onValueChange={setInto}>
              <SelectTrigger size="sm" data-import-into={into} className="w-56 text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AS_IS} className="text-[12.5px]">
                  {asIsLabel}
                </SelectItem>
                {intoOptions.map((s) => (
                  <SelectItem key={s} value={s} className="font-mono text-[12.5px]">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {dialectMismatch && sourceDesign && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md bg-panel px-2.5 py-2 text-[11.5px] leading-relaxed text-muted">
            <AlertTriangle className="mt-[3px] size-3.5 shrink-0 text-accent-2" />
            <span>
              벤더가 다릅니다({dialectInfo(sourceDesign.dialect).label} →{' '}
              {dialectInfo(target.dialect).label}). 컬럼 타입은 적힌 글자 그대로 넘어오니 받은 뒤
              손봐야 할 수 있어요.
            </span>
          </p>
        )}

        <div className="mt-3 flex items-center justify-between px-0.5 text-[11px] text-muted">
          <span>
            테이블 {sourceTables.length}개
            {picked.length > 0 && ` · ${picked.length}개 선택`}
          </span>
          {sourceTables.length > 0 && (
            <button
              type="button"
              data-import-all
              className="text-[11px] text-muted outline-none hover:text-accent"
              onClick={() => setPicked(picked.length === sourceTables.length ? [] : sourceTables.map((t) => t.id))}
            >
              {picked.length === sourceTables.length ? '전체 해제' : '전체 선택'}
            </button>
          )}
        </div>

        <div className="mt-1 max-h-[38vh] overflow-auto rounded-lg border border-line">
          {sourceTables.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-muted">가져올 테이블 없음</div>
          ) : (
            sourceTables.map((t) => {
              const entry = entryById.get(t.id)
              const checked = pickedSet.has(t.id)
              return (
                <label
                  key={t.id}
                  data-import-row={t.name}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0',
                    checked ? 'bg-accent-soft' : 'hover:bg-panel'
                  )}
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(t.id)} />
                  <span className="flex-1 truncate font-mono text-[12.5px] text-fg">
                    {displayName(t, multiSchema)}
                  </span>
                  {t.isView && <Eye className="size-3.5 shrink-0 text-muted" />}
                  <span className="shrink-0 text-[11px] text-muted">컬럼 {t.columns.length}</span>
                  {entry?.related && (
                    <span className="shrink-0 rounded bg-panel-strong px-1.5 py-0.5 text-[10.5px] text-muted">
                      관계로 함께
                    </span>
                  )}
                  {entry?.skipped && (
                    <span
                      data-import-skip
                      className="shrink-0 rounded bg-panel-strong px-1.5 py-0.5 text-[10.5px] text-accent-2"
                    >
                      이름 겹침 · 건너뜀
                    </span>
                  )}
                  {/*
                    가는 곳을 **한정 이름 그대로** 찍는다(`service2.orders_copy`) — 스키마를 옮겼든
                    이름이 겹쳐 바뀌었든, 눌렀을 때 무엇이 생기는지 이 한 줄이 답한다.
                    그대로 들어오는 줄에는 아무것도 안 붙인다(안 바뀌는 것을 적으면 소음이다).
                  */}
                  {entry && !entry.skipped && movedOrRenamed(t, entry) && (
                    <span
                      data-import-dest={destName(entry)}
                      data-import-rename={entry.finalName !== entry.name ? entry.finalName : undefined}
                      className="shrink-0 rounded bg-panel-strong px-1.5 py-0.5 font-mono text-[10.5px] text-accent-2"
                    >
                      → {destName(entry)}
                    </span>
                  )}
                </label>
              )
            })
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-fg">
            <Checkbox checked={withRelated} onCheckedChange={(v) => setWithRelated(v === true)} />
            FK 로 엮인 테이블도 함께
          </label>

          <div className="flex items-center gap-2 text-[12px] text-fg">
            이름이 겹치면
            <div className="flex overflow-hidden rounded-md border border-line">
              {(
                [
                  ['rename', '복사본 이름'],
                  ['skip', '건너뛰기']
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={onCollision === mode}
                  data-import-collision={mode}
                  onClick={() => setOnCollision(mode)}
                  className={cn(
                    'px-2.5 py-1 text-[11.5px] transition-colors outline-none',
                    onCollision === mode ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-panel'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {(preview.droppedFks.length > 0 || preview.linkedFks.length > 0) && (
          <div className="mt-2 flex flex-col gap-1 rounded-md bg-panel px-2.5 py-2 text-[11.5px] leading-relaxed text-muted">
            {preview.droppedFks.length > 0 && (
              <p className="flex items-start gap-1.5">
                <Unlink className="mt-[3px] size-3.5 shrink-0" />
                <span>
                  관계 {preview.droppedFks.length}개는 대상을 안 가져와 빠집니다 —{' '}
                  <span className="font-mono">{preview.droppedFks.map((f) => f.target).join(', ')}</span>
                </span>
              </p>
            )}
            {preview.linkedFks.length > 0 && (
              <p className="flex items-start gap-1.5">
                <Link2 className="mt-[3px] size-3.5 shrink-0" />
                <span>
                  관계 {preview.linkedFks.length}개는 <b className="font-semibold text-fg">{target.name}</b> 의
                  같은 이름 테이블로 이어집니다 —{' '}
                  <span className="font-mono">{preview.linkedFks.map((f) => f.target).join(', ')}</span>
                </span>
              </p>
            )}
          </div>
        )}

        <DialogFooter className="mt-4 items-center">
          <span className="mr-auto text-[12px] text-muted">
            {preview.tables.length > 0 ? `${preview.tables.length}개 복제` : ''}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            data-import-submit={preview.tables.length}
            disabled={preview.tables.length === 0}
            onClick={submit}
          >
            가져오기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
