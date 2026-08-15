import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Download,
  Layers,
  Link2,
  Loader2,
  Play,
  Radar,
  RefreshCw,
  ScrollText,
  Server,
  Undo2,
  Upload,
  XCircle
} from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Badge } from '@renderer/ui/badge'
import { Checkbox } from '@renderer/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { useNav } from '@renderer/nav/useNav'
import { useActiveDesign, useScopedDesigns, type DesignDef } from '../designs/store'
import { useActiveConnection, type ConnectionDef } from '../connections/store'
import { useDesignVersions } from '../versions/store'
import type { SchemaDiff } from '../versions/diff'
import { isEmptyDiff } from '../versions/diff'
import { isEmptySeedDiff, type SeedDiff } from '../versions/seedDiff'
import { useMigrationStore } from './store'
import { SchemaDiffExplorer } from './SchemaDiffExplorer'
import { diagnosisState, shouldIdentify } from './diagnose'
import { planGate, removals } from './planGate'
import { groupDrift } from './driftSummary'
import type { MigrationStatement } from './ddlDiff'
import { groupStatements } from './planGroups'
import { useImportStore } from './importStore'

interface Ctx {
  design: DesignDef
  connection: ConnectionDef
}

/**
 * 공통 가드 — Migration 은 실제(Connection)를 설계 버전과 대조하므로 **둘 다** 필요하다.
 * (Remote 는 Connection 만으로 되지만, 마이그레이션은 설계가 있어야 diff 대상이 생긴다.)
 */
function useCtx(): { ctx: Ctx | null; fallback: ReactElement | null } {
  const design = useActiveDesign()
  const connection = useActiveConnection()
  if (!connection)
    return { ctx: null, fallback: <Guard title="연결을 선택하세요" sub="Connection 셀렉터에서 대상 실 DB 를 고르세요." /> }
  if (!design)
    return {
      ctx: null,
      fallback: (
        <Guard title="설계를 선택하세요" sub="마이그레이션은 실제(연결)를 설계 버전과 대조합니다. 상단 Design 셀렉터에서 대상 설계를 고르세요." />
      )
    }
  return { ctx: { design, connection }, fallback: null }
}

function Guard({ title, sub }: { title: string; sub?: string }): ReactElement {
  return <PlaceholderView icon={Radar} depth="depth 3 · Migration" title={title} subtitle={sub} />
}

/*
 * 테이블 이름 칩 묶음(`DiffSummary`)은 없앴다 — 쓰던 두 자리가 다 사라졌다: 맵핑 판은
 * "아직 무엇과 견줄지 안 정한 자리에 차이부터 펼친다"고 걷혔고, 가져오기 탭은 통째로
 * 없어졌다(2026-08-14 사용자). 남은 곳에서 "얼마나 다른가"는 아래 눈금이 숫자로 말한다.
 */

/**
 * 드리프트 눈금 — 종류마다 한 칸, 칸 안에 `+ − ~` 숫자만.
 *
 * 예전엔 `summarizeDrift` 가 만든 한 줄(아홉 항목)을 그대로 제목 옆에 붙였다. 스물몇 낱말이
 * 줄줄이 흘러 "몇 개가 어떻게" 중 아무것도 안 남았다(2026-08-10 사용자: "저렇게 계속 나열하면
 * 누가 알아. 좀 시인성 좋게"). 숫자를 색으로 갈라 두면 눈이 낱말을 안 읽고도 크기를 잡는다.
 */
function DriftScale({ diff }: { diff: SchemaDiff }): ReactElement | null {
  const groups = groupDrift(diff)
  if (groups.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((g) => (
        <span
          key={g.label}
          className="flex items-center gap-2 rounded-md bg-canvas px-2 py-1 text-[12px] ring-1 ring-line"
        >
          <span className="font-medium text-fg">{g.label}</span>
          {g.added > 0 && <b className="font-mono text-success">+{g.added}</b>}
          {g.removed > 0 && <b className="font-mono text-danger">−{g.removed}</b>}
          {g.modified > 0 && <b className="font-mono text-warning">~{g.modified}</b>}
        </span>
      ))}
    </div>
  )
}

function SeedSummary({ diff }: { diff?: SeedDiff | null }): ReactElement | null {
  if (!diff || isEmptySeedDiff(diff)) return null
  const s = diff.summary
  return (
    <div className="flex flex-wrap gap-3 text-[12px] text-muted">
      <span>시드 세트 <b className="text-success">+{s.setsAdded}</b> / <b className="text-accent-2">~{s.setsModified}</b> / <b className="text-destructive">-{s.setsRemoved}</b></span>
      <span>행 <b className="text-success">+{s.rowsAdded}</b> / <b className="text-accent-2">~{s.rowsModified}</b> / <b className="text-destructive">-{s.rowsRemoved}</b></span>
    </div>
  )
}

function ErrorBar(): ReactElement | null {
  const error = useMigrationStore((s) => s.error)
  const dismiss = useMigrationStore((s) => s.dismissError)
  if (!error) return null
  return (
    <div className="mx-4 mt-3 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
      {error}
      <button type="button" className="ml-2 opacity-70 hover:opacity-100" onClick={dismiss}>✕</button>
    </div>
  )
}

/**
 * 상태 줄 — **이 모듈의 전부가 여기 있다.**
 *
 * `Design v0.2.0 ── 2단계 앞섬 ── Remote v0.1.0`
 *
 * 예전엔 탭마다 자기가 무엇과 무엇을 견주는지 따로 적었다(Drift 는 기준선↔실제, Plan 은
 * 설계↔실제). 그래서 어느 화면에 있느냐에 따라 "무엇과 무엇"이 달라져, 매번 다시 읽어야 했다
 * (2026-08-10 사용자 지적: "화면이 좀 많이 꼬인 것 같다"). 이제 이 한 줄이 모든 탭 위에 서고,
 * 탭은 그 줄에서 갈라지는 일만 한다.
 */
