import { memo, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Ban, Copy, Inbox, Lock, Radio, Square } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import {
  inboundRequests,
  MATCH_LABEL,
  parseExpected,
  receivedRow,
  type MatchVerdict,
  type ReceivedRequest
} from '@shared/api/inbox'
import { useApiStore } from '../store'
import { OpsGuardBand } from '../ops/EnvironmentsView'
import { useActiveEnvironment, useOpsSync } from '../ops/store'
import { useInboxStore } from './inboxStore'

/**
 * Runner › Inbox — `docs/spec/api-runner.md` § inbox.
 *
 * 4모양 중 **유일하게 방향이 반대**다: 내가 안 보냈는데 들어온다. 그래서 이 화면에는
 * "보내기"가 없고 대신 **주소를 내주고 기다리는 일**이 중심이다.
 *
 * 이 화면이 지키는 것:
 *   · **로컬 전용임을 숨기지 않는다** — 외부에서 안 닿는다는 사실을 상시 문구로 띄운다
 *   · 앱을 켜면 늘 **꺼짐**으로 시작한다(모르는 새 포트가 열려 있지 않게)
 *   · 대조 결과에 `선언 없음`·`대조 불가`가 따로 있다 — 맞음으로 뭉치지 않는다
 */

const VERDICT_STYLE: Record<MatchVerdict, string> = {
  match: 'bg-accent-soft text-accent',
  mismatch: 'bg-danger-soft text-danger',
  // 모르는 것은 성공색도 실패색도 아니다 — 회색이 그 사실을 말한다.
  undeclared: 'bg-panel text-muted',
  unparsable: 'bg-panel text-muted'
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('ko-KR', { timeStyle: 'medium' })
}

