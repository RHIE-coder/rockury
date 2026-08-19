import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/ui/dialog'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { useActiveConnection } from '../connections/store'
import { dialectInfo } from '../dialects'
import { DialectMark } from '../DialectMark'
import { HighlightedSqlLine } from '../workspaces/definition/HighlightedSql'
import { ConnectionError } from './ConnectionError'
import { IntrospectNotice } from './IntrospectNotice'
import { useRemoteStore } from './store'
import { composeEffective, type EffectiveRow } from './grants/effective'
import { diffGrants, type GrantChange, type GrantsDiff } from './grants/diff'
import { expandPattern } from './grants/pattern'
import { buildGridModel, type DiffFilter, type GridRow, type LayerFilter } from './grants/gridModel'
import { useGrantsStore } from './grants/store'
import {
  SET_PRIVILEGES,
  type GrantLayer,
  type GrantSetItem,
  type GrantSetRecord,
  type GrantsIR,
  type PrivSource,
  type StatementPlan
} from './grants/types'

/**
 * Grant 뷰(§db-remote.grants) — [계정 | 객체×권한 표 | 세트] 3패널.
 * 권한 셀은 체크(✓)가 아니라 **출처 층 배지**다: "부여됐나"와 "어디서 왔나"가 한 사실이라
 * 셀 하나가 그 사실 전체를 말한다(privileges AC-2 — "회수했는데 왜 아직 되지?" 미궁 방지).
 * 표 파생(필터·칩 개수·전역 그 외 요약)은 순수 모듈 `grants/gridModel` 이 담당한다.
 */

const LAYER_LABEL: Record<GrantLayer, string> = { global: '전역', database: 'DB', table: '테이블', column: '컬럼' }
/** 층 배지 색 — 전역이 가장 눈에 띄는 2차 강조: "왜 아직 되지"의 범인이 대개 위층이다. */
const LAYER_BADGE: Record<GrantLayer, string> = {
  global: 'bg-accent-2-soft text-accent-2',
  database: 'bg-info-soft text-info',
  table: 'bg-accent-soft text-accent',
  column: 'bg-panel-strong text-muted'
}
const CORE = [...SET_PRIVILEGES] as string[]
/** 키보드 포커스 지시자 — outline-none 만 쓰면 Tab 사용자가 길을 잃는다(WCAG 2.4.7, 리뷰 H-7). */
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-canvas'

function TextBadge({ className, title, children }: { className: string; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} className={cn('shrink-0 rounded px-1 py-px text-[9px] font-bold', className)}>
      {children}
    </span>
  )
}

/** 출처(층) 원문 — 배지에 마우스를 올리면 어느 대상에 준 권한인지 보인다(privileges AC-3). */
function sourceTitle(row: EffectiveRow, s: PrivSource): string {
  const target =
    s.layer === 'global' ? '*.*' : s.layer === 'database' ? `${row.db}.*` : `${row.db}.${row.table}`
  const extra = [s.column && `(${s.column})`, s.via && 'PUBLIC 경유', s.implicit && '소유자 기본권한']
    .filter(Boolean)
    .join(' · ')
  return extra ? `${target} · ${extra}` : target
}

