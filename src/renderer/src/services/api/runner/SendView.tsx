import { useMemo, useState } from 'react'
import { AlertTriangle, Ban, Copy, Send, XCircle } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import { composeRequest, toCurl } from '@shared/api/compose'
import { ORIGIN_LABEL, RUN_STATUS_LABEL, type ValueOrigin } from '@shared/api/types'
import { useApiStore } from '../store'
import { OpsGuardBand } from '../ops/EnvironmentsView'
import { rendererFunctionEnv, useActiveEnvironment, useOpsStore, useOpsSync } from '../ops/store'

/**
 * Runner › Send — `docs/spec/api-runner.md` § send.
 *
 * 이 화면의 알맹이는 "보내기" 가 아니라 **보내기 전에 보이는 것**이다:
 *   · 최종 요청 전문        · 값마다 어디서 왔는지        · 왜 못 보내는지
 * Postman 에서 "STG 인 줄 알고 PROD 를 쳤다" 가 나는 자리를 화면으로 막는다.
 */

const ORIGIN_STYLE: Record<ValueOrigin, string> = {
  default: 'bg-panel text-muted',
  environment: 'bg-accent-2-soft text-accent-2',
  call: 'bg-accent-soft text-accent'
}

export function SendView() {
  useOpsSync()
  const spec = useApiStore((s) => s.active)
  const selected = useApiStore((s) => s.selectedRequest)
  const selectRequest = useApiStore((s) => s.selectRequest)
  const env = useActiveEnvironment()
  const callValues = useOpsStore((s) => s.callValues)
  const setCallValue = useOpsStore((s) => s.setCallValue)
  const send = useOpsStore((s) => s.send)
  const sending = useOpsStore((s) => s.sending)
  const cancelSend = useOpsStore((s) => s.cancelSend)
  const lastRun = useOpsStore((s) => s.lastRun)
  const pruned = useOpsStore((s) => s.pruned)
  const error = useOpsStore((s) => s.error)
  const clearError = useOpsStore((s) => s.clearError)
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)

  const req = spec?.requests.find((r) => r.name === selected) ?? null
  const call = (req && callValues[req.name]) ?? {}

  // 미리보기는 늘 가린 채로 만든다 — 화면에 실값이 뜨면 화면 공유·스크린샷으로 샌다.
  const preview = useMemo(
    () =>
      spec && req
        ? composeRequest({
            kind: spec.kind,
            request: req,
            env,
            call,
            functions: rendererFunctionEnv,
            maskSecrets: true
          })
        : null,
    [spec, req, env, call]
  )

  if (!spec) {
    return (
      <PlaceholderView
        icon={Send}
        title="명세를 먼저 고르세요"
        subtitle="상단 컨텍스트 바에서 명세를 고르면 요청을 쏠 수 있어요."
      />
    )
  }

  const doSend = (): void => {
    if (!req || !env) return
    setConfirming(false)
    void send({ specId: spec.id, requestName: req.name, environmentId: env.id })
  }

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

      <div className="min-h-0 flex-1">
        <WorkspacePanels
          autoSaveId="api-runner-send"
          collapsible
          sidebarTitle="요청"
          sidebar={
            <div className="flex flex-col">
              {spec.requests.length === 0 ? (
                <p className="px-3 py-4 text-[12px] text-muted">Studio 에서 요청을 먼저 만드세요.</p>
              ) : (
                spec.requests.map((r) => (
                  <button
                    key={r.name}
                    type="button"
                    data-api-send-pick={r.name}
                    onClick={() => selectRequest(r.name)}
                    className={cn(
                      'border-b border-line px-3 py-2 text-left text-[13px] last:border-b-0',
                      r.name === selected ? 'bg-accent-soft font-medium' : 'hover:bg-panel'
                    )}
                  >
                    {r.name}
                  </button>
                ))
              )}
            </div>
          }
        >
          {!req || !preview ? (
            <PlaceholderView
              icon={Send}
              title="요청을 고르세요"
              subtitle="왼쪽에서 요청을 고르면 파라미터를 넣고 최종 요청을 미리 볼 수 있어요."
            />
          ) : (
            <div className="flex h-full flex-col gap-4 overflow-auto px-4 py-4">
              {/* 호출 파라미터 — 호출마다 달라지는 값. 환경 값과 섞지 않는다. */}
              <section className="flex flex-col gap-2" data-api-section="call">
                <h3 className="text-[12px] font-semibold text-fg">
                  호출 파라미터 <span className="font-normal text-muted">— 이번 호출에만 쓰는 값</span>
                </h3>
                {req.params.length === 0 ? (
                  <p className="text-[11.5px] text-muted">이 요청은 파라미터가 없어요.</p>
                ) : (
                  req.params.map((p) => (
                    <label key={p.name} className="flex items-center gap-2 text-[11.5px] text-muted">
                      <span className="w-32 shrink-0 truncate font-mono text-fg">
                        {p.name}
                        {p.required && <span className="text-danger">*</span>}
                      </span>
                      <span className="w-14 shrink-0">{p.type}</span>
                      <Input
                        value={call[p.name] ?? ''}
                        placeholder={p.defaultValue ?? ''}
                        data-api-call-param={p.name}
                        className="h-7 flex-1 font-mono text-[12px]"
                        onChange={(e) => setCallValue(req.name, p.name, e.target.value)}
                      />
                    </label>
                  ))
                )}
              </section>

              {/* 최종 요청 — 보내기 전에 전문을 본다. */}
              <section className="flex flex-col gap-2" data-api-section="preview">
                <h3 className="text-[12px] font-semibold text-fg">최종 요청</h3>
                <div className="rounded-md border border-line bg-panel px-3 py-2 font-mono text-[12px] break-all text-fg" data-api-preview-url>
                  <b>{preview.method || 'CONNECT'}</b> {preview.url}
                </div>
                {Object.entries(preview.headers).length > 0 && (
                  <div className="rounded-md border border-line px-3 py-2 font-mono text-[11.5px] break-all text-muted">
                    {Object.entries(preview.headers).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-fg">{k}</span>: {v}
                      </div>
                    ))}
                  </div>
                )}
                {preview.body && (
                  <pre className="max-h-40 overflow-auto rounded-md border border-line px-3 py-2 font-mono text-[11.5px] text-muted">
                    {preview.body}
                  </pre>
                )}

                {/* 출처 — "이 값 어디서 왔나" 가 안 보이면 오조작이 난다. */}
                {preview.origins.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5" data-api-origins>
                    <span className="text-[11px] text-muted">값 출처:</span>
                    {preview.origins.map((o) => (
                      <span
                        key={o.name}
                        data-api-origin={o.origin}
                        className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-medium', ORIGIN_STYLE[o.origin])}
                      >
                        {o.name} · {ORIGIN_LABEL[o.origin]}
                        {o.secret && ' · 비밀'}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {/* 못 보내는 이유 — 버튼을 흐리게만 두면 왜인지 모른다. */}
              {preview.blocking.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-md bg-panel px-3 py-2 text-[11.5px] text-muted" data-api-blocking>
                  {preview.blocking.map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <Ban className="mt-[2px] size-3 shrink-0 text-danger" />
                      <span>
                        <b className="text-fg">{b.where}</b> — {b.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-center gap-2">
                {confirming ? (
                  <>
                    <span className="text-[12px] text-danger" data-api-confirm-gate>
                      운영 환경 <b>{env?.name}</b> 으로 <b>{req.name}</b> 을(를) 보냅니다. 계속할까요?
                    </span>
                    <Button size="sm" variant="destructive" className="h-7 text-[12px]" data-api-confirm-send onClick={doSend}>
                      보냅니다
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => setConfirming(false)}>
                      취소
                    </Button>
                  </>
                ) : sending ? (
                  /* 보내는 중에는 **끊을 수 있어야 한다** — 안 그러면 타임아웃(30초)까지 갇힌다.
                     끊긴 결과는 실패가 아니라 `취소` 기록으로 남는다(execute AC-3). */
                  <>
                    <Button size="sm" className="h-7 text-[12px]" disabled data-api-send>
                      <Send className="size-3.5" /> 보내는 중…
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-[12px]"
                      data-api-cancel-send
                      onClick={() => void cancelSend()}
                    >
                      <XCircle className="size-3.5" /> 취소
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    className="h-7 text-[12px]"
                    disabled={!preview.canSend}
                    data-api-send
                    title={preview.canSend ? undefined : preview.blocking.map((b) => b.message).join('\n')}
                    onClick={() => (env?.production ? setConfirming(true) : doSend())}
                  >
                    <Send className="size-3.5" /> 보내기
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[12px]"
                  data-api-copy-curl
                  onClick={() => {
                    void navigator.clipboard.writeText(toCurl(preview))
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  <Copy className="size-3.5" /> {copied ? '복사됨' : 'curl 복사'}
                </Button>
              </div>

              {/* 응답 */}
              {lastRun && lastRun.requestName === req.name && (
                <section className="flex flex-col gap-2" data-api-section="response">
                  <h3 className="flex items-center gap-2 text-[12px] font-semibold text-fg">
                    응답
                    <span
                      data-api-run-status={lastRun.status}
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10.5px] font-medium',
                        lastRun.status === 'ok' ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'
                      )}
                    >
                      {RUN_STATUS_LABEL[lastRun.status]}
                      {lastRun.httpStatus !== null && ` ${lastRun.httpStatus}`}
                    </span>
                    <span className="font-normal text-muted">{lastRun.durationMs}ms</span>
                    {pruned > 0 && (
                      <span className="font-normal text-muted" data-api-pruned>
                        · 보관 상한으로 오래된 기록 {pruned}건을 지웠습니다
                      </span>
                    )}
                  </h3>
                  {lastRun.error && <p className="text-[12px] text-danger">{lastRun.error}</p>}
                  {lastRun.response && (
                    <pre className="max-h-72 overflow-auto rounded-md border border-line px-3 py-2 font-mono text-[11.5px] text-fg" data-api-response-body>
                      {lastRun.response.body || '(본문 없음)'}
                    </pre>
                  )}
                </section>
              )}
            </div>
          )}
        </WorkspacePanels>
      </div>
    </div>
  )
}
