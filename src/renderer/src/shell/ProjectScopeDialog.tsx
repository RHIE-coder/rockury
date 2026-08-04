import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Button } from '@renderer/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/ui/dialog'
import { cx } from '../lib/cx'
import { useProjectStore } from './projectStore'

type ScopedItem = Awaited<ReturnType<typeof window.rockury.projects.listItems>>[number]
type ScopedKind = ScopedItem['kind']

/**
 * 소속 정리 — 이미 만들어 둔 것들을 프로젝트로 나눈다.
 *
 * 이 자리가 없으면 프로젝트 기능이 반쪽이다: 만들 때 소속이 정해지므로, 프로젝트를 도입하기
 * **전에** 만든 설계·접속은 영원히 무소속으로 남는다.
 *
 * 서비스마다 목록 화면을 뜯는 대신 여기 한 곳에 모았다 — 사람은 네 종류를 한 번에 정리하고,
 * 서비스 소유 파일은 그대로 둔다.
 */
const KIND_LABEL: Record<ScopedKind, string> = {
  design: 'DB 설계',
  connection: 'DB 접속',
  apiSpec: 'API 명세',
  infraDesign: '인프라 설계본',
  infraProvider: '클라우드 계정',
  middleware: '미들웨어 접속'
}

/** 화면에 뜨는 순서 — 설계류를 먼저, 접속류를 뒤에. 무소속 규칙이 갈리는 경계이기도 하다. */
const KIND_ORDER: ScopedKind[] = [
  'design',
  'apiSpec',
  'infraDesign',
  'connection',
  'infraProvider',
  'middleware'
]

export function ProjectScopeDialog({ onClose }: { onClose: () => void }) {
  const projects = useProjectStore((s) => s.projects)
  const markItemsChanged = useProjectStore((s) => s.markItemsChanged)
  const [items, setItems] = useState<ScopedItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.rockury.projects.listItems().then(setItems)
  }, [])

  const move = async (item: ScopedItem, projectId: string | null): Promise<void> => {
    // 먼저 화면에 반영한다 — 목록이 길어서, 왕복을 기다리면 어느 줄을 눌렀는지 잊는다.
    setItems(
      (prev) =>
        prev?.map((i) => (i.kind === item.kind && i.id === item.id ? { ...i, projectId } : i)) ??
        null
    )
    try {
      await window.rockury.projects.setItemProject(item.kind, item.id, projectId)
      // 서비스 스토어들이 든 사본은 아직 옛 소속이다 — 신호를 보내 다시 읽게 한다.
      markItemsChanged()
      setError(null)
    } catch (e) {
      setItems(await window.rockury.projects.listItems())
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const groups = KIND_ORDER.map((kind) => ({
    kind,
    rows: (items ?? []).filter((i) => i.kind === kind)
  })).filter((g) => g.rows.length > 0)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>소속 정리</DialogTitle>
          <DialogDescription>
            프로젝트를 고르면 그 프로젝트 것만 보입니다. 접속은 비워 두면 어디서나 보입니다.
          </DialogDescription>
        </DialogHeader>

        {items === null ? (
          <div className="flex h-40 items-center justify-center text-muted">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted">정리할 항목 없음</p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto pr-1">
            {groups.map((g) => (
              <section key={g.kind} className="mb-4 last:mb-0">
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {KIND_LABEL[g.kind]}
                </h3>
                <ul className="flex flex-col gap-px">
                  {g.rows.map((item) => (
                    <ItemRow
                      key={`${item.kind}:${item.id}`}
                      item={item}
                      projects={projects}
                      onMove={move}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="text-[12px] text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ItemRow({
  item,
  projects,
  onMove
}: {
  item: ScopedItem
  projects: { id: string; name: string }[]
  onMove: (item: ScopedItem, projectId: string | null) => Promise<void>
}) {
  const current = projects.find((p) => p.id === item.projectId) ?? null
  // 무소속의 뜻이 종류마다 다르다 — 접속류는 "어디서나 보임"이고, 설계류는 "아무 데도 안 속함".
  const unassignedLabel = item.sharedWhenUnassigned ? '공용' : '없음'

  return (
    <li className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 hover:bg-panel">
      <span className="min-w-0 truncate text-[13px] text-fg">{item.name}</span>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={cx(
              'shrink-0 rounded-md border px-2 py-0.5 text-[12px] transition',
              current
                ? 'border-accent/30 bg-accent-soft font-medium text-accent'
                : 'border-line bg-canvas text-muted hover:text-fg'
            )}
          >
            {current?.name ?? unassignedLabel}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-[160px] rounded-lg border border-line bg-canvas p-1 shadow-lg"
          >
            <Row
              label={unassignedLabel}
              selected={item.projectId === null}
              onSelect={() => void onMove(item, null)}
            />
            {projects.map((p) => (
              <Row
                key={p.id}
                label={p.name}
                selected={item.projectId === p.id}
                onSelect={() => void onMove(item, p.id)}
              />
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  )
}

function Row({
  label,
  selected,
  onSelect
}: {
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-fg outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent"
    >
      {selected ? (
        <Check size={14} className="shrink-0 text-accent" />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </DropdownMenu.Item>
  )
}
