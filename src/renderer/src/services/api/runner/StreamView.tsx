import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  Copy,
  Download,
  Info,
  Plug,
  Unplug,
  Waves
} from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import { composeRequest } from '@shared/api/compose'
import {
  copyMessageText,
  exportTimeline,
  filterTimeline,
  graphqlSubscribeBlocker,
  grpcStreamBlocker,
  sendPanelVisible,
  transportFor,
  transportLabel
} from '@shared/api/stream'
import { parseGrpcTarget } from '@shared/api/grpcTarget'
import { secretValues } from '@shared/api/redact'
import {
  SHAPE_LABEL,
  STREAM_DIRECTIONS,
  STREAM_DIRECTION_LABEL,
  STREAM_STATE_LABEL,
  type StreamDirection,
  type StreamMessage,
  type StreamState
} from '@shared/api/types'
import { useApiStore } from '../store'
import { OpsGuardBand } from '../ops/EnvironmentsView'
import { rendererFunctionEnv, useActiveEnvironment, useOpsStore, useOpsSync } from '../ops/store'
import { useStreamStore } from './streamStore'

/**
 * Runner › Stream — `docs/spec/api-runner.md` § stream.session.
 *
 * 단발(Send)과 가르는 것은 프로토콜이 아니라 **상호작용 모양**이다. 여기 사는 것은
 * 응답이 계속 오는 것(서버 스트리밍)과 내가 계속 보내는 것(양방향) 둘뿐이다.
 *
 * 이 화면이 지키는 것:
 *   · 서버 스트리밍에는 보내기 패널이 **없다**(비활성이 아니라 없음 — AC-3)
 *   · 못 붙이는 인터페이스는 빈 화면이 아니라 **사유**를 보인다
 *   · 재접속 시도도 타임라인 항목이다 — 안 남기면 중간이 왜 비었는지 모른다
 */

const STATE_STYLE: Record<StreamState, string> = {
  idle: 'bg-panel text-muted',
  connecting: 'bg-accent-2-soft text-accent-2',
  open: 'bg-accent-soft text-accent',
  closed: 'bg-panel text-muted',
  error: 'bg-danger-soft text-danger'
}

const DIRECTION_ICON: Record<StreamDirection, typeof ArrowUp> = {
  out: ArrowUp,
  in: ArrowDown,
  system: Info
}

const DIRECTION_STYLE: Record<StreamDirection, string> = {
  out: 'text-accent',
  in: 'text-fg',
  system: 'text-muted'
}

/**
 * **memo 가 필수다.** 부모가 다시 렌더되면(메시지 한 건만 와도) memo 없는 행은 전부 다시
 * 호출된다 — 5,000행에서 재렌더 한 번이 92ms 였고(실측), 그러면 초당 11건이 한계다.
 * 이 프로세스는 다섯 서비스가 공유하므로 DB·Infra 화면까지 같이 멈춘다.
 */
