import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, History, Lock } from 'lucide-react'
import { cx } from '@renderer/lib/cx'
import { useActiveDesign } from '../designs/store'
import { currentLensOption, lensOptions } from './lensOptions'
import { useDesignVersions, useVersionLens, useVersionsStore } from './store'

/**
 * **시점 손잡이** — Draft(편집) ↔ 커밋 버전(읽기 전용)을 고른다.
 *
 * 자리는 상단 모듈 줄의 **‘설계’ 뱃지 손잡이 안**, 설계 이름 바로 뒤다. 시점은 설계에 귀속되므로
 * 그 소속을 자리로 말한다 — 따로 선 칩이면 "고를 게 하나 더"로 읽히고, 실제로 그렇게 읽혀서
 * 한 번 걷어냈다(2026-07-29 상단 바 → Studio 도구줄, 2026-07-30 설계 뱃지 손잡이로).
 *
 * 값은 이 서비스 스토어(`versions/store.ts` 의 `lens`)가 든다. 셸의 `contextValues` 가 아니라
 * 서비스가 직접 그리는 칸(`ContextSelector.Render`)인 이유는 두 가지다 — 시점 목록은 활성 설계에
 * 딸려 바뀌고, 드롭다운도 일반 셀렉터와 달리 버전 번호를 고정폭으로 세우고 잠금을 말한다.
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
          title={
            current.readOnly
              ? `${current.label} — 컷된 버전이라 읽기 전용이에요`
              : 'Draft — 편집할 수 있는 작업본이에요'
          }
          className={cx(
            'flex shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-[13px] transition-colors',
            'hover:bg-panel-strong data-[state=open]:bg-panel-strong',
            // 읽기 전용은 테라코타 **글자**로만 말한다. 손잡이를 채우면 활성 탭(진한 시안)·구획
            // 라벨과 함께 한 줄에 색 채움이 셋이 된다.
            current.readOnly ? 'text-accent-2' : 'text-fg'
          )}
        >
          {current.readOnly ? (
            <Lock size={13} className="shrink-0" />
          ) : (
            <History size={13} className="shrink-0 text-muted" />
          )}
          <span className="font-mono text-[12px] font-semibold">{current.label}</span>
          {/* 좁아지면 상태말부터 접는다 — 자물쇠/시계 아이콘이 같은 말을 이미 하고 있다. */}
          <span
            className={cx(
              'max-[1599px]:hidden',
              current.readOnly ? 'text-[11px] text-accent-2' : 'text-[11px] text-muted'
            )}
          >
            {current.readOnly ? '읽기 전용' : current.hint}
          </span>
          <ChevronDown size={13} className={cx('shrink-0', current.readOnly ? '' : 'text-muted')} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
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
