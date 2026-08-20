import { FolderKanban, Plus, ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'
import { useNav } from '@renderer/nav/useNav'
import { Button } from '@renderer/ui/button'
import { parseContent } from '../content'
import { collectRules, type RuleEntry } from '../rules'
import { useActiveProject, useSpecStore, useTree } from '../store'

/**
 * Rules — 값 제약·검증·활성 조건을 **사람 말로** 모아 본다.
 *
 * 규칙은 요소에 붙어 있고(구조화 데이터), 여기는 그것을 프로젝트 전체에서 모아 읽는 렌즈다 —
 * 흐름(Flows)이 이벤트를 모아 보는 것과 같은 자리.
 */
export function RulesWorkspace() {
  const project = useActiveProject()
  const tree = useTree()
  const openDialog = useSpecStore((s) => s.openDialog)
  const selectSurface = useSpecStore((s) => s.selectSurface)
  const selectNode = useSpecStore((s) => s.selectNode)

  const entries = useMemo<RuleEntry[]>(() => {
    if (!project) return []
    const out: RuleEntry[] = []
    for (const surface of tree.surfaces) {
      const svc = tree.services.find((s) => s.id === surface.service_id)
      const app = svc && tree.applications.find((a) => a.id === svc.application_id)
      if (!svc || !app) continue
      out.push(
        ...collectRules(parseContent(surface.content), {
          surfaceId: surface.id,
          surfaceName: surface.name,
          address: `${project.key}.${app.key}.${svc.key}.${surface.key}`
        })
      )
    }
    return out
  }, [tree, project?.key])

  if (!project) {
    return (
      <Empty
        icon={<FolderKanban size={24} strokeWidth={1.8} />}
        title="프로젝트를 고르세요"
        body="규칙은 프로젝트 안 화면의 요소에 붙습니다. 위쪽 Project 에서 고르거나 새로 만드세요."
        action={
          <Button size="sm" onClick={() => openDialog({ level: 'project', parentId: null })}>
            <Plus size={14} /> 새 프로젝트
          </Button>
        }
      />
    )
  }

  if (entries.length === 0) {
    return (
      <Empty
        icon={<ShieldCheck size={24} strokeWidth={1.8} />}
        title="아직 규칙이 없어요"
        body="Screens 에서 요소를 고르고 속성의 '규칙' 칸을 채우면 여기 모입니다 — 어떤 값이 유효한지, 언제 알릴지, 언제 켜질지."
        action={
          <Button size="sm" variant="outline" onClick={() => useNav.getState().selectModule('screens')}>
            Screens 로 가기
          </Button>
        }
      />
    )
  }

  // 화면별로 묶는다 — 규칙은 화면을 만들 때 함께 읽히는 것이라, 요소만 늘어놓으면 맥락이 없다.
  const bySurface = new Map<string, RuleEntry[]>()
  for (const e of entries) bySurface.set(e.surfaceId, [...(bySurface.get(e.surfaceId) ?? []), e])

  const open = (entry: RuleEntry): void => {
    selectSurface(entry.surfaceId)
    selectNode(entry.componentId)
    useNav.getState().selectModule('screens')
    useNav.getState().selectView('spec')
  }

  return (
    <div className="h-full overflow-auto">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[12px] font-semibold tracking-wide text-muted">규칙</span>
        <span className="text-[11px] text-muted" data-uiux-rule-count={entries.length}>
          요소 {entries.length}개에 붙어 있어요
        </span>
      </div>
      <div className="mx-auto max-w-3xl p-4">
        {[...bySurface.values()].map((group) => (
          <section key={group[0].surfaceId} className="mb-5 last:mb-0">
            <h3 className="mb-2 flex items-baseline gap-2">
              <span className="text-[13px] font-semibold">{group[0].surfaceName}</span>
              <span className="font-mono text-[11px] text-muted">{group[0].address}</span>
            </h3>
            <ul className="flex flex-col gap-1.5">
              {group.map((entry) => (
                <li key={`${entry.surfaceId}:${entry.componentId}`}>
                  <button
                    className="w-full rounded-md border border-line bg-panel p-2.5 text-left hover:border-accent"
                    onClick={() => open(entry)}
                    data-uiux-rule={entry.componentId}
                  >
                    <div className="mb-1 flex items-baseline gap-1.5">
                      <span className="text-[13px] font-medium">{entry.componentLabel}</span>
                      <span className="font-mono text-[10px] text-muted">{entry.componentId}</span>
                    </div>
                    <ul className="flex flex-col gap-0.5">
                      {entry.lines.map((line, i) => (
                        <li key={i} className="text-[12px] leading-relaxed text-muted">
                          · {line}
                        </li>
                      ))}
                    </ul>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="mt-6 text-[12px] leading-relaxed text-muted">
          규칙은 <span className="font-medium">요소에 직접</span> 붙은 것만 보입니다. 위 계층(앱·서비스)에서
          흘러내리는 기본값은 아직 없어요 — 스코프 편집이 서면 그 출처까지 함께 보입니다.
        </p>
      </div>
    </div>
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
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
        {icon}
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-[13px] leading-relaxed text-muted">{body}</p>
      {action}
    </div>
  )
}
