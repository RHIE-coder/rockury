import { useEffect, useState } from 'react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { MW_KINDS, defaultPortOf, parseCommandLine, quickCommandsOf } from './console'

/**
 * 미들웨어 접속·콘솔.
 *
 * DB 서비스의 Connections/Console 패턴을 빌린다(새로 발명하지 않는다 — `middleware.scope` AC-2).
 * 클라이언트는 **의존성 0**으로 메인 프로세스가 규약을 직접 태운다(`middleware/redis.ts`).
 *
 * 아직 못 붙는 종류를 목록에서 **빼지 않고 못 붙는다고 표시**한다 — 빼면 "지원 안 하나?"를
 * 사용자가 짐작해야 하고, 표시 없이 두면 눌러 보고 나서 안다.
 */

interface MwConnection {
  id: string
  kind: string
  name: string
  host: string
  port: number
  username: string
  hasSecret: boolean
  options: string
}

interface Line {
  command: string
  output: string
  ok: boolean
  ms: number
}

export function MiddlewareView(): React.JSX.Element {
  const [conns, setConns] = useState<MwConnection[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)

  // 새 접속 폼
  const [kind, setKind] = useState('redis')
  const [name, setName] = useState('')
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState(String(defaultPortOf('redis')))
  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')

  const reload = async (): Promise<void> => {
    const rows = await window.rockury.infra.listMwConnections()
    setConns(rows)
    if (!rows.some((r) => r.id === activeId)) setActiveId(rows[0]?.id ?? null)
  }

  useEffect(() => {
    void reload()
    // 최초 1회.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const active = conns.find((c) => c.id === activeId) ?? null
  const activeKind = MW_KINDS.find((k) => k.id === active?.kind) ?? null

  const save = async (): Promise<void> => {
    setError(null)
    try {
      await window.rockury.infra.saveMwConnection({
        kind,
        name: name.trim() || `${kind} 접속`,
        host: host.trim(),
        port: Number(port) || defaultPortOf(kind),
        username: username.trim(),
        secret: secret || undefined
      })
      setName('')
      setSecret('')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const send = async (line: string): Promise<void> => {
    const args = parseCommandLine(line)
    if (args.length === 0 || !active) return
    setRunning(true)
    try {
      const r = await window.rockury.infra.runMw({ connectionId: active.id, commands: [args] })
      setLines((prev) => [
        ...prev,
        {
          command: line,
          // 못 붙은 것(error)과 서버가 거절한 것(출력 안의 (error))을 구분해 보인다.
          output: r.error ? `붙지 못했습니다 — ${r.error}` : (r.outputs[0] ?? ''),
          ok: r.ok && !r.hadCommandError,
          ms: r.durationMs
        }
      ])
      setInput('')
    } catch (e) {
      setLines((prev) => [
        ...prev,
        { command: line, output: e instanceof Error ? e.message : String(e), ok: false, ms: 0 }
      ])
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 gap-4 p-4" data-infra-view="middleware">
      {/* 접속 목록 + 새 접속 */}
      <section className="flex w-[320px] shrink-0 flex-col gap-2">
        <h2 className="text-xs font-medium">접속</h2>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
          {conns.length === 0 && (
            <p className="p-3 text-[11px] text-muted">아직 접속이 없습니다.</p>
          )}
          {conns.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setActiveId(c.id)
                setLines([])
              }}
              className={cn(
                'flex w-full cursor-pointer flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left text-xs last:border-b-0 hover:bg-secondary/50',
                activeId === c.id && 'bg-primary/5'
              )}
              data-mw-conn={c.id}
            >
              <span className="flex w-full items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="rounded bg-secondary px-1 text-[10px] text-muted">{c.kind}</span>
              </span>
              <span className="font-mono text-[10px] text-muted">
                {c.host}:{c.port}
                {c.hasSecret ? ' · 비밀 있음' : ''}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
          <h3 className="text-[11px] font-medium">새 접속</h3>
          <label className="flex flex-col gap-0.5 text-[10px] text-muted">
            종류
            <select
              className="h-8 rounded-md border border-input bg-background px-1.5 text-xs"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value)
                setPort(String(defaultPortOf(e.target.value)))
              }}
              data-mw-kind
            >
              {MW_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                  {k.ready ? '' : ' (아직 못 붙음)'}
                </option>
              ))}
            </select>
          </label>
          {MW_KINDS.find((k) => k.id === kind)?.note && (
            <p className="rounded bg-amber-50 p-1 text-[10px] text-amber-900" data-mw-kind-note>
              {MW_KINDS.find((k) => k.id === kind)?.note}
            </p>
          )}
          <Input
            className="h-8 text-[11px]"
            placeholder="이름 (예: 로컬 캐시)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-mw-name
          />
          <div className="flex gap-1.5">
            <Input
              className="h-8 flex-1 font-mono text-[11px]"
              placeholder="host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              data-mw-host
            />
            <Input
              className="h-8 w-20 font-mono text-[11px]"
              placeholder="port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              data-mw-port
            />
          </div>
          <Input
            className="h-8 text-[11px]"
            placeholder="사용자 이름(선택)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            data-mw-username
          />
          <Input
            className="h-8 text-[11px]"
            type="password"
            placeholder="비밀번호(선택)"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            data-mw-secret
          />
          <p className="text-[10px] text-muted">
            비밀은 OS 키체인으로 암호화해 저장하고, <strong>꺼내는 창구가 없습니다.</strong>
          </p>
          {error && <p className="text-[10px] text-destructive">{error}</p>}
          <Button size="sm" onClick={() => void save()} data-mw-save>
            저장
          </Button>
        </div>
      </section>

      {/* 콘솔 */}
      <section className="flex min-w-0 flex-1 flex-col gap-2">
        {!active ? (
          <p className="text-xs text-muted">왼쪽에서 접속을 만들거나 고르세요.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-xs font-medium">
                {active.name}{' '}
                <span className="font-mono text-[10px] text-muted">
                  {active.host}:{active.port}
                </span>
              </h2>
              {activeKind && !activeKind.ready && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900" data-mw-not-ready>
                  아직 못 붙는 종류입니다
                </span>
              )}
              <div className="ml-auto flex flex-wrap gap-1">
                {quickCommandsOf(active.kind).map((q) => (
                  <Button
                    key={q.line}
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px]"
                    disabled={running}
                    onClick={() => void send(q.line)}
                    data-mw-quick={q.line}
                    title={q.line}
                  >
                    {q.label}
                  </Button>
                ))}
              </div>
            </div>

            <div
              className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-secondary/20 p-2"
              data-mw-output
            >
              {lines.length === 0 && (
                <p className="text-[11px] text-muted">
                  위의 빠른 명령을 누르거나 아래에 직접 쳐 보세요. <strong>전부 읽기 명령</strong>입니다.
                </p>
              )}
              {lines.map((l, i) => (
                <div key={i} className="mb-1.5" data-mw-line={i}>
                  <p className="font-mono text-[11px] text-muted">&gt; {l.command}</p>
                  <pre
                    className={cn(
                      'font-mono text-[11px] whitespace-pre-wrap',
                      l.ok ? '' : 'text-destructive'
                    )}
                  >
                    {l.output}
                  </pre>
                  <p className="text-[9px] text-muted">{l.ms}ms</p>
                </div>
              ))}
            </div>

            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                void send(input)
              }}
            >
              <Input
                className="flex-1 font-mono text-xs"
                placeholder="PING"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                data-mw-input
              />
              <Button size="sm" type="submit" disabled={running || !input.trim()} data-mw-send>
                {running ? '보내는 중…' : '보내기'}
              </Button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}
