import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { AlertTriangle, Ban, Copy, FlaskConical, Lock, Play, Square } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import { DEFAULT_MOCK_PORT, mockableRequests, mockUnsupportedReason } from '@shared/api/mock'
import { useApiStore, useSpecSync } from '../store'
import type { MockHitEvent, MockStatus } from '../../../../../preload/services/api'

/**
 * Studio › Mocking — `docs/spec/api-studio.md` § mocking.server.
 *
 * 목적은 하나다: **프론트가 백엔드 완성을 안 기다려도 되게.**
 * 그런데 이 서비스의 한 문장이 여기서 특히 세게 걸린다 — **모르는 것을 안다고 말하지 않는다.**
 *
 *   · 선언이 없는 요청은 **그럴듯한 JSON 을 지어내지 않는다.** 501 과 사유를 준다 —
 *     지어내 주면 프론트가 없는 계약 위에 화면을 짓고, 진짜 서버가 오면 통째로 다시 짓는다
 *   · 값이 **일부러 가짜처럼 보인다** — 진짜 같으면 스크린샷 한 장이 "이미 되는 것"으로 돈다
 *   · 가짜 응답은 **관측 기록이 되지 않는다** — 우리가 만든 것을 관측으로 쌓으면 판정이
 *     "선언 대 실제"가 아니라 "선언 대 선언"이 되어 늘 이상 없음이 된다
 */

const IDLE: MockStatus = {
  listening: false,
  port: null,
  url: null,
  specId: null,
  routes: 0,
  statusFor: {}
}

/** 오간 것 목록 상한. 가짜라 기록으로 안 남으므로 화면에만 산다. */
const MAX_HITS = 200

interface MockStoreState {
  status: MockStatus
  hits: MockHitEvent[]
  port: number
  error: string | null
  busy: boolean
}

const useMockStore = create<MockStoreState>()(() => ({
  status: IDLE,
  hits: [],
  port: DEFAULT_MOCK_PORT,
  error: null,
  busy: false
}))

// 화면이 안 떠 있는 사이에 온 것도 받는다 — 프론트가 쏘는 것은 우리 화면과 무관하게 온다.
window.rockury.apiMock.onHit((e) => {
  useMockStore.setState((s) => ({ hits: [...s.hits, e].slice(-MAX_HITS) }))
})
window.rockury.apiMock.onStatus((status) => useMockStore.setState({ status }))

function fmt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('ko-KR', { timeStyle: 'medium' })
}

