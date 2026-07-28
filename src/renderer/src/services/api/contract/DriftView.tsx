import { AlertTriangle, ArrowDownToLine, Radar, ScrollText, ShieldQuestion } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import {
  UNAVAILABLE_LABEL,
  splitFindings,
  summarizeDrift,
  type DriftFinding,
  type DriftResult
} from '@shared/api/drift'
import { supportsCompleteDrift } from '@shared/api/types'
import { useApiStore } from '../store'
import { OpsGuardBand } from '../ops/EnvironmentsView'
import { useActiveEnvironment } from '../ops/store'
import { useContractStore, useContractSync } from './store'

/**
 * Contract › Drift — `docs/spec/api-contract.md` § drift.
 *
 * 이 화면이 이 앱의 값어치다. 그런데 값어치는 "어긋남을 찾는다"가 아니라
 * **"확인 안 된 것을 확인됐다고 말하지 않는다"** 에 있다:
 *   · 등급(완전/관측)이 늘 붙는다        · 커버리지 없는 "이상 없음" 이 없다
 *   · 미관측 요청 이름이 목록으로 보인다   · 판정 불가는 관측 결과로 대체되지 않는다
 */

const KIND_META: Record<DriftFinding['kind'], { label: string; risk: string; cls: string }> = {
  'server-only': {
    label: '서버에만 있음',
    risk: '낮음 — 명세가 뒤처졌습니다. 흡수하면 됩니다.',
    cls: 'bg-accent-2-soft text-accent-2'
  },
  'spec-only': {
    label: '명세에만 있음',
    risk: '높음 — 지금 이 요청은 실제로 깨집니다.',
    cls: 'bg-danger-soft text-danger'
  },
  different: {
    label: '양쪽 있는데 다름',
    risk: '최고 — 타입·모양이 바뀌었습니다.',
    cls: 'bg-danger-soft text-danger'
  }
}

function GradeBadge({ drift }: { drift: DriftResult }) {
  const complete = drift.grade === 'complete'
  return (
    <span
      data-api-drift-grade={drift.grade}
      title={
        complete
          ? '서버가 자기 스키마를 통째로 말해 줬습니다 — 전량 대조입니다.'
          : '실제로 쏴 본 것만 압니다 — 안 쏴 본 요청은 확인된 것이 아닙니다.'
      }
      className={cn(
        'rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
        complete ? 'bg-accent-soft text-accent' : 'bg-panel text-muted'
      )}
    >
      {complete ? '완전 판정' : '관측 판정'}
    </span>
  )
}

function Coverage({ drift }: { drift: DriftResult }) {
  const { total, observed, unobserved, unparsable } = drift.coverage
  const all = unobserved.length === 0 && unparsable.length === 0
  return (
    <div className="flex flex-col gap-1.5" data-api-drift-coverage>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="font-semibold text-fg">
          {observed} / {total} 관측
        </span>
        {!all && (
          <span className="text-danger">
            · 미관측 {unobserved.length}개
            {unparsable.length > 0 && ` · 모양 못 읽음 ${unparsable.length}개`}
          </span>
        )}
        {all && total > 0 && <span className="text-muted">· 전부 관측됨</span>}
        {drift.skippedUnknown > 0 && (
          <span className="text-muted" data-api-drift-skipped>
            · 필수여부 모름 {drift.skippedUnknown}개 제외
          </span>
        )}
      </div>
      {unobserved.length > 0 && (
        <p className="rounded-md bg-panel px-2.5 py-1.5 text-[11.5px] text-muted" data-api-drift-unobserved>
          아직 안 쏴 본 요청 — <span className="font-mono">{unobserved.join(', ')}</span>
          <br />
          이것들은 <b>일치가 아니라 모르는 것</b>입니다. Runner 에서 한 번씩 보내면 판정에 들어옵니다.
        </p>
      )}
      {unparsable.length > 0 && (
        <p className="rounded-md bg-panel px-2.5 py-1.5 text-[11.5px] text-muted">
          응답이 JSON 이 아니라 모양을 못 읽은 요청 — <span className="font-mono">{unparsable.join(', ')}</span>
        </p>
      )}
      {drift.unstable.length > 0 && (
        <p className="rounded-md bg-panel px-2.5 py-1.5 text-[11.5px] text-muted">
          과거 관측과 응답 모양이 달랐던 요청 — <span className="font-mono">{drift.unstable.join(', ')}</span>.
          서버가 도중에 바뀌었을 수 있습니다.
        </p>
      )}
    </div>
  )
}

function FindingList({ title, items, hint }: { title: string; items: DriftFinding[]; hint: string }) {
  if (items.length === 0) return null
  return (
    <section className="flex flex-col gap-1.5" data-api-drift-group={title}>
      <h4 className="text-[12px] font-semibold text-fg">
        {title} <span className="font-normal text-muted">— {hint}</span>
      </h4>
      {items.map((f, i) => (
        <div
          key={i}
          data-api-finding={f.kind}
          className="flex items-start gap-2 rounded-md border border-line px-3 py-2"
        >
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', KIND_META[f.kind].cls)}>
            {KIND_META[f.kind].label}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[12px] break-all text-fg">{f.path}</span>
            <span className="block text-[11.5px] text-muted">{f.detail}</span>
          </span>
        </div>
      ))}
    </section>
  )
}

