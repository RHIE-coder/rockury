import { useMemo, useState } from 'react'
import { ArrowRight, GitCompare } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/ui/select'
import { useActiveDesign } from '../designs/store'
import { useDesignVersions, type VersionDef } from './store'
import { diffSnapshots } from './diff'
import { diffSeeds, isEmptySeedDiff } from './seedDiff'
import { SchemaDiffPanel } from './SchemaDiffPanel'
import { SeedDiffPanel } from './SeedDiffPanel'

/** Versions › Version Diff (diff ①) — 두 버전 스냅샷의 스키마 델타. 같은 계보라 id 매칭(rename 추적). */
export function VersionDiffView() {
  const design = useActiveDesign()
  const versions = useDesignVersions(design?.id ?? null)
  // 기본: base = 이전(둘째 최신), target = 최신
  const [baseId, setBaseId] = useState<string | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)

  const base = versions.find((v) => v.id === baseId) ?? versions[1] ?? null
  const target = versions.find((v) => v.id === targetId) ?? versions[0] ?? null

  const diff = useMemo(
    () => (base && target ? diffSnapshots(base.snapshot, target.snapshot) : null),
    [base, target]
  )
  // 시드는 스키마와 따로 계산한다 — 실 DB 비교(Drift·Plan)에는 시드가 없어 한 함수로 묶으면 거짓 델타가 난다.
  const seedDiff = useMemo(
    () => (base && target ? diffSeeds(base.snapshot.seeds, target.snapshot.seeds) : null),
    [base, target]
  )

  if (!design) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[13px] text-muted">상단에서 설계를 먼저 선택하세요.</p>
      </div>
    )
  }

  if (versions.length < 2) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <GitCompare className="size-6 text-muted/60" />
        <div className="text-[13px] font-semibold text-fg">비교하려면 버전이 2개 이상 필요해요</div>
        <p className="max-w-72 text-[12px] text-muted">Timeline 에서 버전을 더 컷하세요.</p>
      </div>
    )
  }

  const verSelect = (value: VersionDef | null, onChange: (id: string) => void, label: string) => (
    <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
      {label}
      <Select value={value?.id} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-60 font-mono text-[12px] normal-case tracking-normal">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {versions.map((v) => (
            <SelectItem key={v.id} value={v.id} className="font-mono text-[12px]">
              {v.number}
              {v.note ? ` · ${v.note}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )

  return (
    <div className="mx-auto max-w-[880px] px-5 py-5">
      <div className="mb-3 flex items-center gap-2 text-[16px] font-bold tracking-tight text-fg">
        <GitCompare className="size-4 text-muted" />
        버전 비교
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
        {verSelect(base, setBaseId, '이전')}
        <ArrowRight className="size-4 text-muted" />
        {verSelect(target, setTargetId, '이후')}
      </div>

      {diff && (
        <SchemaDiffPanel
          diff={diff}
          // 시드에 변화가 있으면 "스키마는 동일"이라고만 말한다 — 화면 전체가 '변경 없음'으로 읽히지 않게.
          emptyText={
            seedDiff && !isEmptySeedDiff(seedDiff)
              ? '스키마는 동일하고, 아래 시드만 바뀌었어요'
              : '두 버전의 스키마·시드가 동일해요'
          }
        />
      )}
      {seedDiff && <SeedDiffPanel diff={seedDiff} />}
    </div>
  )
}
