import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { Badge } from '@renderer/ui/badge'
import { Checkbox } from '@renderer/ui/checkbox'
import { ClipToggle, clipBox, useClipped } from '@renderer/ui/clipped'
import { TableSidePanel } from '../TableSidePanel'
import { ConstraintShape } from '../workspaces/definition/ConstraintShape'
import { keyBadgesOf, type KeyBadge } from '../workspaces/definition/derive'
import type { TableRef } from '@shared/db/tableRef'
import type { Column, TableDef } from '../workspaces/definition/types'
import type { VersionSnapshot } from '../versions/store'
import {
  asTableDefs,
  buildDiffView,
  filterView,
  schemasOf,
  type ConstraintRow,
  type FieldRow,
  type RowStatus,
  type SchemaSlice,
  type TableView
} from './diffView'

/**
 * 대조표 — **Definition 의 그 표 그대로**, 각 줄에 `+ / − / ~` 만 얹는다.
 *
 * 왜 Definition 을 베끼나: 사람이 스키마를 읽을 때 쓰는 눈이 이미 거기 있다. 타입·키 배지·NULL·
 * 기본값이 어느 칸에 있는지 몸이 알고 있어서, 같은 표에 표시만 붙이면 **새로 배울 것이 없다**.
 * 2단 요약표를 먼저 만들어 봤지만 "원래 어떤 테이블이었나"가 여전히 안 잡혔다(2026-08-10 사용자).
 *
 * 기호는 Terraform 관례를 따른다 — `+` 생김, `−` 사라짐, `~` 안이 바뀜.
 * `~` 는 추가와 삭제가 섞인 테이블도 자연스럽게 담는다("이 테이블은 수정된다"는 뜻이므로).
 */

/** 표 열 — Definition 의 것과 같은 구성에 맨 앞 표시 칸만 더한다. */
const GRID = '22px 28px minmax(100px,1.1fr) minmax(120px,1.3fr) 108px 40px minmax(90px,0.9fr) minmax(120px,1.4fr)'
const GRID_MIN_W = 680

const MARK: Record<RowStatus, string> = { added: '+', removed: '−', modified: '~', same: '' }

/**
 * 바뀐 줄의 바탕 — 왼쪽 색 띠 + **알아볼 만큼 진한 바탕**.
 *
 * 앞서 쓴 `*-soft` 토큰은 글자 대비(AA)를 맞추려 만든 값이라 흰 바탕 위에서는 거의 흰색이다.
 * 거기에 투명도까지 얹으니(`/60`·`/70`) 바탕이 있는지조차 안 보였다(2026-08-10 사용자:
 * "배경색 주면 안되나?"). 그래서 시맨틱 색 자체를 낮은 알파로 깐다 — `soft` 토큰을 건드리면
 * 다른 서비스의 색 위계까지 흔들리므로 이 표 안에서만 진하게 한다.
 * 본문 글자(#232b34)는 이 바탕들 위에서 10:1 이 넘어 AA 여유가 충분하다.
 */
const ROW_TONE: Record<RowStatus, string> = {
  added: 'bg-success/[0.18] border-l-[3px] border-l-success',
  removed: 'bg-danger/[0.18] border-l-[3px] border-l-danger',
  modified: 'bg-warning/[0.18] border-l-[3px] border-l-warning',
  same: 'border-l-[3px] border-l-transparent'
}

const MARK_TONE: Record<RowStatus, string> = {
  added: 'text-success',
  removed: 'text-danger',
  modified: 'text-warning',
  same: 'text-transparent'
}

function Mark({ status }: { status: RowStatus }): ReactElement {
  return (
    <span className={cn('select-none text-center font-mono text-[13px] font-bold', MARK_TONE[status])}>
      {MARK[status]}
    </span>
  )
}

function KeyChips({ badges, isCheck }: { badges: KeyBadge[]; isCheck?: boolean }): ReactElement {
  return (
    <div className="flex gap-1 px-1">
      {badges.map((b) => (
        <Badge key={b.kind} variant={b.kind} className="px-1.5 py-0.5 text-[10px]">
          {b.kind.toUpperCase()}
          {b.pos != null && <span className="opacity-70">·{b.pos}</span>}
        </Badge>
      ))}
      {isCheck && <Badge variant="check" className="px-1.5 py-0.5 text-[10px]">CHK</Badge>}
    </div>
  )
}

