import { useMemo, useState } from 'react'
import { Search, Sprout } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { filterTables } from '../../tableList'
import type { TableDef } from '../definition/types'
import { defaultNaturalKey, seedSetCandidates } from './seedSet'
import type { SeedSet } from './types'

/**
 * 시드 세트 등록 모달 — 설계 테이블 중에서 고른다.
 * 뷰와 이미 세트가 있는 테이블은 후보에서 빠진다(spec db-design.seed.set-list AC-2).
 * 검색은 공용 순수 로직(`db/tableList`)을 재사용한다.
 */
export function SeedSetDialog({
  open,
  onClose,
  tables,
  sets,
  onPick
}: {
  open: boolean
  onClose: () => void
  tables: TableDef[]
  sets: SeedSet[]
  onPick: (t: TableDef) => void
}) {
  const [q, setQ] = useState('')
  const candidates = useMemo(() => filterTables(seedSetCandidates(tables, sets), q), [tables, sets, q])

  const dismiss = (): void => {
    setQ('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && dismiss()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>시드 세트 만들기</DialogTitle>
          <DialogDescription>
            기준 데이터를 관리할 테이블을 고르세요. 뷰와 이미 세트가 있는 테이블은 목록에 없어요.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="테이블/컬럼 검색…"
            className="h-8 pl-7 text-[12px]"
          />
        </div>

        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          {candidates.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
              <Sprout className="size-5 text-muted/60" />
              <span className="text-[12px] text-muted">
                {tables.length === 0 ? '이 설계엔 테이블이 없어요' : '고를 수 있는 테이블이 없어요'}
              </span>
            </div>
          ) : (
            candidates.map((t) => {
              const key = defaultNaturalKey(t)
              return (
                <button
                  key={t.id}
                  type="button"
                  data-seed-candidate={t.name}
                  onClick={() => {
                    onPick(t)
                    dismiss()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left last:border-b-0',
                    'transition-colors hover:bg-panel'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{t.name}</span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {key.length ? (
                      <>
                        짝짓기 기준 <span className="font-mono">{key.join(', ')}</span>
                      </>
                    ) : (
                      '짝짓기 기준 선택 필요'
                    )}
                  </span>
                </button>
              )
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
