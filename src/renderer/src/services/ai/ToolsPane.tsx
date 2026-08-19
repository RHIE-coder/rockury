import { useEffect, useMemo, useState } from 'react'
import { Ban, Search, Wrench } from 'lucide-react'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { useAiStore } from './store'
import {
  countTools,
  filterCatalog,
  orderByRail,
  serviceLabel,
  toolSignature,
  type McpServiceTools,
  type McpToolInfo
} from './toolCatalog'

/**
 * 에이전트에게 열어 둔 도구 목록 — Agents 화면의 **오른쪽 칸**이다.
 *
 * 왜 별도 화면이 아닌가: 좌측 탭에 "Tools" 라고만 걸어 두면 **MCP 도구인지 앱의 범용
 * 유틸리티인지 구분이 안 된다**(2026-07-30 사용자 지적). 도구 목록은 "연결하면 무엇을 쓸 수
 * 있나"의 답이므로, 연결 화면 옆에 붙어 있을 때만 그 뜻이 분명해진다. 그래서 네비를 없애고
 * 연결 바로 옆에 두고, 제목도 `Tools` 가 아니라 **"에이전트에게 열어 둔 도구"** 로 적는다.
 *
 * 목록은 손으로 관리하지 않는다 — 메인 프로세스가 도구 정의 + 노출 지도를 조립해 준다
 * (`ai:tools`). 그래서 도구가 늘거나 줄면 이 칸이 저절로 따라온다.
 *
 * "안 열어 둔 것"도 사유와 함께 같이 보여 준다. 목록에 없는 기능을 두고 "왜 안 되지"를
 * 코드까지 뒤져야 한다면, 그건 이 화면이 절반만 답한 것이다.
 */

