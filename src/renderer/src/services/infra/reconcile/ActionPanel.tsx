import { useState } from 'react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import {
  actionBlockReason,
  actionVars,
  checkArgs,
  describeAction,
  type ActionTarget
} from '../catalog/actions'
import type { ActionDef } from '../catalog/types'
import type { ProviderPublic } from '../store'

/**
 * 액션 버튼 — **Rockury 가 실물을 바꾸는 유일한 통로**(D1).
 *
 * 셸을 붙이지 않는 이유(D9): 하는 일 대부분은 정해진 명령 한 줄이고, 로컬 셸(PTY)은 네이티브
 * 모듈이라 프로젝트 규칙과 부딪힌다. 그리고 Supabase·Vercel·Cloudflare 는 **셸에 붙을 기계가 없다** —
 * 이들에겐 버튼이 유일한 길이다.
 *
 * 화면 규율 셋:
 *   1. **무엇이 돌아갈지 먼저 보인다.** 버튼 라벨만 보고 누르게 하지 않는다.
 *   2. **위험한 것은 한 번 더 묻는다.** 잠금은 메인이 다시 강제한다(여기서만 막으면 권유다).
 *   3. **결과를 뭉개지 않는다.** 종료 코드·표준 출력·표준 오류를 그대로 보인다.
 */

interface RunState {
  actionId: string
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  command: string
  durationMs: number
}

export function ActionPanel({
  actions,
  target,
  provider
}: {
  actions: ActionDef[]
  target: ActionTarget
  provider: ProviderPublic | null
}): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [result, setResult] = useState<RunState | null>(null)

  const reset = (): void => {
    setForm({})
    setMissing([])
    setConfirming(null)
  }

  const run = async (action: ActionDef): Promise<void> => {
    const checked = checkArgs(action, form)
    if (!checked.ok) {
      setMissing(checked.missing)
      return
    }
    if (!provider) return
    setMissing([])
    setRunning(action.id)
    setConfirming(null)
    try {
      const vars = actionVars(target, checked.values)
      const call = action.call
      if (call.type !== 'cli') {
        setResult({
          actionId: action.id,
          ok: false,
          exitCode: null,
          stdout: '',
          stderr: '아직 CLI 액션만 실행합니다.',
          command: describeAction(action),
          durationMs: 0
        })
        return
      }
      const out = await window.rockury.infra.runAction({
        providerId: provider.id,
        cmd: call.cmd,
        args: call.args,
        node: vars.node,
        arg: vars.arg,
        danger: action.danger
      })
      setResult({
        actionId: action.id,
        ok: out.ok,
        exitCode: out.exitCode,
        stdout: out.stdout,
        stderr: out.stderr || (out.error ?? ''),
        command: out.displayCommand,
        durationMs: out.durationMs
      })
    } catch (e) {
      setResult({
        actionId: action.id,
        ok: false,
        exitCode: null,
        stdout: '',
        stderr: e instanceof Error ? e.message : String(e),
        command: describeAction(action),
        durationMs: 0
      })
    } finally {
      setRunning(null)
    }
  }

  if (actions.length === 0) {
    return (
      <p className="p-3 text-[11px] text-muted-foreground" data-action-none>
        이 종류에는 정의된 액션이 없습니다 — 카탈로그에 `actions` 를 적으면 여기 버튼으로 뜹니다.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3" data-action-panel={target.externalId}>
      <p className="text-[11px] text-muted-foreground">
        <strong className="text-foreground">{target.name || target.externalId}</strong> 에 대고 돌립니다.
      </p>

      {actions.map((a) => {
        const blocked = actionBlockReason(a, provider)
        const isOpen = open === a.id
        return (
          <div key={a.id} className="rounded-md border border-border">
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <Button
                size="sm"
                variant={a.danger ? 'destructive' : 'outline'}
                disabled={Boolean(blocked)}
                onClick={() => {
                  setOpen(isOpen ? null : a.id)
                  reset()
                }}
                data-action-open={a.id}
                title={blocked ?? describeAction(a)}
              >
                {a.label}
              </Button>
              {a.danger && (
                <span className="rounded bg-rose-100 px-1 text-[9px] text-rose-900" data-action-danger={a.id}>
                  실물을 바꿈
                </span>
              )}
              {blocked && (
                <span className="text-[10px] text-muted-foreground" data-action-blocked={a.id}>
                  {blocked}
                </span>
              )}
            </div>

            {isOpen && !blocked && (
              <div className="flex flex-col gap-1.5 border-t border-border px-2 py-2">
                {/* 무엇이 돌아갈지 먼저 보인다 — 라벨만 보고 누르게 하지 않는다. */}
                <p className="font-mono text-[10px] break-all text-muted-foreground" data-action-preview={a.id}>
                  {describeAction(a)}
                </p>

                {(a.args ?? []).map((arg) => (
                  <label key={arg.id} className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                    {arg.label}
                    {arg.required && <span className="text-[9px]">필수</span>}
                    <Input
                      className="h-7 text-[11px]"
                      placeholder={arg.placeholder}
                      value={form[arg.id] ?? ''}
                      onChange={(e) => setForm({ ...form, [arg.id]: e.target.value })}
                      data-action-arg={arg.id}
                    />
                  </label>
                ))}

                {missing.length > 0 && (
                  <p className="text-[10px] text-destructive" data-action-missing>
                    빠진 값: {missing.join(' · ')}
                  </p>
                )}

                {a.danger && confirming === a.id ? (
                  <div className="rounded bg-rose-50 p-1.5" data-action-confirm={a.id}>
                    <p className="text-[10px] text-rose-900">
                      이 액션은 <strong>실물을 바꿉니다.</strong> 되돌리는 것은 Rockury 밖의 일입니다.
                    </p>
                    <div className="mt-1 flex gap-1">
                      <Button size="sm" variant="destructive" onClick={() => void run(a)} data-action-confirm-yes={a.id}>
                        정말 실행
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                        취소
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    disabled={running === a.id}
                    onClick={() => (a.danger ? setConfirming(a.id) : void run(a))}
                    data-action-run={a.id}
                  >
                    {running === a.id ? '돌리는 중…' : a.danger ? '실행하기' : '돌리기'}
                  </Button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {result && (
        <div className="mt-1 rounded-md border border-border" data-action-output={result.actionId}>
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1 text-[10px]">
            <span
              className={cn(
                'rounded px-1',
                result.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-900'
              )}
              data-action-exit={result.exitCode ?? 'none'}
            >
              종료 코드 {result.exitCode ?? '(없음)'}
            </span>
            <span className="text-muted-foreground">{result.durationMs}ms</span>
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{result.command}</span>
          </div>
          <pre
            className="max-h-48 overflow-auto p-2 font-mono text-[10px] whitespace-pre-wrap"
            data-action-stdout
          >
            {result.stdout || '(표준 출력 없음)'}
          </pre>
          {result.stderr && (
            <pre
              className="max-h-32 overflow-auto border-t border-border bg-destructive/5 p-2 font-mono text-[10px] whitespace-pre-wrap text-destructive"
              data-action-stderr
            >
              {result.stderr}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
