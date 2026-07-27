import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Braces, Eye, EyeOff, Info, Layers, Link2, Plus, Sprout, Table2, Trash2 } from 'lucide-react'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { Badge } from '@renderer/ui/badge'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { useNav } from '@renderer/nav/useNav'
import { autoColumnWidths } from '../../console/data/colWidth'
import { useActiveDesign, useDesignsStore } from '../../designs/store'
import { useDesignTables, useStudioReadOnly } from '../definition/store'
import type { Column, TableDef } from '../definition/types'
import { missingRequiredCells, isVariableCell, seedVariables, validateSeedRows, type SeedRowIssue } from './seedRows'
import { seedColumnHints } from './columnHint'
import {
  looksLikeSeedRef,
  parseSeedRef,
  refCellKey,
  seedRefCycles,
  validateAliases,
  validateSeedRefs,
  type SeedAliasIssue,
  type SeedRefIssue
} from './seedRef'
import {
  matchKeyBlockedReason,
  naturalKeyBacking,
  pkColumnNames,
  seedApplyReadiness,
  seedColumnRole,
  seedSetStatus,
  visibleSeedColumns,
  SEED_ROLE_HINT,
  SEED_ROLE_LABEL
} from './seedSet'
import { SeedSetDialog } from './SeedSetDialog'
import { setKey, useActiveSeedSet, useDesignSeedSets, useSeedStore } from './store'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/ui/select'
import { pkPreview, pkRuleOptions, pkRuleVariesPerRow, PK_RULE_CUSTOM, PK_TEMPLATE_TOKENS } from './seedPk'
import {
  PK_STRATEGY_HINT,
  PK_STRATEGY_LABEL,
  type SeedPkStrategy,
  STRENGTH_GROUP_LABEL,
  STRENGTH_HINT,
  STRENGTH_LABEL,
  type SeedRow,
  type SeedSet,
  type SeedStrength
} from './types'

/**
 * Studio › Seed — 기준 데이터(시드) 저작 화면. 정본: `docs/spec/db-studio.md` Surface `db-studio.seed`.
 * 실 DB 를 건드리지 않는다 — 저장은 로컬 설계 저장소뿐(Studio 공통 불변식).
 */

/** 컬럼 머리에 보일 타입 라벨 글자 상한 — 넘으면 잘라 그리고 전체는 툴팁으로. */
const TYPE_LABEL_MAX = 18

/**
 * 좌측 사이드바 — 시드 세트 목록. 짝짓기 기준이 없는 세트는 경고 표식을 단다.
 * 머리·개수 표기는 Definition·Diagram 사이드바(`TableListPanel`)와 같은 문법으로 맞춘다.
 */