export function GrantView() {
  const conn = useActiveConnection()
  const connId = conn?.id ?? null

  const ir = useGrantsStore((s) => (connId ? s.byConn[connId] : undefined))
  const loading = useGrantsStore((s) => (connId ? !!s.loading[connId] : false))
  const error = useGrantsStore((s) => (connId ? s.error[connId] : null))
  const load = useGrantsStore((s) => s.load)
  const sets = useGrantsStore((s) => s.sets)
  const setsLoaded = useGrantsStore((s) => s.setsLoaded)
  const loadSets = useGrantsStore((s) => s.loadSets)

  // 패턴 전개·유효 권한 계산에 실제 표 목록이 필요하다 — introspection 결과를 같이 쓴다.
  const tableDefs = useRemoteStore((s) => (connId ? s.byEnv[connId] : undefined))
  const introError = useRemoteStore((s) => (connId ? s.error[connId] : null))
  const introWarnings = useRemoteStore((s) => (connId ? s.warnings[connId] : undefined))
  const loadTables = useRemoteStore((s) => s.load)

  const [account, setAccount] = useState<string | null>(null)
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; name: string; items: GrantSetItem[] } | null>(null)

  const sqlite = conn?.dbType === 'sqlite'

  useEffect(() => {
    if (connId && !sqlite) {
      void load(connId)
      void loadTables(connId, connId)
    }
  }, [connId, sqlite, load, loadTables])
  useEffect(() => {
    if (!setsLoaded) void loadSets()
  }, [setsLoaded, loadSets])
  // 연결이 바뀌면 계정 선택은 무의미하다 — 세트 선택(연결 무관)은 남긴다.
  useEffect(() => setAccount(null), [connId])

  const tables = useMemo(
    () => (tableDefs ?? []).filter((t) => !t.isView).map((t) => ({ db: t.schema ?? '', table: t.name })),
    [tableDefs]
  )
  const unreadable = !!(account && ir?.unreadableAccounts?.includes(account))
  const effective = useMemo(
    () => (ir && account ? composeEffective(account, ir.grants, tables) : []),
    [ir, account, tables]
  )
  const selectedSet = sets.find((s) => s.id === selectedSetId) ?? null
  // 못 읽은 계정의 대조는 계산하지 않는다 — 모름을 "모자람/맞음"으로 그리면 안 된다(diff AC-4).
  const diff = useMemo(
    () => (selectedSet && account && !unreadable ? diffGrants(selectedSet.items, tables, effective, account) : null),
    [selectedSet, account, unreadable, tables, effective]
  )

  if (!conn) {
    return <PlaceholderView icon={ShieldCheck} depth="depth 3 · Remote › Grant" title="선택된 연결 없음" />
  }

  const refresh = (): void => {
    if (!connId) return
    void load(connId, true)
    void loadTables(connId, connId, true)
  }

  // 못 읽은 것의 사유는 한 벌로 — 권한 경고 + 표 목록(introspection) 경고·실패(리뷰 지적).
  const notices = [
    ...(ir?.warnings ?? []),
    ...(introWarnings ?? []),
    ...(introError ? [`표 목록을 읽지 못했습니다 — 층 표시·패턴 매칭이 불완전합니다: ${introError}`] : [])
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">
            Grant <span className="font-normal text-muted">· {conn.name}</span>
          </h2>
          <p className="text-[12px] text-muted">
            {sqlite ? '—' : loading ? '실 DB 권한을 읽는 중…' : ir ? `${ir.accounts.length}개 계정` : '조회 대기'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-medium text-fg">
            <DialectMark dialect={conn.dbType} />
            {dialectInfo(conn.dbType).label}
          </span>
          {!sqlite && (
            <Button size="sm" variant="outline" disabled={loading} onClick={refresh}>
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} 새로고침
            </Button>
          )}
        </div>
      </div>

      {sqlite ? (
        // 탭은 뷰 줄에 남는다(연결 따라 탭이 사라지면 줄이 출렁인다) — 본문만 한 줄(vendor AC-4).
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          SQLite — 권한 개념 없음
        </div>
      ) : error ? (
        <ConnectionError error={error} retrying={loading} onRetry={refresh} />
      ) : loading && !ir ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          <Loader2 className="mr-2 size-4 animate-spin" /> 실 DB 권한을 읽는 중…
        </div>
      ) : (
        <>
          <IntrospectNotice connId={connId} warnings={notices} />
          <div className="min-h-0 flex-1">
            <WorkspacePanels
              autoSaveId="db.remote.grants"
              collapsible
              sidebarTitle="계정"
              sidebar={
                <AccountList
                  ir={ir}
                  active={account}
                  onPick={(a) => {
                    setAccount(a)
                    setEditing(null)
                  }}
                />
              }
              rightTitle="권한 세트"
              rightActions={
                <button
                  type="button"
                  data-grant-set-new
                  title="새 세트"
                  onClick={() => {
                    setSelectedSetId(null)
                    setEditing({ id: null, name: '', items: [{ pattern: '', privileges: ['SELECT'] }] })
                  }}
                  className={cn('rounded p-0.5 text-muted hover:bg-panel-strong hover:text-fg', FOCUS_RING)}
                >
                  <Plus className="size-3.5" />
                </button>
              }
              rightPanel={
                <SetPanel
                  sets={sets}
                  selectedId={selectedSetId}
                  account={unreadable ? null : account}
                  tables={tables}
                  effective={effective}
                  onToggle={(id) => {
                    setSelectedSetId((cur) => (cur === id ? null : id))
                    setEditing(null)
                  }}
                  onEdit={(s) => setEditing({ id: s.id, name: s.name, items: s.items })}
                />
              }
            >
              {editing ? (
                <SetEditor
                  draft={editing}
                  tables={tables}
                  effective={effective}
                  account={account}
                  onChange={setEditing}
                  onClose={() => setEditing(null)}
                />
              ) : (
                <PrivilegeGrid effective={effective} account={account} unreadable={unreadable} diff={diff} />
              )}
            </WorkspacePanels>
          </div>
          {/* 적용 바 — 세트를 골라 대조 중일 때만. key 로 문맥(계정×세트)마다 상태를 리셋한다 —
              REVOKE 토글·실패 메시지가 다른 계정으로 이월되면 안 된다(리뷰 지적). */}
          {!editing && diff && diff.counts.matchedTables > 0 && account && connId && (
            <ApplyBar
              key={`${account}\u0000${selectedSetId}`}
              connId={connId}
              account={account}
              ir={ir}
              diff={diff}
              onApplied={refresh}
            />
          )}
        </>
      )}
    </div>
  )
}