/**
 * 버전을 아직 모를 때의 자리 — 글자 `—` 는 **값처럼 읽힌다**(버전 이름이 대시인가?).
 * 빈 동그라미는 "아직 안 정해짐"을 값과 섞이지 않게 보인다
 * (2026-08-14 사용자: "이 표시말고 다른 표시를 해줘. 문자말고 아이콘 안되나?").
 */
function UnknownVersion(): ReactElement {
  return <CircleDashed className="size-3.5 shrink-0 text-muted" role="img" aria-label="버전 모름" />
}

function StatusLine({ ctx, targetPicker }: { ctx: Ctx; targetPicker?: ReactNode }): ReactElement {
  const remote = useMigrationStore((s) => s.remoteVersion)
  const target = useMigrationStore((s) => s.targetVersion)
  const diagDiff = useMigrationStore((s) => s.diagDiff)
  const state = diagnosisState(!!remote, diagDiff)

  /**
   * 이 줄은 **설계와 실 DB 의 관계** 하나만 말한다 — 그래서 낱말도 하나로 맞춘다
   * (2026-08-12 사용자: "실제가 다름 ㅋㅋ … '설계와 일치', '설계와 다름' 이런식으로").
   *
   * 예전엔 `실제가 다름`(남이 고침)과 `설계가 앞섬`(안 밀었음)을 갈라 적었다. 사람이 이 줄에서
   * 얻는 답은 "같나 다른가"뿐이고, **왜** 다른지는 진단 화면이 한 줄로 따로 말한다.
   * "샘"은 여전히 안 쓴다 — drift 직역이라 한국어로는 수도꼭지 소리로 읽힌다(2026-08-10).
   */
  /**
   * 셋을 **덩어리로 가른다** — 예전엔 이 줄 전체가 같은 크기·같은 회색 글자라 `설계 · 관계 ·
   * 실 DB` 가 한 뭉텅이로 흘렀고, 정작 답인 관계 낱말이 제일 안 보였다
   * (2026-08-14 사용자: "UI 적으로 좀더 구분감 있게 시인성 있게").
   * 양끝은 옅은 칩, 가운데 관계는 뜻에 맞는 색 칩 + 아이콘, 잇는 것은 글자 `──` 가 아니라 실선.
   */
  const relation: Record<string, { label: string; tone: string; Icon: typeof AlertTriangle }> = {
    unmapped: { label: '아직 모름', tone: 'bg-panel-strong text-muted', Icon: CircleDashed },
    different: { label: '설계와 다름', tone: 'bg-accent-2-soft text-accent-2', Icon: AlertTriangle },
    synced: { label: '설계와 일치', tone: 'bg-success-soft text-success', Icon: CheckCircle2 }
  }
  const r = relation[state]

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel/40 px-5 py-2 text-[13px]">
      <span className="flex items-center gap-1.5 rounded-md bg-canvas px-2.5 py-1 ring-1 ring-line">
        <Layers className="size-3.5 shrink-0 text-muted" />
        <span className="truncate text-muted">{ctx.design.name}</span>
        {/*
          타깃 버전을 **고르는 자리도 여기**다 — 예전엔 계획 화면 머리에 셀렉터가 따로 있어
          같은 `v0.1.0` 이 한 화면에 두 번 떴고, 위 툴바의 `Draft` 까지 더해 어느 버전을
          말하는지 알 수 없었다(2026-08-12 사용자: "왜 이렇게 헷갈리게 구현해놓았어?").
          값을 보이는 자리와 고르는 자리가 하나면 그 물음이 생기지 않는다.
        */}
        {targetPicker ?? (target ? <b className="font-mono text-fg">{target}</b> : <UnknownVersion />)}
      </span>

      <span className="h-px w-4 shrink-0 bg-line" aria-hidden />
      <span className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold', r.tone)}>
        <r.Icon className="size-3.5 shrink-0" />
        {r.label}
      </span>
      <span className="h-px w-4 shrink-0 bg-line" aria-hidden />

      <span className="flex items-center gap-1.5 rounded-md bg-canvas px-2.5 py-1 ring-1 ring-line">
        <Server className="size-3.5 shrink-0 text-muted" />
        <span className="truncate text-muted">{ctx.connection.name}</span>
        {remote ? <b className="font-mono text-fg">{remote}</b> : <UnknownVersion />}
      </span>
    </div>
  )
}

/** `meta` 는 제목 옆에 붙는 것 — "이 화면이 지금 무엇을 놓고 있나"를 제목과 한 줄에 둔다. */
function Header({
  title,
  meta,
  children
}: {
  title: string
  meta?: ReactNode
  children?: ReactNode
}): ReactElement {
  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <h2 className="shrink-0 text-[14px] font-bold text-fg">{title}</h2>
        {meta}
      </div>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  )
}

/**
 * 진단·계획·실행이 공유하는 뼈대 — 상태 줄은 언제나 맨 위다.
 *
 * `footer` 는 **스크롤 밖**에 선다. 계획 화면의 "실행으로" 버튼을 본문 끝에 뒀더니 SQL 84개
 * 아래로 밀려나 찾아 내려가야 했다(2026-08-10 사용자: "지금 숨은 그림 찾기야?"). 다음 걸음은
 * 본문 길이와 무관하게 언제나 보여야 한다.
 */
