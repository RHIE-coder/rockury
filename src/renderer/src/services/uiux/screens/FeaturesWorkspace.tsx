import { AlertTriangle, Blocks, ChevronDown, ChevronRight, FolderKanban, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNav } from '@renderer/nav/useNav'
import { cx } from '@renderer/lib/cx'
import { Button } from '@renderer/ui/button'
import { STATUS_LABEL, surfaceKindLabel } from '../catalog'
import { completion, gaps, summarizeTree, type StatusCount } from '../features'
import { useActiveProject, useSpecStore, useTree } from '../store'
import type { SurfaceStatus } from '../types'

/**
 * Features — 제품 한 줄 + 능력 인덱스 + 완성 상태.
 *
 * **이 서비스의 첫 화면이자 목차다.** 사람은 여기서 훑고 파고들고, 에이전트는 같은 집계를 MCP 로
 * 받아 "어디가 아직 안 덮였나"를 스스로 안다.
 *
 * 상태는 **여기서 고치지 않는다** — 판정은 설계를 읽고 실제 코드를 본 에이전트가 하고 앱은 받아
 * 적는다(§8). 그래서 이 화면에는 상태를 바꾸는 손잡이가 없다.
 */
export function FeaturesWorkspace() {
  const project = useActiveProject()
  const tree = useTree()
  const openDialog = useSpecStore((s) => s.openDialog)
  const selectSurface = useSpecStore((s) => s.selectSurface)
  const loadTree = useSpecStore((s) => s.loadTree)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  /**
   * 들어올 때마다 다시 읽는다 — 상태를 적는 주체가 **에이전트**라 화면 밖에서 바뀐다(§8).
   * 적었는데 안 보이면 "적힌 건가?" 가 되므로, 이 화면만큼은 열 때 최신을 가져온다(목록은 작다).
   */
  const projectId = project?.id
  useEffect(() => {
    if (projectId) void loadTree(projectId)
  }, [projectId, loadTree])

  if (!project) {
    return (
      <Empty
        icon={<FolderKanban size={24} strokeWidth={1.8} />}
        title="프로젝트를 고르세요"
        body="화면 설계는 프로젝트 안에 담깁니다. 위쪽 Project 에서 고르거나 새로 만드세요."
        action={
          <Button size="sm" onClick={() => openDialog({ level: 'project', parentId: null })}>
            <Plus size={14} /> 새 프로젝트
          </Button>
        }
      />
    )
  }

  const summary = summarizeTree(tree)
  const missing = gaps(summary)

  const openSurface = (id: string): void => {
    selectSurface(id)
    useNav.getState().selectModule('screens')
    useNav.getState().selectView('spec')
  }

  const toggle = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-6 py-6">
        {/* 제품 소개는 별도 모듈 없이 여기 헤더로 접는다(§4). */}
        <header className="mb-6">
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-semibold">{project.name}</h1>
            <span className="font-mono text-[12px] text-muted">{project.key}</span>
          </div>
          {project.description && (
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{project.description}</p>
          )}
          <div className="mt-4">
            <Progress counts={summary.counts} />
          </div>
        </header>

        {missing.length > 0 && (
          <div className="mb-5 flex items-start gap-2 rounded-md border border-line bg-panel px-3 py-2.5">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-muted" />
            <div className="min-w-0 text-[13px]">
              <span className="font-medium">아직 확인이 없는 곳</span>
              <span className="text-muted">
                {' — '}
                {missing.map((g) => `${g.application} › ${g.service}(화면 ${g.total})`).join(' · ')}
              </span>
            </div>
          </div>
        )}

        {summary.applications.length === 0 ? (
          <Empty
            icon={<Blocks size={24} strokeWidth={1.8} />}
            title="아직 앱이 없어요"
            body="Screens 에서 앱 › 서비스 › 화면을 만들면 여기에 능력 인덱스가 쌓입니다."
            action={
              <Button size="sm" variant="outline" onClick={() => useNav.getState().selectModule('screens')}>
                Screens 로 가기
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {summary.applications.map((app) => (
              <section key={app.id} className="rounded-lg border border-line bg-panel">
                <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                  <span className="text-[14px] font-semibold">{app.name}</span>
                  <span className="font-mono text-[11px] text-muted">{app.key}</span>
                  <span className="ml-auto shrink-0">
                    <Counts counts={app.counts} />
                  </span>
                </div>

                {app.services.length === 0 && (
                  <p className="px-4 py-4 text-[13px] text-muted">서비스가 아직 없어요.</p>
                )}

                {app.services.map((svc) => {
                  const open = !collapsed.has(svc.id)
                  return (
                    <div key={svc.id} className="border-b border-line/60 last:border-b-0">
                      <button
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-panel-strong"
                        onClick={() => toggle(svc.id)}
                      >
                        <span className="shrink-0 text-muted">
                          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-[13px] font-medium">{svc.name}</span>
                          {svc.description && (
                            <span className="ml-2 text-[12px] text-muted">{svc.description}</span>
                          )}
                        </span>
                        <span className="shrink-0">
                          <Counts counts={svc.counts} />
                        </span>
                      </button>

                      {open && svc.surfaces.length > 0 && (
                        <ul className="pb-1.5">
                          {svc.surfaces.map((sf) => (
                            <li key={sf.id}>
                              <button
                                className="flex w-full items-center gap-2 py-1 pl-10 pr-4 text-left hover:bg-panel-strong"
                                onClick={() => openSurface(sf.id)}
                                data-uiux-feature-surface={sf.id}
                              >
                                <StatusDot status={sf.status} />
                                <span className="min-w-0 flex-1 truncate text-[13px]">{sf.name}</span>
                                {sf.description && (
                                  <span className="hidden min-w-0 flex-1 truncate text-[12px] text-muted sm:block">
                                    {sf.description}
                                  </span>
                                )}
                                <span className="shrink-0 text-[11px] text-muted">
                                  {sf.kind === 'page' ? '' : `${surfaceKindLabel(sf.kind)} · `}
                                  {STATUS_LABEL[sf.status] ?? sf.status}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {open && svc.surfaces.length === 0 && (
                        <p className="pb-2.5 pl-10 text-[12px] text-muted">화면이 아직 없어요.</p>
                      )}
                    </div>
                  )
                })}
              </section>
            ))}
          </div>
        )}

        <p className="mt-6 text-[12px] leading-relaxed text-muted">
          상태는 사람이 손으로 바꾸는 칸이 아니에요 — 설계를 읽고 실제 코드를 본 에이전트가 확인
          결과를 적습니다.
        </p>
      </div>
    </div>
  )
}

/** 완성도 막대 — **확인된 것만** 찬다(구현만 된 것을 완성으로 세면 "다 됐다"가 거짓이 된다). */
function Progress({ counts }: { counts: StatusCount }) {
  const ratio = completion(counts)
  return (
    <div className="flex items-center gap-3" data-uiux-progress={counts.verified}>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-panel-strong">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <span className="shrink-0 text-[13px] text-muted">
        화면 {counts.total}개 중 <span className="font-medium text-fg">{counts.verified}개</span> 확인
      </span>
    </div>
  )
}

function Counts({ counts }: { counts: StatusCount }) {
  if (counts.total === 0) return <span className="text-[12px] text-muted">화면 없음</span>
  return (
    <span className="text-[12px] text-muted">
      화면 {counts.total} · 확인 <span className="font-medium text-fg">{counts.verified}</span>
    </span>
  )
}

const DOT: Record<SurfaceStatus, string> = {
  designed: 'bg-transparent border-line',
  implemented: 'bg-muted/40 border-muted',
  verified: 'bg-accent border-accent'
}

function StatusDot({ status }: { status: SurfaceStatus }) {
  return (
    <span
      title={STATUS_LABEL[status] ?? status}
      className={cx('size-2 shrink-0 rounded-full border', DOT[status])}
    />
  )
}

function Empty({
  icon,
  title,
  body,
  action
}: {
  icon: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
        {icon}
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-[13px] leading-relaxed text-muted">{body}</p>
      {action}
    </div>
  )
}
