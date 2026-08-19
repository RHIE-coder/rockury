import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Download, Info, Layers, Loader2 } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
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
import { dialectInfo } from '../dialects'
import { tableLabel } from '../ids'
import { ScopeMenu } from '../connections/ScopeMenu'
import { useScopedConnections } from '../connections/store'
import { reconcileScope, scopeModel, scopeSummary, shownScope, toggleSchema } from '../scope'
import { useDefinitionStore } from '../workspaces/definition/store'
import { isEmptyDiff } from '../versions/diff'
import { checkImportNumber } from './importSchema'
import { useImportStore } from './importStore'

/**
 * 운영 DB → 설계 가져오기 다이얼로그. Migration 드리프트 뷰에서 열린다.
 * 실 DB 를 역설계한 미리보기를 보이고, 새 설계/새 버전으로 컷할 번호·이름·메모를 확정받는다.
 */
export function ImportDialog() {
  const st = useImportStore()
  const connections = useScopedConnections()
  // 지금 설계에 든 테이블 수 — 덮어쓰기 전에 무엇이 바뀌는지 숫자로 보인다.
  // **훅은 조기 return 위에서 전부 부른다** — 아래로 내리면 창이 닫힌 렌더와 열린 렌더의
  // 훅 개수가 달라져 화면이 통째로 죽는다(실측).
  const draftCount = useDefinitionStore((s) =>
    st.design ? s.tables.filter((t) => t.designId === st.design!.id).length : 0
  )
  const conn = st.connection
  if (!conn) return null

  const busy = st.phase === 'preparing' || st.phase === 'running'
  const info = dialectInfo(conn.dbType)
  const isNew = st.mode === 'new-design'
  const noChanges = st.hasPrevVersion && !!st.diff && isEmptyDiff(st.diff)
  const nameOk = !isNew || st.designName.trim().length > 0
  // 버전 차이가 없어도 **설계 반영은 남아 있다** — 그때는 번호도 필요 없다(버전을 안 만드니까).
  const draftOnly = noChanges && st.applyToDraft && !isNew
  // 번호는 사람이 직접 적는 유일한 컷 입구다 — 형식·중복을 여기서 보고 못 쓰면 버튼을 막는다.
  const numberCheck = checkImportNumber(st.number, isNew ? [] : st.existingNumbers)
  const numberOk = noChanges ? true : !numberCheck.error
  const canSubmit =
    st.phase === 'ready' && !!st.actual && numberOk && nameOk && (!noChanges || draftOnly)

  // 범위 — 무엇을 읽어올지. 없어진 스키마는 떨어뜨리고, 아직 안 고른 연결은 **실제로 읽힌**
  // 스키마를 보인다(Remote 손잡이와 같은 규칙 — 여기만 다르면 같은 연결이 두 말을 한다).
  const model = scopeModel(conn.dbType)
  const selected = st.availableSchemas ? reconcileScope(conn.schemas, st.availableSchemas) : conn.schemas
  const shown = shownScope(selected, st.actual?.tables ?? [])

  return (
    <Dialog open={st.open} onOpenChange={(o) => !o && !busy && st.close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>운영 DB 를 설계로 가져오기</DialogTitle>
          <DialogDescription>
            {isNew
              ? `"${conn.name}" 실제 DB 연결을 새 설계로 가져옵니다.`
              : `"${conn.name}" 실제 DB 연결을 설계 "${st.design?.name}" 의 새 버전으로 가져옵니다.`}
          </DialogDescription>
        </DialogHeader>

        {/*
          갈래를 고르는 토글은 없앴다 — **부른 버튼이 이미 골랐다.**
          "새 설계로 저장하기"로 열어 놓고 창에서 "기존 설계에 버전 추가"를 다시 내미는 것은,
          방금 고른 것을 도로 물어보는 셈이었다(2026-08-14 사용자: "왜 기존 설계에 버전 추가가
          있냐고", "없애"). 갈림은 진단 화면의 버튼 둘이 맡는다.
        */}
        <div className="mt-4 flex flex-col gap-4">
          {/* 실 DB 역설계 미리보기 — 소스(운영)는 테라코타로 표식. */}
          {st.phase === 'preparing' ? (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-panel/60 px-3 py-3 text-[12.5px] text-muted">
              <Loader2 className="size-4 animate-spin" /> 실제 스키마를 읽는 중…
            </div>
          ) : st.actual ? (
            /*
             * 새 설계로 갈 때는 미리보기를 안 그린다 — 견줄 것이 없어 **읽은 테이블을 통째로
             * 늘어놓는 것**뿐이었고, 그 목록을 보고 사람이 정할 것이 없다
             * (2026-08-14 사용자: 목록에 "없애자", 아래 입력 칸들을 가리키며 "이것만 있으면
             * 될 것 같은데?"). 기존 설계에 버전을 더할 때는 남긴다 — 거기 나오는 것은 목록이
             * 아니라 **무엇이 바뀌는가**이고, 그게 곧 누를지 말지의 근거다.
             */
            !st.hasPrevVersion || !st.diff ? null : (
              <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-panel/60 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[12.5px] text-fg">
                    <span className="size-1.5 rounded-full bg-accent-2" />
                    실 DB 에서 <b className="text-accent-2 tabular-nums">{st.actual.tables.length}</b>개 테이블을 읽음
                  </div>
                  <span className="truncate font-mono text-[11px] text-muted">{conn.name}</span>
                </div>

                {noChanges ? (
                  <p className="text-[12px] text-muted">
                    최신 버전과 차이가 없습니다 — 새 버전은 만들지 않아요.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                      <span>테이블 <b className="text-success">+{st.diff.summary.tablesAdded}</b> <b className="text-accent-2">~{st.diff.summary.tablesModified}</b> <b className="text-destructive">−{st.diff.summary.tablesRemoved}</b></span>
                      <span>컬럼 <b className="text-success">+{st.diff.summary.columnsAdded}</b> <b className="text-accent-2">~{st.diff.summary.columnsModified}</b> <b className="text-destructive">−{st.diff.summary.columnsRemoved}</b></span>
                    </div>
                    <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto pr-1">
                      {st.diff.tables.map((t) => (
                        <span key={t.id} className={cn('rounded bg-panel-strong px-1.5 py-0.5 font-mono text-[11px]', t.status === 'added' ? 'text-success' : t.status === 'removed' ? 'text-destructive' : 'text-accent-2')}>
                          {t.status === 'added' ? '+' : t.status === 'removed' ? '−' : '~'} {tableLabel(t.schema, t.name)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          ) : (
            // 못 읽었다 — 여기서 되돌릴 손잡이를 준다. 없으면 가져오기 버튼이 영원히 꺼진 채
            // 이유도 안 보이는 막힌 화면이 된다(닫고 다시 여는 것 말고 길이 없었다).
            <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[12.5px] text-fg">실 DB 를 읽지 못했습니다</span>
                <span className="truncate font-mono text-[11px] text-destructive">
                  {st.error ?? '알 수 없는 오류'}
                </span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void st.prepare()}>
                다시 시도
              </Button>
            </div>
          )}

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

          {/* 범위 · 버전 번호 — 무엇을 가져와서 몇 번으로 남기나. 읽는 순서대로 나란히 둔다.
              (메모는 문장이라 아래 줄로 내렸다 — 셋을 한 줄에 넣으면 버전 칸이 눈금만 남는다.) */}
          <div className="flex gap-3">
            {model.selectable && (
              <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-[12px] font-semibold text-fg">
                {model.schemaLabel}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      data-import-scope
                      disabled={busy}
                      className={cn(
                        'flex h-9 items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 text-left transition-colors',
                        'hover:bg-panel data-[state=open]:bg-panel disabled:cursor-not-allowed disabled:opacity-60'
                      )}
                    >
                      <Layers size={13} className="shrink-0 text-muted" />
                      <span className="truncate font-mono text-[12px] font-normal text-fg">
                        {scopeSummary(shown)}
                      </span>
                      <ChevronDown size={12} className="ml-auto shrink-0 text-muted" />
                    </button>
                  </DropdownMenu.Trigger>
                  {/* 켜짐/토글의 기준은 고른 값이 아니라 **지금 읽히고 있는 것**(`shown`)이다.
                      범위를 한 번도 안 고른 연결은 저장값이 비어 있는데, 그때 auth 를 누르면
                      `[] + auth = [auth]` 가 되어 **읽고 있던 public 이 조용히 빠진다**(실측). */}
                  <ScopeMenu
                    model={model}
                    current={conn}
                    connections={connections}
                    available={st.availableSchemas}
                    selected={shown}
                    catalogs={st.catalogs}
                    loading={st.scopeLoading}
                    error={st.scopeError}
                    catalogHint="고르면 그 연결에서 가져옵니다"
                    onToggle={(s) => st.setScope(toggleSchema(shown, s))}
                    onPickCatalog={st.switchConnection}
                  />
                </DropdownMenu.Root>
              </label>
            )}
            <label className="flex flex-1 flex-col gap-1.5 text-[12px] font-semibold text-fg">
              버전 번호
              <Input
                value={st.number}
                onChange={(e) => st.setNumber(e.target.value)}
                placeholder="v0.1.0"
                className="h-9 font-mono text-[13px] font-normal"
                aria-invalid={!noChanges && !!numberCheck.error}
                data-import-number
                // 차이가 없으면 버전을 안 만든다 — 쓸 수 없는 칸을 열어 두면 뭘 하는 칸인지 흐려진다.
                disabled={busy || noChanges}
              />
              {!noChanges && numberCheck.error && (
                <span data-import-number-error className="text-[11px] font-normal text-destructive">
                  {numberCheck.error}
                </span>
              )}
            </label>
          </div>

          {/* 설계 편집본 반영 — 기존 설계에 더할 때만. 버전만 만들고 설계 화면은 그대로 두는 것이
              예전의 함정이었다(실 DB 를 40개 읽고도 Design 은 16개 그대로). */}
          {!isNew && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-panel/50 px-3 py-2.5">
              <Checkbox
                checked={st.applyToDraft}
                onCheckedChange={(v) => st.setApplyToDraft(v === true)}
                disabled={busy}
                className="mt-[1px]"
                data-apply-to-draft
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-semibold text-fg">설계 편집본도 이 모습으로</span>
                <span className="text-[11.5px] leading-relaxed text-muted">
                  {st.actual && (
                    <>
                      지금 설계의 테이블 <b className="font-semibold text-fg">{draftCount}</b>개가 실 DB{' '}
                      <b className="font-semibold text-fg">{st.actual.tables.length}</b>개로 바뀝니다.
                      직접 손댄 편집분은 사라져요.
                    </>
                  )}
                </span>
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
            {/* 한 덩이로 묶는다 — flex-col 에서는 맨 텍스트와 span 이 각각 한 줄을 차지한다. */}
            <span>
              메모 <span className="font-normal text-muted">(선택)</span>
            </span>
            <Input
              value={st.note}
              onChange={(e) => st.setNote(e.target.value)}
              placeholder="예: 운영에서 직접 추가된 변경 흡수"
              className="h-9 text-[13px] font-normal"
              disabled={busy}
            />
          </label>

          {/*
            버전을 안 만드는 판에 "이 버전을 쓰는 것으로 기록된다"고 적으면 화면이 거짓말을 한다.

            문구는 **일어나는 일 그대로** 적는다 — 예전엔 "적용 버전이 되고, 연결↔설계 결속도
            자동으로 세워집니다" 였는데, `적용 버전`·`결속`·`세워집니다` 셋 다 우리끼리 쓰는
            말이라 읽는 사람에게는 아무 그림도 안 그려졌다(2026-08-14 사용자).
          */}
          {!noChanges && (
            <p className="flex items-start gap-2 rounded-lg bg-accent-soft/50 px-3 py-2.5 text-[11.5px] leading-relaxed text-fg/80">
              <Info className="mt-[2px] size-3.5 shrink-0 text-accent" />
              <span><b className="text-fg">{conn.name}</b> 이 이 설계에 연결되고, 지금 쓰는 버전으로 기록됩니다.</span>
            </p>
          )}

          {/* 컷 실패 문구. 역설계 실패는 위 칸이 이미 말했으므로 여기서 되풀이하지 않는다. */}
          {st.error && st.actual && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{st.error}</div>
          )}
        </div>

        <DialogFooter className="mt-1">
          <Button type="button" variant="ghost" size="sm" onClick={st.close} disabled={busy}>
            취소
          </Button>
          <Button type="button" size="sm" disabled={!canSubmit} onClick={() => void st.execute()}>
            {st.phase === 'running' ? <Loader2 className="animate-spin" /> : <Download />}
            {isNew ? '설계 만들고 가져오기' : noChanges ? '설계에 반영' : '새 버전으로 가져오기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