function Shell({
  title,
  ctx,
  meta,
  actions,
  targetPicker,
  footer,
  children
}: {
  title: string
  ctx: Ctx
  meta?: ReactNode
  actions?: ReactNode
  targetPicker?: ReactNode
  footer?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <div className="flex h-full flex-col">
      <StatusLine ctx={ctx} targetPicker={targetPicker} />
      <Header title={title} meta={meta}>
        {actions}
      </Header>
      <ErrorBar />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-5">{children}</div>
      {footer && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-panel/60 px-5 py-3">
          {footer}
        </div>
      )}
    </div>
  )
}

/*
 * 범위 알림(ScopeNotice)은 없앴다 — 세 문장으로 "지금 본 스키마는 …"을 설명하던 자리다.
 * 그 사실은 **대조표 위 스키마 토글**이 칩으로 이미 보인다(`service1 2/2 · testdb 18/32`).
 * 같은 것을 글로 또 적으니 시끄럽기만 했다(2026-08-12 사용자). 범위가 바뀐 사실 자체는
 * 스토어(`scopeChanged`)에 남아 있어, 필요하면 조용한 표시로 다시 꺼내 쓸 수 있다.
 */

// ═══════════════════════════ 진단 ═══════════════════════════
/**
 * 진단 — 이 모듈의 입구이자 **갈림길**.
 *
 * 화면의 본체는 `지금 DB → 설계` 대조표 하나다. 예전엔 같은 사실을 두 묶음("실제가 설계와
 * 다른 것" / "설계가 앞선 것")으로 갈라 칩 요약만 내밀었는데, 무엇이 어떻게 다른지를 보려면
 * 계획까지 가야 했다(2026-08-12 사용자: "진단 페이지도 Definition 화면으로 대체해줘").
 *
 * **표가 하나로 충분한 이유:** 남이 DB 에 몰래 만든 것은 설계에 없으므로 이 표에 `−`(지워짐)로
 * 이미 나온다. 즉 `−` 줄이 곧 "이대로 밀면 사라지는 것"이라, 그 줄을 보고 방향을 고르면 된다.
 *
 * 방향은 둘이고 둘 다 열어 둔다 — 지금 DB 가 정답이라는 보장이 없기 때문이다
 * (2026-08-12 사용자: "남이 실수로 넣은 스키마일 수도 있잖아"):
 *   실제 → 설계 — DB 모습을 설계 새 버전으로 (가져오기)
 *   설계 → 실제 — 설계 모습대로 DB 를 고친다 (계획)
 *   이대로 두기 — 아무것도 안 바꾸고 지금을 정상으로 기록
 */
export function DiagnoseView(): ReactElement {
  const { ctx, fallback } = useCtx()
  const st = useMigrationStore()
  const cid = ctx?.connection.id
  const did = ctx?.design.id

  useEffect(() => {
    if (cid && did) void useMigrationStore.getState().runDiagnosis(cid, did)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, did])

  if (!ctx) return fallback!
  const mapped = !!st.remoteVersion

  return (
    <Shell
      title="진단"
      ctx={ctx}
      meta={mapped ? <DesignScale design={ctx.design.name} diff={st.diagDiff} /> : null}
      actions={
        <Button size="sm" variant="outline" disabled={st.loading} onClick={() => void st.runDiagnosis(ctx.connection.id, ctx.design.id)}>
          {st.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} 다시 검사
        </Button>
      }
    >
      {st.loading && !st.diagnosis ? (
        <div className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> 실제 DB 를 읽는 중…</div>
      ) : !mapped ? (
        <MappingPanel ctx={ctx} />
      ) : (
        <>
          <DiagnoseActions ctx={ctx} />
          <SeedSummary diff={st.diagnosis?.ahead?.seed} />
          <DiagnoseTables ctx={ctx} />
        </>
      )}
    </Shell>
  )
}

/**
 * 두 방향 — **이름이 곧 방향이다.** 예전엔 이름 옆에 "가져오기 = 지금 DB 가 정답 · 계획 =
 * 설계가 정답"을 덧붙였는데, 이름을 방향으로 바꾸니 같은 말을 두 번 하는 꼴이라 뺐다
 * (2026-08-12 사용자).
 *
 * 아이콘도 **방향을 되풀이한다** — 예전엔 `DownloadCloud`(구름)와 `FileDiff`(문서 비교)라
 * 둘이 서로 반대라는 것이 안 보였다(2026-08-14 사용자: "아이콘이 명확하지가 않아").
 * 내려받기/올리기는 화살표가 서로 뒤집혀 있어 글자를 안 읽어도 짝이 잡힌다.
 */
function DiagnoseActions({ ctx }: { ctx: Ctx }): ReactElement {
  const st = useMigrationStore()
  const selectView = useNav((s) => s.selectView)
  const openImport = useImportStore((s) => s.openImport)
  const same = !st.diagDiff || isEmptyDiff(st.diagDiff)

  if (same)
    return (
      <div className="flex items-center gap-2 text-[13px] text-success">
        <CheckCircle2 className="size-4" /> 설계와 실제가 같습니다
      </div>
    )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => openImport(ctx.connection, ctx.design)}>
        <Download /> 실제 → 설계
      </Button>
      {/*
        계획 화면은 없앨 것이 있으면 스스로 막는다(§planGate). 그 관문을 여기서 열어 주지
        않으면 이 버튼이 막다른 길로 보낸다 — "지울 것을 알고 간다"를 이 클릭이 뜻한다.
      */}
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          st.passRemovals()
          selectView('plan')
        }}
      >
        <Upload /> 설계 → 실제
      </Button>
    </div>
  )
}