function SeedSetSidebar({ sets, activeKey, onPick }: { sets: SeedSet[]; activeKey: string; onPick: (k: string) => void }) {
  if (sets.length === 0) {
    return <div className="px-3 py-4 text-[12px] text-muted">아직 시드 세트가 없어요</div>
  }
  const sorted = [...sets].sort((a, b) => a.tableName.localeCompare(b.tableName))
  return (
    <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
        <Sprout className="size-3" />
        시드 세트
        <span className="opacity-70">{sorted.length}</span>
      </div>
      {sorted.map((s) => {
        const k = setKey(s)
        const active = k === activeKey
        return (
          <button
            key={k}
            type="button"
            data-seed-set-row={s.tableName}
            onClick={() => onPick(k)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
              active ? 'bg-accent-soft font-semibold text-accent' : 'text-fg hover:bg-panel-strong'
            )}
          >
            {/* 시드는 뷰에 못 심는다(seedSetCandidates 가 뷰를 뺀다) — 아이콘도 테이블 하나로 고정. */}
            <Table2 className="size-3.5 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate font-mono">{s.tableName}</span>
            {seedSetStatus(s) === 'no-natural-key' && (
              <span
                data-seed-needs-key
                title="짝짓기 기준 컬럼이 필요해요"
                className="flex shrink-0 items-center gap-0.5 rounded bg-warning-soft px-1 py-0.5 text-[10px] font-semibold text-warning"
              >
                <AlertTriangle className="size-2.5" />
                짝짓기
              </span>
            )}
            <span
              className={cn('shrink-0 text-[10.5px] tabular-nums', active ? 'text-accent/70' : 'text-muted')}
            >
              {s.rows.length}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** 설계 미선택 빈 상태 — Definition 과 같은 문법. */
function NoDesignState() {
  const openCreate = useDesignsStore((s) => s.openCreate)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3.5 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
        <Layers size={22} />
      </div>
      <div>
        <div className="text-[14px] font-semibold text-fg">설계를 선택하세요</div>
        <p className="mt-1 max-w-72 text-[12px] leading-relaxed text-muted">
          시드는 설계가 정의하는 기준 데이터예요. 상단 컨텍스트 바에서 설계를 고르거나 새로 만들어요.
        </p>
      </div>
      <Button size="sm" onClick={openCreate}>
        <Plus />새 설계 만들기
      </Button>
    </div>
  )
}

/** 세트 없음 빈 상태 — 테이블에서 세트를 만들도록 유도. */
function NoSeedSetState({ onCreate, hasTables }: { onCreate: () => void; hasTables: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3.5 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
        <Sprout size={22} />
      </div>
      <div>
        <div className="text-[14px] font-semibold text-fg">아직 시드 세트가 없어요</div>
        <p className="mt-1 max-w-80 text-[12px] leading-relaxed text-muted">
          시드는 테이블을 만들 때 처음부터 있어야 하는 기준 데이터예요(권한·역할·코드표).
          {hasTables ? ' 관리할 테이블을 골라 시작해요.' : ' 먼저 Definition 에서 테이블을 만들어요.'}
        </p>
      </div>
      {hasTables && (
        <Button size="sm" onClick={onCreate}>
          <Plus />
          테이블에서 시드 세트 만들기
        </Button>
      )}
    </div>
  )
}

/** 셀 편집기 — 값 입력 + NULL 토글. Enter 확정 / Esc 취소. */
function CellEditor({
  initial,
  onCommit,
  onCancel
}: {
  initial: string | null
  onCommit: (v: string | null) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(initial ?? '')
  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit(v)
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={() => onCommit(v)}
        className="h-6 rounded-sm px-1 font-mono text-[12px]"
      />
      <button
        type="button"
        title="NULL 로 두기"
        // mousedown 으로 처리 — Input 의 blur(=확정)가 먼저 일어나면 이 클릭이 사라진다.
        onMouseDown={(e) => {
          e.preventDefault()
          onCommit(null)
        }}
        className="shrink-0 rounded border border-line px-1 text-[10px] font-semibold text-muted hover:bg-panel-strong"
      >
        NULL
      </button>
    </div>
  )
}

/** 별칭 입력기 — 형식(영문·숫자·`-`·`_`)은 저장 후 검증이 잡는다. Enter 확정 / Esc 취소. */
function AliasEditor({
  initial,
  onCommit,
  onCancel
}: {
  initial: string
  onCommit: (v: string) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(initial)
  return (
    <Input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(v)
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => onCommit(v)}
      placeholder="예: admin"
      className="h-6 rounded-sm px-1 font-mono text-[12px]"
    />
  )
}

/** 값 표시 — NULL 은 흐린 이탤릭, 변수·참조는 각자 표식을 붙인다(Data 뷰와 같은 표기 문법). */
function CellValue({ v, broken = false }: { v: string | null | undefined; broken?: boolean }) {
  if (v == null) return <span className="font-mono text-[12px] italic text-muted/60">NULL</span>
  // 참조 — 다른 시드 행을 가리키는 값. 깨진 참조는 붉게(오류는 셀 배경으로도 보인다).
  if (parseSeedRef(v) || looksLikeSeedRef(v))
    return (
      <span data-seed-ref-cell={v} className="flex items-center gap-1">
        <Link2 className={cn('size-3 shrink-0', broken ? 'text-danger' : 'text-accent')} />
        <span className={cn('truncate font-mono text-[12px]', broken ? 'text-danger' : 'text-accent')}>{v}</span>
      </span>
    )
  if (isVariableCell(v))
    return (
      <span data-seed-variable-cell className="flex items-center gap-1">
        <Braces className="size-3 shrink-0 text-accent-2" />
        <span className="truncate font-mono text-[12px] text-accent-2">{v}</span>
      </span>
    )
  if (v === '') return <span className="text-[12px] text-muted/50">—</span>
  return <span className="truncate font-mono text-[12px] text-fg">{v}</span>
}

/**
 * PK 생성 규칙 줄 — `시드가 정한다` 를 켰을 때만 나온다.
 *
 * 왜 **고르기(드롭박스)** 인가: 실제로 유효한 규칙은 몇 개뿐인데 자유 문자열로 받으면 오타·타입
 * 불일치·상수 규칙(모든 행이 같은 PK) 세 가지 사고가 다 열린다. 잘못 쓸 수 있게 만들고 경고를
 * 붙이는 것보다 **고를 수 없게 하는 것**이 낫다 — 목록은 PK 컬럼 타입으로 걸러 내놓는다.
 * 접두사가 필요한 드문 경우를 위해 `직접 입력` 을 남기고, 그 경로에만 조각 칩과 경고를 붙인다.
 *
 * 어느 경로든 **1행에 실제로 들어갈 값**을 함께 보인다 — 고른 것이 무슨 값이 되는지가 이 화면의
 * 설명서다. 값 계산은 반영 계획과 같은 함수(`pkPreview` → `seedPkValues`)를 쓴다.
 */
function PkRuleBar({ set, table, readOnly }: { set: SeedSet; table: TableDef | undefined; readOnly: boolean }) {
  const setPkStrategy = useSeedStore((s) => s.setPkStrategy)
  const pks = useMemo(() => (table ? pkColumnNames(table) : []), [table])
  const firstRow = set.rows[0]
  const preview = useMemo(
    () => (firstRow ? pkPreview(set, firstRow, pks, table?.columns ?? []) : null),
    [set, firstRow, pks, table]
  )
  const template = set.pkTemplate ?? ''
  const options = useMemo(
    () => pkRuleOptions(table?.columns.find((c) => c.name === pks[0])),
    [table, pks]
  )
  // 목록에 없는 규칙이 이미 저장돼 있으면 그건 손으로 쓴 것이다 — 그 상태로 열어 준다.
  // 사용자가 `직접 입력` 을 골랐지만 아직 아무것도 안 쓴 순간은 값만으로 구별할 수 없어 state 로 든다
  // (세트를 바꾸면 리셋돼야 해서 호출부가 세트 키로 remount 한다).
  const [customPicked, setCustomPicked] = useState(false)
  const custom = customPicked || (template !== '' && !options.some((o) => o.value === template))
  // 상수 규칙이면 모든 행이 같은 PK 를 받는다 — 행이 둘 이상일 때만 실제 문제다.
  const constantRule = template !== '' && !pkRuleVariesPerRow(template) && set.rows.length > 1

  // PK 가 없는 테이블이면 이 선언 자체가 성립하지 않는다 — 규칙칸을 주는 대신 그 사실을 알린다.
  if (pks.length === 0) {
    return (
      <div
        data-seed-pk-no-pk
        className="flex items-start gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-[11.5px] text-warning"
      >
        <AlertTriangle className="mt-[1px] size-3.5 shrink-0" />
        <span>
          <span className="font-mono">{set.tableName}</span> 에는 PK 가 없어요 — 시드가 정할 PK 가 없습니다.
          Definition 에서 PK 를 만들거나 <span className="font-semibold">DB 가 만든다</span> 로 되돌리세요.
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-panel-strong px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-fg">
          PK <span className="font-mono">{pks[0]}</span> 에 넣을 값
        </span>
        {readOnly ? (
          <span data-seed-pk-rule={template} className="font-mono text-[11px] text-fg">
            {template || '(규칙 없음 — 셀에 쓴 값)'}
          </span>
        ) : (
          <>
            <Select
              value={custom ? PK_RULE_CUSTOM : template}
              onValueChange={(v) => {
                setCustomPicked(v === PK_RULE_CUSTOM)
                // `직접 입력` 은 모드 전환일 뿐 — 이미 쓴 규칙을 지우지 않는다.
                if (v !== PK_RULE_CUSTOM) setPkStrategy('seed', v)
              }}
            >
              <SelectTrigger size="sm" data-seed-pk-rule={template} className="w-64 text-[11px] normal-case tracking-normal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value} data-seed-pk-rule-option={o.value} className="text-[11.5px]">
                    {o.label}
                  </SelectItem>
                ))}
                <SelectItem value={PK_RULE_CUSTOM} data-seed-pk-rule-option={PK_RULE_CUSTOM} className="text-[11.5px]">
                  직접 입력…
                </SelectItem>
              </SelectContent>
            </Select>
            {custom && (
              <Input
                value={template}
                placeholder="예: role-{key}"
                data-seed-pk-template
                onChange={(e) => setPkStrategy('seed', e.target.value)}
                className="h-6 w-52 font-mono text-[11px]"
              />
            )}
          </>
        )}
      </div>

      {/* 조각 칩은 `직접 입력` 에서만 — 고르기로 끝나는 대부분의 경우엔 화면 소음일 뿐이다. */}
      {!readOnly && custom && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted">
          <span className="shrink-0">넣을 수 있는 조각</span>
          {PK_TEMPLATE_TOKENS.map((t) => (
            <span key={t.token} className="flex items-center gap-1">
              <button
                type="button"
                data-seed-pk-token={t.token}
                title={`규칙 끝에 ${t.token} 붙이기`}
                onClick={() => setPkStrategy('seed', `${template}${t.token}`)}
                className="rounded bg-accent-2-soft px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent-2 hover:brightness-95"
              >
                {t.token}
              </button>
              <span>{t.what}</span>
            </span>
          ))}
        </div>
      )}

      {/* 미리보기 — 규칙을 치는 동안 결과가 바로 바뀐다. 이게 이 화면의 설명서 역할을 한다. */}
      {!firstRow ? (
        <div className="text-[11px] text-muted">행을 추가하면 여기서 실제 값을 미리 봐요.</div>
      ) : (
        preview && (
          <div
            data-seed-pk-preview={preview.value || undefined}
            data-seed-pk-preview-from={preview.from}
            className="flex flex-wrap items-center gap-1.5 text-[11px]"
          >
            <span className="text-muted">1행에 들어갈 값</span>
            <span className="font-mono text-muted">{preview.column}</span>
            <span className="text-muted">=</span>
            {preview.from === 'none' ? (
              <span className="flex items-center gap-1 font-medium text-warning">
                <AlertTriangle className="size-3 shrink-0" />
                아직 없어요 — 규칙을 쓰거나 그리드의 <span className="font-mono">{preview.column}</span> 칸에 값을
                넣으세요(둘 다 없으면 반영이 막힙니다)
              </span>
            ) : (
              <>
                <span className="rounded bg-panel px-1.5 py-0.5 font-mono font-semibold text-fg">{preview.value}</span>
                {preview.from === 'cell' && <span className="text-muted">← 그리드 셀에 쓴 값</span>}
              </>
            )}
            {preview.unknown.length > 0 && (
              <span data-seed-pk-unknown className="flex items-center gap-1 font-medium text-warning">
                <AlertTriangle className="size-3 shrink-0" />
                <span className="font-mono">{preview.unknown.join(', ')}</span> 는 모르는 조각이라 글자 그대로
                들어가요
              </span>
            )}
            {/* 타입 불일치 — 반영 단계(트랜잭션 안)에서 터지기 전에 규칙을 쓰는 자리에서 알린다. */}
            {preview.typeIssue && (
              <span data-seed-pk-type-issue className="flex items-center gap-1 font-medium text-danger">
                <AlertTriangle className="size-3 shrink-0" />
                {preview.typeIssue}
              </span>
            )}
            {/* 상수 규칙 — 고르기 목록에는 없고 `직접 입력` 으로만 만들 수 있는 사고. */}
            {constantRule && (
              <span data-seed-pk-constant className="flex items-center gap-1 font-medium text-danger">
                <AlertTriangle className="size-3 shrink-0" />
                이 규칙은 행마다 값이 안 변해서 {set.rows.length}행이 모두 같은 PK 가 돼요 —{' '}
                <span className="font-mono">{'{uuid}'}</span> · <span className="font-mono">{'{key}'}</span> ·{' '}
                <span className="font-mono">{'{alias}'}</span> 중 하나를 넣으세요
              </span>
            )}
            {pks.length > 1 && template && (
              <span className="text-muted">
                (규칙은 <span className="font-mono">{pks[0]}</span> 에만 적용 — 나머지{' '}
                <span className="font-mono">{pks.slice(1).join(', ')}</span> 는 셀 값)
              </span>
            )}
          </div>
        )
      )}
    </div>
  )
}

/** 선언 바 — '설계에 없는 행' 처리 · 변수 목록 · 짝짓기 기준 경고. 컬럼 단위 선언은 그리드 헤더에 있다. */
function DeclarationBar({
  set,
  table,
  readOnly
}: {
  set: SeedSet
  table: TableDef | undefined
  readOnly: boolean
}) {
  const setStrength = useSeedStore((s) => s.setStrength)
  const setPkStrategy = useSeedStore((s) => s.setPkStrategy)
  const variables = useMemo(() => seedVariables(set.rows), [set.rows])
  const needsKey = seedSetStatus(set) === 'no-natural-key'
  // 자연키를 UNIQUE 가 뒷받침하지 않으면 반영 단계에서 UPSERT 를 못 쓴다 — 그 사실을 지금 알린다.
  const backing = useMemo(
    () => (table ? naturalKeyBacking(table, set.naturalKey) : { backed: false }),
    [table, set.naturalKey]
  )
  // 반영((b) 단계) 전제: 짝짓기 기준에 환경 간 안정적인 컬럼이 1개 이상 있어야 한다.
  const readiness = useMemo(() => seedApplyReadiness(set, table), [set, table])

  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] font-semibold text-fg">{set.tableName}</span>
        <span className="text-[11px] text-muted" title="어느 행이 이미 있는 행인지 알아보는 기준 컬럼">
          짝짓기 기준 <span className="font-mono text-fg">{set.naturalKey.join(', ') || '없음'}</span>
        </span>
        {/* 무시 컬럼은 **개수만** — 이름을 다 늘어놓으면 선언 바가 컬럼 목록에 잡아먹힌다.
            어느 컬럼인지는 마우스를 올리면 보이고, 표에서도 흐리게 그려져 이미 구별된다. */}
        {set.ignoredColumns.length > 0 && (
          <span
            data-seed-ignored-count={set.ignoredColumns.length}
            title={`비교에서 빼는 컬럼 — ${set.ignoredColumns.join(', ')}`}
            className="text-[11px] text-muted"
          >
            무시 <span className="font-semibold text-fg">{set.ignoredColumns.length}</span>
          </span>
        )}

        {/* PK 획득 방식 — 반영 계약의 선언(누가 PK 를 만드나). */}
        <span className="flex items-center gap-1" title={PK_STRATEGY_HINT[set.pkStrategy ?? 'db']}>
          <span className="text-[11px] text-muted">PK</span>
          {(['db', 'seed'] as SeedPkStrategy[]).map((v) => (
            <button
              key={v}
              type="button"
              disabled={readOnly}
              data-seed-pk-strategy={v}
              data-seed-pk-active={(set.pkStrategy ?? 'db') === v ? 'true' : undefined}
              onClick={() => setPkStrategy(v)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                (set.pkStrategy ?? 'db') === v ? 'bg-accent-2 text-white' : 'bg-panel-strong text-muted hover:text-fg',
                readOnly && 'cursor-default opacity-60'
              )}
            >
              {PK_STRATEGY_LABEL[v]}
            </button>
          ))}
        </span>

        {!readiness.ready && readiness.reason !== 'no-key' && (
          <span
            data-seed-apply-blocked={readiness.reason}
            title={
              readiness.reason === 'volatile-key'
                ? `${(readiness.columns ?? []).join(', ')} 는 DB 가 값을 만드는 컬럼이라 짝짓기 기준이 될 수 없어요 — 실 DB 반영 대상에서 빠집니다.`
                : '테이블이 설계에 없어 반영할 수 없어요.'
            }
            className="flex items-center gap-1 rounded bg-warning-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-warning"
          >
            <AlertTriangle className="size-3" />
            반영 불가
          </span>
        )}

        <div className="ml-auto flex items-center gap-1" title={STRENGTH_HINT[set.strength]}>
          <span className="text-[11px] text-muted">{STRENGTH_GROUP_LABEL}</span>
          {(['ensure', 'authoritative'] as SeedStrength[]).map((v) => (
            <button
              key={v}
              type="button"
              disabled={readOnly}
              data-seed-strength={v}
              onClick={() => setStrength(v)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                set.strength === v ? 'bg-accent text-white' : 'bg-panel-strong text-muted hover:text-fg',
                readOnly && 'cursor-default opacity-60'
              )}
            >
              {STRENGTH_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {/* PK 를 시드가 정할 때만 — 규칙 입력·자리표시자·미리보기를 한 자리에 모은다. */}
      {/* key — 세트를 바꾸면 `직접 입력` 모드가 따라오면 안 된다(리셋을 remount 로 처리). */}
      {(set.pkStrategy ?? 'db') === 'seed' && (
        <PkRuleBar key={set.tableName} set={set} table={table} readOnly={readOnly} />
      )}

      {needsKey && (
        <div className="flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-[11.5px] text-warning">
          <AlertTriangle className="size-3.5 shrink-0" />
          짝짓기 기준 컬럼을 고르세요 — 어느 행이 이미 있는 행인지 알아볼 기준이 없으면 버전 비교와 실 DB
          반영의 기준이 없어요. 아래 컬럼 머리의 버튼을 눌러 <span className="font-semibold">짝짓기</span> 로
          바꾸면 지정됩니다.
        </div>
      )}

      {set.strength === 'authoritative' && (
        <div className="flex items-center gap-1.5 rounded-md bg-panel-strong px-2 py-1 text-[11.5px] text-muted">
          <AlertTriangle className="size-3.5 shrink-0 text-warning" />
          {STRENGTH_HINT.authoritative}
        </div>
      )}

      {/* 자연키는 있지만 그걸 보장하는 UNIQUE 가 설계에 없을 때 — 오류가 아니라 안내(반영 단계 함의). */}
      {!needsKey && !backing.backed && (
        <div
          data-seed-key-unbacked
          className="flex items-start gap-1.5 rounded-md bg-panel-strong px-2 py-1 text-[11.5px] text-muted"
        >
          <Info className="mt-[1px] size-3.5 shrink-0" />
          <span>
            짝짓기 기준 <span className="font-mono text-fg">{set.naturalKey.join(', ')}</span> 에 UNIQUE 제약이
            없어요. 지금 저작·비교는 문제없지만, 실 DB 에 반영할 때 UPSERT(있으면 고치고 없으면 넣기)를 쓸 수
            없어 "찾아서 넣기"로 내려가고 동시에 실행되면 같은 행이 두 번 들어갈 수 있어요. Definition 에서 이
            컬럼 구성에 UNIQUE 를 추가하는 걸 권해요.
          </span>
        </div>
      )}

      {variables.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">필요한 변수</span>
          {variables.map((v) => (
            <span
              key={v}
              data-seed-variable={v}
              className="rounded bg-accent-2-soft px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent-2"
            >
              {v}
            </span>
          ))}
          <span className="text-[11px] text-muted/80">
            값은 환경에 두고 반영할 때 채워요 — 비밀값을 여기 평문으로 넣지 마세요.
          </span>
        </div>
      )}
    </div>
  )
}

