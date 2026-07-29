import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, History, Lock } from 'lucide-react'
import { cx } from '@renderer/lib/cx'
import { useActiveDesign } from '../designs/store'
import { currentLensOption, lensOptions } from './lensOptions'
import { useDesignVersions, useVersionLens, useVersionsStore } from './store'

/**
 * L4 — Studio 도구줄의 **시점 손잡이**. Draft(편집) ↔ 커밋 버전(읽기 전용)을 고른다.
 *
 * 예전엔 상단 컨텍스트 바에 있었다. 거기 나란히 선 Design·Connection 은 "무엇을 대상으로
 * 하느냐"인데 이것만 "그 대상을 언제 시점으로 보느냐"라 성격이 달랐고, 실제로 읽는 화면도
 * Studio 셋(Definition·Diagram·Seed)뿐이었다. 보는 자리에 손잡이를 두는 편이 맞다.
 *
 * 버전 목록의 관리 홈은 여전히 **Versions 모듈**이다 — 여기서는 고르기만 한다.
 */
export function VersionLens() {
  const design = useActiveDesign()
  const versions = useDesignVersions(design?.id ?? null)
  const lens = useVersionLens()
  const setLens = useVersionsStore((s) => s.setLens)

  // 설계를 아직 안 골랐으면 고를 시점도 없다 — 빈 손잡이를 띄우지 않는다.
  if (!design) return null

  const options = lensOptions(versions)
  const current = currentLensOption(options, lens)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          // e2e 가 렌즈를 라벨 문자열이 아니라 역할로 집게 하는 훅 — 지우면 스모크가 깨진다.
          data-version-lens
          title="보고 있는 시점 — Draft 는 편집 가능, 컷된 버전은 읽기 전용이에요"
          className={cx(
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
            current.readOnly
              ? 'border-accent-2/30 bg-accent-2-soft text-accent-2 hover:bg-accent-2/15'
              : 'border-line bg-canvas text-fg hover:bg-panel-strong'
          )}
        >
          {current.readOnly ? <Lock size={12} /> : <History size={12} />}
          <span className="font-mono font-semibold">{current.label}</span>
          <span className={cx('font-normal', current.readOnly ? 'text-accent-2/80' : 'text-muted')}>
            {current.readOnly ? '읽기 전용' : current.hint}
          </span>
          <ChevronDown size={12} className={current.readOnly ? 'text-accent-2/70' : 'text-muted'} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 max-h-[320px] min-w-[200px] overflow-y-auto rounded-lg border border-line bg-canvas p-1 shadow-lg"
        >
          {options.map((o) => (
            <DropdownMenu.Item
              key={o.id}
              onSelect={() => setLens(o.id)}
              data-version-lens-option={o.id}
              className="flex cursor-pointer items-center justify-between gap-4 rounded-md px-2 py-1.5 text-[13px] text-fg outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent"
            >
              <span className="flex min-w-0 items-center gap-2">
                {o.id === current.id ? (
                  <Check size={14} className="shrink-0 text-accent" />
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                <span className="truncate font-mono">{o.label}</span>
              </span>
              <span className="shrink-0 text-[11px] text-muted">{o.hint}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** Studio 뷰 중 자기 도구줄이 따로 없는 것들(Diagram·Seed)의 L4 — 시점 손잡이만 오른쪽에 세운다. */
export function StudioLensToolbar() {
  return (
    <div className="ml-auto flex items-center gap-2">
      <VersionLens />
    </div>
  )
}
