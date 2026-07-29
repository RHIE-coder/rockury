import { useMemo, useState } from 'react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { InfraIcon } from './iconMap'
import { makePresetType } from './presets'
import { SOURCE_LABEL, type CatalogSource } from './types'
import { useInfraStore } from '../store'

/**
 * 노드 종류 목록 — 카탈로그(탐침 있음)와 프리셋(모양만)을 한 목록에서 본다.
 *
 * 출처를 늘 같이 보인다. **가져온 카탈로그에서 온 종류라는 사실은 계속 눈에 보여야 한다**(신뢰 경계) —
 * 그 종류가 실행할 명령을 들고 있기 때문이다.
 *
 * 여기서 두 가지가 시작된다:
 *   **새 프리셋** — 모양만 있는 종류를 만든다(탐침 정의 없이 그림에 올릴 수 있어야 한다).
 *   **승격** — 프리셋에 탐침을 붙여 읽어 오는 종류로 올린다. 종류 id 를 그대로 이어받는다.
 */

const sourceTone: Record<CatalogSource, string> = {
  builtin: 'bg-neutral-200 text-neutral-700',
  mine: 'bg-emerald-100 text-emerald-800',
  imported: 'bg-amber-100 text-amber-900'
}

export function TypesView(): React.JSX.Element {
  const store = useInfraStore()
  const catalogs = store.catalogs
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ id: '', label: '', icon: '', box: false })
  const [saveTo, setSaveTo] = useState('')
  const [newProviderId, setNewProviderId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase()
    return catalogs.flatMap((c) =>
      c.catalog.nodeTypes
        .filter((t) => !query || t.label.toLowerCase().includes(query) || t.id.toLowerCase().includes(query))
        .map((t) => ({ type: t, source: c.source, provider: c.catalog.provider.label, version: c.catalog.catalogVersion }))
    )
  }, [catalogs, q])

  const probeCount = rows.filter((r) => r.type.discover).length
  const mine = catalogs.filter((c) => c.source === 'mine')

  const createPreset = async (): Promise<void> => {
    setMsg(null)
    const made = makePresetType({
      id: form.id,
      label: form.label,
      icon: form.icon,
      canContain: form.box ? ['*'] : undefined
    })
    if (!made.ok) {
      setMsg(made.error)
      return
    }
    const providerId = newProviderId.trim() || made.type.id.split('.')[0]
    try {
      await store.saveNodeType({
        catalogId: saveTo || null,
        providerId,
        providerLabel: providerId,
        type: made.type
      })
      setMsg(`'${made.type.label}' 을 만들었습니다 — 설계 캔버스의 종류 목록에 바로 뜹니다.`)
      setForm({ id: '', label: '', icon: '', box: false })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-4" data-infra-view="types">
      <div className="mb-3 flex items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="종류 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-types-search
        />
        <p className="text-xs text-muted" data-types-count>
          {rows.length}개 · 탐침 있음 {probeCount}개 · 프리셋 {rows.length - probeCount}개
        </p>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => setCreating((v) => !v)}
          data-types-new-preset
        >
          {creating ? '닫기' : '새 프리셋'}
        </Button>
      </div>

      {creating && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3" data-preset-form>
          <p className="w-full text-[11px] text-muted">
            <strong>모양만 있는 종류</strong>를 만듭니다 — 탐침(읽어 오는 법)은 없어도 됩니다. 그림에 먼저
            올리고, 나중에 읽어 올 수 있게 되면 <strong>승격</strong>으로 탐침을 붙이면 됩니다.
          </p>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            종류 id
            <Input
              className="h-8 w-48 font-mono text-[11px]"
              placeholder="my.grafana"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              data-preset-id
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            표시 이름
            <Input
              className="h-8 w-40 text-[11px]"
              placeholder="그라파나"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              data-preset-label
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            아이콘(선택)
            <Input
              className="h-8 w-44 font-mono text-[11px]"
              placeholder="phosphor:chart-line"
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              data-preset-icon
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            어느 카탈로그에
            <select
              className="h-8 rounded-md border border-input bg-background px-1.5 text-xs"
              value={saveTo}
              onChange={(e) => setSaveTo(e.target.value)}
              data-preset-catalog
            >
              <option value="">— 새 카탈로그 만들기 —</option>
              {mine.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.catalog.provider.label}
                </option>
              ))}
            </select>
          </label>
          {!saveTo && (
            <Input
              className="h-8 w-40 font-mono text-[11px]"
              placeholder="새 공급자 id"
              value={newProviderId}
              onChange={(e) => setNewProviderId(e.target.value)}
              data-preset-provider-id
            />
          )}
          <label className="flex items-center gap-1.5 pb-1.5 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={form.box}
              onChange={(e) => setForm({ ...form, box: e.target.checked })}
              data-preset-box
            />
            무엇이든 담는 상자
          </label>
          <Button size="sm" onClick={() => void createPreset()} data-preset-save>
            만들기
          </Button>
          {msg && (
            <p className="w-full text-[11px] text-muted" data-preset-msg>
              {msg}
            </p>
          )}
        </div>
      )}

      {store.promoting && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 p-2" data-promote-banner>
          <p className="flex-1 text-[11px] text-sky-900">
            <strong>&lsquo;{store.promoting.label}&rsquo; 승격 중</strong> — <strong>탐침</strong> 뷰로 가서 명령을 한 번
            돌리고 저장하면 이 종류에 읽어 오는 법이 붙습니다. 종류 id(
            <span className="font-mono">{store.promoting.id}</span>)는 그대로 이어받으므로{' '}
            <strong>이미 그려 둔 노드는 그대로 남습니다.</strong>
          </p>
          <Button size="sm" variant="ghost" onClick={() => store.clearPromotion()} data-promote-cancel>
            취소
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-secondary/60 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">종류</th>
              <th className="px-3 py-2 font-medium">id</th>
              <th className="px-3 py-2 font-medium">담길 곳</th>
              <th className="px-3 py-2 font-medium">읽기</th>
              <th className="px-3 py-2 font-medium">출처</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.source}:${r.type.id}`} className="border-t border-border" data-type-row={r.type.id}>
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-1.5">
                    <span style={{ color: r.type.color }}>
                      <InfraIcon icon={r.type.icon} size={15} />
                    </span>
                    {r.type.label}
                  </span>
                </td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-muted">{r.type.id}</td>
                <td className="px-3 py-1.5 text-muted">
                  {r.type.canContain?.includes('*')
                    ? '무엇이든 담음'
                    : (r.type.canNestIn?.join(' · ') ?? '최상위')}
                </td>
                <td className="px-3 py-1.5">
                  {r.type.discover ? (
                    <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-800">탐침 있음</span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span className="text-muted">모양만(프리셋)</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px]"
                        onClick={() => store.startPromotion(r.type)}
                        data-type-promote={r.type.id}
                        title="탐침을 붙여 읽어 오는 종류로 올립니다. 종류 id 는 그대로입니다."
                      >
                        승격
                      </Button>
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px]', sourceTone[r.source])}>
                    {SOURCE_LABEL[r.source]}
                  </span>
                  <span className="ml-1.5 text-[10px] text-muted">
                    {r.provider} {r.version}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-xs text-muted">찾는 종류가 없습니다.</p>}
      </div>
    </div>
  )
}