function AccountList({
  ir,
  active,
  onPick
}: {
  ir: GrantsIR | undefined
  active: string | null
  onPick: (a: string) => void
}) {
  const [q, setQ] = useState('')
  const list = (ir?.accounts ?? []).filter((a) => a.account.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line p-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="계정 검색…"
          className="w-full rounded border border-line bg-canvas px-2 py-1 text-[12px] outline-none focus:border-accent"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {list.map((a) => (
          <button
            key={a.account}
            type="button"
            data-grant-account={a.account}
            onClick={() => onPick(a.account)}
            className={cn(
              'flex w-full items-center gap-1.5 border-b border-line/50 px-3 py-1.5 text-left hover:bg-panel',
              FOCUS_RING,
              a.account === active && 'border-l-2 border-l-accent bg-accent-soft/30'
            )}
          >
            <span className="min-w-0 truncate font-mono text-[12px] text-fg">{a.account}</span>
            {a.isCurrent && <TextBadge className="bg-accent-soft text-accent">접속 중</TextBadge>}
            {ir?.unreadableAccounts?.includes(a.account) && (
              <TextBadge className="bg-warning-soft text-warning" title="이 계정의 권한을 읽지 못했습니다">
                못 읽음
              </TextBadge>
            )}
            {a.memberOf && a.memberOf.length > 0 && (
              // 소속 role 은 이름 나열까지만 — 상속 권한 전개는 범위 밖(vendor AC-3a)
              <span className="ml-auto shrink-0 truncate text-[10px] text-muted" title={`소속: ${a.memberOf.join(', ')}`}>
                {a.memberOf.join(', ')}
              </span>
            )}
          </button>
        ))}
        {/* '계정 없음' 은 스펙이 금지한 표기(accounts AC-2) — 여기 도달하는 유일한 길은 검색뿐이다. */}
        {list.length === 0 && <div className="px-3 py-2 text-[12px] text-muted">검색 결과 없음</div>}
      </div>
    </div>
  )
}

