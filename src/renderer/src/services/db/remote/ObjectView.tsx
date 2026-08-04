import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Boxes, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Badge } from '@renderer/ui/badge'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import type { ConstraintKind, TableDef } from '../workspaces/definition/types'
import { useActiveConnection } from '../connections/store'
import { columnKeyKinds } from './introspection'
import { useRemoteStore } from './store'
import { ConnectionError } from './ConnectionError'

const KIND_VARIANT: Record<ConstraintKind, 'pk' | 'uk' | 'fk' | 'idx' | 'check'> = {
  pk: 'pk',
  uk: 'uk',
  fk: 'fk',
  idx: 'idx',
  check: 'check'
}

/** 한 테이블 카드 — 접힘: 요약 / 펼침: 컬럼 그리드 + FK 참조. */
function TableCard({ table }: { table: TableDef }) {
  const [open, setOpen] = useState(false)
  const kinds = columnKeyKinds(table)
  const fks = table.constraints.filter((c) => c.kind === 'fk')

  return (
    <div className="rounded-lg border border-line bg-canvas">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left outline-none hover:bg-panel"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted" />
        )}
        <span className="font-mono text-[13px] font-semibold text-fg">{table.name}</span>
        <span className="text-[11px] text-muted">
          {table.columns.length}컬럼
          {table.constraints.length > 0 && ` · 제약 ${table.constraints.length}`}
        </span>
        {table.comment && (
          // 기울임을 쓰지 않는다 — 실 DB 주석은 한글이 흔한데, 한글은 이탤릭 자형이 없어
          // 브라우저가 강제로 기울이고 그 삐져나온 획을 `truncate` 가 깎는다(2026-08-04 실측).
          <span className="ml-auto truncate pl-2 text-[11px] text-muted">{table.comment}</span>
        )}
      </button>

      {open && (
        <div className="border-t border-line px-3 py-2.5">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-muted">
                <th className="pb-1 pr-3 font-medium">컬럼</th>
                <th className="pb-1 pr-3 font-medium">타입</th>
                <th className="pb-1 pr-3 font-medium">NULL</th>
                <th className="pb-1 pr-3 font-medium">기본값</th>
                <th className="pb-1 font-medium">키</th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((col) => (
                <tr key={col.id} className="border-t border-line/60">
                  <td className="py-1 pr-3 font-mono text-fg">{col.name}</td>
                  <td className="py-1 pr-3 font-mono text-muted">{col.type}</td>
                  <td className="py-1 pr-3 text-muted">{col.nullable ? 'NULL' : 'NOT NULL'}</td>
                  <td className="py-1 pr-3 font-mono text-muted">
                    {col.defaultValue == null || col.defaultValue === '' ? '—' : col.defaultValue}
                  </td>
                  <td className="py-1">
                    <span className="flex flex-wrap gap-1">
                      {[...(kinds.get(col.id) ?? [])]
                        .sort()
                        .map((k) => (
                          <Badge key={k} variant={KIND_VARIANT[k]} className="px-1 py-0 text-[10px]">
                            {k.toUpperCase()}
                          </Badge>
                        ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {fks.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-1 border-t border-line/60 pt-2">
              {fks.map((fk) => (
                <div key={fk.id} className="flex items-center gap-1.5 text-[11px] text-muted">
                  <KeyRound className="size-3 text-accent" />
                  <span className="font-mono text-fg">
                    ({fk.columns.map((c) => c.columnId.split('.').pop()).join(', ')})
                  </span>
                  → <span className="font-mono text-fg">{fk.refTable}</span>
                  <span className="font-mono">({(fk.refColumns ?? []).join(', ')})</span>
                  {fk.onDelete && fk.onDelete !== 'NO ACTION' && (
                    <span className="rounded bg-panel-strong px-1 py-0.5 text-[10px]">
                      ON DELETE {fk.onDelete}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Remote › Object(운영부 · depth 3) — 활성 환경의 실 DB 를 역설계(Reverse)해 객체를 브라우징.
 * Phase 2a introspection 의 첫 소비자. 결과 TableDef[] 는 Diagram/Migration 과 공유된다.
 */
export function ObjectView() {
  const conn = useActiveConnection()
  const connId = conn?.id ?? null

  const tables = useRemoteStore((s) => (connId ? s.byEnv[connId] : undefined))
  const loading = useRemoteStore((s) => (connId ? s.loading[connId] : false))
  const error = useRemoteStore((s) => (connId ? s.error[connId] : null))
  const load = useRemoteStore((s) => s.load)

  useEffect(() => {
    if (connId) void load(connId, connId)
  }, [connId, load])

  if (!conn) {
    return (
      <PlaceholderView
        icon={Boxes}
        depth="depth 3 · Remote › Object"
        title="연결을 선택하세요"
        subtitle="상단 컨텍스트 바의 Connection 셀렉터(또는 Connections 카드)에서 대상을 고르면 실 DB 를 역설계해 객체를 보여줍니다."
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">
            Object <span className="font-normal text-muted">· {conn.name}</span>
          </h2>
          <p className="text-[12px] text-muted">
            {loading
              ? '실 DB 역설계 중…'
              : tables
                ? `${tables.length}개 테이블 · Reverse(introspection)`
                : '역설계 대기'}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => void load(conn.id, conn.id, true)}
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} 새로고침
        </Button>
      </div>

      {error ? (
        <ConnectionError
          error={error}
          retrying={loading}
          onRetry={() => void load(conn.id, conn.id, true)}
        />
      ) : loading && !tables ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          <Loader2 className="mr-2 size-4 animate-spin" /> 실 DB 스키마를 읽는 중…
        </div>
      ) : tables && tables.length > 0 ? (
        <div className={cn('flex flex-1 flex-col gap-2 overflow-auto p-5')}>
          {tables.map((t) => (
            <TableCard key={t.id} table={t} />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          테이블이 없습니다
        </div>
      )}
    </div>
  )
}
