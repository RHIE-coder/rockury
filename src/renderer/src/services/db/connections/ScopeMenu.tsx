import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Database, Loader2 } from 'lucide-react'
import { cx } from '@renderer/lib/cx'
import { findConnectionForCatalog, type ScopeModel } from '../scope'
import type { ConnectionDef } from './store'

/**
 * 범위 드롭다운의 **알맹이** — 스키마 다중 선택 + (PostgreSQL 만) 카탈로그 목록.
 *
 * 두 자리가 같은 것을 그린다: 뷰 탭 줄의 `ScopeSelector` 와 가져오기 창의 범위 칸.
 * 한 벌로 두는 이유는 규칙이 벤더마다 갈리기 때문이다(§db-remote.scope) — 두 번 적으면 한쪽만
 * 고쳐져 "Remote 에선 고를 수 있는데 가져오기에선 못 고르는" 상태가 다시 생긴다.
 * **트리거(손잡이 모양)는 자리마다 달라 부르는 쪽이 그린다** — 여기는 `DropdownMenu.Root` 안에
 * 놓는 내용물이다.
 */
export interface ScopeMenuProps {
  model: ScopeModel
  /** 고를 수 있는 스키마. 아직 못 읽었으면 `null`. */
  available: string[] | null
  selected: string[]
  onToggle: (schema: string) => void
  /**
   * 켜진 것이 하나만 남았을 때 그것을 잠글까. 운영부는 true — 다 끄면 읽을 것이 없어
   * 빈 화면이 된다. 설계부는 false — 거기선 "다 끔"이 곧 "전부 보기"다.
   */
  lockLastOne?: boolean
  loading?: boolean
  error?: string | null
  /** 지금 대상 연결 — 카탈로그 항목이 "지금 여기"인지 가르는 기준. 카탈로그 층이 있을 때만. */
  current?: ConnectionDef
  /** 카탈로그를 고를 때 갈아탈 연결을 찾을 목록. */
  connections?: readonly ConnectionDef[]
  catalogs?: string[]
  /** 카탈로그 라벨 옆 한 마디 — 고르면 무슨 일이 나는지가 자리마다 다르다. */
  catalogHint?: string
  onPickCatalog?: (target: ConnectionDef) => void
}

export function ScopeMenu({
  model,
  current,
  connections = [],
  available,
  selected,
  catalogs = [],
  loading = false,
  error = null,
  lockLastOne = true,
  catalogHint = '',
  onToggle,
  onPickCatalog
}: ScopeMenuProps) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="start"
        sideOffset={6}
        className="z-50 min-w-[240px] rounded-lg border border-line bg-canvas p-1 shadow-lg"
      >
        <DropdownMenu.Label className="px-2 py-1.5 text-[11px] font-semibold text-muted">
          {model.schemaLabel}
        </DropdownMenu.Label>

        {loading && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-muted">
            <Loader2 className="size-3.5 animate-spin" /> 읽는 중…
          </div>
        )}
        {error && <div className="px-2 py-1.5 text-[12px] text-destructive">{error}</div>}
        {!loading && !error && available?.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-muted">고를 {model.schemaLabel} 없음</div>
        )}

        {(available ?? []).map((s) => {
          const on = selected.includes(s)
          // 마지막 하나는 못 끈다 — 다 끄면 읽을 것이 없어 빈 화면이 되고, 그건 고장으로 읽힌다.
          const locked = lockLastOne && on && selected.length === 1
          return (
            <DropdownMenu.CheckboxItem
              key={s}
              // e2e 가 라벨 문자열이 아니라 역할로 항목을 집게 하는 훅 — 지우면 스모크가 깨진다.
              data-scope-schema={s}
              checked={on}
              disabled={locked}
              onSelect={(e) => {
                e.preventDefault() // 여러 개를 연달아 고르는 자리라 한 번 누를 때마다 닫지 않는다
                onToggle(s)
              }}
              title={locked ? '마지막 하나는 끌 수 없어요' : undefined}
              className={cx(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none',
                'data-[highlighted]:bg-panel-strong',
                locked && 'cursor-default opacity-60'
              )}
            >
              <Check size={13} className={cx('shrink-0', on ? 'text-accent' : 'invisible')} />
              <span className="font-mono text-[12px]">{s}</span>
            </DropdownMenu.CheckboxItem>
          )
        })}

        {model.hasCatalogLayer && current && catalogs.length > 0 && (
          <>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Label className="px-2 py-1.5 text-[11px] font-semibold text-muted">
              {model.catalogLabel}
              {/* 왜 여긴 체크가 아니라 이동인지 — 안 적으면 "왜 여러 개를 못 고르지"가 된다. */}
              <span className="ml-1 font-normal">· {catalogHint}</span>
            </DropdownMenu.Label>
            {catalogs.map((cat) => {
              const target = findConnectionForCatalog(connections, current, cat)
              const here = target?.id === current.id
              return (
                <DropdownMenu.Item
                  key={cat}
                  data-scope-catalog={cat}
                  disabled={!target}
                  onSelect={() => target && onPickCatalog?.(target)}
                  title={
                    target
                      ? here
                        ? '지금 보고 있는 데이터베이스예요'
                        : `연결 "${target.name}" 으로 바꿔요`
                      : '이 데이터베이스에 붙는 연결이 아직 없어요 — Connections 에서 만들어 주세요'
                  }
                  className={cx(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none',
                    'data-[highlighted]:bg-panel-strong',
                    !target && 'cursor-default opacity-45'
                  )}
                >
                  <Database size={13} className={cx('shrink-0', here ? 'text-accent' : 'text-muted')} />
                  <span className="font-mono text-[12px]">{cat}</span>
                  {here && <span className="ml-auto text-[11px] text-muted">지금</span>}
                </DropdownMenu.Item>
              )
            })}
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  )
}
