import { Loader2, RotateCcw } from 'lucide-react'
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
import { isEmptyDiff } from './diff'
import { useRestoreStore } from './restoreStore'
import { isEmptySeedDiff } from './seedDiff'

/**
 * 버전 → Draft 되돌리기 확인 창.
 *
 * 파괴적 조작이라 **무엇이 바뀌는지 보고 나서** 결정하게 한다. 예전엔 `window.confirm` 한 줄로
 * "테이블 N개로 덮어써요"만 말했는데, 그 숫자만으로는 무엇을 잃는지 알 수 없었다.
 */
export function RestoreDraftDialog() {
  const st = useRestoreStore()
  const target = st.target
  if (!target) return null

  const diff = st.diff
  const seedDiff = st.seedDiff
  // 시드만 다른 되돌리기도 할 일이 있는 되돌리기다 — 스키마 diff 만 보면 버튼이 잠겼다.
  const same = !!diff && isEmptyDiff(diff) && (!seedDiff || isEmptySeedDiff(seedDiff))

  return (
    <Dialog open={st.open} onOpenChange={(o) => !o && !st.running && st.close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Draft 를 <span className="font-mono text-accent-2">{target.number}</span> 로 되돌리기
          </DialogTitle>
          <DialogDescription>
            지금 편집본이 이 버전의 모습으로 바뀝니다. 실 DB 는 건드리지 않아요.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-4">
          {/* 미리보기 — 지금 Draft 에서 그 버전으로 갈 때의 변경. */}
          <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-panel/60 p-3">
            {same ? (
              <p className="text-[12.5px] text-muted">지금 Draft 와 같습니다 — 바뀌는 것이 없어요.</p>
            ) : diff && !isEmptyDiff(diff) ? (
              <>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                  <span>
                    테이블 <b className="text-success">+{diff.summary.tablesAdded}</b>{' '}
                    <b className="text-accent-2">~{diff.summary.tablesModified}</b>{' '}
                    <b className="text-destructive">−{diff.summary.tablesRemoved}</b>
                  </span>
                  <span>
                    컬럼 <b className="text-success">+{diff.summary.columnsAdded}</b>{' '}
                    <b className="text-accent-2">~{diff.summary.columnsModified}</b>{' '}
                    <b className="text-destructive">−{diff.summary.columnsRemoved}</b>
                  </span>
                </div>
                <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto pr-1">
                  {diff.tables.map((t) => (
                    <span
                      key={t.id}
                      className={cn(
                        'rounded bg-panel-strong px-1.5 py-0.5 font-mono text-[11px]',
                        t.status === 'added'
                          ? 'text-success'
                          : t.status === 'removed'
                            ? 'text-destructive'
                            : 'text-accent-2'
                      )}
                    >
                      {t.status === 'added' ? '+' : t.status === 'removed' ? '−' : '~'} {t.name}
                    </span>
                  ))}
                </div>
                {/* 없어지는 것이 있을 때만 경고 — 늘기만 하는 되돌리기는 겁줄 일이 아니다. */}
                {diff.summary.tablesRemoved > 0 && (
                  <p className="text-[11.5px] text-destructive">
                    테이블 {diff.summary.tablesRemoved}개가 Draft 에서 사라집니다.
                  </p>
                )}
              </>
            ) : null}

            {/* 시드 — 스키마와 함께 되돌아간다. 담긴 적 없는 버전이면 대신 그 사실을 말한다. */}
            {!same && seedDiff && !isEmptySeedDiff(seedDiff) && (
              <div data-restore-seed className="flex flex-col gap-1">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                  <span>
                    시드 세트 <b className="text-success">+{seedDiff.summary.setsAdded}</b>{' '}
                    <b className="text-accent-2">~{seedDiff.summary.setsModified}</b>{' '}
                    <b className="text-destructive">−{seedDiff.summary.setsRemoved}</b>
                  </span>
                  <span>
                    시드 행 <b className="text-success">+{seedDiff.summary.rowsAdded}</b>{' '}
                    <b className="text-accent-2">~{seedDiff.summary.rowsModified}</b>{' '}
                    <b className="text-destructive">−{seedDiff.summary.rowsRemoved}</b>
                  </span>
                </div>
                {seedDiff.summary.rowsRemoved > 0 && (
                  <p className="text-[11.5px] text-destructive">
                    시드 {seedDiff.summary.rowsRemoved}행이 Draft 에서 사라집니다.
                  </p>
                )}
              </div>
            )}
            {st.seedUnrecorded && (
              <p data-restore-seed-unrecorded className="text-[11.5px] text-muted">
                이 버전엔 시드 기록이 없어요 — 시드는 그대로 둡니다.
              </p>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-panel/50 px-3 py-2.5">
            <Checkbox
              checked={st.keepBackup}
              onCheckedChange={(v) => st.setKeepBackup(v === true)}
              disabled={st.running}
              className="mt-[1px]"
              data-keep-backup
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[12.5px] font-semibold text-fg">덮기 전에 지금 Draft 를 버전으로</span>
              <span className="text-[11.5px] leading-relaxed text-muted">
                되돌린 게 아니다 싶으면 그 버전으로 다시 돌아올 수 있어요.
              </span>
            </span>
          </label>

          {st.error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {st.error}
            </div>
          )}
        </div>

        <DialogFooter className="mt-1">
          <Button type="button" variant="ghost" size="sm" onClick={st.close} disabled={st.running}>
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            data-restore-confirm
            disabled={st.running || same}
            onClick={() => void st.execute()}
          >
            {st.running ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            되돌리기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
