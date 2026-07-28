import { useMemo, useState } from 'react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { useInfraStore } from '../store'

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

  // 자격증명이 없는 공급자도 연결 대상이다 — 로컬 도커가 그렇다.
  // 프리셋(모양만 모아 둔 카탈로그)은 읽을 것이 없으므로 제외한다.
  const connectable = useMemo(
    () => store.catalogs.filter((c) => c.catalog.nodeTypes.some((t) => t.discover)),
    [store.catalogs]
  )
  const chosen = store.catalogs.find((c) => c.id === catalogId)
  const slots = chosen?.catalog.credentials ?? []

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
            <p className="p-4 text-xs text-muted-foreground">아직 연결이 없습니다.</p>
          )}
          {store.providers.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs last:border-b-0"
              data-provider-row={p.id}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {p.hasCredentials ? '자격증명 있음' : '자격증명 없음'}
              </span>
              {p.readOnly && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">
                  읽기 전용 표시
                </span>
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
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          연결을 지워도 <strong>설계본은 그대로</strong> 남습니다 — 설계는 실물과 독립입니다.
        </p>
      </section>

      <section className="flex w-[360px] shrink-0 flex-col gap-2 rounded-md border border-border p-3">
        <h2 className="text-xs font-medium">새 연결</h2>

        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
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

        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          이름
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="prod" data-provider-name />
        </label>

        {slots.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            이 공급자는 자격증명이 필요 없습니다(로컬에서 바로 읽습니다).
          </p>
        )}
        {slots.map((s) => (
          <label key={s.id} className="flex flex-col gap-1 text-[11px] text-muted-foreground">
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
        <p className="text-[10px] text-muted-foreground">
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
