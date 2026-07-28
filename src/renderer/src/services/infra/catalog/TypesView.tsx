import { useMemo, useState } from 'react'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { InfraIcon } from './iconMap'
import { SOURCE_LABEL, type CatalogSource } from './types'
import { useInfraStore } from '../store'

/**
 * 노드 종류 목록 — 카탈로그(탐침 있음)와 프리셋(모양만)을 한 목록에서 본다.
 *
 * 출처를 늘 같이 보인다. **가져온 카탈로그에서 온 종류라는 사실은 계속 눈에 보여야 한다**(신뢰 경계) —
 * 그 종류가 실행할 명령을 들고 있기 때문이다.
 */

const sourceTone: Record<CatalogSource, string> = {
  builtin: 'bg-neutral-200 text-neutral-700',
  mine: 'bg-emerald-100 text-emerald-800',
  imported: 'bg-amber-100 text-amber-900'
}

export function TypesView(): React.JSX.Element {
  const catalogs = useInfraStore((s) => s.catalogs)
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase()
    return catalogs.flatMap((c) =>
      c.catalog.nodeTypes
        .filter((t) => !query || t.label.toLowerCase().includes(query) || t.id.toLowerCase().includes(query))
        .map((t) => ({ type: t, source: c.source, provider: c.catalog.provider.label, version: c.catalog.catalogVersion }))
    )
  }, [catalogs, q])

  const probeCount = rows.filter((r) => r.type.discover).length

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
        <p className="text-xs text-muted-foreground" data-types-count>
          {rows.length}개 · 탐침 있음 {probeCount}개 · 프리셋 {rows.length - probeCount}개
        </p>
      </div>

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
                <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{r.type.id}</td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {r.type.canContain?.includes('*')
                    ? '무엇이든 담음'
                    : (r.type.canNestIn?.join(' · ') ?? '최상위')}
                </td>
                <td className="px-3 py-1.5">
                  {r.type.discover ? (
                    <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-800">탐침 있음</span>
                  ) : (
                    <span className="text-muted-foreground">모양만(프리셋)</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px]', sourceTone[r.source])}>
                    {SOURCE_LABEL[r.source]}
                  </span>
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    {r.provider} {r.version}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-xs text-muted-foreground">찾는 종류가 없습니다.</p>}
      </div>
    </div>
  )
}