/** 행 저작 그리드 — 컬럼 머리 버튼 하나로 컬럼 역할(짝짓기/포함/무시)을 돌린다. */
function SeedGrid({
  set,
  table,
  sets,
  tables,
  readOnly,
  hideIgnored
}: {
  set: SeedSet
  table: TableDef | undefined
  /** 활성 설계의 모든 세트 — 참조가 가리키는 대상을 확인하려면 세트 전체가 필요하다. */
  sets: SeedSet[]
  tables: TableDef[]
  readOnly: boolean
  /** 보기 설정 — `무시` 컬럼을 표에서 감춘다(선언은 그대로). */
  hideIgnored: boolean
}) {
  const editing = useSeedStore((s) => s.editing)
  const setEditing = useSeedStore((s) => s.setEditing)
  const updateCell = useSeedStore((s) => s.updateCell)
  const deleteRow = useSeedStore((s) => s.deleteRow)
  const cycleColumnRole = useSeedStore((s) => s.cycleColumnRole)
  const setRowAlias = useSeedStore((s) => s.setRowAlias)

  // 검증(필수 빈 칸·참조·짝짓기 중복)은 **감춘 컬럼까지** 본다 — 보기 설정이 무엇을 문제로 볼지
  // 바꿔선 안 된다. 그래서 전체 목록(allColumns)과 그릴 목록(columns)을 갈라 둔다.
  const allColumns: Column[] = table?.columns ?? []
  const columns = useMemo(() => visibleSeedColumns(set, allColumns, hideIgnored), [set, allColumns, hideIgnored])
  const issues = useMemo(() => validateSeedRows(set.rows, set.naturalKey), [set.rows, set.naturalKey])
  // 컬럼 제약(PK/FK/UK/IDX/CHK · 필수 여부 · 상세)을 그리드 머리에서 바로 보인다 — Definition 화면과
  // 왕복하지 않게. 파생은 Definition 정본 로직 재사용(columnHint).
  const hints = useMemo(() => (table ? seedColumnHints(table) : []), [table])
  const hintOf = useMemo(() => new Map(hints.map((h) => [h.name, h])), [hints])
  const required = useMemo(() => hints.filter((h) => h.required).map((h) => h.name), [hints])
  const missing = useMemo(() => missingRequiredCells(set.rows, required), [set.rows, required])
  const aliasIssues = useMemo(() => validateAliases(set.rows), [set.rows])
  // 참조·순환은 세트 하나만 보고 판단할 수 없다 — 설계 전체를 본다.
  const refIssues = useMemo(() => validateSeedRefs(sets, tables), [sets, tables])
  const cycles = useMemo(() => seedRefCycles(sets), [sets])
  const widths = useMemo(
    () =>
      autoColumnWidths(
        columns.map((c) => {
          const h = hintOf.get(c.name)
          return {
            name: c.name,
            // 긴 타입 하나가 컬럼 폭을 독차지하면 정작 값이 안 보인다 — 라벨을 잘라 계산·표시하고
            // 전체는 툴팁으로 본다(표시와 계산이 같은 상한을 쓴다).
            typeLabel: c.type.slice(0, TYPE_LABEL_MAX),
            // 헤더가 차지하는 자리: 제약 배지 + CHK + 필수 + 역할 토글 1개.
            badges: 1 + (h?.badges.length ?? 0) + (h?.hasCheck ? 1 : 0) + (h?.required ? 1 : 0),
            trailingPx: 8
          }
        }),
        set.rows.map((r) => r.values)
      ),
    [columns, hintOf, set.rows]
  )

  if (!table) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="size-5 text-warning" />
        <div className="text-[13px] font-semibold text-fg">
          <span className="font-mono">{set.tableName}</span> 테이블이 설계에 없어요
        </div>
        <p className="max-w-80 text-[12px] text-muted">
          테이블 이름이 바뀌었거나 지워졌어요. Definition 에서 테이블을 되살리거나 이 세트를 지우세요.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-max border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr>
            <th className="w-10 border-b border-r border-line px-2 py-1.5 text-[10px] font-semibold text-muted">
              #
            </th>
            {/* 행 삭제 칸 — Console › Data 와 같은 문법: 행번호 바로 옆 고정 칸에 **항상 보이는** 휴지통.
                (회귀: 호버해야 나타나는 버튼이라 표 오른쪽 끝의 빈 컬럼으로만 보였다.
                 본문 <td> 와 **같은 자리**여야 한다 — 헤더만 옮기면 표가 한 칸씩 어긋난다.) */}
            {!readOnly && <th className="w-8 border-b border-r border-line" />}
            {/* 별칭 — 다른 시드 행이 이 행을 가리킬 이름. 설계 전용이라 컬럼 목록과 갈라 맨 앞에 둔다. */}
            <th
              className="w-28 border-b border-r border-line px-2 py-1"
              title={
                '별칭 — 다른 시드 행이 이 행을 가리킬 이름이에요(@' +
                set.tableName +
                '#별칭).\n설계 안에서만 쓰이고 실 DB 에는 들어가지 않아요.'
              }
            >
              <div className="text-[12px] font-semibold text-fg">별칭</div>
              <div className="text-[10px] text-muted">참조 대상 이름</div>
            </th>
            {columns.map((c) => {
              const role = seedColumnRole(set, c.name)
              // DB 가 값을 만드는 컬럼은 짝짓기 기준이 될 수 없다 → 역할 순환에서 건너뛴다.
              const blockedReason = matchKeyBlockedReason(c)
              const allowKey = !blockedReason
              const isIgnored = role === 'ignore'
              const hint = hintOf.get(c.name)
              return (
                <th
                  key={c.id}
                  data-seed-col={c.name}
                  style={{ width: widths[c.name], minWidth: widths[c.name] }}
                  className={cn('border-b border-r border-line px-2 py-1', isIgnored && 'opacity-55')}
                >
                  <div className="flex items-center gap-1" title={hint?.detail}>
                    <span className="min-w-0 truncate font-mono text-[12px] font-semibold text-fg">{c.name}</span>
                    {/* 제약 배지 — 색까지 서비스 공통 정본(ui/badge 의 종류별 variant)을 그대로 쓴다.
                        텍스트만 표기(이모지 금지), 복합 제약은 위치 번호. */}
                    {hint?.badges.map((b) => (
                      <Badge
                        key={b.label}
                        variant={b.kind}
                        data-seed-col-badge={b.label}
                        className="shrink-0 px-1 py-0 text-[9.5px]"
                      >
                        {b.label}
                      </Badge>
                    ))}
                    {hint?.hasCheck && (
                      <Badge variant="check" className="shrink-0 px-1 py-0 text-[9.5px]" title="CHECK 제약에 참여">
                        CHK
                      </Badge>
                    )}
                    {/* 필수 = NOT NULL·기본값 없음 → 비우면 반영 단계에서 INSERT 가 실패한다. */}
                    {hint?.required && (
                      <span
                        data-seed-col-required
                        className="shrink-0 rounded bg-warning-soft px-1 text-[9.5px] font-bold text-warning"
                      >
                        필수
                      </span>
                    )}
                    {/* 읽기 전용에선 토글이 없으니 상태를 배지로 보인다(편집 중엔 토글 자체가 배지 역할).
                        '포함'은 기본값이라 읽기 전용에서 굳이 그리지 않는다 — 표가 배지로 뒤덮인다. */}
                    {readOnly && role !== 'include' && (
                      <span
                        data-seed-col-role={role}
                        className={cn(
                          'shrink-0 rounded px-1 text-[9.5px] font-bold',
                          role === 'key' ? 'bg-accent-soft text-accent' : 'bg-panel-strong text-muted'
                        )}
                      >
                        {SEED_ROLE_LABEL[role]}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {/* 긴 타입은 **문자열 자체를** 줄여 그린다 — 표가 max-content 로 커지는 표라
                        CSS 말줄임만으로는 컬럼이 타입 라벨 길이만큼 벌어진다(ENUM 이 값 자리를 먹음). */}
                    <span className="min-w-0 text-[10px] text-muted" title={c.type}>
                      {c.type.length > TYPE_LABEL_MAX ? `${c.type.slice(0, TYPE_LABEL_MAX)}…` : c.type}
                    </span>
                    {/* 역할 토글 하나 — 짝짓기 → 포함 → 무시 → 짝짓기. 세 상태가 한 축이라 버튼도 하나다. */}
                    {!readOnly && (
                      <button
                        type="button"
                        data-seed-role-toggle={c.name}
                        data-seed-col-role={role}
                        title={blockedReason ? `${SEED_ROLE_HINT[role]}\n(${blockedReason})` : SEED_ROLE_HINT[role]}
                        onClick={() => cycleColumnRole(c.name, allowKey)}
                        className={cn(
                          'ml-auto shrink-0 rounded px-1 text-[9.5px] font-bold transition-colors',
                          role === 'key' && 'bg-accent text-white',
                          role === 'include' && 'bg-panel-strong text-muted hover:text-fg',
                          role === 'ignore' && 'bg-fg text-white'
                        )}
                      >
                        {SEED_ROLE_LABEL[role]}
                      </button>
                    )}
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {set.rows.map((r, i) => (
            <SeedGridRow
              key={r.id}
              row={r}
              index={i}
              columns={columns}
              allColumns={allColumns}
              widths={widths}
              issue={issues[r.id]}
              missing={missing[r.id]}
              aliasIssue={aliasIssues[r.id]}
              refIssueOf={(column) => refIssues[refCellKey(set.tableName, r.id, column)]}
              inCycle={cycles.some((path) => path.includes(`${set.tableName}#${(r.alias ?? '').trim() || r.id}`))}
              onAlias={(v) => setRowAlias(r.id, v)}
              ignored={set.ignoredColumns}
              readOnly={readOnly}
              editing={editing}
              onEdit={setEditing}
              onCommit={(col, v) => {
                updateCell(r.id, col, v)
                setEditing(null)
              }}
              onDelete={() => deleteRow(r.id)}
            />
          ))}
          {set.rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + (readOnly ? 2 : 3)} className="px-3 py-8 text-center text-[12px] text-muted">
                아직 시드 행이 없어요 — 위의 <span className="font-semibold">행 추가</span> 로 시작해요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function SeedGridRow({
  row,
  index,
  columns,
  allColumns,
  widths,
  issue,
  missing,
  aliasIssue,
  refIssueOf,
  inCycle,
  onAlias,
  ignored,
  readOnly,
  editing,
  onEdit,
  onCommit,
  onDelete
}: {
  row: SeedRow
  index: number
  /** 그릴 컬럼(보기 설정이 걸러낸 것). */
  columns: Column[]
  /** 테이블의 모든 컬럼 — 감춘 컬럼의 문제도 행 경고에는 나와야 한다. */
  allColumns: Column[]
  widths: Record<string, number>
  issue: SeedRowIssue | undefined
  /** 필수인데 비어 있는 컬럼 이름들. */
  missing: string[] | undefined
  aliasIssue: SeedAliasIssue | undefined
  refIssueOf: (column: string) => SeedRefIssue | undefined
  /** 참조 순환에 걸린 행 — 삽입 순서를 정할 수 없다. */
  inCycle: boolean
  onAlias: (v: string) => void
  ignored: string[]
  readOnly: boolean
  editing: string | null
  onEdit: (k: string | null) => void
  onCommit: (column: string, v: string | null) => void
  onDelete: () => void
}) {
  const missingSet = new Set(missing ?? [])
  // 감춘 컬럼에 깨진 참조가 있어도 행 경고로는 보여야 한다 → 전체 컬럼을 훑는다.
  const refProblems = allColumns.map((c) => refIssueOf(c.name)?.message).filter(Boolean)
  // 행 경고 문구 — 짝짓기 기준·필수 빈 칸·별칭·참조·순환을 한 줄로 합쳐 보인다(여러 개면 전부).
  const rowMessage = [
    issue?.message,
    missingSet.size ? `필수 값이 비었어요: ${[...missingSet].join(', ')}` : null,
    aliasIssue?.message,
    ...refProblems,
    inCycle ? '참조가 순환해요 — 어느 행을 먼저 넣을지 정할 수 없어요' : null
  ]
    .filter(Boolean)
    .join(' / ')
  const bad = !!issue || missingSet.size > 0 || !!aliasIssue || refProblems.length > 0 || inCycle
  const aliasKey = `alias::${row.id}`

  return (
    <tr
      data-seed-row={row.id}
      data-seed-row-issue={issue?.kind}
      data-seed-row-missing={missingSet.size ? [...missingSet].join(',') : undefined}
      data-seed-row-alias-issue={aliasIssue?.kind}
      data-seed-row-ref-issue={refProblems.length ? 'true' : undefined}
      data-seed-row-cycle={inCycle ? 'true' : undefined}
      className={cn('group', bad && 'bg-danger/5')}
    >
      <td className="border-b border-r border-line px-2 py-1 text-[11px] tabular-nums text-muted">
        <span className="flex items-center gap-1">
          {index + 1}
          {rowMessage && (
            <span title={rowMessage}>
              <AlertTriangle className="size-3 text-danger" />
            </span>
          )}
        </span>
      </td>
      {/* 행 삭제 — 항상 보인다(호버로만 나타나면 버튼이 있는 줄 모른다). Console › Data 와 같은 자리·같은 색. */}
      {!readOnly && (
        <td className="border-b border-r border-line px-1 py-1 text-center">
          <button
            type="button"
            title="행 삭제"
            data-seed-row-delete={row.id}
            onClick={onDelete}
            className="text-muted transition-colors hover:text-danger"
          >
            <Trash2 className="size-3.5" />
          </button>
        </td>
      )}
      {/* 별칭 칸 — 비워 둬도 된다(참조 대상이 아닌 행). */}
      <td
        data-seed-alias-cell={row.id}
        onClick={() => !readOnly && editing !== aliasKey && onEdit(aliasKey)}
        className={cn(
          'border-b border-r border-line px-2 py-1 align-middle',
          aliasIssue && 'bg-danger/10 ring-1 ring-inset ring-danger/40',
          !readOnly && 'cursor-text'
        )}
      >
        {editing === aliasKey ? (
          <AliasEditor
            initial={row.alias ?? ''}
            onCommit={(v) => {
              onAlias(v)
              onEdit(null)
            }}
            onCancel={() => onEdit(null)}
          />
        ) : row.alias?.trim() ? (
          <span data-seed-row-alias={row.alias} className="truncate font-mono text-[12px] text-accent-2">
            {row.alias}
          </span>
        ) : (
          <span className="text-[12px] text-muted/50">—</span>
        )}
      </td>
      {columns.map((c) => {
        const key = `${row.id}::${c.name}`
        const refIssue = refIssueOf(c.name)
        const isEditing = editing === key
        return (
          <td
            key={c.id}
            data-seed-cell={c.name}
            style={{ width: widths[c.name], maxWidth: widths[c.name] }}
            onClick={() => !readOnly && !isEditing && onEdit(key)}
            className={cn(
              'border-b border-r border-line px-2 py-1 align-middle',
              ignored.includes(c.name) && 'opacity-55',
              // 필수인데 빈 셀 — 반영 단계에서 터지기 전에 그 자리에서 보인다.
              missingSet.has(c.name) && 'bg-danger/10 ring-1 ring-inset ring-danger/40',
              refIssue && 'bg-danger/10 ring-1 ring-inset ring-danger/40',
              !readOnly && 'cursor-text'
            )}
          >
            {isEditing ? (
              <CellEditor
                initial={row.values[c.name] ?? null}
                onCommit={(v) => onCommit(c.name, v)}
                onCancel={() => onEdit(null)}
              />
            ) : (
              <CellValue v={row.values[c.name]} broken={!!refIssue} />
            )}
          </td>
        )
      })}
    </tr>
  )
}

/** Studio › Seed 워크스페이스 — [시드 세트 목록 | 선언 바 + 행 그리드]. 활성 Design 스코프. */
export function SeedWorkspace() {
  const design = useActiveDesign()
  const tables = useDesignTables()
  const sets = useDesignSeedSets()
  const active = useActiveSeedSet()
  const readOnly = useStudioReadOnly()
  const versionId = useNav((s) => s.contextValues['version'])
  const activeKey = useSeedStore((s) => s.activeKey)
  const setActive = useSeedStore((s) => s.setActive)
  const addSet = useSeedStore((s) => s.addSet)
  const removeSet = useSeedStore((s) => s.removeSet)
  const addRow = useSeedStore((s) => s.addRow)
  const [pickOpen, setPickOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 보기 설정 — 세션 동안만 유지한다(설계에 저장하지 않는다: 내 화면 편의일 뿐 팀과 공유할 선언이 아니다).
  const [hideIgnored, setHideIgnored] = useState(false)

  // 활성 세트 재조정 — 앱을 다시 켜면 activeKey 는 비어 있는데 화면은 첫 세트를 보여준다.
  // 그 상태로 편집하면 스토어가 대상 세트를 못 찾아 **조용히 아무 일도 안 한다**(회귀: 재시작 후
  // 행 추가가 먹지 않던 문제). 화면이 보고 있는 세트를 스토어에 알려 맞춘다
  // (definition 의 reconcileActiveTable 과 같은 취지).
  const effectiveKey = active ? setKey(active) : ''
  useEffect(() => {
    if (effectiveKey && effectiveKey !== activeKey) setActive(effectiveKey)
  }, [effectiveKey, activeKey, setActive])

  if (!design) return <NoDesignState />

  const activeTable = active ? tables.find((t) => t.name === active.tableName) : undefined
  // 실제로 감춰질 컬럼 수 — 선언에 남아 있지만 설계에서 사라진 이름은 세지 않는다.
  const ignoredCount =
    active && activeTable ? activeTable.columns.filter((c) => active.ignoredColumns.includes(c.name)).length : 0

  return (
    <WorkspacePanels
      autoSaveId="db.seed"
      sidebarTitle="SEED SETS"
      sidebarActions={
        readOnly ? undefined : (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="시드 세트 추가"
            onClick={() => setPickOpen(true)}
          >
            <Plus className="size-4" />
          </Button>
        )
      }
      sidebar={
        <SeedSetSidebar
          sets={sets}
          activeKey={effectiveKey || activeKey}
          onPick={(k) => setActive(k)}
        />
      }
    >
      <div className="flex h-full flex-col">
        {readOnly && versionId && (
          <div className="flex items-center gap-2 border-b border-line bg-accent-2-soft px-4 py-1.5 text-[12px] text-accent-2">
            <span className="font-medium">읽기 전용</span>
            <span className="font-mono font-semibold">{versionId}</span>
            <span className="text-accent-2/80">컷된 버전의 시드를 보고 있어요.</span>
          </div>
        )}

        {!active ? (
          <NoSeedSetState onCreate={() => setPickOpen(true)} hasTables={tables.length > 0} />
        ) : (
          <>
            <DeclarationBar set={active} table={activeTable} readOnly={readOnly} />
            {/* 그리드 도구줄 — 읽기 전용에서도 나온다: 보기 설정(무시 컬럼 감추기)은 편집 권한과 무관하다. */}
            <div className="flex items-center gap-2 border-b border-line px-4 py-1.5">
              {!readOnly && (
                <Button variant="soft" size="sm" onClick={addRow} disabled={!activeTable}>
                  <Plus />행 추가
                </Button>
              )}
              <span className="text-[11px] text-muted">{active.rows.length}행</span>
              {/* 무시 컬럼 감추기 — 감출 컬럼이 없으면 누를 게 없으니 버튼도 내지 않는다. */}
              {ignoredCount > 0 && (
                <Button
                  variant={hideIgnored ? 'soft' : 'ghost'}
                  size="sm"
                  aria-pressed={hideIgnored}
                  data-seed-hide-ignored={hideIgnored ? 'true' : 'false'}
                  title={
                    hideIgnored
                      ? `무시 컬럼 ${ignoredCount}개를 감춰 뒀어요 — 다시 보이면 역할도 되돌릴 수 있어요.`
                      : `무시 컬럼 ${ignoredCount}개를 표에서 감춰요. 선언은 그대로예요(비교·반영에서 계속 빠짐).`
                  }
                  onClick={() => setHideIgnored((v) => !v)}
                >
                  {hideIgnored ? <Eye /> : <EyeOff />}
                  무시 컬럼 {hideIgnored ? '보이기' : '감추기'}
                  <span className="tabular-nums opacity-70">{ignoredCount}</span>
                </Button>
              )}
              {!readOnly && (
                <div className="ml-auto flex items-center gap-1">
                  {confirmDelete ? (
                    <>
                      <span className="text-[11px] text-muted">세트를 지울까요?</span>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                        취소
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          removeSet(setKey(active))
                          setConfirmDelete(false)
                        }}
                      >
                        세트 삭제
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                      <Trash2 />
                      세트 삭제
                    </Button>
                  )}
                </div>
              )}
            </div>
            <SeedGrid
              set={active}
              table={activeTable}
              sets={sets}
              tables={tables}
              readOnly={readOnly}
              hideIgnored={hideIgnored}
            />
          </>
        )}
      </div>

      <SeedSetDialog
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        tables={tables}
        sets={sets}
        onPick={(t) => addSet(t)}
      />
    </WorkspacePanels>
  )
}
