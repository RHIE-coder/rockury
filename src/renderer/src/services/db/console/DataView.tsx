import { useEffect } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import type { TableDef } from '../workspaces/definition/types'
import { useActiveConnection } from '../connections/store'
import { useConsoleStore } from './store'
import { canEdit, pkColumns } from './data/sqlBuilder'
import { PAGE_SIZE, rowKey, useDataStore } from './data/store'

/** 표시 문자열화(NULL/객체/원시). */
function display(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * Console › Data(운영부 · depth 3) — 실 DB 테이블 행 조회/편집.
 * 편집(수정·삭제·추가)은 pending 버퍼에 쌓고, SQL 프리뷰 확인 후 트랜잭션 게이트로 커밋한다.
 * **PK 없으면 읽기전용**(§ops-plan). 타입별 셀 에디터/타임존은 향후(현재 텍스트 + NULL 표시).
 */
export function DataView() {
  const conn = useActiveConnection()
  const connId = conn?.id ?? null

  const tables = useConsoleStore((s) => (connId ? s.byEnv[connId] : undefined))
  const introLoading = useConsoleStore((s) => (connId ? s.loading[connId] : false))
  const loadIntro = useConsoleStore((s) => s.load)

  const d = useDataStore()
  const dialect = conn?.dbType

  useEffect(() => {
    if (connId) void loadIntro(connId, connId)
  }, [connId, loadIntro])

  if (!conn) {
    return <PlaceholderView icon={Table2} depth="depth 3 · Console › Data" title="연결을 선택하세요" subtitle="Connection 셀렉터에서 대상을 고르면 실 DB 테이블을 조회/편집할 수 있습니다." />
  }

  const selected: TableDef | null = tables?.find((t) => t.name === d.table) ?? null
  const editable = selected ? canEdit(selected) : false
  const pk = selected ? pkColumns(selected) : []
  const pendingCount = d.pendingCount()
  const statements = selected && dialect ? d.buildStatements(dialect, selected) : []

  return (
    <div className="flex h-full min-h-0">
      {/* 좌: 테이블 목록 */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <span>테이블</span>
          {introLoading && <Loader2 className="size-3 animate-spin" />}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {(tables ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => dialect && void d.selectTable(conn.id, dialect, t)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px] outline-none hover:bg-panel',
                t.name === d.table ? 'bg-accent-soft/50 text-accent' : 'text-fg'
              )}
            >
              <Table2 className="size-3.5 shrink-0 opacity-60" />
              <span className="truncate">{t.name}</span>
              {!canEdit(t) && <Lock className="ml-auto size-3 shrink-0 opacity-40" />}
            </button>
          ))}
          {tables && tables.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-muted">테이블 없음</div>
          )}
        </div>
      </aside>

      {/* 우: 그리드 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
            왼쪽에서 테이블을 선택하세요
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-semibold text-fg">{selected.name}</span>
                {!editable && (
                  <span className="flex items-center gap-1 rounded-full bg-panel-strong px-2 py-0.5 text-[10.5px] text-muted">
                    <Lock className="size-3" /> 읽기전용 (PK 없음)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {editable && (
                  <Button size="sm" variant="ghost" onClick={() => d.addRow()}>
                    <Plus /> 행
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={d.loading}
                  onClick={() => dialect && void d.load(conn.id, dialect, selected)}
                >
                  {d.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} 새로고침
                </Button>
              </div>
            </div>

            {/* pending 요약 + SQL 프리뷰 + 저장 */}
            {editable && pendingCount > 0 && !d.tx && (
              <div className="shrink-0 border-b border-line bg-panel/60 px-4 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-fg">
                    대기 변경 <span className="font-semibold">{pendingCount}</span>건 · SQL{' '}
                    {statements.length}문
                  </span>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => d.discard()}>
                      취소
                    </Button>
                    <Button
                      size="sm"
                      disabled={d.loading || statements.length === 0}
                      onClick={() => dialect && void d.save(conn.id, dialect, selected)}
                    >
                      저장(트랜잭션)
                    </Button>
                  </div>
                </div>
                <div className="mt-1.5 max-h-24 overflow-auto rounded bg-canvas p-2 font-mono text-[11px] leading-relaxed text-muted">
                  {statements.map((s, i) => (
                    <div key={i} className="truncate" title={`${s.sql}  ·  [${s.params.map(display).join(', ')}]`}>
                      {s.sql}
                      {s.params.length > 0 && (
                        <span className="text-accent"> · [{s.params.map(display).join(', ')}]</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 트랜잭션 게이트 바 */}
            {d.tx && (
              <div className="flex shrink-0 items-center gap-3 border-b border-accent/30 bg-accent-soft/50 px-4 py-2.5 text-[12.5px]">
                <span className="min-w-0 flex-1">
                  {d.tx.statements}개 문 실행됨 · 영향{' '}
                  <span className="font-mono font-semibold">{d.tx.affected}</span>행 · 아직 커밋되지
                  않았습니다
                </span>
                <Button size="sm" variant="ghost" onClick={() => void d.rollback()}>
                  롤백
                </Button>
                <Button size="sm" onClick={() => dialect && void d.confirm(conn.id, dialect, selected)}>
                  커밋
                </Button>
              </div>
            )}

            {d.error && (
              <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-[12px] text-destructive">
                <span className="min-w-0 flex-1 whitespace-pre-wrap font-mono">{d.error}</span>
                <button type="button" onClick={d.dismissError} className="shrink-0 opacity-70 hover:opacity-100">
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            {/* 그리드 */}
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 bg-panel">
                  <tr>
                    {editable && <th className="w-8 border-b border-line px-1 py-1.5" />}
                    {selected.columns.map((c) => (
                      <th key={c.id} className="border-b border-line px-3 py-1.5 text-left font-mono font-semibold text-fg">
                        {c.name}
                        {pk.includes(c.name) && <span className="ml-1 text-[10px] text-accent-2">PK</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((row, ri) => {
                    const key = rowKey(pk, row)
                    const deleted = editable && d.deletes[key]
                    const edited = d.edits[key]
                    return (
                      <tr key={ri} className={cn('hover:bg-panel/50', deleted && 'opacity-40 line-through')}>
                        {editable && (
                          <td className="border-b border-line/50 px-1 py-0.5 text-center">
                            <button
                              type="button"
                              title={deleted ? '삭제 취소' : '행 삭제'}
                              onClick={() => d.toggleDelete(key)}
                              className={cn('text-muted hover:text-destructive', deleted && 'text-destructive')}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        )}
                        {selected.columns.map((c) => {
                          const has = !!(edited && c.name in edited)
                          const val = edited && c.name in edited ? edited[c.name] : row[c.name]
                          const original = row[c.name]
                          if (!editable) {
                            return (
                              <td key={c.id} className={cn('max-w-[320px] truncate border-b border-line/50 px-3 py-1 font-mono', original == null ? 'italic text-muted' : 'text-fg')} title={display(original)}>
                                {original == null ? 'NULL' : display(original)}
                              </td>
                            )
                          }
                          return (
                            <td key={c.id} className="border-b border-line/50 p-0">
                              <input
                                value={display(val)}
                                placeholder={original == null ? 'NULL' : ''}
                                disabled={deleted}
                                onChange={(e) => d.editCell(key, c.name, e.target.value)}
                                className={cn(
                                  'w-full min-w-[80px] bg-transparent px-3 py-1 font-mono text-[12px] outline-none focus:bg-accent-soft/40',
                                  has ? 'text-accent-2' : 'text-fg'
                                )}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}

                  {/* 삽입 대기 행 */}
                  {editable &&
                    d.inserts.map((ins) => (
                      <tr key={ins.tempId} className="bg-success-soft/40">
                        <td className="border-b border-line/50 px-1 py-0.5 text-center">
                          <button type="button" title="추가 취소" onClick={() => d.removeInsert(ins.tempId)} className="text-muted hover:text-destructive">
                            <X className="size-3.5" />
                          </button>
                        </td>
                        {selected.columns.map((c) => (
                          <td key={c.id} className="border-b border-line/50 p-0">
                            <input
                              value={display(ins.values[c.name])}
                              placeholder="(기본값)"
                              onChange={(e) => d.editInsert(ins.tempId, c.name, e.target.value)}
                              className="w-full min-w-[80px] bg-transparent px-3 py-1 font-mono text-[12px] text-success outline-none focus:bg-success-soft"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
              {d.rows.length === 0 && !d.loading && (
                <div className="py-8 text-center text-[13px] text-muted">행이 없습니다</div>
              )}
            </div>

            {/* 페이지네이션 */}
            <div className="flex shrink-0 items-center justify-between border-t border-line px-4 py-2 text-[12px] text-muted">
              <span>
                {d.rows.length}행 표시 · 페이지 {d.page + 1}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" disabled={d.page === 0 || d.loading} onClick={() => dialect && void d.setPage(conn.id, dialect, selected, d.page - 1)}>
                  <ChevronLeft />
                </Button>
                <Button size="sm" variant="ghost" disabled={d.rows.length < PAGE_SIZE || d.loading} onClick={() => dialect && void d.setPage(conn.id, dialect, selected, d.page + 1)}>
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