const defLabel = (c: Column): string => (c.defaultValue == null || c.defaultValue === '' ? '—' : c.defaultValue)

/** 바뀐 칸에만 옛 값을 취소선으로 덧댄다 — 안 바뀐 칸까지 두 줄이 되면 표가 안 읽힌다. */
function Was({ v, changed }: { v: string; changed: boolean }): ReactElement | null {
  if (!changed) return null
  return <span className="ml-1.5 font-mono text-[10.5px] text-danger/70 line-through">{v}</span>
}

/**
 * 잘리는 칸 — **넘칠 때만 스스로 ⌄ 를 내민다**(`ui/clipped`). 표 머리에 있던 "전문 보기"
 * 체크박스는 걷어냈다: 긴 칸 하나를 보려고 표 전체 줄이 바뀌었고, 사용자가 그 체크박스 자체를
 * 걸고 넘어졌다(2026-08-12: "체크박스말고 좀 더 우아한 방법 없어?"). 호버 툴팁(`title`)도 함께
 * 걷었다 — 마우스를 올려야 나오는 것은 없는 것과 같고, 보이는 손잡이가 그 일을 이미 한다.
 *
 * `text` 는 이 칸이 담은 **글자**다: 잘렸는지를 재는 기준이자, 바뀌면 접는 열쇠다.
 * `children` 은 옛 값(취소선)까지 얹은 그림이라 렌더마다 새 객체여서 열쇠로 못 쓴다.
 */
function Cell({
  text,
  className,
  children
}: {
  text: string
  className?: string
  children: ReactNode
}): ReactElement {
  const { ref, clipped, expanded, toggle } = useClipped<HTMLDivElement>(text)
  return (
    <div className="flex min-w-0 items-start gap-0.5 px-1">
      <div ref={ref} className={cn('min-w-0 flex-1', clipBox(expanded), className)}>
        {children}
      </div>
      {clipped && <ClipToggle expanded={expanded} onToggle={toggle} className="mt-0" />}
    </div>
  )
}

function ColumnLine({
  row,
  index,
  badges,
  isCheck
}: {
  row: FieldRow
  index: number
  badges: KeyBadge[]
  isCheck: boolean
}): ReactElement {
  const c = row.col
  const p = row.prevCol
  if (!c) return <></>
  const changed = (field: (x: Column) => unknown): boolean =>
    row.status === 'modified' && !!p && field(p) !== field(c)

  return (
    // `items-center` 그대로 — 칸 하나를 펼치면 그 칸만 높아지고 이웃은 가운데에 남는다.
    <div
      className={cn('grid items-center border-t border-line/70 py-0.5 text-[12px]', ROW_TONE[row.status])}
      style={{ gridTemplateColumns: GRID, minHeight: 34 }}
    >
      <Mark status={row.status} />
      <div className="px-1 text-right tabular-nums text-muted">{index + 1}</div>
      <Cell text={c.name} className="font-mono text-fg">{c.name}</Cell>
      <Cell text={c.type} className="font-mono text-muted">
        {c.type}
        {p && <Was v={p.type} changed={changed((x) => x.type)} />}
      </Cell>
      <KeyChips badges={badges} isCheck={isCheck} />
      <div className="flex justify-center">
        <Checkbox checked={c.nullable} disabled className={cn(changed((x) => x.nullable) && 'ring-2 ring-warning')} />
      </div>
      <Cell text={defLabel(c)} className="font-mono text-muted">
        {defLabel(c)}
        {p && <Was v={defLabel(p)} changed={changed((x) => x.defaultValue ?? '')} />}
      </Cell>
      <Cell text={c.comment || ''} className="text-muted">{c.comment || ''}</Cell>
    </div>
  )
}

/**
 * 제약 한 줄 — **Definition 의 그 표기 그대로**(`ConstraintShape`). 컬럼 순번·방향·FK 참조처·
 * ON DELETE/ON UPDATE 정책까지 같은 그림으로 그린다. 앞서 쓰던 문자열 한 줄에는 정책이 없어서
 * "이 FK 가 무슨 정책으로 다시 걸리는지"를 대조표에서 알 수 없었다(2026-08-11 사용자).
 *
 * 열 배치도 Definition 과 맞춘다 — 종류 배지 · 이름 · 내용. 같은 자리에 같은 것이 있어야
 * 두 화면을 오갈 때 눈이 다시 자리를 안 찾는다.
 */
