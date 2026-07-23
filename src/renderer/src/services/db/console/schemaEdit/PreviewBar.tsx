import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import type { DialectId } from '../../dialects'
import { isMyDialect } from '../../workspaces/definition/ddl'
import { HighlightedSqlLine } from '../../workspaces/definition/HighlightedSql'
import { planOf, useSchemaEditStore } from './store'

/**
 * 대기 변경 미리보기 바 — baseline↔draft diff 로 생성될 DDL 을 보여주고 tx 게이트로 적용한다.
 * 파괴적 문이 있으면 적용 전 확인을 받는다. MySQL/MariaDB 는 DDL 자동커밋이라 부분 적용 경고.
 */
export function PreviewBar({ dialect }: { dialect: DialectId }) {
  const baseline = useSchemaEditStore((s) => s.baseline)
  const draft = useSchemaEditStore((s) => s.draft)
  const applying = useSchemaEditStore((s) => s.applying)
  const error = useSchemaEditStore((s) => s.error)
  const discard = useSchemaEditStore((s) => s.discard)
  const apply = useSchemaEditStore((s) => s.apply)
  const dismissError = useSchemaEditStore((s) => s.dismissError)
  const [expanded, setExpanded] = useState(false)

  const plan = useMemo(() => planOf(baseline, draft, dialect), [baseline, draft, dialect])
  const n = plan.statements.length
  const destructive = plan.destructiveCount
  const autoCommit = isMyDialect(dialect) && n > 0

  const onApply = async (): Promise<void> => {
    if (destructive > 0) {
      const ok = window.confirm(
        `파괴적 변경 ${destructive}건(삭제/이름변경 등)이 포함돼 있어요.${autoCommit ? '\nMySQL은 DDL이 자동 커밋되어 되돌릴 수 없습니다.' : ''}\n계속 적용할까요?`
      )
      if (!ok) return
    }
    await apply(dialect)
  }

  return (
    <div className="shrink-0 border-t border-line bg-panel">
      {error && (
        <div className="flex items-center gap-2 border-b border-line bg-destructive/10 px-4 py-1.5 text-[12px] text-destructive">
          <AlertTriangle className="size-3.5" />
          적용 실패: {error}
          <button type="button" onClick={dismissError} className="ml-auto text-destructive/70 hover:text-destructive">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {expanded && n > 0 && (
        <div className="max-h-52 overflow-auto border-b border-line bg-canvas px-4 py-2.5 font-mono text-[12px] leading-[1.7]">
          {plan.statements.map((st, i) =>
            st.sql.split('\n').map((line, j) => (
              <div key={`${i}:${j}`} className={cn(st.destructive && 'bg-destructive/5')}>
                <HighlightedSqlLine line={line} />
              </div>
            ))
          )}
          {plan.unsupported.length > 0 && (
            <div className="mt-2 border-t border-line pt-2 text-[11px] text-accent-2">
              {plan.unsupported.map((u, i) => (
                <div key={i}>⚠ {u}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 px-4 py-2">
        <div className="flex items-center gap-2 text-[12px]">
          {n === 0 ? (
            <span className="text-muted">변경 없음</span>
          ) : (
            <>
              <span className="font-semibold text-fg">대기 변경 {n}건</span>
              {destructive > 0 && (
                <span className="flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                  <AlertTriangle className="size-3" />파괴적 {destructive}
                </span>
              )}
              {autoCommit && (
                <span className="rounded bg-accent-2-soft px-1.5 py-0.5 text-[11px] text-accent-2" title="MySQL/MariaDB 는 DDL 이 자동 커밋됩니다">
                  자동 커밋
                </span>
              )}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-0.5 text-[11.5px] text-accent hover:underline"
              >
                {expanded ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
                SQL {expanded ? '접기' : '보기'}
              </button>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" disabled={applying} onClick={discard}>
            {n === 0 ? '편집 종료' : '버리기'}
          </Button>
          <Button size="sm" disabled={applying || n === 0} onClick={() => void onApply()}>
            {applying ? <Loader2 className="animate-spin" /> : null}
            적용
          </Button>
        </div>
      </div>
    </div>
  )
}
