import { FolderKanban, History, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cx } from '@renderer/lib/cx'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { diffSnapshots, takeSnapshot, type ChangeKind, type Snapshot } from '../versions'
import { useActiveProject, useSpecStore, useTree } from '../store'

/**
 * Versions — 설계 스냅샷과 비교. 명세 정본 `docs/spec/uiux-ia.md` Surface `uiux.versions`.
 *
 * 컷은 **사람의 판단**이다("여기까지가 한 덩어리") — 그래서 에이전트에게 열지 않는다.
 * 비교는 **화면 단위**로 본다: 요소 하나까지 훑어 내려가면 "무엇이 바뀌었나"가 아니라
 * "얼마나 많이 바뀌었나"만 남는다.
 */
export function VersionsWorkspace({ view }: { view: 'timeline' | 'diff' }) {
  const project = useActiveProject()
  const openDialog = useSpecStore((s) => s.openDialog)
  const loadVersions = useSpecStore((s) => s.loadVersions)

  const projectId = project?.id
  useEffect(() => {
    if (projectId) void loadVersions(projectId)
  }, [projectId, loadVersions])

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
          <FolderKanban size={24} strokeWidth={1.8} />
        </div>
        <h2 className="text-lg font-semibold">프로젝트를 고르세요</h2>
        <p className="max-w-md text-[13px] leading-relaxed text-muted">
          버전은 프로젝트 설계를 통째로 굳힌 것입니다.
        </p>
        <Button size="sm" onClick={() => openDialog({ level: 'project', parentId: null })}>
          <Plus size={14} /> 새 프로젝트
        </Button>
      </div>
    )
  }

  return view === 'timeline' ? <TimelineView /> : <DiffView />
}

function TimelineView() {
  const versions = useSpecStore((s) => s.versions)
  const cutVersion = useSpecStore((s) => s.cutVersion)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const cut = async (): Promise<void> => {
    setBusy(true)
    await cutVersion(note.trim())
    setNote('')
    setBusy(false)
  }

  return (
    <div className="h-full overflow-auto">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[12px] font-semibold tracking-wide text-muted">버전</span>
        <span className="text-[11px] text-muted" data-uiux-version-count={versions.length}>
          {versions.length}개
        </span>
      </div>

      <div className="mx-auto max-w-2xl p-4">
        <div className="mb-5 rounded-md border border-line bg-panel p-3">
          <div className="mb-2 text-[13px] font-medium">지금 설계를 굳히기</div>
          <p className="mb-2 text-[12px] leading-relaxed text-muted">
            지금 이 프로젝트의 화면 전부를 그대로 떠서 남깁니다. 나중에 "그때 무엇이 달랐나"를 볼 수 있어요.
          </p>
          <div className="flex gap-2">
            <Input
              data-uiux-version-note
              className="h-8 min-w-0 flex-1"
              placeholder="무엇을 마쳤나요 (선택)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button size="sm" disabled={busy} onClick={() => void cut()}>
              굳히기
            </Button>
          </div>
        </div>

        {versions.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted">아직 굳힌 버전이 없어요.</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {versions.map((v) => (
              <li
                key={v.id}
                data-uiux-version={v.number}
                className="flex items-baseline gap-2 rounded-md border border-line bg-panel px-3 py-2"
              >
                <span className="font-mono text-[13px] font-medium">{v.number}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{v.note || '메모 없음'}</span>
                <span className="shrink-0 text-[11px] text-muted">{v.created_at.slice(0, 16).replace('T', ' ')}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

const CHANGE_LABEL: Record<ChangeKind, string> = {
  changed: '바뀜',
  added: '더해짐',
  removed: '사라짐',
  same: '그대로'
}

const CHANGE_TONE: Record<ChangeKind, string> = {
  changed: 'text-accent border-accent/40',
  added: 'text-fg border-line',
  removed: 'text-destructive border-destructive/40',
  same: 'text-muted border-line'
}

function DiffView() {
  const versions = useSpecStore((s) => s.versions)
  const tree = useTree()
  const [pick, setPick] = useState<string>('')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  // 고른 버전의 본문은 목록에 없다(무거워서) — 고를 때 따로 읽는다.
  useEffect(() => {
    if (!pick) {
      setSnapshot(null)
      return
    }
    let alive = true
    void window.rockury.uiux.getVersion(pick).then((row) => {
      if (!alive || !row) return
      try {
        setSnapshot(JSON.parse(row.snapshot) as Snapshot)
      } catch {
        setSnapshot(null)
      }
    })
    return () => {
      alive = false
    }
  }, [pick])

  const diff = useMemo(
    () => (snapshot ? diffSnapshots(snapshot, takeSnapshot(tree)) : []),
    [snapshot, tree]
  )

  if (versions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
          <History size={24} strokeWidth={1.8} />
        </div>
        <h2 className="text-lg font-semibold">비교할 버전이 없어요</h2>
        <p className="max-w-md text-[13px] leading-relaxed text-muted">
          Timeline 에서 지금 설계를 한 번 굳히면, 그 뒤로 무엇이 달라졌는지 여기서 볼 수 있어요.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[12px] font-semibold tracking-wide text-muted">비교</span>
        <select
          data-uiux-diff-pick
          className="h-7 rounded border border-line bg-canvas px-2 text-[12px]"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">버전 고르기</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.number}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted">↔ 지금 설계</span>
      </div>

      <div className="mx-auto max-w-2xl p-4">
        {!snapshot ? (
          <p className="py-8 text-center text-[13px] text-muted">
            위에서 버전을 고르면 지금 설계와 비교합니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5" data-uiux-diff>
            {diff.map((row) => (
              <li
                key={row.address}
                data-uiux-diff-row={row.change}
                className="rounded-md border border-line bg-panel px-3 py-2"
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className={cx(
                      'shrink-0 rounded border px-1.5 py-0.5 text-[10px]',
                      CHANGE_TONE[row.change]
                    )}
                  >
                    {CHANGE_LABEL[row.change]}
                  </span>
                  <span className="text-[13px] font-medium">{row.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted">{row.address}</span>
                </div>
                {row.details.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 pl-1">
                    {row.details.map((d, i) => (
                      <li key={i} className="text-[12px] text-muted">
                        · {d}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
