import { DownloadCloud, Info, Loader2 } from 'lucide-react'
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
import { dialectInfo } from '../dialects'
import { isEmptyDiff } from '../versions/diff'
import { useImportStore } from './importStore'

/**
 * 운영 DB → 설계 가져오기 다이얼로그. Migration 드리프트 뷰에서 열린다.
 * 실 DB 를 역설계한 미리보기를 보이고, 새 설계/새 버전으로 컷할 번호·이름·메모를 확정받는다.
 */
export function ImportDialog() {
  const st = useImportStore()
  const conn = st.connection
  if (!conn) return null

  const busy = st.phase === 'preparing' || st.phase === 'running'
  const info = dialectInfo(conn.dbType)
  const isNew = st.mode === 'new-design'
  const noChanges = st.hasPrevVersion && !!st.diff && isEmptyDiff(st.diff)
  const nameOk = !isNew || st.designName.trim().length > 0
  const canSubmit = st.phase === 'ready' && !!st.actual && st.number.trim().length > 0 && nameOk && !noChanges

  return (
    <Dialog open={st.open} onOpenChange={(o) => !o && !busy && st.close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>운영 DB 를 설계로 가져오기</DialogTitle>
          <DialogDescription>
            {isNew
              ? `연결 "${conn.name}" 의 실 DB 를 새 설계로 역설계하고 첫 버전을 만듭니다.`
              : `연결 "${conn.name}" 의 실 DB 를 설계 "${st.design?.name}" 의 새 버전으로 가져옵니다.`}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-4">
          {/* 대상 선택 — 활성 설계가 있을 때만(없으면 항상 새 설계). 통합 강조 세그먼트. */}
          {st.canVersionUp && (
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-panel p-1">
              {[
                { m: 'version-up' as const, label: '기존 설계에 버전 추가', active: !isNew },
                { m: 'new-design' as const, label: '새 설계 만들기', active: isNew }
              ].map(({ m, label, active }) => (
                <button
                  key={m}
                  type="button"
                  disabled={busy}
                  onClick={() => st.chooseMode(m)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-[12.5px] transition-colors',
                    active
                      ? 'bg-canvas font-semibold text-accent shadow-sm ring-1 ring-accent/25'
                      : 'font-medium text-muted hover:text-fg'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* 실 DB 역설계 미리보기 — 소스(운영)는 테라코타로 표식. */}
          {st.phase === 'preparing' ? (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-panel/60 px-3 py-3 text-[12.5px] text-muted">
              <Loader2 className="size-4 animate-spin" /> 실제 스키마를 읽는 중…
            </div>
          ) : st.actual ? (
            <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-panel/60 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[12.5px] text-fg">
                  <span className="size-1.5 rounded-full bg-accent-2" />
                  실 DB 에서 <b className="text-accent-2 tabular-nums">{st.actual.tables.length}</b>개 테이블을 읽음
                </div>
                <span className="truncate font-mono text-[11px] text-muted">{conn.name}</span>
              </div>

              {st.hasPrevVersion && st.diff ? (
                noChanges ? (
                  <p className="text-[12px] text-muted">최신 버전과 차이가 없습니다 — 가져올 변경이 없어요.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                      <span>테이블 <b className="text-success">+{st.diff.summary.tablesAdded}</b> <b className="text-accent-2">~{st.diff.summary.tablesModified}</b> <b className="text-destructive">−{st.diff.summary.tablesRemoved}</b></span>
                      <span>컬럼 <b className="text-success">+{st.diff.summary.columnsAdded}</b> <b className="text-accent-2">~{st.diff.summary.columnsModified}</b> <b className="text-destructive">−{st.diff.summary.columnsRemoved}</b></span>
                    </div>
                    <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto pr-1">
                      {st.diff.tables.map((t) => (
                        <span key={t.id} className={cn('rounded bg-panel-strong px-1.5 py-0.5 font-mono text-[11px]', t.status === 'added' ? 'text-success' : t.status === 'removed' ? 'text-destructive' : 'text-accent-2')}>
                          {t.status === 'added' ? '+' : t.status === 'removed' ? '−' : '~'} {t.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              ) : (
                <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto pr-1">
                  {st.actual.tables.map((t) => (
                    <span key={t.id} className="rounded bg-panel-strong px-1.5 py-0.5 font-mono text-[11px] text-muted">{t.name}</span>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* 새 설계 이름(새 설계 모드 전용) */}
          {isNew && (
            <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
              새 설계 이름
              <Input
                value={st.designName}
                onChange={(e) => st.setDesignName(e.target.value)}
                placeholder="예: commerce-core"
                className="h-9 font-mono text-[13px] font-normal"
                disabled={busy}
              />
              <span className="text-[11px] font-normal text-muted">
                벤더 <b className="font-semibold text-accent-2">{info.label}</b> · 연결에서 자동 결정돼요(설계의 고정 속성)
              </span>
            </label>
          )}

          {/* 버전 번호 · 메모 */}
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5 text-[12px] font-semibold text-fg">
              버전 번호
              <Input
                value={st.number}
                onChange={(e) => st.setNumber(e.target.value)}
                placeholder="v0.1.0"
                className="h-9 font-mono text-[13px] font-normal"
                disabled={busy}
              />
            </label>
            <label className="flex flex-[2] flex-col gap-1.5 text-[12px] font-semibold text-fg">
              메모 <span className="font-normal text-muted">(선택)</span>
              <Input
                value={st.note}
                onChange={(e) => st.setNote(e.target.value)}
                placeholder="예: 운영에서 직접 추가된 변경 흡수"
                className="h-9 text-[13px] font-normal"
                disabled={busy}
              />
            </label>
          </div>

          <p className="flex items-start gap-2 rounded-lg bg-accent-soft/50 px-3 py-2.5 text-[11.5px] leading-relaxed text-fg/80">
            <Info className="mt-[2px] size-3.5 shrink-0 text-accent" />
            <span>이 버전이 <b className="text-fg">{conn.name}</b> 의 적용 버전·드리프트 기준선이 되고, 연결↔설계 결속도 자동으로 세워집니다.</span>
          </p>

          {st.error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{st.error}</div>
          )}
        </div>

        <DialogFooter className="mt-1">
          <Button type="button" variant="ghost" size="sm" onClick={st.close} disabled={busy}>
            취소
          </Button>
          <Button type="button" size="sm" disabled={!canSubmit} onClick={() => void st.execute()}>
            {st.phase === 'running' ? <Loader2 className="animate-spin" /> : <DownloadCloud />}
            {isNew ? '설계 만들고 가져오기' : '새 버전으로 가져오기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
