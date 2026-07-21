import { useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Server,
  Trash2,
  XCircle
} from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { useNav } from '@renderer/nav/useNav'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { dialectInfo } from '../dialects'
import { useActiveDesign } from '../designs/store'
import {
  useDesignEnvironments,
  useEnvironmentsStore,
  type ConnStatus,
  type EnvironmentDef
} from './store'

/** 연결 상태 → 시맨틱 컬러 점 + 라벨. */
function StatusPill({ status }: { status?: ConnStatus }) {
  const s = status?.state ?? 'idle'
  if (s === 'testing')
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted">
        <Loader2 className="size-3 animate-spin" /> 확인 중…
      </span>
    )
  if (s === 'ok')
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-success" title={status?.serverVersion}>
        <CheckCircle2 className="size-3" /> 연결됨 · {status?.latencyMs}ms
      </span>
    )
  if (s === 'error')
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-destructive" title={status?.message}>
        <XCircle className="size-3" /> 실패
      </span>
    )
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted">
      <span className="size-1.5 rounded-full bg-muted/50" /> 미확인
    </span>
  )
}

/** 환경 카드 하나 — 클릭 시 active Env 로. 테스트/편집/삭제 액션. */
function EnvCard({ env, active }: { env: EnvironmentDef; active: boolean }) {
  const setContextValue = useNav((s) => s.setContextValue)
  const status = useEnvironmentsStore((s) => s.statusMap[env.id])
  const testExisting = useEnvironmentsStore((s) => s.testExisting)
  const openEdit = useEnvironmentsStore((s) => s.openEdit)
  const remove = useEnvironmentsStore((s) => s.remove)
  const [confirming, setConfirming] = useState(false)
  const info = dialectInfo(env.dbType)

  const conn =
    env.dbType === 'sqlite' ? env.database : `${env.host}:${env.port}/${env.database}`

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setContextValue('env', env.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setContextValue('env', env.id)}
      className={cn(
        'group flex cursor-pointer flex-col gap-2.5 rounded-xl border p-3.5 text-left transition-colors outline-none',
        active
          ? 'border-accent bg-accent-soft/40 ring-1 ring-accent/30'
          : 'border-line bg-canvas hover:bg-panel'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13.5px] font-semibold text-fg">{env.name}</span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <span className="size-1.5 rounded-full" style={{ background: info.dot }} />
            {info.label}
          </span>
        </div>
        {active && (
          <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">
            활성
          </span>
        )}
      </div>

      <div className="truncate font-mono text-[11.5px] text-muted" title={conn}>
        {conn}
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        <span className="rounded-md bg-panel-strong px-1.5 py-0.5 font-mono text-muted">
          타깃 {env.targetVersion || '—'}
        </span>
        <span className="rounded-md bg-panel-strong px-1.5 py-0.5 font-mono text-muted">
          적용 {env.appliedVersion || '—'}
        </span>
      </div>

      <div className="mt-0.5 flex items-center justify-between border-t border-line pt-2">
        <StatusPill status={status} />
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted hover:text-accent"
            title="연결 테스트"
            onClick={() => void testExisting(env.id)}
          >
            <Plug className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted hover:text-fg"
            title="편집"
            onClick={() => openEdit(env)}
          >
            <Pencil className="size-3.5" />
          </Button>
          {confirming ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px]"
                onClick={() => setConfirming(false)}
              >
                취소
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-6 px-1.5 text-[11px]"
                onClick={() => void remove(env.id)}
              >
                삭제
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted hover:text-destructive"
              title="삭제"
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Environments 모듈(운영부 · depth 2) — 활성 설계의 배포 환경 카드 그리드.
 * 카드 클릭 = active Env 설정(컨텍스트 바와 동기화). 여기서 Connection 자격증명도 관리한다.
 */
export function EnvironmentsView() {
  const design = useActiveDesign()
  const environments = useDesignEnvironments(design?.id ?? null)
  const activeEnvId = useNav((s) => s.contextValues['env'])
  const openCreate = useEnvironmentsStore((s) => s.openCreate)

  if (!design) {
    return (
      <PlaceholderView
        icon={Server}
        depth="depth 2 · DB › Environments"
        title="설계를 먼저 선택하세요"
        subtitle="환경은 설계에 소속됩니다. 상단 컨텍스트 바에서 설계를 고르면 그 설계의 배포 환경을 관리할 수 있어요."
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">Environments</h2>
          <p className="text-[12px] text-muted">
            “{design.name}” 설계의 배포 환경 · 카드를 누르면 활성 환경으로 설정됩니다
          </p>
        </div>
        <Button size="sm" onClick={() => openCreate(design.id)}>
          <Plus /> 새 환경
        </Button>
      </div>

      {environments.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
            <Server size={24} strokeWidth={1.8} />
          </div>
          <h3 className="text-[15px] font-semibold text-fg">아직 환경이 없어요</h3>
          <p className="max-w-md text-[13px] leading-relaxed text-muted">
            개발·QA·Stage·운영처럼 이 설계를 물릴 대상을 환경으로 등록하세요. Connection 정보와 타깃
            버전을 함께 담습니다.
          </p>
          <Button size="sm" className="mt-1" onClick={() => openCreate(design.id)}>
            <Plus /> 첫 환경 만들기
          </Button>
        </div>
      ) : (
        <div className="grid flex-1 auto-rows-min gap-3 overflow-auto p-5 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {environments.map((env) => (
            <EnvCard key={env.id} env={env} active={env.id === activeEnvId} />
          ))}
        </div>
      )}
    </div>
  )
}