/** 진단의 본체 — 계획과 **같은 대조표**다(같은 것을 두 화면에서 다르게 그리면 눈이 다시 배운다). */
function DiagnoseTables({ ctx }: { ctx: Ctx }): ReactElement | null {
  const actual = useMigrationStore((s) => s.actual)
  const target = useMigrationStore((s) => s.diagTarget)
  if (!actual) return null
  if (!target)
    return <div className="text-[13px] text-muted">{ctx.design.name} 에 견줄 버전 없음</div>
  return (
    <SchemaDiffExplorer
      before={actual}
      after={target}
      designId={ctx.design.id}
      emptyText="설계와 같습니다"
      /* 진단은 화면의 본체가 이 표 하나다 — 남은 높이를 다 준다(계획은 아래에 SQL 이 있어 안 켠다). */
      fill
    />
  )
}

/**
 * 맵핑 — "이 연결은 어느 설계의 몇 버전인가?"
 *
 * 연결을 처음 물리면 우리는 이 답을 모른다. 그래서 실제를 떠서 설계의 버전들과 대조하고
 * 사람에게 확정을 받는다. 이 관문이 없으면 `Remote —` 인 채로 Migration 을 열게 되고,
 * 그때는 무엇과 무엇을 견주는지 아무도 모른다(2026-08-10 사용자 지적의 뿌리).
 */
function MappingPanel({ ctx }: { ctx: Ctx }): ReactElement {
  const st = useMigrationStore()
  const openImport = useImportStore((s) => s.openImport)
  const versions = useDesignVersions(ctx.design.id)
  const [linking, setLinking] = useState(false)

  /**
   * 판정을 한 번은 **반드시** 묻는다.
   *
   * 예전 조건(`!identified && !loading`)에 딸린 의존성이 연결·설계 id 뿐이라, 판이 뜨는 순간
   * 이미 `loading` 이면 물음이 통째로 날아가고 다시 묻지 않았다. 결속을 끊고 이 화면으로
   * 돌아오면 진단이 먼저 돌고 있어 늘 그 상태였고, 후보를 못 받아 "기존 설계 연결하기" 버튼이
   * 사라졌다(2026-08-14 사용자 제보). 이제 `loading` 이 풀리면 그때 묻는다.
   *
   * 한 번 물었으면 표식을 남긴다 — 판정이 실패해 후보가 빈 채로 끝나도 그 상태가 다시
   * 이 효과를 깨워 무한히 되묻는 일이 없어야 한다.
   */
  const asked = useRef<string | null>(null)
  const pair = `${ctx.connection.id}:${ctx.design.id}`
  useEffect(() => {
    if (!shouldIdentify({ identified: !!st.identified, loading: st.loading, askedPair: asked.current, pair })) return
    asked.current = pair
    void st.identify(ctx.connection.id, ctx.design.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, st.identified, st.loading])

  const best = st.identified?.candidates[0] ?? null
  /** 모달이 미리 골라 둘 버전 — 똑같은 것이 있으면 그것, 없으면 가장 가까운 것. */
  const suggested = st.identified?.match ?? best?.number ?? ''

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-panel/50 p-4">
      {/*
        머리가 경고의 얼굴을 쓰고, 머리 하나가 이 판의 전부다 — 예전엔 평범한 사슬 아이콘 아래
        "어느 버전인지 정해야 무엇과 무엇을 견줄지가 정해집니다" 같은 설명이 두 줄 더 붙었다.
        고를 것이 아래 버튼 둘뿐이라, 무엇이 없는지만 말하면 나머지는 버튼이 말한다
        (2026-08-14 사용자: 설명 줄들에 "삭제").
      */}
      <div className="flex items-center gap-2 text-[13px] font-semibold text-accent-2">
        <AlertTriangle className="size-4 shrink-0" />
        Connection &quot;{ctx.connection.name}&quot; 에 연결된 설계 아직 없음
      </div>

      {st.loading ? (
        <div className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> 버전을 찾는 중…</div>
      ) : versions.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-[12px] text-muted">이 설계에는 버전이 없습니다.</p>
          {/*
            여기만 이름이 다르다 — 이 갈래가 하는 일이 다르기 때문이다. 아래 갈래의
            "새 설계로 저장하기"는 **설계를 새로 만들지만**, 여기서는 지금 고른 이 설계의
            첫 버전을 채운다. 한때 이름을 아래와 맞췄다가 하는 일까지 새 설계 만들기로
            바꿔 버렸는데, 그러면 비어 있던 이 설계를 말없이 버리는 셈이라 되돌렸다.
          */}
          <Button size="sm" onClick={() => openImport(ctx.connection, ctx.design)}>
            <Download /> 실 DB 를 첫 버전으로 들이기
          </Button>
        </div>
      ) : st.identified?.match ? (
        <div className="flex flex-col items-start gap-3">
          <div className="flex items-center gap-2 text-[13px] text-success">
            <CheckCircle2 className="size-4" /> 실 DB 가 <b className="font-mono">{st.identified.match}</b> 와 똑같습니다
          </div>
          {/* 아래 갈래와 같은 클릭이라 이름도 같다 — 무엇으로 걸리는지는 모달이 보여 준다. */}
          <Button size="sm" onClick={() => setLinking(true)}>
            <Link2 /> 기존 설계 연결하기
          </Button>
        </div>
      ) : (
        /*
         * 설명 없이 버튼 둘만 — 예전엔 "가장 가까운 것은 v0.1.0", 그 후보와의 대조표,
         * "똑같은 버전이 없습니다" 가 차례로 깔려 있었다. 셋 다 **버튼 두 개가 이미 말하는 것**의
         * 되풀이라 걷어냈다(2026-08-14 사용자: "삭제").
         *
         * 그래서 이름이 대신 다 말해야 한다 — 왼쪽은 지금 DB 모습을 새로 저장하고, 오른쪽은
         * 이미 있는 설계에 이 연결을 건다. 이 자리에서 사람이 고르는 것은 **새것이냐 있던
         * 것이냐** 하나뿐이라, 이름도 그 갈림만 말한다. 예전엔 여기에 방식("못박고 차이는
         * 남겨 두기")·용어("드리프트")를 적어 두 번 되물었다(2026-08-14 사용자).
         */
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => openImport(ctx.connection, ctx.design, 'new-design')}>
            <Download /> 새 설계로 저장하기
          </Button>
          {/*
            후보를 못 골랐어도 이 길은 연다 — 예전엔 판정이 내놓은 후보가 있을 때만 그렸더니,
            판정이 빈손으로 끝나면 갈 수 있는 길이 통째로 사라져 보였다(2026-08-14 사용자:
            "버튼이 사라져있어"). 무엇으로 걸지는 모달에서 사람이 고른다.
          */}
          <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
            <Link2 /> 기존 설계 연결하기
          </Button>
        </div>
      )}

      {linking && <LinkDesignDialog ctx={ctx} suggested={suggested} onClose={() => setLinking(false)} />}
    </section>
  )
}