const MessageRow = memo(function MessageRow({ m }: { m: StreamMessage }) {
  const [copied, setCopied] = useState(false)
  const Icon = DIRECTION_ICON[m.direction]
  return (
    <div
      data-api-stream-msg={m.direction}
      className="group flex items-start gap-2 border-b border-line px-3 py-1.5 last:border-b-0 hover:bg-panel"
    >
      <Icon className={cn('mt-[3px] size-3 shrink-0', DIRECTION_STYLE[m.direction])} />
      {/* `02:03:12.238` 는 12자 — `w-16`(64px)에선 넘쳐 다음 칸과 맞닿는다. */}
      <span className="w-20 shrink-0 pt-[1px] text-[10.5px] tabular-nums text-muted">
        {m.at.slice(11, 23)}
      </span>
      {m.event && (
        <span className="shrink-0 rounded-full bg-panel px-1.5 py-0.5 text-[10px] text-muted">
          {m.event}
        </span>
      )}
      <pre
        className={cn(
          'min-w-0 flex-1 font-mono text-[11.5px] whitespace-pre-wrap break-all',
          DIRECTION_STYLE[m.direction]
        )}
      >
        {m.data}
      </pre>
      <Button
        variant="ghost"
        size="sm"
        data-api-stream-copy
        // 호버로만 나타나면 키보드만 쓰는 사람은 닿지 못한다 — 초점이 오면 같이 보인다.
        className="h-5 shrink-0 px-1 text-[10.5px] opacity-0 group-hover:opacity-100 focus:opacity-100"
        onClick={() => {
          void navigator.clipboard.writeText(copyMessageText(m))
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        <Copy className="size-3" /> {copied ? '복사됨' : '복사'}
      </Button>
    </div>
  )
})

export function StreamView() {
  useOpsSync()
  const spec = useApiStore((s) => s.active)
  const selected = useApiStore((s) => s.selectedRequest)
  const selectRequest = useApiStore((s) => s.selectRequest)
  const env = useActiveEnvironment()
  const callValues = useOpsStore((s) => s.callValues)
  const setCallValue = useOpsStore((s) => s.setCallValue)

  // **선택자로 쪼개 구독한다.** `useStreamStore()` 로 통째로 받으면 vanilla setState 가 매번
  // 새 객체를 만들어(zustand 5) 관계없는 상태 변화에도 화면 전체가 다시 돈다.
  const sessionRequest = useStreamStore((x) => x.requestName)
  const state = useStreamStore((x) => x.state)
  const messages = useStreamStore((x) => x.messages)
  const url = useStreamStore((x) => x.url)
  const reason = useStreamStore((x) => x.reason)
  const savedNote = useStreamStore((x) => x.savedNote)
  const dropped = useStreamStore((x) => x.dropped)
  const autoReconnect = useStreamStore((x) => x.autoReconnect)
  const error = useStreamStore((x) => x.error)
  const busy = useStreamStore((x) => x.busy)

  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [dir, setDir] = useState<StreamDirection | ''>('')
  const bottom = useRef<HTMLDivElement>(null)

  const req = spec?.requests.find((r) => r.name === selected) ?? null
  const call = (req && callValues[req.name]) ?? {}
  const live = state === 'open' || state === 'connecting'

  // 이 요청을 어느 전송으로 여나 — 못 여는 이유도 여기서 나온다.
  const pick = useMemo(
    () => (spec && req ? transportFor(spec.kind, req.shape) : null),
    [spec, req]
  )

  // 못 보내는 이유는 붙기 전에 보인다(단발 Send 와 같은 관문).
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

  const shown = useMemo(() => filterTimeline(messages, { query: q, direction: dir }), [messages, q, dir])

  // 새 메시지가 오면 아래로 따라간다 — 흐르는 것을 보려고 여는 화면이다.
  // **바닥 근처일 때만** 따라간다. 조건 없이 부르면 위로 올려 읽는 중에도 끌려 내려가고,
  // 메시지마다 동기 레이아웃(줄바꿈 계산이 필요한 `pre` 수천 개)을 강제한다.
  const scroller = useRef<HTMLDivElement>(null)
  /** 바닥을 벗어나 있나 — 벗어나면 자동 따라가기가 멈추므로 **되돌아갈 손잡이**를 띄운다. */
  const [behind, setBehind] = useState(0)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    if (gap > 80) {
      // 따라가기를 멈춘 사실을 **화면이 말한다.** 안 말하면 카운터가 "320/320건" 이라
      // 전부 보이고 있다고 읽히고, 돌아갈 방법도 없다(실측: 한 번 올리면 8,900px 뒤처짐).
      setBehind((n) => n + 1)
      return
    }
    setBehind(0)
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const jumpToBottom = (): void => {
    setBehind(0)
    bottom.current?.scrollIntoView({ block: 'end' })
  }

  // 요청을 바꾸면 남의 타임라인이 남아 보이면 안 된다. **살아 있는 세션은 안 건드린다.**
  useEffect(() => {
    if (selected && sessionRequest && selected !== sessionRequest) {
      useStreamStore.getState().resetIfIdle()
    }
  }, [selected, sessionRequest])

  if (!spec) {
    return (
      <PlaceholderView
        icon={Waves}
        title="명세를 먼저 고르세요"
        subtitle="상단 컨텍스트 바에서 명세를 고르면 스트림 요청에 붙을 수 있어요."
      />
    )
  }

  /**
   * gRPC 만 붙기 전 조건이 더 있다(메서드 칸·주소·암호화). **창구와 같은 함수**를 쓴다 —
   * 여기만 막으면 다른 경로가 우회하고, 창구만 막으면 사용자가 정의 받아 오는 왕복을
   * 기다렸다 실패를 본다.
   */
  const grpcBlock =
    spec.kind === 'grpc' && req && env && preview
      ? grpcStreamBlocker(req, parseGrpcTarget(env.baseUrl), preview.headers, secretValues(env.values))
      : null

  // 구독도 붙기 전에 알 수 있는 조건이 있다 — 손잡기까지 마친 뒤 실패하면 화면이
  // '연결됨' 을 먼저 적고 그 다음에 못 한다고 말한다.
  const gqlBlock =
    spec.kind === 'graphql' && req && pick?.transport === 'graphql-ws'
      ? graphqlSubscribeBlocker(req.request.graphqlQuery ?? '', req.request.graphqlVariables ?? '')
      : null
  const blocked = grpcBlock ?? gqlBlock

  const canOpen =
    !!req && !!env && !!pick?.transport && !!preview?.canSend && !blocked && !live && !busy

  return (
    <div className="flex h-full flex-col">
      <OpsGuardBand />
      {/**
       * 세션은 전역이고 이 화면은 지금 고른 명세·요청만 그린다 — 명세를 옮기거나 다른 요청을
       * 고르면 아래 본문이 통째로 바뀌어 **끊기 버튼이 사라진다.** 소켓은 계속 열려 있는데
       * 닫을 길이 없어지므로, 살아 있는 세션이 있으면 어디서든 닫을 수 있게 띠로 남긴다.
       */}
      {live && sessionRequest && sessionRequest !== selected && (
        <div
          data-api-stream-elsewhere
          className="flex items-center gap-2 border-b border-line bg-accent-2-soft px-4 py-1.5 text-[12px] text-accent-2"
        >
          <Waves className="size-3.5 shrink-0" />
          <span className="flex-1">
            <b>{sessionRequest}</b> 세션이 열려 있습니다 — 여기서도 끊을 수 있어요.
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            data-api-stream-close-elsewhere
            onClick={() => void useStreamStore.getState().close()}
          >
            <Unplug className="size-3" /> 끊기
          </Button>
        </div>
      )}
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
            onClick={useStreamStore.getState().clearError}
          >
            닫기
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <WorkspacePanels
          autoSaveId="api-runner-stream"
          collapsible
          sidebarTitle="스트림 요청"
          sidebar={
            <div className="flex flex-col">
              {spec.requests.length === 0 ? (
                <p className="px-3 py-4 text-[12px] text-muted">Studio 에서 요청을 먼저 만드세요.</p>
              ) : (
                spec.requests.map((r) => {
                  const streamable = !!transportFor(spec.kind, r.shape).transport
                  return (
                    <button
                      key={r.name}
                      type="button"
                      data-api-stream-pick={r.name}
                      onClick={() => selectRequest(r.name)}
                      className={cn(
                        'flex items-center gap-2 border-b border-line px-3 py-2 text-left text-[13px] last:border-b-0',
                        r.name === selected ? 'bg-accent-soft font-medium' : 'hover:bg-panel'
                      )}
                    >
                      <span title={r.name} className="min-w-0 flex-1 truncate">
                        {r.name}
                      </span>
                      {/* 목록에서 이미 갈라 보인다 — 골라 놓고 "왜 안 열리지" 하지 않게. */}
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[10px]',
                          streamable ? 'bg-accent-2-soft text-accent-2' : 'bg-panel text-muted'
                        )}
                      >
                        {SHAPE_LABEL[r.shape]}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          }
        >
          {!req || !pick ? (
            <PlaceholderView
              icon={Waves}
              title="요청을 고르세요"
              subtitle="왼쪽에서 스트림 요청을 고르면 붙어서 메시지를 주고받을 수 있어요."
            />
          ) : !pick.transport ? (
            /* 못 여는 것은 **사유를 단 빈 결과**로 준다 — 다른 전송으로 흉내 내지 않는다. */
            <PlaceholderView
              icon={Ban}
              title="이 요청은 여기서 못 엽니다"
              subtitle={pick.unsupported ?? ''}
            />
          ) : (
            <div className="flex h-full flex-col">
              {/* ── 세션 머리: 상태 · 접속/끊기 · 자동 재접속 ── */}
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
                <span
                  data-api-stream-state={state}
                  className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-medium', STATE_STYLE[state])}
                >
                  {STREAM_STATE_LABEL[state]}
                </span>
                <span className="text-[11.5px] text-muted" data-api-stream-transport>
                  {transportLabel(pick.transport, req.shape)}
                </span>
                {url && (
                  <span className="max-w-[24rem] truncate font-mono text-[11px] text-muted" data-api-stream-url>
                    {url}
                  </span>
                )}
                <span className="flex-1" />

                <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
                  <input
                    type="checkbox"
                    data-api-stream-autoreconnect
                    checked={autoReconnect}
                    disabled={live}
                    // 기본 체크박스는 13×13 이라 트랙패드에서 빗나간다(WCAG 2.5.8).
                    className="size-4"
                    onChange={(e) => useStreamStore.getState().setAutoReconnect(e.target.checked)}
                  />
                  자동 재접속
                </label>

                {live ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-[12px]"
                    data-api-stream-close
                    onClick={() => void useStreamStore.getState().close()}
                  >
                    <Unplug className="size-3.5" /> 끊기
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-7 text-[12px]"
                    data-api-stream-open
                    disabled={!canOpen}
                    title={
                      canOpen
                        ? undefined
                        : (blocked ??
                          preview?.blocking.map((b) => b.message).join('\n') ??
                          '붙을 수 없습니다')
                    }
                    onClick={() =>
                      void useStreamStore.getState().open({
                        specId: spec.id,
                        requestName: req.name,
                        environmentId: env!.id,
                        call
                      })
                    }
                  >
                    <Plug className="size-3.5" /> 접속
                  </Button>
                )}
              </div>

              {/* 끊긴 이유 · 기록으로 남았다는 사실 */}
              {(reason || savedNote || dropped > 0) && (
                <div className="border-b border-line bg-panel px-4 py-1.5 text-[11.5px] text-muted">
                  {/* 서버가 준 문구는 여러 줄이 정상이다(GraphQL 오류가 그렇다) — 접으면
                      위치를 짚어 주는 캐럿이 엉뚱한 글자를 가리킨다. 길면 스스로 스크롤한다. */}
                  {reason && (
                    <div
                      data-api-stream-reason
                      className="max-h-32 overflow-y-auto whitespace-pre-wrap"
                    >
                      {reason}
                    </div>
                  )}
                  {savedNote && <div data-api-stream-saved>{savedNote}</div>}
                  {dropped > 0 && (
                    <div data-api-stream-dropped>
                      타임라인 상한(5,000건)을 넘겨 오래된 메시지 {dropped}건이 빠졌습니다 —
                      기록에도 같은 수만 남습니다.
                    </div>
                  )}
                </div>
              )}

              {/* 못 붙는 이유 — 버튼을 흐리게만 두면 왜인지 모른다. */}
              {!live && preview && preview.blocking.length > 0 && (
                <ul
                  className="flex flex-col gap-1 border-b border-line px-4 py-2 text-[11.5px] text-muted"
                  data-api-blocking
                >
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

              {/* 호출 파라미터 — 접속 주소에 치환된다. */}
              {req.params.length > 0 && !live && (
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
                  {req.params.map((p) => (
                    <label key={p.name} className="flex items-center gap-1.5 text-[11.5px] text-muted">
                      <span className="font-mono text-fg">
                        {p.name}
                        {p.required && <span className="text-danger">*</span>}
                      </span>
                      <Input
                        value={call[p.name] ?? ''}
                        placeholder={p.defaultValue ?? ''}
                        data-api-call-param={p.name}
                        className="h-7 w-36 font-mono text-[12px]"
                        onChange={(e) => setCallValue(req.name, p.name, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              )}

              {/* ── 타임라인 도구 ── */}
              <div className="flex items-center gap-2 border-b border-line px-4 py-2">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="메시지 검색"
                  data-api-stream-search
                  className="h-7 w-44 text-[12px]"
                />
                <select
                  value={dir}
                  data-api-stream-direction
                  className="h-7 rounded-md border border-line bg-canvas px-1.5 text-[12px] text-fg"
                  onChange={(e) => setDir(e.target.value as StreamDirection | '')}
                >
                  <option value="">모든 방향</option>
                  {STREAM_DIRECTIONS.map((d) => (
                    <option key={d} value={d}>
                      {STREAM_DIRECTION_LABEL[d]}
                    </option>
                  ))}
                </select>
                <span className="text-[11.5px] text-muted" data-api-stream-count>
                  {shown.length} / {messages.length}건
                </span>
                <span className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[12px]"
                  data-api-stream-export
                  disabled={messages.length === 0}
                  onClick={() => void navigator.clipboard.writeText(exportTimeline(messages))}
                >
                  <Download className="size-3.5" /> 전체 내보내기
                </Button>
              </div>

              {/* ── 타임라인 ── */}
              <div ref={scroller} className="min-h-0 flex-1 overflow-auto" data-api-stream-timeline>
                {shown.length === 0 ? (
                  <p className="px-4 py-4 text-[12px] text-muted" data-api-empty="no-message">
                    {messages.length === 0
                      ? '아직 오간 메시지가 없어요. 접속하면 주고받은 것이 시간순으로 쌓입니다.'
                      : '검색·필터에 걸리는 메시지가 없어요.'}
                  </p>
                ) : (
                  shown.map((m) => <MessageRow key={m.seq} m={m} />)
                )}
                <div ref={bottom} />
              </div>

              {behind > 0 && (
                <button
                  type="button"
                  data-api-stream-jump
                  onClick={jumpToBottom}
                  className="flex items-center justify-center gap-1.5 border-t border-line bg-accent-soft px-4 py-1.5 text-[11.5px] font-medium text-accent hover:bg-accent-soft/70"
                >
                  <ArrowDown className="size-3.5" /> 맨 아래로 — 그동안 {behind}건이 더 왔습니다
                </button>
              )}

              {/* ── 보내기 패널: 양방향에만 **있다**(AC-3) ── */}
              {sendPanelVisible(req.shape) && (
                <div className="flex items-center gap-2 border-t border-line px-4 py-2.5" data-api-stream-sendpanel>
                  <Input
                    value={draft}
                    disabled={state !== 'open'}
                    placeholder={
                      // 전송마다 규칙이 다르다 — gRPC 는 그 메서드 메시지의 JSON 이어야 한다.
                      spec.kind === 'grpc'
                        ? '보낼 메시지(JSON) — {{변수}} 를 쓰면 환경 값으로 바뀝니다'
                        : '보낼 메시지 — {{변수}} 를 쓰면 환경 값으로 바뀝니다'
                    }
                    data-api-stream-draft
                    className="h-7 flex-1 font-mono text-[12px]"
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || !draft) return
                      void useStreamStore
                        .getState()
                        .send(draft)
                        .then((ok) => ok && setDraft(''))
                    }}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <Button
                    size="sm"
                    className="h-7 text-[12px]"
                    data-api-stream-send
                    disabled={state !== 'open' || !draft}
                    onClick={() =>
                      void useStreamStore
                        .getState()
                        .send(draft)
                        .then((ok) => ok && setDraft(''))
                    }
                  >
                    <ArrowUp className="size-3.5" /> 보내기
                  </Button>
                </div>
              )}
            </div>
          )}
        </WorkspacePanels>
      </div>
    </div>
  )
}