const ReceivedRow = memo(function ReceivedRow({
  item,
  open,
  onToggle
}: {
  item: ReceivedRequest
  open: boolean
  onToggle: () => void
}) {
  const row = receivedRow(item)
  return (
    <div data-api-inbox-row={row.method} className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-panel"
      >
        <span className="w-14 shrink-0 font-mono text-[11px] font-semibold text-fg">{row.method}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{row.path}</span>
        <span
          data-api-inbox-verdict={row.verdict}
          className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium', VERDICT_STYLE[row.verdict])}
        >
          {MATCH_LABEL[row.verdict]}
        </span>
        <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted">{row.size}B</span>
        <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-muted">{fmt(row.at)}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 bg-panel px-4 py-3 text-[11.5px]" data-api-inbox-detail>
          {item.match.issues.length > 0 && (
            <ul className="flex flex-col gap-1" data-api-inbox-issues>
              {item.match.issues.map((i, n) => (
                <li key={n} className="flex items-start gap-1.5 text-danger">
                  <Ban className="mt-[2px] size-3 shrink-0" />
                  <span>
                    <b className="font-mono">{i.path}</b> — {i.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {item.match.skippedUnknown > 0 && (
            <span className="text-muted">
              필수여부 모름 {item.match.skippedUnknown}개는 대조에서 뺐습니다.
            </span>
          )}
          <div className="font-mono break-all text-muted">
            {Object.entries(item.headers).map(([k, v]) => (
              <div key={k}>
                <span className="text-fg">{k}</span>: {v}
              </div>
            ))}
          </div>
          <pre
            className="max-h-56 overflow-auto rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-fg"
            data-api-inbox-body
          >
            {item.body || '(본문 없음)'}
          </pre>
          <span className="text-muted">
            되돌려준 코드: {item.respondedWith} · 이 수신은 실행 기록으로 남았습니다
          </span>
        </div>
      )}
    </div>
  )
})

export function InboxView() {
  useOpsSync()
  const spec = useApiStore((s) => s.active)
  const selected = useApiStore((s) => s.selectedRequest)
  const selectRequest = useApiStore((s) => s.selectRequest)
  const env = useActiveEnvironment()

  const status = useInboxStore((s) => s.status)
  const received = useInboxStore((s) => s.received)
  const dropped = useInboxStore((s) => s.dropped)
  const port = useInboxStore((s) => s.port)
  const responseCode = useInboxStore((s) => s.responseCode)
  const error = useInboxStore((s) => s.error)
  const busy = useInboxStore((s) => s.busy)
  const [openId, setOpenId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // 화면이 뜰 때 지금 상태를 읽는다 — 안 떠 있는 사이에 온 것도 따라잡아야 한다.
  useEffect(() => {
    void useInboxStore.getState().refresh()
  }, [])

  const candidates = useMemo(() => inboundRequests(spec?.requests ?? []), [spec])
  const req = candidates.find((r) => r.name === selected) ?? null
  const declared = req ? parseExpected(req.request.expectedBody) : null

  if (!spec) {
    return (
      <PlaceholderView
        icon={Inbox}
        title="명세를 먼저 고르세요"
        subtitle="상단 컨텍스트 바에서 명세를 고르면 웹훅 수신 대기를 걸 수 있어요."
      />
    )
  }

  const canStart = !!req && !!env && !status.listening && !busy

  return (
    <div className="flex h-full flex-col">
      <OpsGuardBand />
      {error && (
        <div
          data-api-error
          className="flex items-start gap-2 border-b border-line bg-danger-soft px-4 py-2 text-[12px] text-danger"
        >
          <AlertTriangle className="mt-[2px] size-3.5 shrink-0" />
          <span className="flex-1 whitespace-pre-wrap">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[11px]"
            onClick={useInboxStore.getState().clearError}
          >
            닫기
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <WorkspacePanels
          autoSaveId="api-runner-inbox"
          collapsible
          sidebarTitle="웹훅 요청"
          sidebar={
            <div className="flex flex-col">
              {candidates.length === 0 ? (
                <p className="px-3 py-4 text-[12px] text-muted" data-api-empty="no-webhook">
                  이 명세에는 받는 요청이 없어요. Studio 에서 웹훅 요청을 먼저 만드세요 — 웹훅 명세만
                  받을 수 있습니다.
                </p>
              ) : (
                candidates.map((r) => (
                  <button
                    key={r.name}
                    type="button"
                    data-api-inbox-pick={r.name}
                    onClick={() => selectRequest(r.name)}
                    className={cn(
                      'flex items-center gap-2 border-b border-line px-3 py-2 text-left text-[13px] last:border-b-0',
                      r.name === selected ? 'bg-accent-soft font-medium' : 'hover:bg-panel'
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    {status.listening && status.requestName === r.name && (
                      <Radio className="size-3 shrink-0 text-accent" />
                    )}
                  </button>
                ))
              )}
            </div>
          }
        >
          {!req ? (
            <PlaceholderView
              icon={Inbox}
              title="받을 요청을 고르세요"
              subtitle="왼쪽에서 웹훅 요청을 고르면 수신 주소를 만들 수 있어요."
            />
          ) : (
            <div className="flex h-full flex-col">
              {/* ── 대기 머리: 주소 · 포트 · 켜기/끄기 · 응답 코드 ── */}
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
                <span
                  data-api-inbox-state={status.listening ? 'on' : 'off'}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10.5px] font-medium',
                    status.listening ? 'bg-accent-soft text-accent' : 'bg-panel text-muted'
                  )}
                >
                  {status.listening ? '대기 중' : '꺼짐'}
                </span>

                {status.listening && status.url ? (
                  <>
                    <span className="font-mono text-[12px] text-fg" data-api-inbox-url>
                      {status.url}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[11px]"
                      data-api-inbox-copy
                      onClick={() => {
                        void navigator.clipboard.writeText(status.url ?? '')
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1200)
                      }}
                    >
                      <Copy className="size-3" /> {copied ? '복사됨' : '주소 복사'}
                    </Button>
                  </>
                ) : (
                  <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
                    포트
                    <Input
                      value={String(port)}
                      data-api-inbox-port
                      className="h-7 w-20 font-mono text-[12px]"
                      onChange={(e) =>
                        useInboxStore.getState().setPort(Number(e.target.value.replace(/\D/g, '')) || 0)
                      }
                    />
                  </label>
                )}

                <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
                  응답 코드
                  <Input
                    value={String(responseCode)}
                    data-api-inbox-code
                    className="h-7 w-16 font-mono text-[12px]"
                    onChange={(e) =>
                      void useInboxStore
                        .getState()
                        .setResponseCode(Number(e.target.value.replace(/\D/g, '')) || 0)
                    }
                  />
                </label>

                <span className="flex-1" />
                {status.listening ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-[12px]"
                    data-api-inbox-stop
                    onClick={() => void useInboxStore.getState().stop()}
                  >
                    <Square className="size-3.5" /> 대기 끄기
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-7 text-[12px]"
                    data-api-inbox-start
                    disabled={!canStart}
                    title={env ? undefined : '환경을 먼저 고르세요 — 어느 환경의 관측으로 남길지 정해집니다.'}
                    onClick={() =>
                      void useInboxStore.getState().start({
                        specId: spec.id,
                        requestName: req.name,
                        environmentId: env!.id
                      })
                    }
                  >
                    <Radio className="size-3.5" /> 대기 켜기
                  </Button>
                )}
              </div>

              {/* ── 로컬 전용임을 숨기지 않는다 (AC-3) ── */}
              <div
                className="flex items-start gap-2 border-b border-line bg-panel px-4 py-2 text-[11.5px] text-muted"
                data-api-inbox-local-note
              >
                <Lock className="mt-[2px] size-3.5 shrink-0" />
                <span>
                  <b className="text-fg">이 주소는 이 컴퓨터 안에서만 닿습니다.</b> 외부 서비스의 웹훅을
                  실제로 받으려면 터널이 필요한데 아직 만들지 않았습니다 — 지금은 같은 컴퓨터에서 쏘는
                  것으로 검증하세요. 앱을 껐다 켜면 대기는 늘 꺼짐으로 시작합니다.
                </span>
              </div>

              {/* 기대 본문 선언 상태 — 없으면 대조가 '선언 없음'이 된다는 사실을 미리 알린다. */}
              <div className="border-b border-line px-4 py-2 text-[11.5px] text-muted" data-api-inbox-expected>
                {declared === null ? (
                  <>
                    기대 본문 선언이 없습니다 — 받은 것을 대조하지 않고 <b className="text-fg">선언 없음</b>
                    으로 둡니다(맞음이 아닙니다). Studio 에서 이 요청의 받을 모양을 선언하면 대조가
                    시작됩니다.
                  </>
                ) : (
                  <>
                    기대 본문 {declared.length}개 필드를 선언해 뒀습니다 — 받은 본문을 이것과 대조합니다:{' '}
                    <span className="font-mono text-fg">{declared.map((d) => d.name).join(', ')}</span>
                  </>
                )}
              </div>

              {dropped > 0 && (
                <div className="border-b border-line px-4 py-1.5 text-[11.5px] text-muted" data-api-inbox-dropped>
                  목록 상한(500건)을 넘겨 오래된 수신 {dropped}건이 빠졌습니다 — 실행 기록에는 남아 있습니다.
                </div>
              )}

              {/* ── 받은 것 ── */}
              <div className="flex items-center gap-2 border-b border-line px-4 py-2">
                <Inbox className="size-4 text-muted" />
                <span className="text-[13px] font-semibold text-fg">받은 것</span>
                <span className="text-[11.5px] text-muted" data-api-inbox-count>
                  {received.length}건
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {received.length === 0 ? (
                  <p className="px-4 py-4 text-[12px] text-muted" data-api-empty="no-received">
                    {status.listening
                      ? '대기 중입니다. 위 주소로 요청이 오면 여기에 시간순으로 쌓입니다.'
                      : '대기를 켜면 이 주소로 오는 요청을 받습니다.'}
                  </p>
                ) : (
                  received
                    .slice()
                    .reverse()
                    .map((r) => (
                      <ReceivedRow
                        key={r.id}
                        item={r}
                        open={openId === r.id}
                        onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                      />
                    ))
                )}
              </div>
            </div>
          )}
        </WorkspacePanels>
      </div>
    </div>
  )
}