/**
 * 기존 설계에 이 연결을 건다 — **누르자마자 걸지 않고 무엇으로 걸리는지 보여 준 뒤** 건다.
 *
 * 값은 이미 정해져 있다(위 셀렉터의 설계 · 판정이 고른 버전). 그래도 창을 세우는 이유는,
 * 이 클릭이 "이 실 DB 는 그 설계의 이 버전이다"를 저장소에 못박는 되돌리기 어려운 일이라
 * 무엇에 걸리는지 눈으로 보고 눌러야 하기 때문이다(2026-08-14 사용자).
 */
function LinkDesignDialog({
  ctx,
  suggested,
  onClose
}: {
  ctx: Ctx
  suggested: string
  onClose: () => void
}): ReactElement {
  const designs = useScopedDesigns()
  const setContextValue = useNav((s) => s.setContextValue)
  const confirmMapping = useMigrationStore((s) => s.confirmMapping)
  const busy = useMigrationStore((s) => s.loading)
  const [designId, setDesignId] = useState(ctx.design.id)
  const [version, setVersion] = useState(suggested)
  const versions = useDesignVersions(designId)

  const submit = async (): Promise<void> => {
    if (!version) return
    // 다른 설계를 골랐으면 화면 전체가 그 설계를 따라가야 한다 — 위 셀렉터만 옛것을 가리키면
    // 연결해 놓고도 이 판이 "아직 없음"인 채로 남는다.
    if (designId !== ctx.design.id) setContextValue('design', designId)
    await confirmMapping(ctx.connection.id, designId, version)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>기존 설계 연결 · {ctx.connection.name}</DialogTitle>
        </DialogHeader>

        <div className="mt-3 flex items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted">설계</span>
            <Select
              value={designId || undefined}
              onValueChange={(v) => {
                setDesignId(v)
                // 앞 설계의 번호는 새 설계에서 뜻이 없다 — 들고 가면 없는 버전을 가리킨다.
                setVersion('')
              }}
            >
              <SelectTrigger size="sm" className="w-full"><SelectValue placeholder="설계 선택" /></SelectTrigger>
              <SelectContent>
                {designs.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-36 shrink-0 flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted">버전</span>
            <Select value={version || undefined} onValueChange={setVersion}>
              <SelectTrigger size="sm" className="w-full font-mono" disabled={!designId || versions.length === 0}>
                <SelectValue placeholder={versions.length ? '버전 선택' : '버전 없음'} />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.number} value={v.number}>{v.number}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="mt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>취소</Button>
          <Button type="button" size="sm" disabled={!designId || !version || busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="animate-spin" /> : <Link2 />} 연결
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


// ═══════════════════════════ 가져오기 ═══════════════════════════
/*
 * `ImportView`(가져오기 탭)는 없앴다 — 창을 여는 버튼 하나를 담으려고 화면 하나가 서 있었고,
 * 정작 그 판단(새 설계냐 기존 설계냐)은 진단이 이미 내리고 있었다. 되먹임으로 들어가는 문은
 * 이제 진단 화면의 버튼 둘뿐이다(2026-08-14 사용자: 탭에 "지우자").
 */

// ═══════════════════════════ 계획 ═══════════════════════════
/**
 * SQL 목록 — **테이블로 묶고, 접힌 채로 시작한다.**
 *
 * 낱개 상자 84개를 펼쳐 놓았을 때 화면 넉 장이 SQL 로만 찼고 그 뒤의 버튼까지 밀려났다
 * (2026-08-10 사용자: "이걸 지금 나보고 보라고?"). SQL 은 **확인하는 자리**라 기본은
 * "어느 테이블에 몇 개가 나가나"까지만 보이고, 문장은 펼쳐 볼 때 나온다.
 */
function StatementGroups({ statements }: { statements: MigrationStatement[] }): ReactElement {
  const groups = groupStatements(statements)
  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => (
        <StatementGroupRow key={g.table} table={g.table} destructiveCount={g.destructiveCount} statements={g.statements} />
      ))}
    </div>
  )
}

