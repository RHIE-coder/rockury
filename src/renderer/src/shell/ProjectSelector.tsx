import { useEffect, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, FolderKanban, Plus, SlidersHorizontal } from 'lucide-react'
import { cx } from '../lib/cx'
import { OPTION_ALL, OPTION_NONE, scopeFromOptionId, scopeToOptionId } from './projectScope'
import { useProjectStore } from './projectStore'
import { ProjectDialog } from './ProjectDialog'
import { ProjectScopeDialog } from './ProjectScopeDialog'

/**
 * 프로젝트 셀렉터 — 타이틀바에 선다.
 *
 * 서비스 안이 아니라 여기 있는 이유: 이 선택은 다섯 서비스 전부를 좁힌다. 어느 서비스 화면에
 * 두면 그 화면을 떠나야 효력이 생기는 컨텍스트가 되고, 화면마다 다른 프로젝트를 볼 수 있게 된다.
 *
 * **좁혀 있을 때만 색이 켜진다.** "왜 내 설계가 목록에 없지?" 의 답이 늘 화면 맨 위에 있어야
 * 하는데, 전체와 특정 프로젝트가 같은 무게로 보이면 좁혀진 것을 눈치채지 못한다.
 */
export function ProjectSelector() {
  const projects = useProjectStore((s) => s.projects)
  const scope = useProjectStore((s) => s.scope)
  const setScope = useProjectStore((s) => s.setScope)
  const load = useProjectStore((s) => s.load)
  const [creating, setCreating] = useState(false)
  const [organizing, setOrganizing] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const currentId = scopeToOptionId(scope)
  const narrowed = scope.kind !== 'all'
  // 얼굴에는 라벨(`프로젝트`)이 이미 붙어 있어 값에서 그 말을 뺀다 — 안 그러면 "프로젝트 프로젝트 없음".
  // 드롭다운 항목은 맥락이 없으므로 거기선 `프로젝트 없음` 으로 풀어 쓴다.
  const face =
    scope.kind === 'all'
      ? '전체'
      : scope.kind === 'none'
        ? '없음'
        : (projects.find((p) => p.id === scope.projectId)?.name ?? '전체')

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            data-project-selector
            aria-label={`프로젝트 범위: ${face}`}
            className={cx(
              'flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] transition',
              // 좁혀 있으면 강조색으로, 아니어도 **채운 배경 + 라벨**로 존재를 드러낸다.
              // (2026-08-04 사용자: "어디 있는지 한참 찾았다" — 조용한 것과 안 보이는 것은 다르다.)
              narrowed
                ? 'border-accent/40 bg-accent-soft font-medium text-accent'
                : 'border-line bg-panel-strong text-fg hover:border-accent/40 hover:bg-accent-soft hover:text-accent'
            )}
          >
            <FolderKanban size={13} className="shrink-0" />
            <span className={cx('shrink-0', narrowed ? 'text-accent/70' : 'text-muted')}>
              프로젝트
            </span>
            <span className="max-w-[160px] truncate font-medium">{face}</span>
            <ChevronDown size={12} className="shrink-0 opacity-60" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-50 min-w-[200px] rounded-lg border border-line bg-canvas p-1 shadow-lg"
          >
            <Option
              id={OPTION_ALL}
              label="전체"
              currentId={currentId}
              onSelect={(id) => setScope(scopeFromOptionId(id))}
            />

            {projects.length > 0 && <DropdownMenu.Separator className="my-1 h-px bg-line" />}
            {projects.map((p) => (
              <Option
                key={p.id}
                id={p.id}
                label={p.name}
                hint={p.key}
                currentId={currentId}
                onSelect={(id) => setScope(scopeFromOptionId(id))}
              />
            ))}

            {/* 프로젝트가 하나도 없으면 '프로젝트 없음' 은 전체와 같은 결과라 보일 이유가 없다. */}
            {projects.length > 0 && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-line" />
                <Option
                  id={OPTION_NONE}
                  label="프로젝트 없음"
                  currentId={currentId}
                  onSelect={(id) => setScope(scopeFromOptionId(id))}
                />
              </>
            )}

            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item
              // Radix 이슈: 메뉴 아이템에서 곧바로 Dialog 를 열면 메뉴 닫힘과 모달 스크롤락이
              // 겹쳐 body 의 pointer-events:none 이 복원되지 않아 UI 전체가 클릭 불능이 된다.
              onSelect={() => setTimeout(() => setCreating(true), 0)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-accent outline-none data-[highlighted]:bg-accent-soft"
            >
              <Plus size={14} />새 프로젝트…
            </DropdownMenu.Item>
            {projects.length > 0 && (
              <DropdownMenu.Item
                onSelect={() => setTimeout(() => setOrganizing(true), 0)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-fg outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent"
              >
                <SlidersHorizontal size={14} />
                소속 정리…
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {creating && <ProjectDialog onClose={() => setCreating(false)} />}
      {organizing && <ProjectScopeDialog onClose={() => setOrganizing(false)} />}
    </>
  )
}

function Option({
  id,
  label,
  hint,
  currentId,
  onSelect
}: {
  id: string
  label: string
  hint?: string
  currentId: string
  onSelect: (id: string) => void
}) {
  const selected = id === currentId
  return (
    <DropdownMenu.Item
      onSelect={() => onSelect(id)}
      className="flex cursor-pointer items-center justify-between gap-4 rounded-md px-2 py-1.5 text-[13px] text-fg outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent"
    >
      <span className="flex min-w-0 items-center gap-2">
        {selected ? (
          <Check size={14} className="shrink-0 text-accent" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="truncate">{label}</span>
      </span>
      {hint && <span className="shrink-0 font-mono text-[11px] text-muted">{hint}</span>}
    </DropdownMenu.Item>
  )
}
