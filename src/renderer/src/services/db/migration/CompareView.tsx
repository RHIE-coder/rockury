import { useState, type ReactElement } from 'react'
import { ArrowRight, GitCompare, Loader2, Radar } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/ui/select'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { dialectInfo } from '../dialects'
import { useActiveConnection, useScopedConnections } from '../connections/store'
import { normalizeSchema } from '../remote/introspection'
import { diffSnapshots, type SchemaDiff } from '../versions/diff'
import { SchemaDiffPanel } from '../versions/SchemaDiffPanel'

/**
 * Migration › Compare — 실 DB ↔ 실 DB 스키마 비교(예: DEV↔STG↔PROD).
 * 설계 무관: 기준 = 활성 Connection, 상대 = 여기서 선택. 양쪽 다 역설계라
 * id 가 이름 기반으로 동일 스킴 → 정렬 없이 diffSnapshots 를 그대로 쓴다(이름이 곧 정체성).
 */
export function CompareView(): ReactElement {
  const base = useActiveConnection()
  const connections = useScopedConnections()
  const [otherId, setOtherId] = useState<string>('')
  const [diff, setDiff] = useState<SchemaDiff | null>(null)
  const [comparedWith, setComparedWith] = useState<string>('') // 결과가 어느 상대의 것인지(선택 변경 시 무효화 표시)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!base)
    return (
      <PlaceholderView
        icon={Radar}
        depth="depth 3 · Migration"
        title="연결을 선택하세요"
        subtitle="기준이 될 실 DB 를 Connection 셀렉터에서 고르세요."
      />
    )

  const others = connections.filter((c) => c.id !== base.id)
  const other = others.find((c) => c.id === otherId) ?? null
  const baseInfo = dialectInfo(base.dbType)

  const compare = async (): Promise<void> => {
    if (!other) return
    setLoading(true)
    setError(null)
    try {
      const [irA, irB] = await Promise.all([
        window.rockury.introspection.run(base.id),
        window.rockury.introspection.run(other.id)
      ])
      // designId 는 비교엔 무의미 — 빈 값으로 정규화만.
      setDiff(diffSnapshots({ tables: normalizeSchema(irA, '') }, { tables: normalizeSchema(irB, '') }))
      setComparedWith(other.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">
            Compare <span className="font-normal text-muted">· 실 DB 간 스키마 비교</span>
          </h2>
          <p className="text-[12px] text-muted">환경(DEV·STG·PROD) 사이에 무엇이 다른지 — 기준에서 상대로 가는 변화로 표시</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mx-auto max-w-[880px]">
          {/* 기준(활성 연결) → 상대(선택) */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
            <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              기준
              <span className="flex items-center gap-1.5 rounded-md bg-canvas px-2 py-1 font-mono text-[12px] normal-case tracking-normal text-fg ring-1 ring-line">
                <span className="size-1.5 rounded-full" style={{ background: baseInfo.dot }} />
                {base.name}
              </span>
            </span>
            <ArrowRight className="size-4 text-muted" />
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              상대
              <Select value={otherId || undefined} onValueChange={setOtherId}>
                <SelectTrigger size="sm" className="w-56 font-mono text-[12px] normal-case tracking-normal">
                  <SelectValue placeholder={others.length ? '연결 선택' : '다른 연결 없음'} />
                </SelectTrigger>
                <SelectContent>
                  {others.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="font-mono text-[12px]">
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button size="sm" className="ml-auto" disabled={!other || loading} onClick={() => void compare()}>
              {loading ? <Loader2 className="animate-spin" /> : <GitCompare />} 비교
            </Button>
          </div>

          {error && (
            <div className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</div>
          )}

          {others.length === 0 ? (
            <p className="text-[13px] text-muted">비교할 다른 연결이 없습니다 — Connections 에서 연결을 더 등록하세요.</p>
          ) : !diff ? (
            <p className="text-[13px] text-muted">상대 연결을 고르고 비교를 누르면 두 실 DB 를 역설계해 차이를 보여줍니다.</p>
          ) : comparedWith !== otherId ? (
            <p className="text-[13px] text-muted">상대가 바뀌었어요 — 비교를 다시 실행하세요.</p>
          ) : (
            <SchemaDiffPanel diff={diff} emptyText="두 DB 의 스키마가 동일해요" />
          )}
        </div>
      </div>
    </div>
  )
}