function StatementGroupRow({
  table,
  destructiveCount,
  statements
}: {
  table: string
  destructiveCount: number
  statements: MigrationStatement[]
}): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-panel/60 px-2 py-1.5 text-left text-[12px] hover:bg-panel-strong/70"
      >
        {open ? <ChevronDown className="size-3.5 shrink-0 text-muted" /> : <ChevronRight className="size-3.5 shrink-0 text-muted" />}
        <span className="min-w-0 flex-1 truncate font-mono text-fg">{table}</span>
        {destructiveCount > 0 && (
          <Badge variant="destructive" className="shrink-0 px-1.5 py-0 text-[10px]">
            지움 {destructiveCount}
          </Badge>
        )}
        <span className="shrink-0 tabular-nums text-muted">{statements.length}개</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-line p-2">
          {statements.map((s, i) => (
            <div key={i} className="font-mono text-[11.5px]">
              <div className="mb-0.5 flex gap-1.5">
                <Badge variant={s.destructive ? 'destructive' : 'secondary'} className="px-1 py-0 text-[10px]">
                  {s.kind}
                </Badge>
                {s.note && <span className="text-[11px] text-muted">{s.note}</span>}
              </div>
              <div className="whitespace-pre-wrap text-fg">{s.sql}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * SQL 묶음을 담는 칸 — 스스로 스크롤한다.
 * 안 그러면 테이블 서른 개를 펼쳤을 때 바깥 스크롤이 다시 길어져 접기가 뜻이 없어진다.
 */
function SqlSection({
  title,
  count,
  note,
  children
}: {
  title: string
  count: number
  note?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="text-[12px] font-semibold text-fg">
        {title} <span className="font-normal text-muted">{count}개</span>
      </div>
      {note}
      <div className="max-h-[420px] min-w-0 overflow-y-auto pr-0.5">{children}</div>
    </section>
  )
}

/**
 * 계획의 대조표 — "지금 → 반영 뒤"를 Definition 과 같은 문법으로.
 * SQL 목록은 아래에 그대로 남는다: 이 표는 **판단하는 자리**, SQL 은 **나갈 문을 확인하는 자리**다.
 */
function PlanTables(): ReactElement | null {
  const actual = useMigrationStore((s) => s.actual)
  const target = useMigrationStore((s) => s.planTarget)
  const design = useActiveDesign()
  if (!actual || !target || !design) return null
  return <SchemaDiffExplorer before={actual} after={target} designId={design.id} />
}

export function PlanView(): ReactElement {
  const { ctx, fallback } = useCtx()
  const st = useMigrationStore()
  const versions = useDesignVersions(ctx?.design.id ?? null)
  const cid = ctx?.connection.id
  const did = ctx?.design.id
  const designDialect = ctx?.design.dialect
  /**
   * 들어오면 이미 정해진 타깃으로 계획을 만든다 — 진단이 들어오면 검사하는 것과 같은 규율.
   * 셀렉터가 값을 **보여주면서** 계획은 onValueChange 에서만 만들던 시절, 버전이 떠 있는데
   * 본문은 "선택하세요"인 막다른 골목이 있었다(2026-08-10 사용자 지적).
   */
  useEffect(() => {
    if (!cid || !did || !designDialect) return
    void (async () => {
      const bound = await useMigrationStore.getState().resolveBinding(cid, did)
      const store = useMigrationStore.getState()
      const v = store.targetVersion ?? bound.targetVersion
      if (v) await store.loadPlan(cid, did, designDialect, v)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, did, designDialect])

  if (!ctx) return fallback!
  const dialect = ctx.design.dialect
  const gate = planGate(st.diagDiff, st.removalsPassed)
  const ready = gate === 'ok' && !st.loading && !!st.plan && st.plan.statements.length > 0

  return (
    <Shell
      title="계획"
      ctx={ctx}
      meta={gate === 'ok' && st.plan ? <DesignScale design={ctx.design.name} diff={st.planDiff} /> : null}
      targetPicker={
        /*
         * 값이 정해지기 전에는 셀렉터를 안 세운다 — `value` 가 undefined 로 시작하면 Radix 가
         * "uncontrolled → controlled" 경고를 뱉는다(2026-08-12 콘솔). 고를 것이 없는 상태를
         * 셀렉터로 그려 봐야 누를 것도 없다.
         */
        st.targetVersion ? (
          <Select
            value={st.targetVersion}
            onValueChange={(v) => void st.loadPlan(ctx.connection.id, ctx.design.id, dialect, v)}
          >
            <SelectTrigger
              size="sm"
              className="h-6 gap-1 border-0 bg-transparent px-1 py-0 font-mono text-[13px] font-bold text-fg shadow-none hover:bg-panel-strong"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {versions.map((v) => (
                <SelectItem key={v.number} value={v.number}>{v.number}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <b className="font-mono text-fg">—</b>
        )
      }
      footer={
        ready && (
          <>
            <span className="min-w-0 flex-1 text-[12px] text-fg">
              문 {st.plan!.statements.length}개
              {st.plan!.destructiveCount > 0 && (
                <span className="text-destructive"> · 데이터가 지워지는 문 {st.plan!.destructiveCount}개</span>
              )}
            </span>
            <Button size="sm" onClick={() => useNav.getState().selectView('run')}>
              <ArrowRight /> 실행으로
            </Button>
          </>
        )
      }
    >
      {st.loading ? (
        <div className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> 실제 DB 를 읽는 중…</div>
      ) : gate === 'removes' ? (
        <RemovalBlock diff={st.diagDiff!} />
      ) : !st.plan ? (
        <div className="text-[13px] text-muted">{versions.length ? '타깃 버전 없음' : '설계 버전 없음'}</div>
      ) : st.plan.statements.length === 0 ? (
        <div className="flex items-center gap-2 text-[13px] text-success"><CheckCircle2 className="size-4" /> 반영할 변경 없음</div>
      ) : (
        <>
          <RemovalNote />
          {/*
            표가 먼저, SQL 이 나중이다 — 사람이 판단하는 근거는 "테이블이 어떤 모양이 되나"이고
            SQL 은 그 결과로 나가는 문이다. 순서가 뒤였을 때 SQL 서른 몇 줄이 판단을 가로막았다.
          */}
          <PlanTables />
          {st.plan.destructiveCount > 0 && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {/* "파괴적 문"은 쓰지 않는다 — 무엇이 어떻게 되는지가 안 담긴 번역어다. */}
              <AlertTriangle className="size-4" /> 데이터가 지워지는 문이 {st.plan.destructiveCount}개
              있습니다. 실행 전에 사람이 확인해야 합니다.
            </div>
          )}
          {st.plan.unsupported.length > 0 && (
            <div className="rounded-md bg-panel px-3 py-2 text-[11.5px] text-muted">
              자동 생성 불가(수동 처리): {st.plan.unsupported.join(' · ')}
            </div>
          )}

          {/* 적용과 되돌리기를 나란히 — 무엇을 물릴 수 있는지 밀기 전에 보여야 한다. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SqlSection title="적용 SQL" count={st.plan.statements.length}>
              <StatementGroups statements={st.plan.statements} />
            </SqlSection>
            <SqlSection
              title="되돌리기 SQL"
              count={st.revert?.statements.length ?? 0}
              note={
                st.revert && st.revert.lossy.length > 0 ? (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-[11.5px] text-destructive">
                    {st.revert.lossy.length}개는 되돌려도 데이터가 안 돌아옵니다. 구조만 되살아납니다.
                  </div>
                ) : undefined
              }
            >
              {st.revert && <StatementGroups statements={st.revert.statements} />}
            </SqlSection>
          </div>
        </>
      )}
    </Shell>
  )
}

/**
 * 머리 눈금 — **무엇을 기준으로, 얼마나 다른가**를 제목과 한 줄에 둔다(진단·계획 공용).
 *
 * 숫자는 지금 DB ↔ 타깃 설계 버전의 차이다. 예전 계획 화면은 이 자리에 기준선↔실제 숫자를
 * "실 DB 가 설계와 다릅니다"라는 말과 함께 뒀는데, **그 숫자는 설계와 견준 값이 아니라**
 * 마지막으로 찍어 둔 DB 모습과 견준 값이었다 — 말과 숫자가 서로 다른 것을 가리켰다.
 */
function DesignScale({ design, diff }: { design: string; diff: SchemaDiff | null }): ReactElement | null {
  const target = useMigrationStore((s) => s.targetVersion)
  if (!diff || isEmptyDiff(diff)) return null
  return (
    <>
      <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11.5px] font-medium text-warning">
        설계와 다름
      </span>
      <DriftScale diff={diff} />
      <span className="text-[11.5px] text-muted">
        <span className="font-mono text-fg">{design} {target}</span> 기준
      </span>
    </>
  )
}

/**
 * 관문 — 계획이 실 DB 에서 **없앨 것이 있으면** 그리기 전에 진단으로 돌려보낸다.
 *
 * 없앨 것은 곧 "설계에 없는데 실 DB 에 있는 것"이다. 남이 만든 것일 수도, 우리가 설계에서
 * 지우기로 한 것일 수도 있는데 — 밀면 사라진다는 사실은 같으므로 사람이 목록을 보고 정해야 한다.
 * 예전엔 실행 버튼만 막았고, 그러면 위험한 계획을 다 읽은 뒤에야 막히는 순서가 됐다
 * (2026-08-12 사용자: "Plan 단계를 수행하는게 아니라 진단 페이지를 먼저하라고 하자. 위험하잖아").
 */
function RemovalBlock({ diff }: { diff: SchemaDiff }): ReactElement {
  const selectView = useNav((s) => s.selectView)
  const gone = removals(diff)
  return (
    <section className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-destructive">
        <AlertTriangle className="size-4" /> 이 계획은 실 DB 에서 {gone.length}개를 없앱니다
      </div>
      <p className="text-[12px] text-fg">설계에 없는 것들입니다 — 살릴 것이 있으면 먼저 설계로 가져오세요.</p>
      <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
        {gone.map((n) => (
          <span key={n} className="rounded-md bg-danger/10 px-2 py-0.5 font-mono text-[11px] text-danger">
            {n}
          </span>
        ))}
      </div>
      <Button size="sm" onClick={() => selectView('diagnose')}>
        <Radar /> 진단에서 확인
      </Button>
    </section>
  )
}

/**
 * 진단을 거쳐 들어온 경우의 한 줄 — 관문은 열렸지만 **없앨 것이 있다는 사실은 그대로**다.
 * 숫자는 안 적는다: 머리 눈금이 이미 설계와의 차이를 세고 있어, 여기 또 세면 두 눈금이 된다.
 */
function RemovalNote(): ReactElement | null {
  const diff = useMigrationStore((s) => s.diagDiff)
  if (!diff || removals(diff).length === 0) return null
  return (
    <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
      <AlertTriangle className="size-4 shrink-0" /> 설계에 없는 것들을 이 계획이 지웁니다.
    </div>
  )
}

// ═══════════════════════════ 실행 ═══════════════════════════
export function RunView(): ReactElement {
  const { ctx, fallback } = useCtx()
  const st = useMigrationStore()
  const selectView = useNav((s) => s.selectView)
  if (!ctx) return fallback!
  const plan = st.plan
  const needsAck = !!plan && plan.destructiveCount > 0
  /*
   * 마지막 관문은 하나다 — **데이터가 지워지는 문**. 무엇이 없어지는지는 계획 화면의 관문이
   * 이미 목록으로 보여 줬고(§planGate), 여기서는 "그래도 민다"는 손도장만 받는다.
   */
  const canRun =
    !!plan && plan.statements.length > 0 && !st.tx && !st.loading && (!needsAck || st.destructiveAck)

  return (
    <Shell title="실행" ctx={ctx}>
      {st.interrupted && (
        <div className="flex flex-col gap-2 rounded-md bg-accent-soft/60 px-3 py-2.5 text-[12px] ring-1 ring-accent/30">
          <div className="flex items-center gap-2 font-semibold text-accent-2">
            <AlertTriangle className="size-4" /> 멈췄습니다
          </div>
          <span className="text-fg">{st.interrupted.detail}</span>
          <Button size="sm" variant="outline" className="self-start" onClick={() => selectView('plan')}>
            <RefreshCw /> 계획 다시 만들기
          </Button>
        </div>
      )}

      {!plan || plan.statements.length === 0 ? (
        <div className="text-[13px] text-muted">계획 없음</div>
      ) : (
        <>
          <div className="text-[13px] text-fg">
            반영 계획: <b>{plan.statements.length}</b>개 문
            {plan.destructiveCount > 0 && (
              <span className="text-destructive"> · 데이터가 지워지는 문 {plan.destructiveCount}개</span>
            )}
          </div>

          {needsAck && !st.tx && (
            <label className="flex cursor-pointer items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              <Checkbox checked={st.destructiveAck} onCheckedChange={(c) => st.setDestructiveAck(c === true)} />
              데이터가 지워지는 것(DROP 등)을 알고 실행에 동의합니다
            </label>
          )}

          {!st.tx ? (
            <div>
              <Button size="sm" disabled={!canRun} onClick={() => void st.run(ctx.connection.id, ctx.design.id)}>
                {st.loading ? <Loader2 className="animate-spin" /> : <Play />} 트랜잭션으로 실행
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent-soft/50 px-3 py-2.5 text-[12.5px]">
              <span className="min-w-0 flex-1">
                {st.tx.statements}개 문 실행됨 · 영향 <b className="font-mono">{st.tx.affected}</b>행 · 아직 커밋되지 않았습니다
              </span>
              <Button size="sm" variant="ghost" onClick={() => void st.rollback()}>롤백</Button>
              <Button size="sm" onClick={() => void st.confirm(ctx.connection.id, ctx.design.id)}>커밋</Button>
            </div>
          )}

          {st.revert && st.revert.statements.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-fg">
                <Undo2 className="size-3.5" /> 되돌리기 SQL
                <span className="font-normal text-muted">반영 뒤 물릴 때 쓸 문</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto pr-0.5">
                <StatementGroups statements={st.revert.statements} />
              </div>
            </section>
          )}

          <p className="text-[11.5px] text-muted">
            밀기 직전에 실 DB 를 다시 읽어 남이 먼저 바꿨는지 봅니다. 문과 문 사이는 보지 않습니다.
            MySQL 은 DDL 이 즉시 커밋되므로 반영 뒤에는 되돌리기 SQL 로만 물릴 수 있습니다.
          </p>
        </>
      )}
    </Shell>
  )
}

// ═══════════════════════════ Logs ═══════════════════════════
const KIND_LABEL: Record<string, string> = {
  map: '맵핑',
  apply: '반영',
  'seed-apply': '시드'
}

export function LogsView(): ReactElement {
  const { ctx, fallback } = useCtx()
  const st = useMigrationStore()
  const cid = ctx?.connection.id
  const did = ctx?.design.id
  useEffect(() => {
    if (cid && did) void useMigrationStore.getState().loadLogs(cid, did)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, did])
  if (!ctx) return fallback!

  return (
    <Shell
      title="기록"
      ctx={ctx}
      actions={
        <Button size="sm" variant="outline" onClick={() => void st.loadLogs(ctx.connection.id, ctx.design.id)}><RefreshCw /> 새로고침</Button>
      }
    >
      {st.logs.length === 0 ? (
        <div className="flex items-center gap-2 text-[13px] text-muted"><ScrollText className="size-4" /> 아직 이력이 없습니다</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {st.logs.map((l) => (
            <div key={l.id} className="flex flex-col gap-1 rounded-md border border-line bg-canvas px-3 py-2 text-[12px]">
              <div className="flex items-center gap-3">
                {l.status === 'success' ? <CheckCircle2 className="size-3.5 shrink-0 text-success" /> : <XCircle className="size-3.5 shrink-0 text-destructive" />}
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{KIND_LABEL[l.kind] ?? l.kind}</Badge>
                {/* 버전이 양쪽 다 비면 "— → —" 만 남아 자리만 먹는다(드리프트 기록이 대개 그렇다). */}
                {(l.fromVersion || l.toVersion) && (
                  <span className="shrink-0 font-mono text-muted">
                    {l.fromVersion || '—'} <ArrowRight className="inline size-3" /> {l.toVersion || '—'}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-fg">{l.summary}</span>
                <span className="shrink-0 text-[11px] text-muted">{new Date(l.createdAt).toLocaleString()}</span>
              </div>
              {/* 상세가 기록의 값어치다 — 어느 테이블이 어떻게 달랐나. 안 보이면 남긴 뜻이 없다. */}
              {l.detail && <div className="pl-[26px] font-mono text-[11px] text-muted">{l.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}
