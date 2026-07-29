import { useMemo, useState } from 'react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { useInfraStore } from '../store'
import { describeTestFailure, pickTestProbe } from './connectionTest'
import { extractNodes, parseResponse } from './extract'

/** 연결 시험 한 번의 결과 — 성공/실패와 사람이 읽을 한 줄. */
interface TestResult {
  ok: boolean
  message: string
  /** 실제로 돌린 명령. 자격증명은 참조 그대로라 보여도 된다. */
  command: string
}

/**
 * 공급자 연결 — 카탈로그가 선언한 자격증명 칸을 채우는 화면.
 *
 * 입력칸은 **카탈로그가 선언한 슬롯대로 자동 생성**된다(공급자를 늘려도 화면 코드가 안 는다).
 * 값은 넣는 길만 있고 꺼내는 길이 없다 — 평문을 돌려주는 채널을 아예 만들지 않았다.
 */
export function ProvidersView(): React.JSX.Element {
  const store = useInfraStore()
  const [catalogId, setCatalogId] = useState('')
  const [name, setName] = useState('')
  const [readOnly, setReadOnly] = useState(true)
  const [creds, setCreds] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, TestResult>>({})

  // 자격증명이 없는 공급자도 연결 대상이다 — 로컬 도커가 그렇다.
  // 프리셋(모양만 모아 둔 카탈로그)은 읽을 것이 없으므로 제외한다.
  const connectable = useMemo(
    () => store.catalogs.filter((c) => c.catalog.nodeTypes.some((t) => t.discover)),
    [store.catalogs]
  )
  const chosen = store.catalogs.find((c) => c.id === catalogId)
  const slots = chosen?.catalog.credentials ?? []

  /**
   * 연결 시험 — 탐침 **하나**를 실제로 돌려 본다.
   * 전부 돌리면 느리고, 하나도 안 돌리면 "저장은 됐는데 붙는지는 모름"이 된다.
   * 실패하면 종료 코드와 표준 오류를 **그대로** 보인다(뭉개지 않는다).
   */
  const test = async (providerId: string, catalogId: string): Promise<void> => {
    const cat = store.catalogs.find((c) => c.id === catalogId)
    const probe = cat ? pickTestProbe(cat.catalog) : null
    if (!probe || probe.discover.call.type !== 'cli') return
    setTesting(providerId)
    try {
      const out = await window.rockury.infra.runProbe({
        providerId,
        cmd: probe.discover.call.cmd,
        args: probe.discover.call.args
      })
      if (!out.ok) {
        setResults((r) => ({
          ...r,
          [providerId]: {
            ok: false,
            command: out.displayCommand,
            message: describeTestFailure({
              timedOut: out.timedOut,
              exitCode: out.exitCode,
              stderr: out.stderr,
              error: out.error ?? ''
            })
          }
        }))
        return
      }
      // 명령이 돌았다고 끝이 아니다 — 우리가 그 응답을 **읽을 수 있어야** 연결된 것이다.
      const parsed = parseResponse(out.stdout, probe.discover.format)
      if (parsed.error) {
        setResults((r) => ({
          ...r,
          [providerId]: { ok: false, command: out.displayCommand, message: parsed.error as string }
        }))
        return
      }
      const got = extractNodes(probe.discover, parsed.data)
      setResults((r) => ({
        ...r,
        [providerId]: got.error
          ? { ok: false, command: out.displayCommand, message: got.error }
          : {
              ok: true,
              command: out.displayCommand,
              message: `${probe.label} ${got.nodes.length}건을 읽었습니다.`
            }
      }))
    } catch (e) {
      setResults((r) => ({
        ...r,
        [providerId]: { ok: false, command: '', message: e instanceof Error ? e.message : String(e) }
      }))
    } finally {
      setTesting(null)
    }
  }

  const submit = async (): Promise<void> => {
    setError(null)
    try {
      await window.rockury.infra.saveProvider({
        catalogId,
        name: name.trim() || (chosen?.catalog.provider.label ?? '연결'),
        readOnly,
        credentials: creds
      })
      setName('')
      setCreds({})
      await store.reloadProviders()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex h-full min-h-0 gap-4 p-4" data-infra-view="providers">
      <section className="flex min-w-0 flex-1 flex-col">
        <h2 className="mb-2 text-xs font-medium">연결 목록</h2>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
          {store.providers.length === 0 && (
            <p className="p-4 text-xs text-muted">아직 연결이 없습니다.</p>
          )}
          {store.providers.map((p) => {
            const cat = store.catalogs.find((c) => c.id === p.catalogId)
            const probe = cat ? pickTestProbe(cat.catalog) : null
            const result = results[p.id]
            return (
              <div key={p.id} className="border-b border-border last:border-b-0" data-provider-row={p.id}>
                <div className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted">
                    {p.hasCredentials ? '자격증명 있음' : '자격증명 없음'}
                  </span>
                  {p.readOnly && (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">
                      읽기 전용 표시
                    </span>
                  )}
                  {probe && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={testing === p.id}
                      onClick={() => void test(p.id, p.catalogId)}
                      data-provider-test={p.id}
                      title={`'${probe.label}' 탐침을 한 번 돌려 봅니다.`}
                    >
                      {testing === p.id ? '시험 중…' : '연결 시험'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await window.rockury.infra.deleteProvider(p.id)
                      await store.reloadProviders()
                    }}
                  >
                    삭제
                  </Button>
                </div>
                {result && (
                  <div
                    className={cn(
                      'mx-3 mb-2 rounded p-2 text-[11px]',
                      result.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'
                    )}
                    data-provider-test-result={result.ok ? 'ok' : 'fail'}
                  >
                    <span className="font-medium">{result.ok ? '연결됨' : '연결 실패'}</span> —{' '}
                    {result.message}
                    {result.command && (
                      <p className="mt-0.5 font-mono text-[10px] opacity-70">{result.command}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted">
          연결을 지워도 <strong>설계본은 그대로</strong> 남습니다 — 설계는 실물과 독립입니다.
        </p>
      </section>

      <section className="flex w-[360px] shrink-0 flex-col gap-2 rounded-md border border-border p-3">
        <h2 className="text-xs font-medium">새 연결</h2>

        <label className="flex flex-col gap-1 text-[11px] text-muted">
          카탈로그
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={catalogId}
            onChange={(e) => {
              setCatalogId(e.target.value)
              setCreds({})
            }}
            data-provider-catalog
          >
            <option value="">— 고르세요 —</option>
            {connectable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.catalog.provider.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-muted">
          이름
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="prod" data-provider-name />
        </label>

        {slots.length === 0 && (
          <p className="text-[11px] text-muted">
            이 공급자는 자격증명이 필요 없습니다(로컬에서 바로 읽습니다).
          </p>
        )}
        {slots.map((s) => (
          <label key={s.id} className="flex flex-col gap-1 text-[11px] text-muted">
            {s.label}
            {s.hint && <span className="-mt-1 text-[10px]">{s.hint}</span>}
            <Input
              type="password"
              value={creds[s.id] ?? ''}
              onChange={(e) => setCreds({ ...creds, [s.id]: e.target.value })}
              data-provider-cred={s.id}
            />
          </label>
        ))}

        <label className="mt-1 flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
          이 연결을 읽기 전용으로 표시
        </label>
        <p className="text-[10px] text-muted">
          이 표시는 <strong>보조선</strong>입니다. 실제로 무엇을 할 수 있는지는 클라우드 쪽 권한 설정(IAM)이
          정합니다 — 읽기 전용 자격증명을 쓰는 것이 진짜 안전선입니다.
        </p>

        {error && <p className="text-[11px] text-destructive">{error}</p>}

        <Button size="sm" disabled={!catalogId} onClick={() => void submit()} data-provider-save>
          저장
        </Button>
      </section>
    </div>
  )
}