function PrivilegeGrid({
  effective,
  account,
  unreadable,
  diff
}: {
  effective: EffectiveRow[]
  account: string | null
  unreadable: boolean
  diff: GrantsDiff | null
}) {
  const [layerFilter, setLayerFilter] = useState<LayerFilter>('ALL')
  const [diffFilter, setDiffFilter] = useState<DiffFilter>('ALL')
  const [extrasOpen, setExtrasOpen] = useState(false)

  const model = useMemo(
    () => buildGridModel(effective, diff, layerFilter, diffFilter),
    [effective, diff, layerFilter, diffFilter]
  )

  if (!account) {
    return <div className="flex h-full items-center justify-center text-[13px] text-muted">선택된 계정 없음</div>
  }
  if (unreadable) {
    // "부여된 권한 없음"(사실)과 다른 상태다 — 모름을 없음으로 그리지 않는다(privileges AC-6).
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted" data-grant-unreadable>
        권한을 읽지 못한 계정 — 없음이 아니라 모름
      </div>
    )
  }

  const byDb = new Map<string, GridRow[]>()
  for (const r of model.rows) (byDb.get(r.db) ?? byDb.set(r.db, []).get(r.db)!).push(r)
  const dc = model.diffCounts // 지역 상수 — 콜백 안까지 좁힘(narrowing)을 끌고 가기 위해

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-2">
        {diff && dc !== null ? (
          <>
            {(['ALL', 'match', 'missing', 'excess'] as const).map((f) => (
              <Chip key={f} active={diffFilter === f} onClick={() => setDiffFilter(f)} testId={`diff-${f}`}>
                {f === 'ALL' ? '전체' : f === 'match' ? '일치' : f === 'missing' ? '모자람' : '넘침'}{' '}
                {dc[f]}
              </Chip>
            ))}
            {/* 개수만 밝히는 자리(AC-7) — 칩 문법(누르면 필터)과 갈라 정적 표기로(리뷰 H-6). */}
            <span data-grant-chip="diff-outside" className="rounded px-1.5 py-0.5 text-[10.5px] text-muted">
              대조 밖 {diff.outsideCount}
            </span>
          </>
        ) : (
          (['ALL', 'global', 'database', 'table', 'column'] as const)
            .filter((f) => f === 'ALL' || model.layerCounts[f] > 0)
            .map((f) => (
              <Chip key={f} active={layerFilter === f} onClick={() => setLayerFilter(f)} testId={`layer-${f}`}>
                {f === 'ALL' ? '전체' : LAYER_LABEL[f]} {model.layerCounts[f]}
              </Chip>
            ))
        )}
      </div>
      {/* 대조 요약 — 양쪽 개수를 항상 보인다: 0=0 은 "일치"가 아니라 "아무것도 대조되지 않음"(diff AC-3). */}
      {diff && (
        <div data-grant-diff-summary className="border-b border-line px-3 py-1.5 text-[11px] text-muted">
          {diff.counts.expected === 0 && diff.counts.actual === 0
            ? `아무것도 대조되지 않음 — 세트 패턴 ${diff.counts.patterns} · 매칭 테이블 ${diff.counts.matchedTables}`
            : `세트 패턴 ${diff.counts.patterns} · 매칭 테이블 ${diff.counts.matchedTables} · 요구 ${diff.counts.expected} · 확인 ${diff.counts.actual}`}
          {diff.unmatchedPatterns.length > 0 && (
            <span className="ml-2 rounded bg-warning-soft px-1 py-px text-[10px] font-semibold text-warning">
              매칭 없음: {diff.unmatchedPatterns.join(', ')}
            </span>
          )}
        </div>
      )}
      {/* 전역 그 외 요약 — 모든 행이 같은 정보라 행마다 반복하지 않는다(리뷰 H-9). */}
      {model.globalExtras.length > 0 && (
        <div data-grant-global-extras className="border-b border-line px-3 py-1.5 text-[11px] text-muted">
          <button
            type="button"
            onClick={() => setExtrasOpen((o) => !o)}
            className={cn('rounded px-1 hover:text-fg', FOCUS_RING)}
          >
            {extrasOpen ? '▾' : '▸'} 전역 그 외 권한 {model.globalExtras.length}종
          </button>
          {extrasOpen && (
            <span className="ml-1 inline-flex flex-wrap gap-0.5 align-middle">
              {model.globalExtras.map((p) => (
                <TextBadge key={p} className="bg-panel-strong font-mono text-muted" title="*.* (전역)">
                  {p}
                </TextBadge>
              ))}
            </span>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] text-muted">
              <th className="sticky top-0 z-20 bg-panel px-3 py-1.5 font-semibold">객체</th>
              {CORE.map((p) => (
                <th key={p} className="sticky top-0 z-20 bg-panel px-2 py-1.5 font-semibold">{p}</th>
              ))}
              <th className="sticky top-0 z-20 bg-panel px-2 py-1.5 font-semibold">그 외</th>
            </tr>
          </thead>
          <tbody>
            {[...byDb.entries()].map(([db, list]) => (
              <GridGroup key={db} db={db} rows={list} />
            ))}
          </tbody>
        </table>
        {model.rows.length === 0 && (
          <div className="px-3 py-2 text-[12px] text-muted">
            {/* 필터 무결과(상태)와 권한 없음(사실)을 가른다(리뷰 지적). */}
            {effective.length === 0
              ? '부여된 권한 없음'
              : diff
                ? '이 대조 상태의 행 없음'
                : '이 층에서 온 권한 없음'}
          </div>
        )}
      </div>
    </div>
  )
}

function GridGroup({ db, rows }: { db: string; rows: GridRow[] }) {
  return (
    <>
      <tr>
        {/* sticky 그룹 헤더 — 스크롤해도 지금 보는 행이 어느 DB 것인지 남는다(privileges AC-1, 리뷰 H-8).
            열 머리(top-0) 바로 아래 자리 — 실측 열 머리 27.8px 보다 살짝 안쪽(27px)이라 겹침이 가림 방향이다(구멍 금지). */}
        <td
          colSpan={CORE.length + 2}
          className="sticky top-[27px] z-10 border-b border-line bg-panel px-3 py-1 font-mono text-[11px] font-semibold text-fg"
        >
          {db === '*' ? '(전역)' : db || '(기본)'}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={`${r.db}\u0000${r.table}`} data-grant-row={r.table} className="border-b border-line/50 hover:bg-panel/50">
          <td className="px-3 py-1.5 font-mono text-fg">{r.table === '*' ? '(모든 표)' : r.table}</td>
          {CORE.map((p) => {
            const sources = r.privs[p]
            const m = r.marks?.[p]
            return (
              <td key={p} className="px-2 py-1.5">
                <span className="flex flex-wrap items-center gap-0.5">
                  {sources?.map((s, i) => (
                    <TextBadge key={i} className={LAYER_BADGE[s.layer]} title={sourceTitle(r, s)}>
                      {LAYER_LABEL[s.layer]}
                    </TextBadge>
                  ))}
                  {m === 'missing' && <TextBadge className="bg-warning-soft text-warning">모자람</TextBadge>}
                  {m === 'excess' && <TextBadge className="bg-danger-soft text-danger">넘침</TextBadge>}
                  {!sources && !m && <span className="text-muted/50">—</span>}
                </span>
              </td>
            )
          })}
          <td className="px-2 py-1.5">
            <span className="flex flex-wrap items-center gap-0.5">
              {Object.entries(r.privs)
                .filter(([p]) => !CORE.includes(p))
                .map(([p, ss]) => (
                  <TextBadge
                    key={p}
                    className="bg-panel-strong font-mono text-muted"
                    title={ss.map((s) => sourceTitle(r, s)).join(' · ')}
                  >
                    {p}
                  </TextBadge>
                ))}
            </span>
          </td>
        </tr>
      ))}
    </>
  )
}

