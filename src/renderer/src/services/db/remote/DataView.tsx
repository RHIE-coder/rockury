import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Columns3,
  Copy,
  Download,
  Eye,
  Filter as FilterIcon,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { SqlEditor } from '@renderer/ui/SqlEditor'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@renderer/ui/dialog'
import type { Constraint, TableDef } from '../workspaces/definition/types'
import { downloadText } from '../download'
import { dialectInfo } from '../dialects'
import { useActiveConnection } from '../connections/store'
import { sameTable } from '../schemaRef'
import type { DialectId } from '../dialects'
import { useRemoteStore } from './store'
import { ConnectionError } from './ConnectionError'
import { TableSidePanel } from '../TableSidePanel'
import { RowDetailDialog } from './RowDetailDialog'
import { columnKeyKinds } from './introspection'
import { canEdit, pkColumns, quoteTable, type SqlDialect } from './data/sqlBuilder'
import { columnKind } from './data/cellKind'
import { autoColumnWidths, COL_WIDTH_DEFAULTS } from './data/colWidth'
import { compactJson, jsonError, prettyJson, summarizeJson } from './data/jsonCell'
import { badgeLabels, typeLabel } from './data/columnMeta'
import { genUuid } from './data/genValue'
import { normalizeDateTime, nowDateTime } from './data/timeValue'
import { formatDateCell, timezoneOptions, TZ_MODES, type TzMode } from './data/timezone'
import { useOutsideClose } from '@renderer/lib/useOutsideClose'
import { toCsv, toJson, toSqlInsert } from './data/exportRows'
import { PAGE_SIZES, rowKey, useDataStore, viewKey } from './data/store'
import { FilterBar } from './data/FilterBar'
import { PagingBar } from './data/PagingBar'
import { useSavedFilterStore } from './data/savedFilterStore'
import { shouldFollowFocus, useRemoteFocus, useRemoteFocusStore } from './focus'

