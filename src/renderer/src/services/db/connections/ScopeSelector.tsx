import { useEffect, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Database, Layers, Loader2 } from 'lucide-react'
import { cx } from '@renderer/lib/cx'
import { useNav } from '@renderer/nav/useNav'
import {
  findConnectionForCatalog,
  reconcileScope,
  scopeModel,
  scopeSummary,
  shownScope,
  toggleSchema
} from '../scope'
import { useRemoteStore } from '../remote/store'
import { useActiveConnection, useConnectionsStore } from './store'

/**
 * **범위 손잡이** — 이 연결에서 볼 스키마를 고른다(§db-remote.scope).
 *
 * 자리는 상단 컨텍스트 바의 Connection 칸 바로 뒤다. **한 자리에서만 고른다** —
 * Definition·Diagram·Data·Query 가 다 같은 값을 보므로, 뷰마다 손잡이를 두면 같은 연결인데
 * 화면끼리 다른 것을 보게 된다.
 *
 * 모양이 벤더마다 다른 이유는 `scope.ts` 에 적혀 있다. 요약: 다중 선택하는 층이
 * MySQL 은 database, PostgreSQL 은 schema 이고, PostgreSQL 의 database 층은 **연결을 갈아타는**
 * 자리라 목록만 보이고 고르면 그 연결로 옮겨 간다. SQLite 는 고를 것이 없어 손잡이가 안 뜬다.
 *
 * 값은 연결에 저장된다(`connections.schemas`) — 앱을 다시 열면 보던 범위로 돌아온다.
 */
export function ScopeSelector() {
  const conn = useActiveConnection()
  const connections = useConnectionsStore((s) => s.connections)
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

  const goToCatalog = (catalog: string): void => {
    const target = findConnectionForCatalog(connections, conn, catalog)
    if (target) setContextValue('conn', target.id)
    // 갈 연결이 없으면 아무 일도 하지 않는다(아래 메뉴가 그 항목을 흐리게 그리고 이유를 말한다).
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-scope-selector
          title={`${model.schemaLabel} 범위 — 여기서 고른 것을 Definition·Diagram·Data·Query 가 함께 봅니다`}
          className={cx(
            'flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] transition-colors',
            'hover:bg-panel-strong data-[state=open]:bg-panel-strong',
            shown.length > 0 ? 'text-fg' : 'text-muted'
          )}
        >
          <Layers size={13} className="shrink-0 text-muted" />
          <span className="font-mono text-[12px] font-semibold">{scopeSummary(shown)}</span>
          <ChevronDown size={12} className="shrink-0 text-muted" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-[240px] rounded-lg border border-line bg-canvas p-1 shadow-lg"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-[11px] font-semibold text-muted">
            {model.schemaLabel}
          </DropdownMenu.Label>

          {loading && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-muted">
              <Loader2 className="size-3.5 animate-spin" /> 읽는 중…
            </div>
          )}
          {error && <div className="px-2 py-1.5 text-[12px] text-destructive">{error}</div>}
          {!loading && !error && available?.length === 0 && (
            <div className="px-2 py-1.5 text-[12px] text-muted">고를 {model.schemaLabel} 없음</div>
          )}

          {(available ?? []).map((s) => {
            const on = selected.includes(s)
            // 마지막 하나는 못 끈다 — 다 끄면 읽을 것이 없어 빈 화면이 되고, 그건 고장으로 읽힌다.
            const locked = on && selected.length === 1
            return (
              <DropdownMenu.CheckboxItem
                key={s}
                // e2e 가 라벨 문자열이 아니라 역할로 항목을 집게 하는 훅 — 지우면 스모크가 깨진다.
                data-scope-schema={s}
                checked={on}
                disabled={locked}
                onSelect={(e) => {
                  e.preventDefault() // 여러 개를 연달아 고르는 자리라 한 번 누를 때마다 닫지 않는다
                  apply(toggleSchema(selected, s))
                }}
                title={locked ? '마지막 하나는 끌 수 없어요' : undefined}
                className={cx(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none',
                  'data-[highlighted]:bg-panel-strong',
                  locked && 'cursor-default opacity-60'
                )}
              >
                <Check size={13} className={cx('shrink-0', on ? 'text-accent' : 'invisible')} />
                <span className="font-mono text-[12px]">{s}</span>
              </DropdownMenu.CheckboxItem>
            )
          })}

          {model.hasCatalogLayer && catalogs.length > 0 && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Label className="px-2 py-1.5 text-[11px] font-semibold text-muted">
                {model.catalogLabel}
                {/* 왜 여긴 체크가 아니라 이동인지 — 안 적으면 "왜 여러 개를 못 고르지"가 된다. */}
                <span className="ml-1 font-normal">· 고르면 그 연결로 갑니다</span>
              </DropdownMenu.Label>
              {catalogs.map((cat) => {
                const target = findConnectionForCatalog(connections, conn, cat)
                const here = target?.id === conn.id
                return (
                  <DropdownMenu.Item
                    key={cat}
                    disabled={!target}
                    onSelect={() => goToCatalog(cat)}
                    title={
                      target
                        ? here
                          ? '지금 보고 있는 데이터베이스예요'
                          : `연결 "${target.name}" 으로 이동해요`
                        : '이 데이터베이스에 붙는 연결이 아직 없어요 — Connections 에서 만들어 주세요'
                    }
                    className={cx(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none',
                      'data-[highlighted]:bg-panel-strong',
                      !target && 'cursor-default opacity-45'
                    )}
                  >
                    <Database size={13} className={cx('shrink-0', here ? 'text-accent' : 'text-muted')} />
                    <span className="font-mono text-[12px]">{cat}</span>
                    {here && <span className="ml-auto text-[11px] text-muted">지금</span>}
                  </DropdownMenu.Item>
                )
              })}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
