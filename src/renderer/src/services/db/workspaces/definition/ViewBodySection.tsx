import { useMemo } from 'react'
import { Eye, Info } from 'lucide-react'
import { SqlEditor } from '@renderer/ui/SqlEditor'
import type { DialectId } from '../../dialects'
import type { TableDef } from './types'
import { useDefinitionStore } from './store'

/**
 * 뷰 본문(SELECT) 편집 구역 — `CREATE VIEW <이름> AS` 뒤에 붙을 질의를 쓴다.
 * 왜 구조화하지 않고 SQL 그대로 두나: 뷰 본문은 조인·집계·윈도우까지 오는 임의 질의라
 * 컬럼·제약처럼 쪼개도 방언 차이를 흡수하지 못한다 — 설계 방언의 SQL 을 그대로 보관한다.
 * 자동완성 스키마는 **같은 설계의 다른 테이블**에서 만든다(뷰가 참조할 대상이 그것들이므로).
 */
export function ViewBodySection({
  table,
  dialect,
  siblings,
  readOnly
}: {
  table: TableDef
  dialect: DialectId
  /** 같은 설계의 다른 테이블/뷰 — 자동완성 대상. */
  siblings: TableDef[]
  readOnly: boolean
}) {
  const updateTable = useDefinitionStore((s) => s.updateTable)

  const schema = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const t of siblings) {
      if (t.id === table.id) continue
      out[t.name] = t.columns.map((c) => c.name)
    }
    return out
  }, [siblings, table.id])

  return (
    <section data-view-body className="mb-4">
      <div className="mb-1.5 flex items-center gap-2">
        <Eye className="size-3.5 text-muted" />
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">뷰 본문 (SELECT)</h3>
        <span className="font-mono text-[11px] text-muted/80">
          CREATE VIEW {table.name} AS …
        </span>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-line bg-canvas">
        <SqlEditor
          value={table.viewSql ?? ''}
          onChange={(v) => updateTable({ viewSql: v })}
          dialect={dialect}
          schema={schema}
          readOnly={readOnly}
          placeholder="SELECT id, name FROM products WHERE deleted_at IS NULL"
          className="min-h-[132px] px-1 py-2"
        />
      </div>

      <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted">
        <Info className="mt-[1px] size-3.5 shrink-0" />
        <span>
          아래 <span className="font-semibold">결과 컬럼</span>은 이 SELECT 가 내놓는 컬럼을 적어 두는 자리예요 —
          ERD·Data 화면이 뷰의 모양을 알려면 필요합니다. 실 DB 에 만들 때 쓰이는 건 위의 SELECT 본문입니다.
        </span>
      </p>
    </section>
  )
}