function Chip({ active, onClick, testId, children }: { active: boolean; onClick: () => void; testId: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      data-grant-chip={testId}
      onClick={onClick}
      className={cn(
        'rounded px-1.5 py-0.5 text-[10.5px] font-semibold',
        FOCUS_RING,
        active ? 'bg-accent text-white' : 'bg-panel-strong text-muted hover:text-fg'
      )}
    >
      {children}
    </button>
  )
}

/** 세트 행 — 대조 요약을 행마다 memo. 렌더마다 세트 전부를 재계산하면 타이핑이 굼떠진다(리뷰 지적). */
function SetRow({
  set,
  selected,
  account,
  tables,
  effective,
  onToggle,
  onEdit,
  onDelete
}: {
  set: GrantSetRecord
  selected: boolean
  account: string | null
  tables: { db: string; table: string }[]
  effective: EffectiveRow[]
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const d = useMemo(
    () => (account ? diffGrants(set.items, tables, effective, account) : null),
    [set.items, account, tables, effective]
  )
  const summary = !d
    ? `패턴 ${set.items.length}`
    : d.counts.matchedTables === 0
      ? '매칭 없음' // 0=0 을 "모자람 0 · 넘침 0"(준수처럼)으로 그리지 않는다(diff AC-3, 리뷰 지적)
      : `모자람 ${d.changes.filter((c) => c.kind === 'missing').length} · 넘침 ${d.changes.filter((c) => c.kind === 'excess').length}`
  return (
    <div
      className={cn(
        'group flex w-full items-center gap-1 border-b border-line/50 px-2 py-1.5',
        selected && 'border-l-2 border-l-accent bg-accent-soft/30'
      )}
    >
      <button type="button" data-grant-set={set.name} onClick={onToggle} className={cn('min-w-0 flex-1 text-left', FOCUS_RING)}>
        <span className="block truncate text-[12px] font-semibold text-fg">{set.name}</span>
        <span className={cn('block text-[10.5px]', d && d.counts.matchedTables === 0 ? 'font-semibold text-warning' : 'text-muted')}>
          {summary}
        </span>
      </button>
      {/* hover 전용이던 액션을 focus 로도 보이게 — 포커스가 가도 안 보이는 버튼 금지(리뷰 H-7). */}
      <button
        type="button"
        title="편집"
        onClick={onEdit}
        className={cn('rounded p-1 text-muted opacity-0 hover:bg-panel-strong hover:text-fg focus-visible:opacity-100 group-hover:opacity-100', FOCUS_RING)}
      >
        <Pencil className="size-3" />
      </button>
      <button
        type="button"
        title="삭제"
        onClick={onDelete}
        className={cn('rounded p-1 text-muted opacity-0 hover:bg-panel-strong hover:text-danger focus-visible:opacity-100 group-hover:opacity-100', FOCUS_RING)}
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  )
}

function SetPanel({
  sets,
  selectedId,
  account,
  tables,
  effective,
  onToggle,
  onEdit
}: {
  sets: GrantSetRecord[]
  selectedId: string | null
  account: string | null
  tables: { db: string; table: string }[]
  effective: EffectiveRow[]
  onToggle: (id: string) => void
  onEdit: (s: GrantSetRecord) => void
}) {
  const deleteSet = useGrantsStore((s) => s.deleteSet)
  const setsError = useGrantsStore((s) => s.setsError)
  const [confirming, setConfirming] = useState<GrantSetRecord | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {sets.map((s) => (
        <SetRow
          key={s.id}
          set={s}
          selected={s.id === selectedId}
          account={account}
          tables={tables}
          effective={effective}
          onToggle={() => onToggle(s.id)}
          onEdit={() => onEdit(s)}
          onDelete={() => setConfirming(s)}
        />
      ))}
      {/* 못 읽음(모름)과 없음(사실)을 가른다 — 스토어가 실패를 삼키면 여기가 거짓이 된다. */}
      {sets.length === 0 && (
        <div className="px-3 py-2 text-[12px] text-muted">{setsError ? `세트를 읽지 못했습니다 — ${setsError}` : '저장된 세트 없음'}</div>
      )}
      {failure && <div className="px-3 py-1 text-[11px] text-danger">{failure}</div>}

      {/* 삭제 확인 — 앱 Dialog(시스템 confirm 은 e2e 를 멈춰 세운다, 기존 규칙). */}
      <Dialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>세트 삭제</DialogTitle>
            <DialogDescription>
              {confirming?.name} — 패턴 {confirming?.items.length ?? 0}개가 함께 지워집니다. 실 DB 권한은 바뀌지 않습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirming(null)}>취소</Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirming)
                  deleteSet(confirming.id).catch((e) =>
                    setFailure(`삭제 실패 — ${e instanceof Error ? e.message : String(e)}`)
                  )
                setConfirming(null)
              }}
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SetEditor({
  draft,
  tables,
  effective,
  account,
  onChange,
  onClose
}: {
  draft: { id: string | null; name: string; items: GrantSetItem[] }
  tables: { db: string; table: string }[]
  effective: EffectiveRow[]
  account: string | null
  onChange: (d: { id: string | null; name: string; items: GrantSetItem[] }) => void
  onClose: () => void
}) {
  const createSet = useGrantsStore((s) => s.createSet)
  const updateSet = useGrantsStore((s) => s.updateSet)
  const [failure, setFailure] = useState<string | null>(null)

  const setItem = (i: number, patch: Partial<GrantSetItem>): void =>
    onChange({ ...draft, items: draft.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) })

  /** 현황에서 뜨기(sets AC-4) — 고른 계정의 지금 CRUD 권한을 시작점으로. */
  const captureFromAccount = (): void => {
    const items: GrantSetItem[] = effective
      .filter((r) => r.table !== '*') // 의사 행은 표가 아니다
      .map((r) => ({
        pattern: r.db ? `${r.db}.${r.table}` : r.table,
        privileges: CORE.filter((p) => r.privs[p])
      }))
      .filter((it) => it.privileges.length > 0)
    if (items.length > 0) onChange({ ...draft, items })
  }

  // 저장 가능 판정 — 조용한 무반응 금지(리뷰 H-4): 반쪽 행(패턴만·권한만)은 이유를 행에 보이고
  // 버튼을 잠근다. 사유는 실제 원인에 귀속한다 — 거짓 사유는 없는 결함을 찾게 만든다(재채점 M-2).
  const rowState = draft.items.map((it) => {
    const hasPattern = it.pattern.trim() !== ''
    const hasPrivs = it.privileges.length > 0
    return {
      valid: hasPattern && hasPrivs,
      empty: !hasPattern && !hasPrivs,
      needPrivs: hasPattern && !hasPrivs,
      needPattern: !hasPattern && hasPrivs
    }
  })
  const validCount = rowState.filter((r) => r.valid).length
  const needPrivsCount = rowState.filter((r) => r.needPrivs).length
  const needPatternCount = rowState.filter((r) => r.needPattern).length
  const canSave = draft.name.trim() !== '' && validCount > 0 && needPrivsCount + needPatternCount === 0
  const blockReason =
    draft.name.trim() === ''
      ? '세트 이름이 비어 있음'
      : needPrivsCount > 0 && needPatternCount > 0
        ? '미완성 행 있음'
        : needPrivsCount > 0
          ? '권한 없는 패턴 있음'
          : needPatternCount > 0
            ? '패턴 없는 행 있음'
            : validCount === 0
              ? '패턴이 하나도 없음'
              : null

  const save = async (): Promise<void> => {
    if (!canSave) return
    const items = draft.items.filter((_, i) => rowState[i].valid)
    try {
      if (draft.id) await updateSet(draft.id, { name: draft.name.trim(), items })
      else await createSet(draft.name.trim(), items)
      onClose()
    } catch (e) {
      setFailure(`저장 실패 — ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-grant-set-editor>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="세트 이름"
          data-grant-set-name
          className="w-56 rounded border border-line bg-canvas px-2 py-1 text-[12px] font-semibold outline-none focus:border-accent"
        />
        {account && (
          <Button size="sm" variant="ghost" onClick={captureFromAccount} title={`${account} 의 지금 권한으로 채우기`}>
            <Copy /> 계정에서 뜨기
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] text-muted">
              <th className="py-1 font-semibold">패턴</th>
              {CORE.map((p) => (
                <th key={p} className="px-2 py-1 font-semibold">{p}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.items.map((it, i) => {
              const matched = it.pattern.trim() ? expandPattern(it.pattern.trim(), tables).length : 0
              return (
                <tr key={i} className="border-b border-line/50">
                  <td className="py-1.5 pr-2">
                    <input
                      value={it.pattern}
                      onChange={(e) => setItem(i, { pattern: e.target.value })}
                      placeholder="orders_* 또는 테이블 이름"
                      data-grant-pattern={i}
                      className="w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-[12px] outline-none focus:border-accent"
                    />
                    <span className="mt-0.5 block text-[10px] text-muted">
                      {rowState[i].needPrivs ? (
                        <span className="rounded bg-warning-soft px-1 py-px font-semibold text-warning">권한을 고르세요</span>
                      ) : rowState[i].needPattern ? (
                        <span className="rounded bg-warning-soft px-1 py-px font-semibold text-warning">패턴을 입력하세요</span>
                      ) : it.pattern.trim() === '' ? (
                        ' '
                      ) : matched > 0 ? (
                        `매칭 ${matched}`
                      ) : (
                        // 0매칭 패턴은 조용히 통과하면 오타가 세트를 지키는 줄로 안다(sets AC-5)
                        <span className="rounded bg-warning-soft px-1 py-px font-semibold text-warning">매칭 없음</span>
                      )}
                    </span>
                  </td>
                  {CORE.map((p) => (
                    <td key={p} className="px-2 py-1.5 align-top">
                      <input
                        type="checkbox"
                        checked={it.privileges.includes(p)}
                        onChange={(e) =>
                          setItem(i, {
                            privileges: e.target.checked
                              ? [...it.privileges, p]
                              : it.privileges.filter((x) => x !== p)
                          })
                        }
                        className="size-3.5 accent-[var(--color-accent)]"
                      />
                    </td>
                  ))}
                  <td className="py-1.5 align-top">
                    <button
                      type="button"
                      title="패턴 삭제"
                      onClick={() => onChange({ ...draft, items: draft.items.filter((_, j) => j !== i) })}
                      className={cn('rounded p-1 text-muted hover:text-danger', FOCUS_RING)}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => onChange({ ...draft, items: [...draft.items, { pattern: '', privileges: ['SELECT'] }] })}>
          <Plus /> 패턴 추가
        </Button>
      </div>
      {/* 로컬 쓰기라 tx 게이트 없음 — 푸터는 둘뿐(sets AC-6). */}
      <div className="flex shrink-0 items-center justify-between border-t border-line px-3 py-2">
        <span className={cn('text-[11px]', failure ? 'text-danger' : 'text-muted')} title={failure ?? undefined}>
          {failure ?? blockReason ?? '세트는 이 앱에만 저장 — 연결과 독립'}
        </span>
        <span className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>취소</Button>
          <Button size="sm" data-grant-set-save onClick={() => void save()} disabled={!canSave} title={blockReason ?? undefined}>
            저장
          </Button>
        </span>
      </div>
    </div>
  )
}

function ApplyBar({
  connId,
  account,
  ir,
  diff,
  onApplied
}: {
  connId: string
  account: string
  ir: GrantsIR | undefined
  diff: GrantsDiff
  onApplied: () => void
}) {
  const [includeRevoke, setIncludeRevoke] = useState(false)
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<StatementPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const currentAccount = ir?.accounts.find((a) => a.isCurrent)?.account ?? ''
  const changes: GrantChange[] = diff.changes
  const missing = changes.filter((c) => c.kind === 'missing').length
  const excess = changes.filter((c) => c.kind === 'excess').length

  // 미리보기 문장은 main 의 생성기에서 온다 — 실행(apply)이 같은 생성기를 다시 태우므로
  // 보인 문장이 곧 실행 문장이다(apply AC-4).
  useEffect(() => {
    let stale = false
    void window.rockury.grants
      .plan(connId, changes, { includeRevoke, currentAccount })
      .then((p) => {
        if (stale) return
        setPlan(p)
        setPlanError(null)
      })
      .catch((e) => {
        if (stale) return
        setPlan(null)
        setPlanError(e instanceof Error ? e.message : String(e)) // 사유 없는 비활성 금지(리뷰 지적)
      })
    return () => {
      stale = true
    }
  }, [connId, changes, includeRevoke, currentAccount])

  const selfExcluded = plan?.excluded.filter((e) => e.reason === 'self-revoke').length ?? 0
  const upperExcluded = plan?.excluded.filter((e) => e.reason === 'upper-layer').length ?? 0
  const columnExcluded = plan?.excluded.filter((e) => e.reason === 'column-layer').length ?? 0
  const total = plan?.statements.length ?? 0

  const run = async (): Promise<void> => {
    setApplying(true)
    setFailure(null)
    try {
      const result = await window.rockury.grants.apply(connId, changes, { includeRevoke })
      const bad = result.executed.find((e) => !e.ok)
      // 어디까지 실행됐는지 숨기지 않는다(apply AC-1) — GRANT/REVOKE 는 자동 커밋이라 롤백이 없다.
      if (bad) setFailure(`${result.executed.filter((e) => e.ok).length}문 실행 뒤 실패: ${bad.error}`)
      onApplied()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(false)
      setConfirming(false)
    }
  }

  return (
    <div data-grant-apply-bar className="shrink-0 border-t border-line bg-panel">
      <div className="flex items-center gap-3 px-4 py-2 text-[12px]">
        <span className="text-fg">
          모자람 {missing} → GRANT · 넘침 {excess}
        </span>
        <label className="flex items-center gap-1 text-muted">
          <input
            type="checkbox"
            checked={includeRevoke}
            data-grant-revoke-toggle
            onChange={(e) => setIncludeRevoke(e.target.checked)}
            className="size-3.5"
          />
          REVOKE 포함
        </label>
        {selfExcluded > 0 && (
          // 차단으로 빠진 문장은 말없이 빼지 않는다(apply AC-3a)
          <TextBadge className="bg-warning-soft text-warning">접속 계정 제외 {selfExcluded}</TextBadge>
        )}
        {upperExcluded > 0 && (
          <TextBadge className="bg-panel-strong text-muted" title="위층(전역·DB) 권한은 테이블 REVOKE 로 걷히지 않습니다">
            위층 제외 {upperExcluded}
          </TextBadge>
        )}
        {columnExcluded > 0 && (
          <TextBadge className="bg-panel-strong text-muted" title="컬럼 단위 권한 회수는 세트가 다루지 않습니다">
            컬럼 제외 {columnExcluded}
          </TextBadge>
        )}
        {(failure ?? planError) && (
          <span className="truncate text-[11px] text-danger" title={failure ?? planError ?? undefined}>
            {failure ?? `미리보기 실패 — ${planError}`}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} disabled={total === 0} data-grant-sql-toggle>
            {open ? <ChevronDown /> : <ChevronUp />} SQL 보기 {total > 0 && `(${total})`}
          </Button>
          <Button
            size="sm"
            data-grant-apply
            disabled={total === 0 || applying}
            onClick={() => (includeRevoke ? setConfirming(true) : void run())}
          >
            {applying ? <Loader2 className="animate-spin" /> : null} 적용
          </Button>
        </span>
      </div>
      {open && plan && (
        <div className="max-h-48 overflow-auto border-t border-line bg-canvas px-4 py-2 font-mono text-[11px] leading-5">
          {plan.statements.map((st, i) => (
            // REVOKE 줄은 danger-soft — destructive/5% 알파는 흰 캔버스에서 지각 불가(리뷰 지적)
            <div key={i} className={cn('whitespace-pre-wrap', st.kind === 'revoke' && 'bg-danger-soft')}>
              <HighlightedSqlLine line={st.sql} />
            </div>
          ))}
        </div>
      )}

      {/* REVOKE 포함 실행은 앱 Dialog 확인을 거친다(apply AC-2) — 시스템 confirm 금지. */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>REVOKE 포함 적용</DialogTitle>
            <DialogDescription>
              {account} 대상 문장 {total}개를 실행합니다. GRANT/REVOKE 는 자동 커밋이라 되돌리기가 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>취소</Button>
            <Button variant="destructive" size="sm" onClick={() => void run()} disabled={applying}>실행</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
