import { useState } from 'react'
import { AlertTriangle, ArrowDownToLine, Wrench } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import { splitFindings } from '@shared/api/drift'
import { useApiStore } from '../store'
import { useActiveEnvironment } from '../ops/store'
import { useContractStore, useContractSync } from './store'

/**
 * Contract › Accept — `docs/spec/api-contract.md` § accept.
 *
 * 고칠 방향이 둘이다:
 *   · **명세를 실제에 맞춘다** → 여기서 된다(서버에만 있는 것을 Draft 로 흡수)
 *   · **실제를 명세에 맞춘다** → 코드 수정이라 Rockury 밖의 일. 여기선 목록만 준다.
 * 흡수는 **더하기만** 하고, 수락 전에는 Draft 가 안 바뀐다.
 */
export function AcceptView() {
  useContractSync()
  const spec = useApiStore((s) => s.active)
  const env = useActiveEnvironment()
  const drift = useContractStore((s) => s.drift)
  const preview = useContractStore((s) => s.preview)
  const makePreview = useContractStore((s) => s.makePreview)
  const accept = useContractStore((s) => s.accept)
  const clearPreview = useContractStore((s) => s.clearPreview)
  const error = useContractStore((s) => s.error)
  const clearError = useContractStore((s) => s.clearError)
  const [picked, setPicked] = useState<string[]>([])

  if (!spec) {
    return (
      <PlaceholderView
        icon={ArrowDownToLine}
        title="명세를 먼저 고르세요"
        subtitle="흡수는 판정 결과를 명세로 받아들이는 것입니다."
      />
    )
  }
  if (!drift) {
    return (
      <PlaceholderView
        icon={ArrowDownToLine}
        title="판정을 먼저 돌리세요"
        subtitle="Drift 에서 판정을 실행하면 흡수 후보가 여기 모입니다."
      />
    )
  }

  const { absorb, report } = splitFindings(drift)
  /** 흡수 후보가 걸린 요청 이름 — 흡수는 요청 단위로 한다. */
  const candidates = [...new Set(absorb.map((f) => f.path.split('.')[0]))]
  const toggle = (name: string): void =>
    setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]))

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div data-api-error className="flex items-start gap-2 border-b border-line bg-danger-soft px-4 py-2 text-[12px] text-danger">
          <AlertTriangle className="mt-[2px] size-3.5 shrink-0" />
          <span className="flex-1 whitespace-pre-wrap">{error}</span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={clearError}>
            닫기
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <ArrowDownToLine className="size-4 text-muted" />
        <span className="text-[14px] font-semibold text-fg">흡수</span>
        <span className="text-[11.5px] text-muted">— 서버에만 있는 것을 명세로 받아들입니다</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        <section className="flex flex-col gap-2" data-api-absorb-candidates>
          <h4 className="text-[12px] font-semibold text-fg">흡수 후보</h4>
          {candidates.length === 0 ? (
            <p className="text-[12px] text-muted">받아들일 것이 없습니다.</p>
          ) : (
            candidates.map((name) => (
              <label
                key={name}
                data-api-absorb-pick={name}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[12px]',
                  picked.includes(name) ? 'border-accent bg-accent-soft' : 'border-line'
                )}
              >
                <input type="checkbox" checked={picked.includes(name)} onChange={() => toggle(name)} />
                <span className="font-mono text-fg">{name}</span>
                <span className="text-muted">
                  {absorb.filter((f) => f.path.startsWith(`${name}.`)).length}건
                </span>
              </label>
            ))
          )}
          {candidates.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 text-[12px]"
                disabled={picked.length === 0 || !env}
                data-api-absorb-preview
                onClick={() => env && void makePreview(spec.id, env.id, picked)}
              >
                미리보기
              </Button>
              {!env && <span className="text-[11.5px] text-muted">환경을 먼저 고르세요.</span>}
            </div>
          )}
        </section>

        {preview && (
          <section className="flex flex-col gap-2 rounded-md border border-accent p-3" data-api-absorb-preview-panel>
            <h4 className="text-[12px] font-semibold text-fg">
              이렇게 바뀝니다 <span className="font-normal text-muted">— 수락 전에는 아무것도 안 바뀝니다</span>
            </h4>
            {preview.changes.length === 0 ? (
              <p className="text-[12px] text-muted">바뀔 것이 없습니다.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {preview.changes.map((c, i) => (
                  <li key={i} className="text-[11.5px] text-muted">
                    <span className="font-mono text-fg">{c.path}</span> — {c.detail}
                  </li>
                ))}
              </ul>
            )}
            <p
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[11.5px]',
                preview.diff.breaking.length > 0 ? 'bg-danger-soft text-danger' : 'bg-panel text-muted'
              )}
              data-api-absorb-breaking={preview.diff.breaking.length}
            >
              {preview.diff.breaking.length > 0
                ? `깨지는 변경 ${preview.diff.breaking.length}건 — 사람 승인이 필요합니다.`
                : '깨지는 변경 없음 (더하기만 합니다). 버전 컷은 따로 하셔야 합니다.'}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 text-[12px]"
                disabled={preview.changes.length === 0 || !env}
                data-api-absorb-accept
                onClick={() => env && void accept(spec.id, env.id, picked)}
              >
                수락하고 Draft 에 반영
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={clearPreview}>
                취소
              </Button>
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2" data-api-absorb-report>
          <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-fg">
            <Wrench className="size-3.5 text-muted" />
            코드를 고쳐야 하는 것{' '}
            <span className="font-normal text-muted">— 여기서는 안 받아들입니다</span>
          </h4>
          {report.length === 0 ? (
            <p className="text-[12px] text-muted">없습니다.</p>
          ) : (
            <>
              <p className="rounded-md bg-panel px-2.5 py-1.5 text-[11.5px] text-muted">
                실제가 옳다고 단정할 근거가 없습니다(서버가 버그일 수도 있습니다). 그래서 이것들은
                자동으로 명세에 들어가지 않고, 고칠 목록으로만 남습니다.
              </p>
              {report.map((f, i) => (
                <div key={i} className="rounded-md border border-line px-3 py-2" data-api-report-item>
                  <span className="block font-mono text-[12px] break-all text-fg">{f.path}</span>
                  <span className="block text-[11.5px] text-muted">{f.detail}</span>
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