function ConstraintLine({ row, from }: { row: ConstraintRow; from: TableRef }): ReactElement {
  // 옛 모습(취소선)은 정책까지 든 한 줄이라 제일 잘 잘린다 — 그 줄도 스스로 펼친다.
  const before = useClipped<HTMLSpanElement>(row.before ?? '')
  return (
    <div
      className={cn('grid items-center border-t border-line/70 py-1.5 text-[12px]', ROW_TONE[row.status])}
      style={{ gridTemplateColumns: '22px 60px minmax(140px,210px) minmax(0,1fr)', minHeight: 36 }}
    >
      <Mark status={row.status} />
      <div className="px-1">
        <Badge variant={row.kind} className="px-1.5 py-0.5 text-[10px]">
          {row.kind.toUpperCase()}
        </Badge>
      </div>
      <Cell text={row.name} className="font-mono text-fg">
        {row.name}
      </Cell>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1.5">
        {row.con && <ConstraintShape con={row.con} cols={row.cols} from={from} />}
        {/* 바뀐 줄에만 옛 모습을 덧댄다 — 정책까지 든 문자열이라 무엇이 무엇으로인지가 여기서 읽힌다. */}
        {row.status === 'modified' && row.before && (
          <span className="flex min-w-0 items-center gap-1">
            <ArrowRight className="size-3 shrink-0 rotate-180 text-muted" />
            <span
              ref={before.ref}
              className={cn('min-w-0 font-mono text-[11px] text-danger/70 line-through', clipBox(before.expanded))}
            >
              {row.before}
            </span>
            {before.clipped && (
              <ClipToggle expanded={before.expanded} onToggle={before.toggle} className="mt-0" />
            )}
          </span>
        )}
      </div>
    </div>
  )
}