export function DriftView() {
  useContractSync()
  const spec = useApiStore((s) => s.active)
  const env = useActiveEnvironment()
  const drift = useContractStore((s) => s.drift)
  const ranAt = useContractStore((s) => s.ranAt)
  const running = useContractStore((s) => s.running)
  const error = useContractStore((s) => s.error)
  const clearError = useContractStore((s) => s.clearError)
  const run = useContractStore((s) => s.run)

  if (!spec) {
    return (
      <PlaceholderView
        icon={Radar}
        depth="depth 3 · API › Contract › Drift"
        title="명세를 먼저 고르세요"
        subtitle="판정은 명세와 환경을 짝지어 봅니다 — 상단 컨텍스트 바에서 명세를 고르세요."
      />
    )
  }

  const complete = supportsCompleteDrift(spec.kind)
  const split = drift ? splitFindings(drift) : null

  return (
    <div className="flex h-full flex-col">
      <OpsGuardBand />
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
        <Radar className="size-4 text-muted" />
        <span className="text-[14px] font-semibold text-fg">판정</span>
        <span className="rounded-full bg-panel px-2 py-0.5 text-[10.5px] text-muted">
          {complete ? '이 인터페이스는 서버가 스키마를 말해 줍니다' : '이 인터페이스는 쏴 본 것만 알 수 있습니다'}
        </span>
        <span className="flex-1" />
        <Button
          size="sm"
          className="h-7 text-[12px]"
          disabled={!env || running}
          data-api-run-drift
          title={env ? undefined : '환경을 먼저 고르세요 — 어디를 볼지 정해지지 않았습니다.'}
          onClick={() => env && void run(spec.id, env.id)}
        >
          <Radar className="size-3.5" /> {running ? '보는 중…' : '판정 실행'}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        {!drift ? (
          // "이상 없음" 과 절대 섞지 않는다 — 아직 아무것도 확인하지 않았다.
          <div className="flex items-start gap-2 rounded-md bg-panel px-3 py-2.5 text-[12px] text-muted" data-api-drift-never-ran>
            <ShieldQuestion className="mt-[2px] size-4 shrink-0" />
            <span>
              <b className="text-fg">아직 판정하지 않았습니다.</b> 이것은 “이상 없음”이 아닙니다 —
              선언한 명세와 실제 서버가 같은지 아직 아무것도 확인하지 않은 상태입니다.
              {!env && ' 환경을 고른 뒤 판정을 실행하세요.'}
            </span>
          </div>
        ) : drift.unavailable ? (
          <div className="flex flex-col gap-2" data-api-drift-unavailable={drift.unavailable.reason}>
            <div className="flex items-center gap-2">
              <GradeBadge drift={drift} />
              <span className="text-[13px] font-semibold text-danger">완전 판정 불가</span>
            </div>
            <p className="rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {UNAVAILABLE_LABEL[drift.unavailable.reason]} — {drift.unavailable.message}
            </p>
            <p className="text-[11.5px] text-muted">
              관측 판정으로 대신 보여 주지 않습니다. 두 판정은 믿을 수 있는 정도가 달라서, 섞으면
              “확인됐다”는 말의 뜻이 흐려집니다.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <GradeBadge drift={drift} />
                <span className="text-[13px] font-semibold text-fg" data-api-drift-summary>
                  {summarizeDrift(drift)}
                </span>
                <span className="text-[11px] text-muted">
                  · 환경 {drift.environmentName}
                  {ranAt && ` · ${new Date(ranAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}`}
                </span>
              </div>
              <Coverage drift={drift} />
            </div>

            {drift.findings.length === 0 ? (
              <p className="rounded-md bg-panel px-3 py-2 text-[12px] text-muted">
                대조한 범위 안에서는 어긋남이 없습니다. 위 커버리지가 이 문장의 범위입니다.
              </p>
            ) : (
              <>
                <FindingList
                  title="코드를 고쳐야 하는 것"
                  items={split!.report}
                  hint="실제가 옳다고 단정할 수 없어 명세로 받아들이지 않습니다"
                />
                <FindingList
                  title="명세로 흡수할 수 있는 것"
                  items={split!.absorb}
                  hint="서버에만 있는 것 — Accept 에서 받아들입니다"
                />
              </>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[12px]"
                data-api-copy-report
                onClick={() => {
                  const lines = [
                    `# API 판정 리포트 — ${spec.name}`,
                    `등급: ${drift.grade === 'complete' ? '완전 판정(전량 대조)' : '관측 판정(쏴 본 것만)'}`,
                    `커버리지: ${drift.coverage.observed}/${drift.coverage.total} 관측 · 미관측 ${drift.coverage.unobserved.length}개`,
                    `필수여부 모름으로 제외: ${drift.skippedUnknown}개`,
                    '',
                    ...drift.findings.map((f) => `- [${KIND_META[f.kind].label}] ${f.path} — ${f.detail}`)
                  ]
                  void navigator.clipboard.writeText(lines.join('\n'))
                }}
              >
                <ScrollText className="size-3.5" /> 리포트 복사
              </Button>
              {split!.absorb.length > 0 && (
                <span className="flex items-center gap-1 text-[11.5px] text-muted">
                  <ArrowDownToLine className="size-3.5" />
                  흡수 후보 {split!.absorb.length}건 — Accept 탭에서 받아들입니다
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
