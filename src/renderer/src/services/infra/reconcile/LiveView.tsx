import { useEffect, useMemo } from 'react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import { InfraIcon } from '../catalog/iconMap'
import { STATUS_LABEL, type NodeStatus } from '../catalog/types'
import { typesOf, useInfraStore } from '../store'

/**
 * 실물 지도 — 공급자에 붙어 읽어 온 것을 그대로 보여 준다.
 *
 * 두 가지를 절대 숨기지 않는다:
 *  1. **언제 기준인지** — 클라우드는 느려서 스냅샷을 보여 주는 것이지 실시간이 아니다.
 *  2. **못 읽은 것** — 일부 탐침이 실패해도 나머지는 보이고, 실패는 실패로 남는다.
 *     조용히 넘기면 사용자는 자기 인프라가 다 보이고 있다고 믿는다.
 */

const tone: Record<NodeStatus, string> = {
  ok: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-800',
  stopped: 'bg-neutral-200 text-neutral-700',
  gone: 'bg-rose-100 text-rose-800',
  unknown: 'bg-sky-100 text-sky-800'
}

/** "○분 전 기준" — 방금 읽은 것처럼 보이지 않게 늘 함께 띄운다. */
export function agoLabel(takenAt: string, now: number = Date.now()): string {
  const ms = now - new Date(takenAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '기준 시각 알 수 없음'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return '방금 기준'
  if (min < 60) return `${min}분 전 기준`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전 기준`
  return `${Math.floor(hour / 24)}일 전 기준`
}

export function LiveView(): React.JSX.Element {
  const store = useInfraStore()
  const types = useMemo(() => typesOf(store.catalogs), [store.catalogs])
  const provider =
    store.providers.find((p) => p.id === store.activeProviderId) ?? store.providers[0] ?? null

  useEffect(() => {
    if (provider && !store.snapshot && !store.syncing) void store.loadSnapshot(provider.id)
    // 최초 1회만 — 자동 폴링은 기본 꺼짐(요금·호출 제한).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.id])

  if (!provider) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        먼저 Catalog › 공급자에서 연결을 만드세요.
      </div>
    )
  }

  const snap = store.snapshot
  const failed = (snap?.probes ?? []).filter((p) => !p.ok)

  return (
    <div className="flex h-full min-h-0 flex-col p-4" data-infra-view="live">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={provider.id}
          onChange={(e) => void store.loadSnapshot(e.target.value)}
          data-live-provider
        >
          {store.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={() => void store.syncProvider(provider.id)}
          disabled={store.syncing}
          data-live-sync
        >
          {store.syncing ? '읽는 중…' : '새로고침'}
        </Button>
        <span className="text-xs text-muted-foreground" data-live-taken-at>
          {snap ? agoLabel(snap.takenAt) : '아직 읽지 않았습니다'}
        </span>
        <span className="text-[11px] text-muted-foreground">
          자동 갱신은 꺼져 있습니다 — 호출 제한·요금 때문에 직접 누를 때만 읽습니다.
        </span>
      </div>

      {failed.length > 0 && (
        <div
          className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900"
          data-live-failed
        >
          못 읽은 것 {failed.length}건 — 나머지는 아래에 그대로 보입니다.
          <ul className="mt-1 flex flex-col gap-0.5">
            {failed.map((p) => (
              <li key={p.typeId} className="font-mono">
                {types[p.typeId]?.label ?? p.typeId}: {p.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-secondary/60 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">종류</th>
              <th className="px-3 py-2 font-medium">이름</th>
              <th className="px-3 py-2 font-medium">식별자</th>
              <th className="px-3 py-2 font-medium">상태</th>
              <th className="px-3 py-2 font-medium">담긴 곳</th>
            </tr>
          </thead>
          <tbody>
            {(snap?.resources ?? []).map((r) => {
              const t = types[r.typeId]
              return (
                <tr key={`${r.typeId}:${r.externalId}`} className="border-t border-border" data-live-row>
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span style={{ color: t?.color }}>
                        <InfraIcon icon={t?.icon ?? 'phosphor:cube'} size={14} />
                      </span>
                      {t?.label ?? (
                        <span className="text-amber-700" title="카탈로그에 없는 종류입니다">
                          미상({r.typeId})
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{r.externalId}</td>
                  <td className="px-3 py-1.5">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px]', tone[r.status])}>
                      {STATUS_LABEL[r.status]}
                    </span>
                    {r.rawStatus && (
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{r.rawStatus}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {r.parentExternalId ?? ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {snap && snap.resources.length === 0 && (
          <p className="p-4 text-xs text-muted-foreground">읽어 온 것이 없습니다.</p>
        )}
        {!snap && (
          <p className="p-4 text-xs text-muted-foreground">
            `새로고침` 을 누르면 이 연결의 탐침을 돌려 실물을 읽어 옵니다.
          </p>
        )}
      </div>
    </div>
  )
}
