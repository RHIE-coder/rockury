import { useMemo } from 'react'
import { ArrowRight, GitCompare, ShieldAlert } from 'lucide-react'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import { diffSpecs, type Change } from '@shared/api/breaking'
import { useApiStore } from '../store'
import { DRAFT, resolveSide, useVersionsStore, useVersionsSync } from './store'

/**
 * Versions › Diff — `docs/spec/api-studio.md` § versions.diff.
 *
 * 이 화면의 알맹이는 **비대칭**이다: 요청은 *더 요구하면* 깨지고, 응답은 *덜 주면* 깨진다.
 * 그래서 같은 연산도 방향에 따라 판정이 갈린다 — 화면이 그 방향을 항상 함께 보인다.
 */

const DIRECTION_LABEL: Record<Change['direction'], string> = { request: '요청', response: '응답' }

function ChangeRow({ c }: { c: Change }) {
  const breaking = c.severity === 'breaking'
  return (
    <div
      data-api-change={c.severity}
      className="flex items-start gap-2 border-b border-line px-4 py-2 last:border-b-0"
    >
      <span
        className={cn(
          'mt-[1px] shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
          breaking ? 'bg-danger-soft text-danger' : 'bg-panel text-muted'
        )}
      >
        {breaking ? '깨짐' : '안전'}
      </span>
      <span className="mt-[1px] shrink-0 rounded-full bg-panel px-1.5 py-0.5 text-[10px] text-muted">
        {DIRECTION_LABEL[c.direction]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[12px] break-all text-fg">{c.path}</span>
        <span className="block text-[11.5px] text-muted">{c.detail}</span>
      </span>
    </div>
  )
}

function Picker({
  side,
  value,
  onPick
}: {
  side: 'left' | 'right'
  value: string
  onPick: (v: string) => void
}) {
  const versions = useVersionsStore((s) => s.versions)
  return (
    <select
      value={value}
      data-api-diff-side={side}
      className="h-7 rounded-md border border-line bg-canvas px-1.5 font-mono text-[12px] text-fg"
      onChange={(e) => onPick(e.target.value)}
    >
      <option value={DRAFT}>Draft (지금)</option>
      {versions.map((v) => (
        <option key={v.number} value={v.number}>
          {v.number}
        </option>
      ))}
    </select>
  )
}

export function DiffView() {
  useVersionsSync()
  const spec = useApiStore((s) => s.active)
  const versions = useVersionsStore((s) => s.versions)
  const left = useVersionsStore((s) => s.left)
  const right = useVersionsStore((s) => s.right)
  const pick = useVersionsStore((s) => s.pick)

  const result = useMemo(() => {
    const a = resolveSide(left, versions, spec)
    const b = resolveSide(right, versions, spec)
    return a && b ? diffSpecs(a, b) : null
  }, [left, right, versions, spec])

  if (!spec) {
    return (
      <PlaceholderView
        icon={GitCompare}
        title="명세를 먼저 고르세요"
        subtitle="비교는 같은 명세의 두 스냅샷 사이에서 합니다."
      />
    )
  }
  if (versions.length === 0) {
    return (
      <PlaceholderView
        icon={GitCompare}
        title="비교할 버전이 없어요"
        subtitle="Timeline 에서 버전을 한 번 컷하면 Draft 와 비교할 수 있습니다."
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <GitCompare className="size-4 text-muted" />
        <Picker side="left" value={left ?? DRAFT} onPick={(v) => pick('left', v)} />
        <ArrowRight className="size-3.5 text-muted" />
        <Picker side="right" value={right} onPick={(v) => pick('right', v)} />
        <span className="flex-1" />
        {result && (
          <span
            data-api-diff-breaking={result.breaking.length}
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium',
              result.breaking.length > 0 ? 'bg-danger-soft text-danger' : 'bg-panel text-muted'
            )}
          >
            {result.breaking.length > 0 ? `깨지는 변경 ${result.breaking.length}건` : '깨지는 변경 없음'}
          </span>
        )}
      </div>

      {/* 비대칭을 화면이 먼저 말한다 — 이걸 모르면 결과를 거꾸로 읽는다. */}
      <p className="flex items-start gap-1.5 border-b border-line bg-panel px-4 py-1.5 text-[11px] text-muted">
        <ShieldAlert className="mt-[2px] size-3 shrink-0" />
        요청은 <b className="text-fg">더 요구하면</b> 깨지고, 응답은 <b className="text-fg">덜 주면</b> 깨집니다 —
        같은 연산도 방향에 따라 판정이 갈립니다.
      </p>

      <div className="min-h-0 flex-1 overflow-auto">
        {!result || result.changes.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-muted" data-api-empty="no-change">
            두 스냅샷이 같습니다 — 바뀐 것이 없어요.
          </p>
        ) : (
          <>
            {result.breaking.length > 0 && (
              <>
                <h4 className="border-b border-line bg-danger-soft/40 px-4 py-1.5 text-[11.5px] font-semibold text-danger">
                  깨지는 변경 — 기존 호출자가 깨집니다
                </h4>
                {result.breaking.map((c, i) => (
                  <ChangeRow key={`b${i}`} c={c} />
                ))}
              </>
            )}
            {result.changes.filter((c) => c.severity === 'safe').length > 0 && (
              <>
                <h4 className="border-b border-line bg-panel px-4 py-1.5 text-[11.5px] font-semibold text-muted">
                  안전한 변경 — 경고도 아닙니다
                </h4>
                {result.changes
                  .filter((c) => c.severity === 'safe')
                  .map((c, i) => (
                    <ChangeRow key={`s${i}`} c={c} />
                  ))}
              </>
            )}
            {result.skippedUnknown > 0 && (
              <p className="px-4 py-2 text-[11.5px] text-muted" data-api-diff-skipped>
                필수여부를 모르는 필드 {result.skippedUnknown}개는 판정에서 뺐습니다 — 모르는 것을
                안전으로 세지 않습니다.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