function display(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 클립보드 복사(실패 무시 — 권한/환경 제약). */
function copy(text: string): void {
  try {
    void navigator.clipboard?.writeText(text)
  } catch {
    // 무시
  }
}

/**
 * FK 조회 대상 — **스키마까지** 담는다. 범위를 켜면 `public.users` 와 `auth.users` 가 함께
 * 있을 수 있어, 이름만 들고 `SELECT * FROM users` 를 쏘면 엉뚱한 테이블을 읽는다.
 */
interface FkTarget {
  schema?: string
  table: string
  column: string
}

/** FK 컬럼명 → 참조 (스키마, 테이블, 컬럼). */
function fkMap(t: TableDef): Record<string, FkTarget> {
  const byId = new Map(t.columns.map((c) => [c.id, c.name]))
  const map: Record<string, FkTarget> = {}
  for (const k of t.constraints.filter((c): c is Constraint => c.kind === 'fk')) {
    k.columns.forEach((ref, i) => {
      const name = byId.get(ref.columnId)
      const refCol = k.refColumns?.[i]
      // refSchema 가 비면 이 테이블과 같은 스키마다(§db/schemaRef 규칙).
      if (name && k.refTable && refCol)
        map[name] = { schema: k.refSchema ?? t.schema, table: k.refTable, column: refCol }
    })
  }
  return map
}

/**
 * Remote › Data — 실 DB 행 조회/편집(§ops 향상, 레거시 이관).
 * 목록·제약 탭은 Definition·Diagram 과 같은 공용 사이드 패널이 맡는다. 키 배지(PK/FK/UK/IDX 텍스트)+타입 라벨,
 * 타입별 셀 도우미(시간값 NOW/OK/ESC · UUID 생성 · NULL · JSON 모달 · FK 룩업), 타임존 3-way,
 * 셀/행 복사, 컬럼 표시/숨김, 미저장 변경 가드. 편집 커밋은 트랜잭션+파라미터 바인드. PK 없으면 읽기전용.
 */
export function DataView() {
  const conn = useActiveConnection()
  const connId = conn?.id ?? null
  const tables = useRemoteStore((s) => (connId ? s.byEnv[connId] : undefined))
  const introLoading = useRemoteStore((s) => (connId ? s.loading[connId] : false))
  const introError = useRemoteStore((s) => (connId ? s.error[connId] : null))
  const loadIntro = useRemoteStore((s) => s.load)
  const d = useDataStore()
  const dialect = conn?.dbType

  const [showFilters, setShowFilters] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [showCols, setShowCols] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [tzMode, setTzMode] = useState<TzMode>('UTC')
  const [tz, setTz] = useState<string>(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [showTz, setShowTz] = useState(false)
  const [copiedCsv, setCopiedCsv] = useState(false)
  /** 상세 모달로 열어 둔 행(0-기준). null 이면 닫혀 있다. */
  const [detailRow, setDetailRow] = useState<number | null>(null)
  const [jsonEdit, setJsonEdit] = useState<{ key: string; col: string; text: string } | null>(null)
  // 읽기 전용 JSON 열람(편집 불가 테이블) — 편집 모달과 같은 뷰어를 쓰되 적용 버튼이 없다.
  const [jsonView, setJsonView] = useState<{ col: string; text: string } | null>(null)
  const [fkEdit, setFkEdit] = useState<{ key: string; col: string; ref: FkTarget; insert?: string } | null>(null)
  // 컬럼 폭(리사이즈). 이름→px. 없으면 기본폭.
  const [colW, setColW] = useState<Record<string, number>>({})
  const resizing = useRef<{ name: string; startX: number; startW: number } | null>(null)
  /** 그리드의 스크롤 상자 — 쪽을 옮길 때 맨 위로 되돌리려면 이 자리를 잡아야 한다. */
  const gridRef = useRef<HTMLDivElement>(null)
  // 툴바 드롭다운은 바깥 클릭/Esc 로 닫는다(안 닫히던 문제).
  const tzRef = useOutsideClose<HTMLDivElement>(showTz, () => setShowTz(false))
  const colsRef = useOutsideClose<HTMLDivElement>(showCols, () => setShowCols(false))

  useEffect(() => {
    if (connId) void loadIntro(connId, connId)
  }, [connId, loadIntro])

  // 컬럼 리사이즈 — 헤더 오른쪽 핸들 드래그로 폭 조절(전역 mousemove/up).
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const r = resizing.current
      if (!r) return
      setColW((w) => ({ ...w, [r.name]: Math.max(72, r.startW + (e.clientX - r.startX)) }))
    }
    const onUp = (): void => {
      if (resizing.current) {
        resizing.current = null
        document.body.style.cursor = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // 연결이 바뀌면 이전 연결에서 열린 커밋 대기 트랜잭션을 롤백한다(고아 tx/락 방지).
  useEffect(() => {
    const s = useDataStore.getState()
    if (s.tx) void s.rollback()
  }, [connId])

  // 테이블이 바뀌면 컬럼 숨김·폭 상태 초기화. 열려 있던 행 상세도 닫는다 —
  // 그대로 두면 다른 표의 몇 번째 행을 가리키게 된다.
  useEffect(() => {
    setHidden(new Set())
    setColW({})
    setDetailRow(null)
  }, [d.table?.schema, d.table?.name])

  /**
   * 쪽을 옮기면 표를 맨 위로 되돌린다(§db-remote.data.paging AC-6).
   * 20번째 행을 보다 다음 쪽으로 넘어가면 새 쪽도 20번째 행부터 보이던 것이 문제였다.
   */
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = 0
  }, [d.page, d.table?.schema, d.table?.name])

  /**
   * 사라진 표의 저장 필터 정리(§db-remote.data.saved-filter AC-5).
   * **역설계가 성공한 뒤에만** 돈다 — `tables` 가 있다는 것이 곧 그 신호다. 오류가 났거나
   * 아직 못 읽었으면 목록이 없어 여기까지 오지 않는다(정리 판정도 빈 목록엔 손대지 않는다).
   * 목록에 없다는 것만으로 지우지는 않는다 — 스토어가 그 표에 직접 물어 확인한다.
   */
  const prune = useSavedFilterStore((s) => s.pruneMissingTables)
  useEffect(() => {
    if (!connId || !dialect || !tables || introError) return
    void prune(connId, dialect, tables)
  }, [connId, dialect, tables, introError, prune])

  /**
   * 고른 표 따라가기 — Definition·Diagram 에서 고른 표를 이 화면도 그대로 연다
   * (2026-08-04 사용자 요청). 목록이 아직 안 왔으면 `tables` 가 바뀔 때 다시 온다.
   *
   * 파생값(all·selected·pendingCount)이 아니라 스토어를 직접 읽는다 — 그것들은 `if (!conn)`
   * 이른 반환 뒤에 계산돼서, 여기서 쓰면 훅 순서가 렌더마다 달라진다.
   */
  const focusId = useRemoteFocus(connId)
  const setFocus = useRemoteFocusStore((s) => s.setFocus)
  useEffect(() => {
    if (!connId || !dialect || !focusId) return
    const list = useRemoteStore.getState().byEnv[connId] ?? []
    const target = list.find((t) => t.id === focusId)
    if (!target) return
    const s = useDataStore.getState()
    const current = s.table ? list.find((t) => sameTable(t, s.table!)) : undefined
    if (
      !shouldFollowFocus({
        focusId,
        currentId: current?.id ?? null,
        pendingCount: s.pendingCount(),
        hasOpenTx: !!s.tx
      })
    )
      return
    void s.selectTable(connId, dialect, target)
  }, [connId, dialect, focusId, tables])

  const NUM_COL_W = 56
  const ACT_COL_W = 32

  if (!conn) {
    return <PlaceholderView icon={Table2} depth="depth 3 · Remote › Data" title="연결을 선택하세요" subtitle="Connection 셀렉터에서 대상을 고르면 실 DB 테이블을 조회/편집할 수 있습니다." />
  }

  const all = tables ?? []

  // 스키마까지 맞춰 되찾는다 — 이름만으로 찾으면 동명 표 중 목록의 첫 번째가 잡힌다.
  const active = d.table
  const selected: TableDef | null = (active && all.find((t) => sameTable(t, active))) || null

  /**
   * 새로고침 — **스키마부터 다시 읽고** 그 다음 행을 읽는다.
   *
   * 컬럼 헤더는 역설계 결과(`selected.columns`)에서 오고 행은 `SELECT *` 로 온다. 행만 다시
   * 읽으면 밖에서 컬럼을 바꾼 순간 헤더는 옛 이름인 채 남고, 화면이 없는 키로 값을 꺼내
   * **모든 칸이 빈 값으로 보인다**(2026-08-04 사용자 실측 — 앱을 껐다 켜야 반영됐다).
   * Definition·Diagram·Object 의 새로고침은 처음부터 역설계를 다시 읽고 있었다.
   */
  const refreshWithSchema = async (id: string, dia: DialectId): Promise<void> => {
    await loadIntro(id, id, true)
    if (!active) return
    const fresh = useRemoteStore.getState().byEnv[id] ?? []
    const target = fresh.find((t) => sameTable(t, active))
    // 표 자체가 사라졌으면 옛 행을 그대로 두지 않는다 — 없는 표의 데이터가 남아 있으면 거짓말이다.
    if (target) await d.selectTable(id, dia, target)
    else useDataStore.setState({ table: null, rows: [], columns: [] })
  }
  const editable = selected ? canEdit(selected) : false
  const pk = selected ? pkColumns(selected) : []
  const fks = selected ? fkMap(selected) : {}
  const keyKinds = selected ? columnKeyKinds(selected) : new Map()
  const pendingCount = d.pendingCount()
  const statements = selected && dialect ? d.buildStatements(dialect, selected) : []
  const shownColumns = selected ? selected.columns.filter((c) => !hidden.has(c.name)) : []

  // 컬럼 폭은 내용에 맞춰 자동으로 잡는다(상한까지). 사용자가 직접 끌어 조절한 컬럼(colW)은 그 값이 이긴다.
  // 셀 오른쪽 도우미(NULL·FK 버튼)와 JSON 요약 칩은 값이 쓸 수 있는 폭을 줄이므로 폭에 얹는다.
  const NULL_BTN_W = 36
  const FK_BTN_W = 22
  const JSON_CHIP_W = 34
  const autoW = autoColumnWidths(
    shownColumns.map((c) => {
      const kind = columnKind(c.type)
      const trailingPx =
        (editable ? NULL_BTN_W : 0) + (editable && fks[c.name] ? FK_BTN_W : 0) + (kind === 'json' ? JSON_CHIP_W : 0)
      return {
        name: c.name,
        typeLabel: typeLabel(c.type),
        badges: badgeLabels(keyKinds.get(c.id)).length,
        trailingPx
      }
    }),
    d.rows
  )
  const widthOf = (name: string): number => colW[name] ?? autoW[name] ?? COL_WIDTH_DEFAULTS.min
  const startResize = (name: string, e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    resizing.current = { name, startX: e.clientX, startW: widthOf(name) }
    document.body.style.cursor = 'col-resize'
  }

  /** 테이블 전환 — 미저장 변경/커밋 대기 트랜잭션이 있으면 확인(가드). selectTable 이 열린 tx 를 롤백한다. */
  const pickTable = (t: TableDef): void => {
    if (!dialect || !connId) return
    if ((pendingCount > 0 || d.tx) && !window.confirm('저장하지 않은 변경/커밋 대기 중인 트랜잭션이 있습니다. 롤백하고 이동할까요?')) return
    // 여기서 고른 것도 운영부 공용 값이다 — Definition·Diagram 으로 옮겨도 같은 표를 본다.
    setFocus(connId, t.id)
    void d.selectTable(connId, dialect, t)
  }

  /**
   * 현재 페이지를 CSV 로 클립보드에 — 스프레드시트에 그대로 붙여넣는 용도라
   * 파일 Export 가 아니라 "보이는 그대로"를 뜬다: 숨긴 컬럼은 빼고, 날짜는 화면과 같은 타임존 표기.
   */
  const copyCsv = (): void => {
    const cols = shownColumns.map((c) => c.name)
    const rows = d.rows.map((r) =>
      Object.fromEntries(
        shownColumns.map((c) => [
          c.name,
          r[c.name] != null && columnKind(c.type) === 'date' ? formatDateCell(r[c.name], tzMode, tz) : r[c.name]
        ])
      )
    )
    copy(toCsv(cols, rows))
    setCopiedCsv(true)
    setTimeout(() => setCopiedCsv(false), 1500)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 화면 머리줄 — Definition·Diagram 과 같은 문법(이름 · 연결 / 무엇을 보고 있나).
          예전엔 이 자리를 탭바가 차지했는데 탭이 사이드바로 들어가면서 비었다. */}
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">
            Data <span className="font-normal text-muted">· {conn.name}</span>
          </h2>
          {/* 보고 있는 표 이름·행 수는 아래 도구줄과 쪽 넘김이 이미 말한다 — 여기서 되풀이하지 않는다. */}
          <p className="text-[12px] text-muted">
            {introError ? '연결 안 됨' : introLoading ? '실 DB 역설계 중…' : `${all.length}개 테이블`}
          </p>
        </div>
        <span
          title="연결 방언"
          className="flex items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-medium text-fg"
        >
          <span className="size-2 rounded-full" style={{ background: dialectInfo(conn.dbType).dot }} />
          {dialectInfo(conn.dbType).label}
        </span>
      </div>

      {/* 연결이 안 되면 표 목록이 빈 것과 구분되지 않는다 — "테이블 없음" 은 연결 실패의 답이 아니다. */}
      {introError ? (
        <ConnectionError
          error={introError}
          retrying={introLoading}
          onRetry={() => connId && void loadIntro(connId, connId, true)}
        />
      ) : (
      <div className="min-h-0 flex-1">
        <WorkspacePanels
          autoSaveId="db.console.data"
          collapsible
          sidebarTitle="SCHEMA"
          sidebarActions={introLoading ? <Loader2 className="size-3.5 animate-spin text-muted" /> : undefined}
          sidebar={
            <TableSidePanel
              tables={all}
              activeId={selected?.id ?? null}
              onPick={pickTable}
              searchPlaceholder="테이블/컬럼/스키마 검색…"
              emptyText="테이블 없음"
              // 이 화면에서만 붙는 표식 — PK 가 없어 행을 고칠 수 없는 표(뷰는 아이콘이 이미 말한다).
              rowExtra={(t) =>
                !t.isView && !canEdit(t) ? (
                  <Lock className="size-3 shrink-0 text-muted" aria-label="읽기 전용 (PK 없음)" />
                ) : undefined
              }
            />
          }
        >
          <div className="flex h-full min-w-0 flex-col">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
                선택된 테이블 없음
              </div>
            ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] font-semibold text-fg">{selected.name}</span>
                  {selected.isView && (
                    <span className="flex items-center gap-1 rounded-full bg-panel-strong px-2 py-0.5 text-[10.5px] text-muted"><Eye className="size-3" /> 뷰</span>
                  )}
                  {!editable && (
                    <span className="flex items-center gap-1 rounded-full bg-panel-strong px-2 py-0.5 text-[10.5px] text-muted">
                      <Lock className="size-3" /> 읽기전용 (PK 없음)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {/* 타임존 3-way */}
                  <div ref={tzRef} className="relative">
                    <Button size="sm" variant="ghost" title="날짜 표시(UTC/LOCAL/TIMESTAMP)" onClick={() => setShowTz((v) => !v)}>
                      <Clock /> {tzMode}
                    </Button>
                    {showTz && (
                      <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-line bg-canvas p-1.5 text-[12px] shadow-lg">
                        {TZ_MODES.map((m) => (
                          <button key={m} type="button" onClick={() => { setTzMode(m); if (m !== 'LOCAL') setShowTz(false) }} className={cn('block w-full rounded px-2 py-1 text-left outline-none hover:bg-panel', tzMode === m && 'text-accent')}>
                            {m}
                          </button>
                        ))}
                        {tzMode === 'LOCAL' && (
                          <select value={tz} onChange={(e) => setTz(e.target.value)} className="mt-1 w-full rounded border border-line bg-canvas px-1.5 py-1 text-[11px] outline-none">
                            {timezoneOptions().map((z) => <option key={z} value={z}>{z}</option>)}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                  <div ref={colsRef} className="relative">
                    <Button size="sm" variant="ghost" title="컬럼 표시/숨김" onClick={() => setShowCols((v) => !v)}>
                      <Columns3 />
                    </Button>
                    {showCols && (
                      <div className="absolute right-0 top-full z-20 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-line bg-canvas p-1.5 text-[12px] shadow-lg">
                        <div className="mb-1 flex gap-1.5 px-1">
                          <button type="button" className="text-[11px] text-accent" onClick={() => setHidden(new Set())}>전체 표시</button>
                          <button type="button" className="text-[11px] text-muted" onClick={() => setHidden(new Set(selected.columns.map((c) => c.name)))}>전체 숨김</button>
                        </div>
                        {selected.columns.map((c) => (
                          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-panel">
                            <input
                              type="checkbox"
                              checked={!hidden.has(c.name)}
                              onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(c.name)) n.delete(c.name); else n.add(c.name); return n })}
                            />
                            <span className="truncate font-mono text-[11px]">{c.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button size="sm" variant={showFilters ? 'soft' : 'ghost'} onClick={() => setShowFilters((v) => !v)}>
                    <FilterIcon /> 필터
                    {d.filters.length > 0 && (
                      // 꺼져 있으면 흐리게 — 조건은 남아 있지만 지금 안 걸려 있다는 뜻(§data.filter AC-3a).
                      <span className={cn(!d.filtersEnabled && 'opacity-40')}> ({d.filters.length})</span>
                    )}
                  </Button>
                  <Button size="sm" variant="ghost" title="현재 페이지를 CSV 로 클립보드에 복사" disabled={d.rows.length === 0} onClick={copyCsv}>
                    <Copy /> {copiedCsv ? '복사됨 ✓' : 'CSV 복사'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setExportOpen((v) => !v)}>
                    <Download /> Export
                  </Button>
                  {editable && (
                    <Button size="sm" variant="ghost" onClick={() => d.addRow()}>
                      <Plus /> 행
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={d.loading || introLoading}
                    onClick={() => connId && dialect && void refreshWithSchema(connId, dialect)}
                  >
                    {d.loading || introLoading ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <RefreshCw />
                    )}{' '}
                    새로고침
                  </Button>
                </div>
              </div>

              {exportOpen && (
                <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel/50 px-4 py-2 text-[12px]">
                  <span className="text-muted">내보내기:</span>
                  <Button size="sm" variant="outline" onClick={() => { downloadText(`${selected.name}.csv`, toCsv(d.columns, d.rows), 'text/csv'); setExportOpen(false) }}>CSV</Button>
                  <Button size="sm" variant="outline" onClick={() => { downloadText(`${selected.name}.json`, toJson(d.rows), 'application/json'); setExportOpen(false) }}>JSON</Button>
                  <Button size="sm" variant="outline" onClick={() => { if (dialect) downloadText(`${selected.name}.sql`, toSqlInsert(dialect, selected.name, d.columns, d.rows), 'text/plain'); setExportOpen(false) }}>SQL</Button>
                  <span className="text-[11px] text-muted">현재 페이지 {d.rows.length}행</span>
                </div>
              )}

              {showFilters && (
                // 표마다 새로 만든다 — 예전엔 이 부품이 살아남아 안에 든 조건 초안이 다음 표로
                // 따라갔다(§db-remote.data.filter AC-2 가 고친 것).
                <FilterBar
                  key={viewKey(selected)}
                  connectionId={connId!}
                  table={selected}
                  columns={selected.columns.map((c) => c.name)}
                  columnTypes={Object.fromEntries(selected.columns.map((c) => [c.name, typeLabel(c.type)]))}
                  filters={d.filters}
                  enabled={d.filtersEnabled}
                  onApply={(f) => dialect && void d.setFilters(connId!, dialect, selected, f)}
                  onToggleEnabled={(on) => dialect && void d.setFiltersEnabled(connId!, dialect, selected, on)}
                />
              )}

              {editable && pendingCount > 0 && !d.tx && (
                <div className="shrink-0 border-b border-line bg-panel/60 px-4 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-fg">대기 변경 <span className="font-semibold">{pendingCount}</span>건 · SQL {statements.length}문</span>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => d.discard()}>취소</Button>
                      <Button size="sm" disabled={d.loading || statements.length === 0} onClick={() => dialect && void d.save(connId!, dialect, selected)}>저장(트랜잭션)</Button>
                    </div>
                  </div>
                  <div className="mt-1.5 max-h-24 overflow-auto rounded bg-canvas p-2 font-mono text-[11px] leading-relaxed text-muted">
                    {statements.map((s, i) => (
                      <div key={i} className="truncate" title={`${s.sql}  ·  [${s.params.map(display).join(', ')}]`}>
                        {s.sql}
                        {s.params.length > 0 && <span className="text-accent"> · [{s.params.map(display).join(', ')}]</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {d.tx && (
                <div className="flex shrink-0 items-center gap-3 border-b border-accent/30 bg-accent-soft/50 px-4 py-2.5 text-[12.5px]">
                  <span className="min-w-0 flex-1">{d.tx.statements}개 문 실행됨 · 영향 <span className="font-mono font-semibold">{d.tx.affected}</span>행 · 아직 커밋되지 않았습니다</span>
                  <Button size="sm" variant="ghost" onClick={() => void d.rollback()}>롤백</Button>
                  <Button size="sm" onClick={() => dialect && void d.confirm(connId!, dialect, selected)}>커밋</Button>
                </div>
              )}

              {d.error && (
                <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-[12px] text-destructive">
                  <span className="min-w-0 flex-1 whitespace-pre-wrap font-mono">{d.error}</span>
                  <button type="button" onClick={d.dismissError} className="shrink-0 opacity-70 hover:opacity-100"><X className="size-3.5" /></button>
                </div>
              )}

              <div ref={gridRef} className="min-h-0 flex-1 overflow-auto">
                <table
                  className="table-fixed border-collapse text-[12px]"
                  style={{ width: NUM_COL_W + (editable ? ACT_COL_W : 0) + shownColumns.reduce((s, c) => s + widthOf(c.name), 0) }}
                >
                  <colgroup>
                    <col style={{ width: NUM_COL_W }} />
                    {editable && <col style={{ width: ACT_COL_W }} />}
                    {shownColumns.map((c) => (
                      <col key={c.id} style={{ width: widthOf(c.name) }} />
                    ))}
                  </colgroup>
                  {/* sticky·배경·z 를 <th> 셀마다 건다 — thead 에만 걸면 border-collapse 에서 본문이 헤더 위로 비친다. */}
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-20 border-b border-line bg-panel px-2 py-1.5 text-right font-medium text-muted">#</th>
                      {editable && <th className="sticky top-0 z-20 border-b border-line bg-panel px-1 py-1.5" />}
                      {shownColumns.map((c) => {
                        const sorted = d.orderBy?.column === c.name ? d.orderBy.direction : null
                        const badges = badgeLabels(keyKinds.get(c.id))
                        return (
                          <th key={c.id} className="sticky top-0 z-20 border-b border-line bg-panel px-3 py-1.5 text-left align-top font-mono font-semibold text-fg">
                            <button type="button" onClick={() => dialect && void d.toggleSort(connId!, dialect, selected, c.name)} className="flex w-full items-center gap-1.5 overflow-hidden outline-none hover:text-accent" title="정렬">
                              {badges.map((b) => <span key={b} className="shrink-0 rounded bg-accent-soft px-1 text-[9px] font-bold text-accent">{b}</span>)}
                              <span className="min-w-0 flex-1 truncate text-left">{c.name}</span>
                              {sorted === 'ASC' && <ChevronUp className="size-3 shrink-0" />}
                              {sorted === 'DESC' && <ChevronDown className="size-3 shrink-0" />}
                            </button>
                            <div className="mt-0.5 truncate text-[10px] font-normal lowercase text-muted">{typeLabel(c.type)}</div>
                            {/* 컬럼 폭 조절 핸들 */}
                            <span
                              onMouseDown={(e) => startResize(c.name, e)}
                              title="드래그하여 폭 조절"
                              className="absolute -right-0.5 top-0 z-10 h-full w-1.5 cursor-col-resize select-none hover:bg-accent/40"
                            />
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((row, ri) => {
                      const key = rowKey(pk, row)
                      const deleted = editable && d.deletes[key]
                      const edited = d.edits[key]
                      return (
                        <tr key={ri} className={cn('group hover:bg-panel/50', deleted && 'opacity-40 line-through')}>
                          <td className="border-b border-line/50 px-2 py-1 text-right font-mono text-muted">
                            {/* 셀은 눌러 편집하는 자리라 행 전체 클릭은 편집과 부딪힌다 — 편집 대상이
                                아닌 행 번호가 상세를 여는 손잡이다(복사는 모달 안에 있다). */}
                            <button
                              type="button"
                              data-result-row={ri}
                              title="행 상세 보기"
                              onClick={() => setDetailRow(ri)}
                              className="outline-none hover:text-accent hover:underline"
                            >
                              {ri + 1}
                            </button>
                          </td>
                          {editable && (
                            <td className="border-b border-line/50 px-1 py-0.5 text-center">
                              <button type="button" title={deleted ? '삭제 취소' : '행 삭제'} onClick={() => d.toggleDelete(key)} className={cn('text-muted hover:text-destructive', deleted && 'text-destructive')}>
                                <Trash2 className="size-3.5" />
                              </button>
                            </td>
                          )}
                          {shownColumns.map((c) => {
                            const has = !!(edited && c.name in edited)
                            const val = edited && c.name in edited ? edited[c.name] : row[c.name]
                            const kind = columnKind(c.type)
                            if (!editable) {
                              // 읽기 전용(뷰·PK 없는 테이블)에서도 JSON 은 뷰어로 열 수 있어야 한다 — 셀 폭 안에서는 못 읽는다.
                              if (kind === 'json' && row[c.name] != null) {
                                return (
                                  <td key={c.id} className="overflow-hidden border-b border-line/50 p-0">
                                    <JsonCellButton
                                      text={display(row[c.name])}
                                      onOpen={() => setJsonView({ col: c.name, text: display(row[c.name]) })}
                                    />
                                  </td>
                                )
                              }
                              const shownVal = row[c.name] == null ? 'NULL' : kind === 'date' ? formatDateCell(row[c.name], tzMode, tz) : display(row[c.name])
                              return (
                                <td key={c.id} className="group/cell relative overflow-hidden border-b border-line/50 px-3 py-1 font-mono">
                                  <span className={cn('block truncate', row[c.name] == null ? 'italic text-muted' : 'text-fg')} title={display(row[c.name])}>{shownVal}</span>
                                  {row[c.name] != null && (
                                    <button type="button" title="셀 값 복사" onClick={() => copy(display(row[c.name]))} className="absolute right-1 top-1/2 hidden -translate-y-1/2 text-muted hover:text-accent group-hover/cell:block"><Copy className="size-3" /></button>
                                  )}
                                </td>
                              )
                            }
                            return (
                              <td key={c.id} className="border-b border-line/50 overflow-hidden p-0">
                                <EditableCell
                                  kind={kind}
                                  value={val}
                                  changed={has}
                                  fk={fks[c.name]}
                                  disabled={!!deleted}
                                  tzMode={tzMode}
                                  tz={tz}
                                  onChange={(v) => d.editCell(key, c.name, v)}
                                  onReset={() => d.resetCell(key, c.name)}
                                  onJson={() => setJsonEdit({ key, col: c.name, text: display(val) })}
                                  onFk={(ref) => setFkEdit({ key, col: c.name, ref })}
                                />
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}

                    {editable &&
                      d.inserts.map((ins) => (
                        <tr key={ins.tempId} className="bg-success-soft/40">
                          <td className="border-b border-line/50 px-2 py-1 text-right font-mono text-[10px] font-bold text-success">NEW</td>
                          <td className="border-b border-line/50 px-1 py-0.5 text-center">
                            <button type="button" title="추가 취소" onClick={() => d.removeInsert(ins.tempId)} className="text-muted hover:text-destructive"><X className="size-3.5" /></button>
                          </td>
                          {shownColumns.map((c) => (
                            <td key={c.id} className="border-b border-line/50 overflow-hidden p-0">
                              <NewCell
                                kind={columnKind(c.type)}
                                value={ins.values[c.name]}
                                fk={fks[c.name]}
                                onFk={(ref) => setFkEdit({ key: ins.tempId, col: c.name, ref, insert: ins.tempId })}
                                onChange={(v) => d.editInsert(ins.tempId, c.name, v)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
                {d.rows.length === 0 && !d.loading && <div className="py-8 text-center text-[13px] text-muted">행이 없습니다</div>}
              </div>

              {/* 현재 테이블의 제약은 사이드 패널 `제약` 탭이 이미 보인다 — 그리드 아래에 같은 것을
                  또 두지 않는다(서비스 문구 규칙: 같은 정보는 한 화면에 한 번). */}
              <div className="flex shrink-0 items-center justify-between border-t border-line px-4 py-2 text-[12px] text-muted">
                <div className="flex items-center gap-2">
                  {/* 쪽 번호는 아래 쪽 넘김 칸이 말한다 — 같은 정보를 한 줄에 두 번 두지 않는다. */}
                  <span>{d.rows.length}행{d.total != null && ` · 전체 ${d.total.toLocaleString()}`}</span>
                  <select value={d.pageSize} onChange={(e) => dialect && void d.setPageSize(connId!, dialect, selected, Number(e.target.value))} className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] outline-none">
                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}/p</option>)}
                  </select>
                  {/* 위 툴바에 CSV 복사가 생겼으므로 여기 라벨에 형식을 밝힌다 — 같은 화면에 "복사" 두 개면 뭘 뜨는지 모른다. */}
                  <button type="button" title="현재 페이지를 JSON 으로 복사" onClick={() => copy(toJson(d.rows))} className="flex items-center gap-1 text-muted hover:text-accent"><Copy className="size-3" /> JSON 복사</button>
                </div>
                <PagingBar
                  page={d.page}
                  pageSize={d.pageSize}
                  total={d.total}
                  counting={d.counting}
                  rowsOnPage={d.rows.length}
                  loading={d.loading}
                  onGo={(p) => dialect && void d.setPage(connId!, dialect, selected, p)}
                />
              </div>
              </>
            )}
          </div>
        </WorkspacePanels>
      </div>
      )}

      {detailRow != null && selected && (
        // 숨긴 컬럼도 보인다 — 상세는 "이 행 전부"를 읽는 자리다(컬럼 숨김은 표를 좁히려는 설정).
        <RowDetailDialog
          columns={selected.columns.map((c) => c.name)}
          rows={d.rows}
          index={detailRow}
          onIndexChange={setDetailRow}
          onClose={() => setDetailRow(null)}
        />
      )}

      {jsonEdit && (
        <JsonValueDialog
          col={jsonEdit.col}
          text={jsonEdit.text}
          onClose={() => setJsonEdit(null)}
          onApply={(t) => {
            d.editCell(jsonEdit.key, jsonEdit.col, t)
            setJsonEdit(null)
          }}
        />
      )}

      {jsonView && (
        <JsonValueDialog col={jsonView.col} text={jsonView.text} onClose={() => setJsonView(null)} />
      )}

      {fkEdit && dialect && (
        <FkLookup
          connectionId={conn.id}
          dialect={dialect}
          sourceCol={fkEdit.col}
          refTo={fkEdit.ref}
          onPick={(v) => {
            // 신규행이면 insert 버퍼, 기존행이면 edits 버퍼로.
            if (fkEdit.insert) d.editInsert(fkEdit.insert, fkEdit.col, v)
            else d.editCell(fkEdit.key, fkEdit.col, v)
            setFkEdit(null)
          }}
          onClose={() => setFkEdit(null)}
        />
      )}
    </div>
  )
}

/**
 * JSON 값 뷰어/편집기 — 열 때 보기 좋게 정렬해 보여주고, 형식이 깨졌으면 그 자리에서 알려 준다.
 * `onApply` 가 없으면 열람 전용(읽기 전용 테이블·뷰).
 * 적용할 때는 유효한 JSON 을 한 줄로 정리해 넣는다 — 저장 값에 우리가 넣은 들여쓰기가 섞이지 않게.
 */
function JsonValueDialog({
  col,
  text,
  onClose,
  onApply
}: {
  col: string
  text: string
  onClose: () => void
  onApply?: (text: string) => void
}) {
  const [draft, setDraft] = useState(() => prettyJson(text))
  const [copied, setCopied] = useState(false)
  const summary = summarizeJson(draft)
  const error = jsonError(draft)
  const readOnly = !onApply

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            <span className="font-mono">{col}</span>
            <span className="ml-2 text-[12px] font-normal text-muted">
              {summary.label}
              {readOnly && ' · 열람 전용'}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {!readOnly && (
            <>
              <Button size="sm" variant="outline" onClick={() => setDraft((t) => prettyJson(t))}>
                정렬
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDraft((t) => compactJson(t))}>
                한 줄로
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              copy(draft)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            <Copy /> {copied ? '복사됨 ✓' : '복사'}
          </Button>
          <span className="ml-auto text-[11.5px]">
            {error ? (
              <span className="text-destructive">형식 오류 · {error}</span>
            ) : (
              <span className="text-success">형식 정상</span>
            )}
          </span>
        </div>

        <div
          className={cn(
            'mt-2 h-80 overflow-auto rounded border px-2 py-1',
            error ? 'border-destructive/50' : 'border-line'
          )}
        >
          <SqlEditor value={draft} onChange={setDraft} language="json" readOnly={readOnly} />
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {readOnly ? '닫기' : '취소'}
          </Button>
          {onApply && (
            <Button
              size="sm"
              title="유효한 JSON 은 한 줄로 정리해 넣습니다"
              onClick={() => onApply(error ? draft : compactJson(draft))}
            >
              적용
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * JSON 셀 버튼 — 원본을 그대로 흘리는 대신 **구조 요약 칩**(`{} 5` / `[] 12`)과
 * 한 줄 미리보기를 보인다. 눌러 뷰어에서 정렬된 전체를 본다.
 * (원본 그대로면 `{"a":1,"b":[...` 처럼 잘려 무엇이 들었는지 못 읽는 게 문제였다.)
 */
function JsonCellButton({
  text,
  disabled,
  changed,
  onOpen
}: {
  text: string
  disabled?: boolean
  changed?: boolean
  onOpen: () => void
}) {
  const s = summarizeJson(text)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      title={`${s.label} — 눌러서 전체 보기`}
      className={cn(
        'flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left font-mono text-[12px] outline-none hover:bg-panel/60',
        changed ? 'text-accent-2' : 'text-fg'
      )}
    >
      <span
        className={cn(
          'shrink-0 rounded px-1 text-[9px] font-bold',
          s.shape === 'invalid' ? 'bg-destructive/10 text-destructive' : 'bg-accent-soft text-accent'
        )}
      >
        {s.chip}
      </span>
      {/* 기울임 금지 — '빈 값'은 한글이라 강제 기울임의 삐져나온 획을 truncate 가 깎는다(ObjectView 주석 참고). */}
      <span className={cn('min-w-0 flex-1 truncate text-[11.5px]', s.shape === 'empty' && 'text-muted')}>
        {s.preview || '빈 값'}
      </span>
    </button>
  )
}

/** 타입별 편집 셀 — NULL 토글 + 종류별 도우미(시간값/UUID/JSON/FK). */
function EditableCell({
  kind,
  value,
  changed,
  fk,
  disabled,
  tzMode,
  tz,
  onChange,
  onReset,
  onJson,
  onFk
}: {
  kind: ReturnType<typeof columnKind>
  value: unknown
  changed: boolean
  fk?: FkTarget
  disabled: boolean
  tzMode: TzMode
  tz: string
  onChange: (v: unknown) => void
  onReset: () => void
  onJson: () => void
  onFk: (ref: FkTarget) => void
}) {
  const base = cn('w-full min-w-0 bg-transparent px-3 py-1 font-mono text-[12px] outline-none focus:bg-accent-soft/40', changed ? 'text-accent-2' : 'text-fg')
  const nullBtn = (
    <button type="button" title="NULL 로 설정" disabled={disabled} onClick={() => onChange(null)} className="px-1 text-[10px] text-muted hover:text-destructive">NULL</button>
  )

  // FK 컬럼은 종류/NULL 무관하게 항상 참조 선택 트리거를 보인다(값 클릭 또는 FK 버튼 → 모달).
  if (fk) {
    const isNull = value === null
    const t = isNull ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    return (
      <div className="flex items-center">
        <input value={t} placeholder="NULL" readOnly disabled={disabled} title={t} onClick={() => !disabled && onFk(fk)} className={cn(base, isNull && 'italic', 'cursor-pointer')} />
        <button type="button" disabled={disabled} onClick={() => onFk(fk)} className="shrink-0 px-1 text-[10px] font-bold text-sky-600 hover:text-accent" title={`${fk.table} 참조 선택`}>FK</button>
        {nullBtn}
      </div>
    )
  }

  if (kind === 'date') return <DateCell value={value} changed={changed} disabled={disabled} tzMode={tzMode} tz={tz} onChange={onChange} onReset={onReset} />
  if (kind === 'uuid') return <UuidCell value={value} changed={changed} disabled={disabled} onChange={onChange} />

  if (value === null) {
    return (
      <div className="flex items-center">
        <input value="" placeholder="NULL" disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(base, 'italic')} />
      </div>
    )
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (kind === 'boolean') {
    return (
      <div className="flex items-center">
        <select value={text} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(base, 'appearance-none')}>
          <option value="true">true</option>
          <option value="false">false</option>
          <option value="1">1</option>
          <option value="0">0</option>
        </select>
        {nullBtn}
      </div>
    )
  }
  if (kind === 'json') {
    return (
      <div className="flex items-center">
        <JsonCellButton text={text} disabled={disabled} changed={changed} onOpen={onJson} />
        {nullBtn}
      </div>
    )
  }
  return (
    <div className="flex items-center">
      <input value={text} disabled={disabled} title={text} onChange={(e) => onChange(e.target.value)} className={base} />
      {nullBtn}
    </div>
  )
}

/** 시간값 도우미 — YYYY-MM-DD HH:mm:ss[.SSS] 입력 + NOW/OK/ESC. */
function DateCell({ value, changed, disabled, tzMode, tz, onChange, onReset }: {
  value: unknown; changed: boolean; disabled: boolean; tzMode: TzMode; tz: string
  onChange: (v: unknown) => void; onReset: () => void
}) {
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const escaping = useRef(false)
  const isNull = value === null
  const raw = isNull ? '' : String(value)
  const shown = focused || isNull ? raw : formatDateCell(value, tzMode, tz)
  const keep = (e: React.MouseEvent): void => e.preventDefault() // 버튼 클릭이 input blur 를 먼저 일으키지 않도록
  return (
    <div className="relative flex items-center">
      <input
        ref={ref}
        value={shown}
        disabled={disabled}
        placeholder="YYYY-MM-DD HH:mm:ss[.SSS]"
        onFocus={() => setFocused(true)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setFocused(false)
          if (escaping.current) { escaping.current = false; return }
          const n = normalizeDateTime(raw)
          if (n) onChange(n)
        }}
        className={cn('w-full min-w-0 bg-transparent px-3 py-1 font-mono text-[12px] outline-none focus:bg-accent-soft/40', changed ? 'text-accent-2' : isNull ? 'italic text-muted' : 'text-fg')}
      />
      {focused && (
        <div className="absolute left-0 top-full z-20 mt-0.5 flex items-center gap-1 rounded border border-line bg-canvas px-1.5 py-1 shadow-lg">
          <span className="font-mono text-[9.5px] text-muted">YYYY-MM-DD HH:mm:ss[.SSS]</span>
          <button type="button" onMouseDown={keep} onClick={() => onChange(nowDateTime())} className="rounded bg-panel-strong px-1.5 py-0.5 text-[10px] font-semibold text-fg hover:text-accent">NOW</button>
          <button type="button" onMouseDown={keep} onClick={() => ref.current?.blur()} className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">OK</button>
          <button type="button" onMouseDown={keep} onClick={() => { escaping.current = true; onReset(); ref.current?.blur() }} className="rounded bg-panel-strong px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:text-fg">ESC</button>
        </div>
      )}
    </div>
  )
}

/** UUID 도우미 — 값 입력 + UUID(생성)/NULL 칩. */
function UuidCell({ value, changed, disabled, onChange }: {
  value: unknown; changed: boolean; disabled: boolean; onChange: (v: unknown) => void
}) {
  const [focused, setFocused] = useState(false)
  const isNull = value === null
  const text = isNull ? '' : String(value)
  const keep = (e: React.MouseEvent): void => e.preventDefault()
  return (
    <div className="relative flex items-center">
      <input
        value={text}
        disabled={disabled}
        placeholder="NULL"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value)}
        className={cn('w-full min-w-0 bg-transparent px-3 py-1 font-mono text-[12px] outline-none focus:bg-accent-soft/40', changed ? 'text-accent-2' : isNull ? 'italic text-muted' : 'text-fg')}
      />
      {focused && (
        <div className="absolute left-0 top-full z-20 mt-0.5 flex items-center gap-1 rounded border border-line bg-canvas px-1.5 py-1 shadow-lg">
          <button type="button" onMouseDown={keep} onClick={() => onChange(genUuid())} className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">UUID</button>
          <button type="button" onMouseDown={keep} onClick={() => onChange(null)} className="rounded bg-panel-strong px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:text-fg">NULL</button>
        </div>
      )}
    </div>
  )
}

/** 신규행 셀 — 도우미(UUID/NOW/FK 참조) 붙은 입력. */
function NewCell({ kind, value, fk, onFk, onChange }: { kind: ReturnType<typeof columnKind>; value: unknown; fk?: FkTarget; onFk?: (ref: FkTarget) => void; onChange: (v: unknown) => void }) {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return (
    <div className="flex items-center">
      <input value={text} placeholder="(기본값)" onChange={(e) => onChange(e.target.value)} className="w-full min-w-0 bg-transparent px-3 py-1 font-mono text-[12px] text-success outline-none focus:bg-success-soft" />
      {fk && onFk && <button type="button" onClick={() => onFk(fk)} className="shrink-0 px-1 text-[10px] font-bold text-sky-600 hover:text-accent" title={`${fk.table} 참조 선택`}>FK</button>}
      {!fk && kind === 'uuid' && <button type="button" onClick={() => onChange(genUuid())} className="px-1 text-[10px] text-muted hover:text-accent" title="UUID 생성">UUID</button>}
      {!fk && kind === 'date' && <button type="button" onClick={() => onChange(nowDateTime())} className="px-1 text-[10px] text-muted hover:text-accent" title="현재 시각">NOW</button>}
    </div>
  )
}

/**
 * FK 룩업 모달 — 참조 테이블을 조회해 값 선택(레거시 이관).
 * 제목에 소스 컬럼→대상 표기, 참조 컬럼 검색(서버사이드 LIKE), 페이지네이션,
 * 행 선택 후 Apply · Set NULL · Cancel.
 */
const FK_PAGE = 50
function FkLookup({ connectionId, dialect, sourceCol, refTo, onPick, onClose }: { connectionId: string; dialect: string; sourceCol: string; refTo: FkTarget; onPick: (v: unknown) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [cols, setCols] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [sel, setSel] = useState<number | null>(null)

  const qc = dialect === 'mysql' || dialect === 'mariadb' ? '`' : '"'
  const qid = (n: string): string => `${qc}${n.split(qc).join(qc + qc)}${qc}`
  const ph = dialect === 'postgresql' ? '$1' : '?'
  const textType = dialect === 'mysql' || dialect === 'mariadb' ? 'CHAR' : 'TEXT'

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setErr(null)
      setSel(null)
      try {
        const params: unknown[] = []
        let where = ''
        if (q.trim()) {
          where = ` WHERE CAST(${qid(refTo.column)} AS ${textType}) LIKE ${ph}`
          params.push(`%${q.trim()}%`)
        }
        const target = quoteTable(dialect as SqlDialect, { schema: refTo.schema, name: refTo.table })
        const sql = `SELECT * FROM ${target}${where} ORDER BY ${qid(refTo.column)} LIMIT ${FK_PAGE} OFFSET ${page * FK_PAGE}`
        const r = await window.rockury.query.runParams(connectionId, sql, params)
        setRows(r.rows)
        setCols(r.columns)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, refTo.table, refTo.column, q, page])

  const applySearch = (): void => { setPage(0); setQ(draft) }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            참조 선택 · <span className="font-mono text-accent-2">{sourceCol}</span> <span className="text-muted">→ {refTo.table}.{refTo.column}</span>
          </DialogTitle>
        </DialogHeader>

        {/* 검색 (참조 컬럼 기준, 서버사이드) */}
        <div className="mt-1 flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5">
          <Search className="size-3.5 text-muted" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
            placeholder={`${refTo.column} 검색…`}
            className="w-full bg-transparent text-[12px] outline-none"
          />
          {draft && <button type="button" onClick={applySearch} className="text-[11px] text-accent">검색</button>}
        </div>

        {err ? (
          <div className="mt-2 rounded bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{err}</div>
        ) : (
          <div className="mt-2 max-h-[52vh] overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-panel">
                <tr>{cols.map((c) => <th key={c} className={cn('border-b border-line px-2 py-1 text-left font-mono', c === refTo.column && 'text-accent')}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    onClick={() => setSel(i)}
                    onDoubleClick={() => onPick(row[refTo.column])}
                    className={cn('cursor-pointer', sel === i ? 'bg-accent-soft' : 'hover:bg-accent-soft/40')}
                  >
                    {cols.map((c) => (
                      <td key={c} className={cn('max-w-[220px] truncate border-b border-line/50 px-2 py-1 font-mono', c === refTo.column ? 'font-semibold text-accent' : 'text-muted')} title={display(row[c])}>{display(row[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && <div className="py-6 text-center text-[12px] text-muted"><Loader2 className="mx-auto size-4 animate-spin" /></div>}
            {!loading && rows.length === 0 && <div className="py-6 text-center text-[12px] text-muted">행이 없습니다</div>}
          </div>
        )}

        {/* 페이지네이션 + 액션 */}
        <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
          <div className="flex items-center gap-2 text-[11.5px] text-muted">
            <span>{rows.length} rows</span>
            <button type="button" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))} className="disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <span>{page + 1}</span>
            <button type="button" disabled={rows.length < FK_PAGE || loading} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40"><ChevronRight className="size-4" /></button>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => onPick(null)}>Set NULL</Button>
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={sel === null} onClick={() => sel !== null && onPick(rows[sel][refTo.column])}>Apply</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