/** 도구 카드 한 장 — 호출 모양 + 설명 + 이 도구가 덮는 앱 기능. */
function ToolCard({ tool }: { tool: McpToolInfo }) {
  return (
    <div
      data-ai-tool={tool.name}
      className="flex flex-col gap-1.5 rounded-lg border border-line bg-canvas px-3.5 py-3"
    >
      <code className="font-mono text-[12.5px] font-semibold break-all text-fg">
        {toolSignature(tool)}
      </code>
      <p className="text-[12px] leading-relaxed break-keep text-muted">{tool.description}</p>
      {/* 창구(IPC 채널) 없이 저장소를 직접 읽는 도구도 있다 — 그때는 빈 줄을 남기지 않는다. */}
      {tool.channels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {tool.channels.map((ch) => (
            <span
              key={ch}
              title="이 도구가 쓰는 앱 기능"
              className="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[10.5px] text-muted"
            >
              {ch}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** 한 서비스 묶음 — 도구 목록 + (있으면) 일부러 안 연 기능들. */
function ServiceSection({ group }: { group: McpServiceTools }) {
  const [showExcluded, setShowExcluded] = useState(false)

  return (
    <section data-ai-tool-service={group.service} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[13px] font-bold text-fg">{serviceLabel(group.service)}</h3>
        <span className="text-[11.5px] text-muted">도구 {group.tools.length}개</span>
      </div>

      {group.tools.length > 0 ? (
        <div className="flex flex-col gap-2">
          {group.tools.map((t) => (
            <ToolCard key={t.name} tool={t} />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3.5 py-3 text-[12px] break-keep text-muted">
          이 서비스는 에이전트에게 연 도구가 아직 없어요.
        </p>
      )}

      {group.excluded.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setShowExcluded((v) => !v)}
            className="flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-[11.5px] font-medium text-muted transition-colors hover:text-fg"
          >
            <Ban className="size-3.5" />
            일부러 안 연 기능 {group.excluded.length}개 {showExcluded ? '접기' : '보기'}
          </button>
          {showExcluded && (
            <ul className="flex flex-col gap-1 rounded-lg bg-panel/60 px-3.5 py-2.5">
              {group.excluded.map((e) => (
                <li key={e.channel} className="flex flex-col gap-0.5 text-[11.5px]">
                  <code className="font-mono text-fg">{e.channel}</code>
                  <span className="leading-relaxed break-keep text-muted">{e.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function FilterChip({
  id,
  label,
  count,
  active,
  onClick
}: {
  /** 서비스 id(또는 `all`) — 화면 글자가 좌측 레일과 겹쳐서, e2e 는 이 훅으로 칩을 집는다. */
  id: string
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-ai-tools-filter={id}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
        active
          ? 'border-transparent bg-accent text-white'
          : 'border-line text-muted hover:bg-panel-strong hover:text-fg'
      )}
    >
      {label}
      <span className={cn('tabular-nums', active ? 'text-white/70' : 'text-muted/70')}>{count}</span>
    </button>
  )
}

export function ToolsPane() {
  const catalog = useAiStore((s) => s.catalog)
  const error = useAiStore((s) => s.catalogError)
  const [query, setQuery] = useState('')
  // 전체 보기 = null. 서비스 하나를 고르면 그 묶음만 남긴다.
  const [service, setService] = useState<string | null>(null)

  useEffect(() => {
    void useAiStore.getState().loadTools()
  }, [])

  const all = useMemo(() => orderByRail(catalog ?? []), [catalog])
  const shown = useMemo(() => {
    const searched = filterCatalog(all, query)
    return service ? searched.filter((s) => s.service === service) : searched
  }, [all, query, service])

  const total = countTools(all)
  const found = countTools(shown)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-line px-5 py-3">
        <div className="flex flex-col">
          {/* 제목이 곧 이 목록의 정체다 — "Tools" 만으로는 범용 유틸리티와 구분이 안 된다. */}
          <h2 className="text-[14px] font-bold text-fg">에이전트에게 열어 둔 도구</h2>
          <p className="text-[12px] break-keep text-muted">
            왼쪽에서 연결한 에이전트가 이 앱에서 쓸 수 있는 도구 {total}개 — 서비스별로 무엇이
            열려 있는지 확인합니다.
          </p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
          <Input
            data-ai-tools-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="도구·설명·기능 이름으로 찾기"
            className="h-8 pl-8 text-[12.5px]"
          />
        </div>

        {/* 서비스 고르기 — "DB 는 뭐가 열려 있나"를 한 번에 좁힌다. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            id="all"
            label="전체"
            count={total}
            active={service === null}
            onClick={() => setService(null)}
          />
          {all.map((g) => (
            <FilterChip
              key={g.service}
              id={g.service}
              label={serviceLabel(g.service)}
              count={g.tools.length}
              active={service === g.service}
              onClick={() => setService(service === g.service ? null : g.service)}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-5 px-5 py-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {error}
            </div>
          )}

          {catalog === null && !error && (
            <p className="py-10 text-center text-[12px] text-muted">도구 목록을 읽는 중…</p>
          )}

          {catalog !== null && shown.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-panel-strong text-muted">
                <Wrench size={22} strokeWidth={1.8} />
              </div>
              <span className="text-[13px] font-semibold text-fg">찾는 도구가 없어요</span>
              <span className="text-[12px] break-keep text-muted">
                다른 말로 찾아보거나 위에서 &lsquo;전체&rsquo;를 눌러 보세요.
              </span>
            </div>
          )}

          {query.trim() && found > 0 && <span className="text-[11.5px] text-muted">{found}개 찾음</span>}

          {shown.map((g) => (
            <ServiceSection key={g.service} group={g} />
          ))}

          {catalog !== null && shown.length > 0 && (
            <p className="border-t border-line pt-3 text-[11px] leading-relaxed break-keep text-muted">
              괄호 안은 도구가 받는 값이고, 물음표가 붙은 것은 빼도 되는 값이에요. 회색 칸은 그
              도구가 실제로 건드리는 앱 기능입니다. 지우기 같은 되돌릴 수 없는 조작은 일부러 열지
              않았어요 — 사람이 앱에서만 합니다.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
