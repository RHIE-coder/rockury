import { useMemo } from 'react'
import { ArrowRight } from 'lucide-react'
import { diffSnapshots } from './diff'
import { diffSeeds, isEmptySeedDiff } from './seedDiff'
import { SchemaDiffPanel } from './SchemaDiffPanel'
import { SeedDiffPanel } from './SeedDiffPanel'
import type { VersionDef } from './store'

/**
 * 버전 비교(diff ①) — 두 버전 스냅샷의 스키마·시드 델타. 같은 계보라 id 매칭(rename 추적).
 *
 * 예전엔 `Versions › Version Diff` 라는 **따로 뜬 화면**이었고, 그 안에서 두 버전을 셀렉트로
 * 다시 골라야 했다 — 타임라인에 이미 보이는 목록을 한 번 더 그린 셈이다. 2026-08-03 사용자
 * 결정으로 타임라인 줄에서 둘을 고르면 여기 열리는 패널이 됐다: 고르는 자리가 곧 목록이다.
 */
export function VersionDiffPanel({ base, target }: { base: VersionDef; target: VersionDef }) {
  const diff = useMemo(() => diffSnapshots(base.snapshot, target.snapshot), [base, target])
  // 시드는 스키마와 따로 계산한다 — 실 DB 비교(Drift·Plan)에는 시드가 없어 한 함수로 묶으면 거짓 델타가 난다.
  const seedDiff = useMemo(
    () => diffSeeds(base.snapshot.seeds, target.snapshot.seeds),
    [base, target]
  )

  return (
    <div data-version-diff className="mt-4">
      <div className="mb-3 flex items-center gap-2 font-mono text-[13px] font-semibold text-fg">
        {base.number}
        <ArrowRight className="size-3.5 text-muted" />
        {target.number}
      </div>

      <SchemaDiffPanel
        diff={diff}
        // 시드에 변화가 있으면 "스키마는 동일"이라고만 말한다 — 화면 전체가 '변경 없음'으로 읽히지 않게.
        emptyText={
          isEmptySeedDiff(seedDiff)
            ? '두 버전의 스키마·시드가 동일해요'
            : '스키마는 동일하고, 아래 시드만 바뀌었어요'
        }
      />
      <SeedDiffPanel diff={seedDiff} />
    </div>
  )
}
