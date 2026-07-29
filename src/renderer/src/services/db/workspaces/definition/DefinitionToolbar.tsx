import { Code2, TableProperties } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '@renderer/lib/cx'
import { useActiveDesign } from '../../designs/store'
import { dialectInfo } from '../../dialects'
import { useDefinitionStore } from './store'

const FORMS: { id: 'table' | 'sql'; label: string; icon: LucideIcon }[] = [
  { id: 'table', label: 'Table', icon: TableProperties },
  { id: 'sql', label: 'SQL', icon: Code2 }
]

/**
 * L4 — Definition 표현 토글([Table|SQL]).
 * SQL 뷰의 방언은 선택지가 아니라 설계의 고정 속성 — 읽기 전용 배지로만 노출한다.
 * (벤더 이동은 추후 "포팅"으로 새 설계를 만드는 명시적 작업)
 *
 * 시점 손잡이는 여기 없다 — 상단 '설계' 뱃지가 든다(2026-07-30). 한 화면에 두 자리가 같은 시점을
 * 말하면 서로 어긋난 숫자를 보이게 된다(예전 `<마지막 컷> · draft` 칩이 정확히 그랬다).
 */
export function DefinitionToolbar() {
  const form = useDefinitionStore((s) => s.form)
  const setForm = useDefinitionStore((s) => s.setForm)
  const design = useActiveDesign()

  return (
    <>
      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-canvas p-0.5">
        {FORMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            // e2e 가 표현 토글을 라벨 문자열이 아니라 역할로 집게 하는 훅 — 지우면 스모크가 깨진다.
            data-definition-form={id}
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
      </div>
    </>
  )
}
