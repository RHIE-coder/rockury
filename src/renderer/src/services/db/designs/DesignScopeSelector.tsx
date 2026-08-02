import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Layers } from 'lucide-react'
import { cx } from '@renderer/lib/cx'
import { ScopeMenu } from '../connections/ScopeMenu'
import { designSchemas, designScopeSummary, scopeModel, toggleDesignSchema } from '../scope'
import { useDesignTables } from '../workspaces/definition/store'
import { useActiveDesign, useDesignsStore } from './store'

/**
 * **설계 범위 손잡이** — 이 설계에서 볼 스키마를 고른다. 자리는 설계 손잡이의 시점(Draft) 바로 뒤.
 *
 * 왜 필요한가: 여러 스키마로 짜인 실 DB 를 한 설계로 가져오면 `public.users` 와 `auth.users` 가
 * 한 목록에 섞여 뜬다. 운영부(Remote)에는 그것을 고를 손잡이가 있는데 설계부에는 없어서,
 * 가져온 다음부터는 갈래를 못 나눴다(2026-08-03 사용자 지적).
 *
 * 운영부 손잡이(`ScopeSelector`)와 **개념은 같고 기본값이 반대다** — 여기서 아무것도 안 고른
 * 상태는 "기본 스키마 하나"가 아니라 **전부 보기**다. 설계는 이미 손안에 있어 읽어 올 비용이
 * 없으니 감출 이유가 없다. 그래서 "마지막 하나는 못 끈다"는 잠금도 없다(`lockLastOne={false}`):
 * 다 끄면 빈 화면이 아니라 전체로 돌아간다.
 *
 * 값은 설계에 저장된다(`designs.schemas`) — 앱을 다시 열면 보던 범위로 돌아온다.
 *
 * Seed 는 아직 이 범위를 안 본다 — 시드 참조 검증(`validateSeedRefs`)이 같은 목록을 쓰기 때문에,
 * 범위를 좁히면 범위 밖 테이블을 가리키는 멀쩡한 시드가 "깨졌다"고 뜬다.
 */
export function DesignScopeSelector() {
  const design = useActiveDesign()
  const setSchemas = useDesignsStore((s) => s.setSchemas)
  // 고를 목록은 **설계 안에 실제로 든 스키마**다 — 실 DB 에 물어볼 것이 없다(연결이 없어도 뜬다).
  const available = designSchemas(useDesignTables())

  if (!design) return null

  const model = scopeModel(design.dialect)
  // 벤더가 스키마 층을 안 쓰면(SQLite) 고를 것이 없다.
  if (!model.selectable) return null

  const selected = design.schemas.filter((s) => available.includes(s))

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-design-scope
          title={`${model.schemaLabel} 범위 — 여기서 고른 것을 Definition·Diagram 이 함께 봅니다`}
          className={cx(
            'flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] transition-colors',
            'hover:bg-panel-strong data-[state=open]:bg-panel-strong',
            selected.length > 0 ? 'text-fg' : 'text-muted'
          )}
        >
          <Layers size={13} className="shrink-0 text-muted" />
          <span className="font-mono text-[12px] font-semibold">
            {designScopeSummary(selected, available)}
          </span>
          <ChevronDown size={12} className="shrink-0 text-muted" />
        </button>
      </DropdownMenu.Trigger>

      <ScopeMenu
        model={model}
        available={available}
        // 안 고른 상태(=전부)에서는 전부 켜진 것으로 보인다 — 화면에 다 떠 있는데 체크가
        // 하나도 없으면 "안 보고 있다"로 읽힌다.
        selected={selected.length > 0 ? selected : available}
        lockLastOne={false}
        onToggle={(s) => void setSchemas(design.id, toggleDesignSchema(selected, s, available))}
      />
    </DropdownMenu.Root>
  )
}