function TablePanel({ t }: { t: TableView }): ReactElement {
  /**
   * **기본은 다 보이기다.** 한동안 반대였다 — 바뀐 줄이 있으면 알아서 걸러 줬는데, 그러면
   * 제약만 바뀐 테이블에서 컬럼 칸이 "바뀐 컬럼 없음" 한 줄로 비어 테이블의 모습 자체를 알 수
   * 없었다(2026-08-12 사용자: "바뀐것만 보여주지말고 다 보여주라고"). 대조표는 **판단하는
   * 자리**이고, 판단은 "이 테이블이 어떤 모양이 되나"를 봐야 선다. 걸러 보는 것은 손잡이로 남긴다.
   *
   * 테이블을 옮길 때 되살리지도 않는다 — 껐는데 다음 테이블에서 다시 켜지면 끈 적이 없는 셈이다
   * (예전엔 `useEffect` 로 `t.changed` 를 다시 심었다).
   */
  const [changedOnly, setChangedOnly] = useState(false)

  // 키 배지는 **반영 뒤 모습** 기준이다 — 표가 그리는 것이 결과 테이블이므로.
  const badgeMap = useMemo(() => keyBadgesOf(t.def), [t.def])
  const checkCols = useMemo(
    () => new Set(t.def.constraints.filter((k) => k.kind === 'check').flatMap((k) => k.columns.map((r) => r.columnId))),
    [t.def]
  )

  const columns = changedOnly ? t.columns.filter((c) => c.status !== 'same') : t.columns
  const constraints = changedOnly ? t.constraints.filter((k) => k.status !== 'same') : t.constraints

  const changedColumns = t.columns.filter((c) => c.status !== 'same').length
  const changedConstraints = t.constraints.filter((k) => k.status !== 'same').length
  /**
   * 이 토글이 실제로 접을 수 있는 줄 수. 0 이면 토글을 아예 안 그린다 —
   * 모든 줄이 바뀐 테이블에서 켜고 꺼도 화면이 안 변해 "장식"으로 보였다
   * (2026-08-10 사용자: "이건 장식인거야? 심심하지 말라고 체크박스 만든건가?").
   */
  const sameCount =
    t.columns.length - changedColumns + (t.constraints.length - changedConstraints)

  return (
    // `flex-1` 이 아니라 **`h-full`** 이다 — 부모(react-resizable-panels 의 Panel)는 flex 컨테이너가
    // 아니라서 flex-1 이 높이를 못 받는다. 그러면 본문이 박스를 넘겨 스크롤이 죽는다(실측).
    // Definition 워크스페이스도 같은 이유로 `h-full` 을 쓴다.
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <span className={cn('font-mono text-[15px] font-bold', MARK_TONE[t.status])}>{MARK[t.status] || '·'}</span>
        <span className="font-mono text-[13px] font-semibold text-fg">
          {t.schema ? `${t.schema}.${t.name}` : t.name}
        </span>
        {/*
          무엇이 바뀌어 "변경"인지 — 컬럼은 그대로인데 제약만 바뀌는 일이 흔하다.
          오른쪽에 `16 columns · 6 constraints` 를 따로 또 적던 것은 지웠다: 같은 종류의 숫자가
          한 줄에 두 벌(한글·영어) 있어 어느 쪽이 바뀐 수인지 알 수 없었다.
        */}
        {t.status === 'modified' && (
          <span className="text-[11.5px] text-muted">
            {[changedColumns > 0 && `바뀐 컬럼 ${changedColumns}`, changedConstraints > 0 && `바뀐 제약 ${changedConstraints}`]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
        {/* 잘린 칸을 펴는 손잡이는 칸 자신이 든다 — 여기 있던 "전문 보기" 체크박스는 걷어냈다. */}
        {sameCount > 0 && (
          /*
           * **켜짐/꺼짐이 한눈에 보이는 토글 버튼**이다 — 체크박스가 아니다(2026-08-13 사용자).
           * 모양은 바로 위 스키마 칩(`SchemaToggles`)과 같은 말투로 맞춘다: 같은 화면에서 "보기를
           * 거르는 손잡이"가 두 벌인데 생김새가 다르면 눈이 매번 다시 배운다.
           */
          <button
            type="button"
            aria-pressed={changedOnly}
            // 검사 손잡이 — 글자가 바뀌어도 이 이름은 안 바뀐다.
            data-changed-only={changedOnly ? '1' : '0'}
            onClick={() => setChangedOnly((v) => !v)}
            className={cn(
              'ml-auto flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] ring-1 transition-colors',
              changedOnly
                ? 'bg-warning/[0.18] font-semibold text-fg ring-warning/50'
                : 'text-muted ring-line hover:bg-panel-strong'
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                changedOnly ? 'bg-warning' : 'bg-transparent ring-1 ring-muted'
              )}
            />
            바뀐 줄만
            <span className="tabular-nums text-muted">안 바뀐 줄 {sameCount}</span>
          </button>
        )}
      </div>

      {/*
        검사 훅 — 이 박스가 실제로 스크롤되는지를 잴 수 있게(높이만으로는 못 잰다).
        가로는 **여기서 막는다**: 세로·가로를 한 컨테이너가 다 맡으면 안쪽 표가 shrink-to-fit 으로
        줄어, 컬럼 수에 따라 표 폭이 춤춘다. 가로 스크롤은 표 자신이 맡는다(아래 overflow-x-auto).
      */}
      <div data-diff-scroll className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        <div className="overflow-x-auto rounded-[10px] border border-line">
          {/*
            `w-full` 이 빠지면 표가 **내용 폭**으로 줄어든다 — 컬럼 2개짜리 테이블과 12개짜리를
            오갈 때마다 열 위치가 춤춰서 눈이 매번 다시 자리를 찾아야 했다(2026-08-10 사용자:
            "왜 이렇게 정신이 없어"). 폭은 언제나 패널을 채우고, 좁아질 때만 가로 스크롤이 선다.
          */}
          <div className="w-full" style={{ minWidth: GRID_MIN_W }}>
            <div
              className="grid items-center bg-panel text-[11px] font-semibold uppercase tracking-wide text-muted"
              style={{ gridTemplateColumns: GRID, minHeight: 30 }}
            >
              <div />
              <div className="px-1 text-right">#</div>
              <div className="px-1">Name</div>
              <div className="px-1">Type</div>
              <div className="px-1">Keys</div>
              <div className="text-center">Null</div>
              <div className="px-1">Default</div>
              <div className="px-1">Comment</div>
            </div>
            {columns.map((c, i) => (
              <ColumnLine
                key={`c:${c.name}`}
                row={c}
                index={i}
                badges={c.col ? (badgeMap.get(c.col.id) ?? []) : []}
                isCheck={!!c.col && checkCols.has(c.col.id)}
              />
            ))}
            {columns.length === 0 && (
              <div className="border-t border-line/70 px-3 py-3 text-[12px] text-muted">
                {/* 걸러서 빈 것과 원래 빈 것은 다른 사실이다 — 같은 말로 덮으면 고장으로 읽힌다. */}
                {changedOnly ? '바뀐 컬럼 없음' : '컬럼 없음'}
              </div>
            )}
          </div>
        </div>

        {constraints.length > 0 && (
          <>
            <h3 className="mb-1.5 mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Constraints
              <span className="tabular-nums text-fg">{t.constraints.length}</span>
            </h3>
            <div className="overflow-hidden rounded-[10px] border border-line">
              {constraints.map((k) => (
                <ConstraintLine key={`k:${k.kind}:${k.name}`} row={k} from={t.def} />
              ))}
            </div>
          </>
        )}

        {/* 접힌 줄 수는 토글 옆 라벨이 이미 말한다 — 여기서 또 적으면 같은 말이 두 번이다. */}
      </div>
    </div>
  )
}

/**
 * 목록 줄 표시 — **꽉 찬 색 칩**. 글자만 물들여 놨더니 서른몇 줄 사이에서 눈에 안 걸렸다
 * (2026-08-10 사용자: "옆에 좀 티나게"). 안 바뀐 테이블에는 아무것도 안 붙인다.
 */
const CHIP_TONE: Record<RowStatus, string> = {
  added: 'bg-success text-white',
  removed: 'bg-danger text-white',
  modified: 'bg-warning text-white',
  same: ''
}

function RowMark({ t }: { t: TableView }): ReactElement | null {
  if (!t.changed) return null
  return (
    <span
      className={cn(
        'flex size-[18px] shrink-0 select-none items-center justify-center rounded font-mono text-[12px] font-bold leading-none',
        CHIP_TONE[t.status]
      )}
      title={t.status === 'added' ? '새로 생김' : t.status === 'removed' ? '사라짐' : '안이 바뀜'}
    >
      {MARK[t.status]}
    </span>
  )
}

/**
 * @param before 지금 실제(또는 반영 전 모습)
 * @param after  반영 뒤가 될 모습
 */
export function SchemaDiffExplorer({
  before,
  after,
  designId,
  emptyText = '변경 없음',
  fill = false
}: {
  before: VersionSnapshot
  after: VersionSnapshot
  designId: string
  emptyText?: string
  /**
   * 남은 높이를 **다 쓴다**. 화면의 본체가 이 표 하나일 때만 켠다(진단).
   * 계획 화면에서 켜면 표 아래의 SQL 묶음이 첫 화면 밖으로 밀려난다 — 거기선 표가 판단의
   * 근거이고 SQL 이 결론이라 둘 다 손 닿는 데 있어야 한다.
   */
  fill?: boolean
}): ReactElement {
  const full = useMemo(() => buildDiffView(before, after), [before, after])
  const schemas = useMemo(() => schemasOf(full), [full])
  /**
   * **꺼 둔 것**을 들고 있는다(켠 것이 아니라). 그래야 대조표에 새 스키마가 나타났을 때
   * 기본이 "켜짐"이 되어 조용히 빠지는 일이 없다 — 안 보이는 변경이 제일 위험하다.
   */
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const view = useMemo(() => {
    if (off.size === 0) return full
    return filterView(full, new Set(schemas.map((s) => s.name).filter((n) => !off.has(n))))
  }, [full, schemas, off])

  const tableDefs = useMemo(() => asTableDefs(view, designId), [view, designId])
  const [activeId, setActiveId] = useState<string | null>(null)

  // 처음에는 **바뀐 것 중 첫째**를 편다 — 열자마자 할 일이 보여야 한다.
  useEffect(() => {
    const first = view.tables.find((t) => t.changed) ?? view.tables[0]
    setActiveId((cur) => (cur && view.tables.some((t) => t.id === cur) ? cur : (first?.id ?? null)))
  }, [view])

  const active = view.tables.find((t) => t.id === activeId) ?? null
  const byId = useMemo(() => new Map(view.tables.map((t) => [t.id, t])), [view])

  if (full.tables.length === 0) return <div className="p-4 text-[13px] text-muted">{emptyText}</div>

  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-2', fill && 'min-h-0 flex-1')}>
      <SchemaToggles
        schemas={schemas}
        off={off}
        onToggle={(name) =>
          setOff((cur) => {
            const next = new Set(cur)
            if (!next.delete(name)) next.add(name)
            return next
          })
        }
      />
      {/*
        `[&>div]:flex-1` 가 핵심이다 — WorkspacePanels 의 최상위 div 는 flex item 이라, 늘어나라고
        말해 주지 않으면 **내용 폭**으로 줄어든다. 그러면 패널 크기가 %인 탓에 좌측 목록 폭까지
        테이블마다 달라져 화면 전체가 춤춘다(2026-08-10 실측: 박스 948px↔1330px, 사이드바 246↔346).
      */}
      {/*
        높이 — `fill` 이면 남은 자리를 다 쓴다. 못 박은 560px 이 화면 아래로 절반을 비워 두고
        표는 표대로 좁아 스크롤이 길었다(2026-08-12 사용자: "높이 다 차지하면 안되나?").
        바닥값(`min-h-[360px]`)은 남긴다 — 위쪽 내용이 길어 자리가 없을 때 0 으로 눌리면 안 된다.
      */}
      <div
        className={cn(
          'flex w-full min-h-0 min-w-0 overflow-hidden rounded-lg border border-line [&>div]:min-w-0 [&>div]:flex-1',
          fill ? 'min-h-[360px] flex-1' : 'h-[560px]'
        )}
      >
        <WorkspacePanels
          sidebarTitle={`테이블 ${view.tables.length}개 · 바뀜 ${view.changedCount}개`}
          autoSaveId="migration-diff-explorer"
          defaultSize={26}
          sidebar={
            <TableSidePanel
              tables={tableDefs}
              activeId={activeId}
              onPick={(t: TableDef) => setActiveId(t.id)}
              searchPlaceholder="테이블/컬럼 검색…"
              emptyText="테이블 없음"
              rowExtra={(t: TableDef) => {
                const v = byId.get(t.id)
                return v ? <RowMark t={v} /> : null
              }}
            />
          }
        >
          {active ? (
            <TablePanel t={active} />
          ) : (
            <div className="p-4 text-[13px] text-muted">선택된 테이블 없음</div>
          )}
        </WorkspacePanels>
      </div>
    </div>
  )
}

/**
 * 스키마 토글 — 표 위에서 **어느 스키마를 볼지** 고른다.
 *
 * 여기 있던 것은 `+ 테이블 6 · ~ 테이블 18 · 전체 38개 중 24개` 요약이었는데, 같은 사실을
 * 계획 머리(종류별 눈금)와 좌측 목록 제목(`테이블 38개 · 바뀜 24개`)이 이미 말하고 있었다.
 * 한 화면에 세 벌이라 자리만 먹었다(2026-08-12 사용자).
 *
 * 스키마가 하나뿐이면 안 그린다 — 끌 것이 없는 토글은 장식이다.
 */
function SchemaToggles({
  schemas,
  off,
  onToggle
}: {
  schemas: SchemaSlice[]
  off: ReadonlySet<string>
  onToggle: (name: string) => void
}): ReactElement | null {
  if (schemas.length < 2) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
      {schemas.map((s) => {
        const on = !off.has(s.name)
        return (
          <button
            key={s.name}
            type="button"
            aria-pressed={on}
            // 검사 손잡이 — 칩 글자는 바뀌어도 이 이름은 안 바뀐다.
            data-schema-toggle={s.name || '(none)'}
            data-schema-on={on ? '1' : '0'}
            onClick={() => onToggle(s.name)}
            // 칩에 든 `2/3` 이 무슨 수인지는 숫자만으로 안 읽힌다 — 글자로 한 번 풀어 둔다.
            title={
              s.changed > 0
                ? `테이블 ${s.total}개 중 ${s.changed}개가 바뀝니다`
                : `테이블 ${s.total}개 · 바뀌는 것 없음`
            }
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 transition-colors',
              on ? 'bg-panel-strong text-fg ring-line' : 'text-muted line-through opacity-60 ring-line'
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                !on ? 'bg-transparent ring-1 ring-muted' : s.changed > 0 ? 'bg-warning' : 'bg-muted'
              )}
            />
            <span className="font-mono">{s.name || '기본 스키마'}</span>
            <span className="tabular-nums text-muted">
              {s.changed > 0 ? `${s.changed}/${s.total}` : s.total}
            </span>
          </button>
        )
      })}
      {/* 숨긴 것이 실행에서도 빠진다고 읽히면 안 된다 — 이 토글은 보기만 거른다. */}
      {off.size > 0 && <span className="text-muted">숨긴 스키마도 실행에는 그대로 들어갑니다</span>}
    </div>
  )
}
