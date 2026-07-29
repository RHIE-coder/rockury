import { useMemo, useState } from 'react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { parseCatalog, serializeCatalog } from './schema'
import { commandsOf } from './userCatalog'
import { SOURCE_LABEL, type CatalogSource } from './types'
import { useInfraStore, type StoredCatalog } from '../store'

/**
 * 카탈로그 목록 · 가져오기 · 내보내기.
 *
 * **가져오기가 이 화면의 요점이다.** 남이 만든 카탈로그는 곧 남이 적어 준 **명령 묶음**이라,
 * 무엇이 돌아갈지 보여 주지 않고 저장하면 그건 승인이 아니라 요식이다.
 * 그래서 순서를 못 박았다 — 붙여넣기 → **검증** → **실행될 명령 전부 보이기** → 명시적 승인 → 저장.
 */

const sourceTone: Record<CatalogSource, string> = {
  builtin: 'bg-neutral-200 text-neutral-700',
  mine: 'bg-emerald-100 text-emerald-800',
  imported: 'bg-amber-100 text-amber-900'
}

export function CatalogsView(): React.JSX.Element {
  const store = useInfraStore()
  const [pasted, setPasted] = useState('')
  const [pending, setPending] = useState<unknown>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [exported, setExported] = useState<{ name: string; text: string } | null>(null)
  const [cloning, setCloning] = useState<StoredCatalog | null>(null)
  const [cloneId, setCloneId] = useState('')

  const pendingCommands = useMemo(() => {
    if (!pending) return []
    try {
      return commandsOf(pending as never)
    } catch {
      return []
    }
  }, [pending])

  /**
   * 검토 — **저장하지 않는다.** 형식 검증만 하고 통과한 것만 명령 목록으로 펼친다.
   * 여기서 저장해 버리면 아래 "승인" 버튼이 장식이 된다.
   */
  const review = (): void => {
    setErrors([])
    setPending(null)
    let raw: unknown
    try {
      raw = JSON.parse(pasted) as unknown
    } catch (e) {
      setErrors([`JSON 이 아닙니다: ${e instanceof Error ? e.message : e}`])
      return
    }
    const parsed = parseCatalog(raw)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      return
    }
    setPending(parsed.catalog)
  }

  const approve = async (): Promise<void> => {
    if (!pending) return
    const r = await store.importCatalog(pending)
    if (r.ok) {
      setPending(null)
      setPasted('')
      setErrors([])
    } else {
      setErrors(r.errors)
      setPending(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 gap-4 p-4" data-infra-view="catalogs">
      <section className="flex min-w-0 flex-1 flex-col">
        <h2 className="mb-2 text-xs font-medium">카탈로그 {store.catalogs.length}개</h2>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-secondary/60 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">공급자</th>
                <th className="px-3 py-2 font-medium">버전</th>
                <th className="px-3 py-2 font-medium">종류</th>
                <th className="px-3 py-2 font-medium">출처</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {store.catalogs.map((c) => {
                const probes = c.catalog.nodeTypes.filter((t) => t.discover).length
                return (
                  <tr key={c.id} className="border-t border-border" data-catalog-row={c.id}>
                    <td className="px-3 py-1.5">{c.catalog.provider.label}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-muted">
                      {c.catalog.catalogVersion}
                    </td>
                    <td className="px-3 py-1.5 text-muted">
                      {c.catalog.nodeTypes.length}개 (탐침 {probes})
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px]', sourceTone[c.source])}>
                        {SOURCE_LABEL[c.source]}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px]"
                          data-catalog-export={c.id}
                          onClick={() =>
                            setExported({
                              name: `${c.catalog.provider.id}.json`,
                              text: serializeCatalog(c.catalog)
                            })
                          }
                        >
                          내보내기
                        </Button>
                        {c.source === 'builtin' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[11px]"
                            data-catalog-clone={c.id}
                            onClick={() => {
                              setCloning(c)
                              setCloneId(`${c.catalog.provider.id}-copy`)
                            }}
                          >
                            복제
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[11px]"
                            data-catalog-delete={c.id}
                            onClick={() => void store.removeCatalog(c.id)}
                          >
                            삭제
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          내장 카탈로그는 앱과 함께 업데이트됩니다 — 고치려면 <strong>복제</strong>해서 내 것으로 만드세요.
        </p>

        {cloning && (
          <div className="mt-2 flex items-end gap-2 rounded-md border border-border p-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              새 공급자 id
              <Input
                className="h-8 w-40 font-mono text-xs"
                value={cloneId}
                onChange={(e) => setCloneId(e.target.value)}
                data-catalog-clone-id
              />
            </label>
            <Button
              size="sm"
              data-catalog-clone-save
              onClick={async () => {
                await store.cloneCatalog(cloning.id, cloneId, `${cloning.catalog.provider.label} (내 사본)`)
                setCloning(null)
              }}
            >
              복제 저장
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCloning(null)}>
              취소
            </Button>
          </div>
        )}

        {exported && (
          <div className="mt-2 flex flex-col gap-1 rounded-md border border-border p-2">
            <span className="text-[11px] text-muted">
              {exported.name} — 자격증명 값은 들어 있지 않습니다(참조만).
            </span>
            <textarea
              className="h-28 rounded border border-input bg-background p-2 font-mono text-[10px]"
              readOnly
              value={exported.text}
              data-catalog-exported
            />
            <Button size="sm" variant="ghost" className="self-end" onClick={() => setExported(null)}>
              닫기
            </Button>
          </div>
        )}
      </section>

      <section className="flex w-[420px] shrink-0 flex-col gap-2 rounded-md border border-border p-3">
        <h2 className="text-xs font-medium">가져오기</h2>
        <p className="text-[11px] text-muted">
          카탈로그 JSON 을 붙여 넣으세요. 저장 전에 <strong>이 파일이 돌릴 명령을 전부</strong> 보여 드립니다.
        </p>
        <textarea
          className="h-40 rounded-md border border-input bg-background p-2 font-mono text-[11px]"
          placeholder='{ "schemaVersion": 1, ... }'
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          data-catalog-paste
        />
        <Button size="sm" variant="outline" disabled={!pasted.trim()} onClick={review} data-catalog-review>
          검토하기
        </Button>

        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2" data-catalog-errors>
            <p className="text-[11px] font-medium text-destructive">저장하지 않았습니다 — 형식 문제:</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {errors.map((e, i) => (
                <li key={i} className="font-mono text-[10px] text-destructive">
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}

        {pending !== null && (
          <div className="flex min-h-0 flex-col gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2">
            <p className="text-[11px] font-medium text-amber-900">
              이 카탈로그는 아래 명령을 돌리게 됩니다 — 승인해야 저장됩니다.
            </p>
            <div className="max-h-40 overflow-auto" data-catalog-commands>
              {pendingCommands.length === 0 && (
                <p className="text-[11px] text-amber-900">돌릴 명령이 없습니다(모양만 있는 프리셋).</p>
              )}
              <ul className="flex flex-col gap-0.5">
                {pendingCommands.map((r, i) => (
                  <li key={i} className="font-mono text-[10px] text-amber-900">
                    [{r.kind}
                    {r.danger ? '·위험' : ''}] {r.typeLabel}: {r.command}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => void approve()} data-catalog-approve>
                승인하고 저장
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                취소
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