export function MockingWorkspace() {
  useSpecSync()
  const spec = useApiStore((s) => s.active)
  const status = useMockStore((s) => s.status)
  const hits = useMockStore((s) => s.hits)
  const port = useMockStore((s) => s.port)
  const error = useMockStore((s) => s.error)
  const busy = useMockStore((s) => s.busy)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.rockury.apiMock.get().then((s) => {
      useMockStore.setState({ status: s })
      if (s.port !== null) useMockStore.setState({ port: s.port })
    })
  }, [])

  if (!spec) {
    return (
      <PlaceholderView
        icon={FlaskConical}
        depth="depth 3 · API › Studio › Mocking"
        title="명세를 먼저 고르세요"
        subtitle="선언한 응답 모양으로 가짜 서버를 띄웁니다 — 명세를 골라야 흉내 낼 것이 생겨요."
      />
    )
  }

  const unsupported = mockUnsupportedReason(spec)
  if (unsupported) {
    // 흉내 못 내는 것을 흉내 내는 척하지 않는다 — 빈 화면 대신 사유를 준다.
    return (
      <PlaceholderView
        icon={Ban}
        depth="depth 3 · API › Studio › Mocking"
        title="이 명세는 아직 흉내 낼 수 없습니다"
        subtitle={unsupported}
      />
    )
  }

  const candidates = mockableRequests(spec)
  const ready = candidates.filter((r) => r.responses.length > 0)
  const unready = candidates.filter((r) => r.responses.length === 0)

  const start = async (): Promise<void> => {
    useMockStore.setState({ busy: true, error: null })
    try {
      const s = await window.rockury.apiMock.start({ specId: spec.id, port, statusFor: status.statusFor })
      useMockStore.setState({ status: s, hits: [] })
    } catch (e) {
      // 포트 충돌 사유·제안이 여기로 온다 — 몰래 다른 포트로 옮기지 않는다.
      useMockStore.setState({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      useMockStore.setState({ busy: false })
    }
  }

  return (
    <div className="flex h-full flex-col">
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
            onClick={() => useMockStore.setState({ error: null })}
          >
            닫기
          </Button>
        </div>
      )}

      {/* ── 머리: 상태 · 주소 · 켜기/끄기 ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <span
          data-api-mock-state={status.listening ? 'on' : 'off'}
          className={cn(
            'rounded-full px-2 py-0.5 text-[10.5px] font-medium',
            status.listening ? 'bg-accent-soft text-accent' : 'bg-panel text-muted'
          )}
        >
          {status.listening ? '켜짐' : '꺼짐'}
        </span>

        {status.listening && status.url ? (
          <>
            <span className="font-mono text-[12px] text-fg" data-api-mock-url>
              {status.url}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              data-api-mock-copy
              onClick={() => {
                void navigator.clipboard.writeText(status.url ?? '')
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
            >
              <Copy className="size-3" /> {copied ? '복사됨' : '주소 복사'}
            </Button>
            <span className="text-[11.5px] text-muted" data-api-mock-routes>
              흉내 내는 요청 {status.routes}개
            </span>
          </>
        ) : (
          <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
            포트
            <Input
              value={String(port)}
              data-api-mock-port
              className="h-7 w-20 font-mono text-[12px]"
              onChange={(e) =>
                useMockStore.setState({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })
              }
            />
          </label>
        )}

        <span className="flex-1" />
        {status.listening ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-[12px]"
            data-api-mock-stop
            onClick={() => void window.rockury.apiMock.stop().then((s) => useMockStore.setState({ status: s }))}
          >
            <Square className="size-3.5" /> 끄기
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-7 text-[12px]"
            data-api-mock-start
            disabled={busy || ready.length === 0}
            title={ready.length === 0 ? '응답 모양을 선언한 요청이 하나도 없습니다.' : undefined}
            onClick={() => void start()}
          >
            <Play className="size-3.5" /> 켜기
          </Button>
        )}
      </div>

      {/* ── 무엇을 흉내 내는지 · 무엇을 못 하는지 ── */}
      <div
        className="flex items-start gap-2 border-b border-line bg-panel px-4 py-2 text-[11.5px] text-muted"
        data-api-mock-note
      >
        <Lock className="mt-[2px] size-3.5 shrink-0" />
        <span>
          <b className="text-fg">이 주소는 이 컴퓨터 안에서만 닿습니다.</b> 응답은{' '}
          <b className="text-fg">선언한 응답 모양</b>에서만 나옵니다 — 값은 일부러 가짜처럼 보이게
          (<span className="font-mono">(mock:필드이름)</span>) 만들고, <b className="text-fg">
          없을 수 있음</b>으로 선언한 필드는 <span className="font-mono">null</span> 로 냅니다(그래야
          프론트가 null 경로를 짭니다). 가짜 응답은 <b className="text-fg">관측 기록으로 안 남습니다.</b>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* ── 흉내 낼 수 있는 요청 ── */}
        <section className="flex flex-col gap-1.5 px-4 py-3" data-api-mock-routes-list>
          <h3 className="text-[12px] font-semibold text-fg">흉내 낼 요청</h3>
          {ready.length === 0 ? (
            <p className="text-[11.5px] text-muted" data-api-empty="no-mock-route">
              응답 모양을 선언한 요청이 없어요. Requests 에서 상태와 필드를 선언하면 그대로 흉내 냅니다.
            </p>
          ) : (
            ready.map((r) => (
              <div key={r.name} data-api-mock-route={r.name} className="flex items-center gap-2 text-[11.5px]">
                <span className="w-14 shrink-0 font-mono font-semibold text-fg">
                  {(r.request.method ?? 'GET').toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-fg">{r.request.path}</span>
                <span className="shrink-0 text-muted">{r.name}</span>
                {/* 오류 경로를 짜 보려면 4xx·5xx 를 낼 수 있어야 한다 — 서버는 안 끊고 바꾼다. */}
                <select
                  value={status.statusFor[r.name] ?? ''}
                  data-api-mock-status={r.name}
                  disabled={!status.listening}
                  className="h-6 shrink-0 rounded-md border border-line bg-canvas px-1 text-[11px] text-fg"
                  onChange={(e) =>
                    void window.rockury.apiMock
                      .setStatus(r.name, e.target.value)
                      .then((s) => useMockStore.setState({ status: s }))
                  }
                >
                  <option value="">기본(가장 낮은 2xx)</option>
                  {r.responses.map((res) => (
                    <option key={res.status} value={res.status}>
                      {res.status}
                    </option>
                  ))}
                </select>
              </div>
            ))
          )}

          {/* **선언이 없는 요청을 감추지 않는다** — 감추면 "왜 404 지" 를 한참 찾는다. */}
          {unready.length > 0 && (
            <p className="mt-1 rounded-md bg-panel px-2.5 py-2 text-[11px] text-muted" data-api-mock-unready>
              응답 모양 선언이 없어 흉내 못 내는 요청 {unready.length}개 —{' '}
              <span className="font-mono">{unready.map((r) => r.name).join(', ')}</span>. 이 경로로
              오면 <b className="text-fg">501</b> 과 사유를 돌려줍니다(가짜 본문을 지어내지 않습니다).
            </p>
          )}
        </section>

        {/* ── 오간 것 ── */}
        <section className="flex flex-col border-t border-line" data-api-mock-hits>
          <h3 className="px-4 py-2 text-[12px] font-semibold text-fg">
            오간 것 <span className="font-normal text-muted">— 가짜라서 기록으로 안 남습니다</span>
          </h3>
          {hits.length === 0 ? (
            <p className="px-4 pb-3 text-[11.5px] text-muted" data-api-empty="no-mock-hit">
              {status.listening
                ? '켜져 있습니다. 위 주소로 요청이 오면 여기 쌓입니다.'
                : '켜면 이 주소로 오는 요청에 가짜 응답을 돌려줍니다.'}
            </p>
          ) : (
            hits
              .slice()
              .reverse()
              .map((h, i) => (
                <div
                  key={`${h.at}:${i}`}
                  data-api-mock-hit={h.unavailable ? 'unavailable' : 'ok'}
                  className="flex items-start gap-2 border-b border-line px-4 py-1.5 text-[11px] last:border-b-0"
                >
                  <span className="w-12 shrink-0 font-mono font-semibold text-fg">{h.method}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-fg">{h.path}</span>
                  {h.guessed > 0 && (
                    <span className="shrink-0 text-muted" data-api-mock-guessed title="필수여부가 `모름`이라 짐작으로 채운 필드">
                      짐작 {h.guessed}
                    </span>
                  )}
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      h.unavailable ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
                    )}
                  >
                    {h.status}
                  </span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-muted">{fmt(h.at)}</span>
                </div>
              ))
          )}
          {hits.some((h) => h.unavailable) && (
            <p className="px-4 py-2 text-[11px] text-muted" data-api-mock-hit-reason>
              {hits.filter((h) => h.unavailable).slice(-1)[0]?.unavailable}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
