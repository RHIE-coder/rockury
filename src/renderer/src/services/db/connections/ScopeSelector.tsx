import { useEffect, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Layers } from 'lucide-react'
import { cx } from '@renderer/lib/cx'
import { useNav } from '@renderer/nav/useNav'
import { reconcileScope, scopeModel, scopeSummary, shownScope, toggleSchema } from '../scope'
import { useRemoteStore } from '../remote/store'
import { ScopeMenu } from './ScopeMenu'
import { useActiveConnection, useConnectionsStore, useScopedConnections } from './store'

/**
 * **범위 손잡이** — 이 연결에서 볼 스키마를 고른다(§db-remote.scope).
 *
 * 자리는 뷰 탭 줄 오른쪽 끝, 운영 손잡이의 Connection 바로 뒤다. **한 자리에서만 고른다** —
 * Definition·Diagram·Data·Query 가 다 같은 값을 보므로, 뷰마다 손잡이를 두면 같은 연결인데
 * 화면끼리 다른 것을 보게 된다.
 *
 * 모양이 벤더마다 다른 이유는 `scope.ts` 에 적혀 있다. 요약: 다중 선택하는 층이
 * MySQL 은 database, PostgreSQL 은 schema 이고, PostgreSQL 의 database 층은 **연결을 갈아타는**
 * 자리라 목록만 보이고 고르면 그 연결로 옮겨 간다. SQLite 는 고를 것이 없어 손잡이가 안 뜬다.
 *
 * 값은 연결에 저장된다(`connections.schemas`) — 앱을 다시 열면 보던 범위로 돌아온다.
 * (목록·항목은 `ScopeMenu` 가 그린다 — 가져오기 창의 범위 칸과 같은 알맹이다.)
 */
export function ScopeSelector() {
  const conn = useActiveConnection()
  const connections = useScopedConnections()
  const setSchemas = useConnectionsStore((s) => s.setSchemas)
  const setContextValue = useNav((s) => s.setContextValue)
  const reload = useRemoteStore((s) => s.load)

  const [available, setAvailable] = useState<string[] | null>(null)
  const [catalogs, setCatalogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const model = conn ? scopeModel(conn.dbType) : null
  const connId = conn?.id ?? null
  // 지금 화면에 실제로 올라온 테이블들 — 손잡이에 적을 이름의 출처.
  const loaded = useRemoteStore((s) => (connId ? s.byEnv[connId] : undefined))

  // 연결이 바뀌면 고를 목록을 새로 읽는다. 실패해도 화면은 살아 있어야 한다 —
  // 범위를 못 읽는 것과 연결이 죽은 것은 다른 일이고, 후자는 각 뷰가 이미 말한다.
  useEffect(() => {
    if (!connId || !model?.selectable) {
      setAvailable(null)
      setCatalogs([])
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    void Promise.all([
      window.rockury.introspection.schemas(connId),
      model.hasCatalogLayer ? window.rockury.introspection.catalogs(connId) : Promise.resolve([])
    ])
      .then(([schemas, cats]) => {
        if (!alive) return
        setAvailable(schemas)
        setCatalogs(cats)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setAvailable([])
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [connId, model?.selectable, model?.hasCatalogLayer])

  if (!conn || !model?.selectable) return null

  // 저장된 범위에 없어진 스키마가 섞여 있을 수 있다 — 고를 수 있는 것만 남긴다.
  const selected = available ? reconcileScope(conn.schemas, available) : conn.schemas
  // 손잡이에는 **지금 실제로 보고 있는 것**을 적는다 — 안 고른 연결도 이름이 뜬다.
  const shown = shownScope(selected, loaded ?? [])

  const apply = (next: string[]): void => {
    void setSchemas(conn.id, next)
    // 저장이 끝나기를 기다리지 않고 새 범위로 바로 다시 읽는다 — 손잡이를 누른 즉시 화면이 따라온다.
    void reload(conn.id, conn.id, true, next)
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-scope-selector
          title={`${model.schemaLabel} 범위 — 여기서 고른 것을 Definition·Diagram·Data·Query 가 함께 봅니다`}
          className={cx(
            // 좁아지면 자기가 줄어든다 — 손잡이 밖으로 글자가 나가지 않게(2026-08-05).
            'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] transition-colors',
            'hover:bg-panel-strong data-[state=open]:bg-panel-strong',
            shown.length > 0 ? 'text-fg' : 'text-muted'
          )}
        >
          <Layers size={13} className="shrink-0 text-muted" />
          {/* 자기 상한 안에서만 줄어든다(`shrink-0` + `max-w`) — 모자란 폭은 연결 이름이 받는다.
              같이 줄어들던 동안은 `piccard` 가 `picca…` 로 갈렸다(2026-08-07 제보). */}
          <span className="max-w-[120px] shrink-0 truncate font-mono text-[12px] font-semibold">
            {scopeSummary(shown)}
          </span>
          <ChevronDown size={12} className="shrink-0 text-muted" />
        </button>
      </DropdownMenu.Trigger>

      <ScopeMenu
        model={model}
        current={conn}
        connections={connections}
        available={available}
        selected={selected}
        catalogs={catalogs}
        loading={loading}
        error={error}
        catalogHint="고르면 그 연결로 갑니다"
        onToggle={(s) => apply(toggleSchema(selected, s))}
        onPickCatalog={(target) => setContextValue('conn', target.id)}
      />
    </DropdownMenu.Root>
  )
}
