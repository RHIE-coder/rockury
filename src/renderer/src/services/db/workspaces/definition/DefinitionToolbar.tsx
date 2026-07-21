import { Code2, TableProperties } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '@renderer/lib/cx'
import { useActiveDesign } from '../../designs/store'
import { dialectInfo } from '../../dialects'
import { latestVer } from '../../versions/semver'
import { useDesignVersions } from '../../versions/store'
import { useDefinitionStore } from './store'

const FORMS: { id: 'table' | 'sql'; label: string; icon: LucideIcon }[] = [
  { id: 'table', label: 'Table', icon: TableProperties },
  { id: 'sql', label: 'SQL', icon: Code2 }
]

/**
 * L4 — Definition 표현 토글([Table|SQL]) + draft 칩.
 * SQL 뷰의 방언은 선택지가 아니라 설계의 고정 속성 — 읽기 전용 배지로만 노출한다.
 * (벤더 이동은 추후 "포팅"으로 새 설계를 만드는 명시적 작업)
 */
export function DefinitionToolbar() {
  const form = useDefinitionStore((s) => s.form)
  const setForm = useDefinitionStore((s) => s.setForm)
  const design = useActiveDesign()
  const versions = useDesignVersions(design?.id ?? null)
  const latest = latestVer(versions.map((v) => v.number))

  return (
    <>
      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-canvas p-0.5">
        {FORMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setForm(id)}
            aria-pressed={form === id}
            className={cx(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
              form === id ? 'bg-accent text-white' : 'text-muted hover:bg-panel-strong hover:text-fg'
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {form === 'sql' && design && (
          <span
            title="설계 방언 — DDL 은 이 벤더 구문으로 출력돼요"
            className="flex items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-medium text-fg"
          >
            <span
              className="size-2 rounded-full"
              style={{ background: dialectInfo(design.dialect).dot }}
            />
            {dialectInfo(design.dialect).label}
          </span>
        )}
        <span
          title={latest ? `마지막 컷 ${latest} 이후 편집 중` : '아직 컷된 버전 없음'}
          className="rounded-full bg-accent-2-soft px-2 py-0.5 font-mono text-[11px] font-medium text-accent-2"
        >
          {latest ?? '미커밋'} · draft
        </span>
      </div>
    </>
  )
}
