import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/ui/dialog'
import { Badge } from '@renderer/ui/badge'
import {
  addSchema,
  checkSchemaName,
  removeSchema,
  renameSchema,
  resolveSchemas,
  schemaIssues,
  schemaTableCounts,
  supportsSchemas
} from '@shared/db/schemaCatalog'
import { scopeModel } from '../scope'
import { useDefinitionStore, useDesignTables } from '../workspaces/definition/store'
import { useActiveDesign, useDesignsStore } from './store'

/**
 * **스키마 관리** — 설계 단계에서 스키마를 만들고 이름을 고치고 지운다.
 *
 * 이것이 없던 동안 스키마를 적는 곳은 "표마다 있는 자유 입력 칸" 하나뿐이었다. 그래서
 * **표가 없는 스키마를 만들 방법이 아예 없었고**, 실 DB 를 가져오지 않으면 설계를 시작할 수도
 * 없었다(2026-08-11 사용자 지적: "실제 DB가 물려야 설계를 할 수 있는 치명적인 기능 막힘").
 *
 * PostgreSQL 의 schema 와 MySQL 의 database 는 같은 자리라 **한 화면으로 다룬다** — 낱말만
 * `scopeModel` 이 갈라 준다. sqlite 는 층이 없어 이 창을 열 수 없다.
 *
 * 이름 바꾸기는 그 스키마의 **표 전부를 옮긴다**. 설계에서는 라벨을 고치는 일이지만, 실 DB 에
 * 반영할 때는 옛 이름을 지우고 새 이름을 만드는 것으로 계획된다(MySQL 에는 데이터베이스
 * 이름을 바꾸는 문이 없다) — 그래서 계획 화면에서 확인하고 밀라고 아래에 적어 둔다.
 */
export function SchemasDialog() {
  const open = useDesignsStore((s) => s.schemasOpen)
  const close = useDesignsStore((s) => s.closeSchemas)
  const setDeclared = useDesignsStore((s) => s.setDeclaredSchemas)
  const design = useActiveDesign()
  const tables = useDesignTables()
  const moveSchema = useDefinitionStore((s) => s.moveSchema)

  const [adding, setAdding] = useState('')
  const [editingName, setEditingName] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const declared = design?.declaredSchemas ?? []
  const schemas = useMemo(() => resolveSchemas(declared, tables), [declared, tables])
  const counts = useMemo(() => schemaTableCounts(tables), [tables])
  const issues = design ? schemaIssues(design.dialect, schemas) : []
  /** 이름이 안 붙은 표 — 선언 기능 이전 설계에 남는다. 감추지 않고 옮길 수 있게 보인다. */
  const orphans = counts.get('') ?? 0

  if (!design || !supportsSchemas(design.dialect)) return null
  const label = scopeModel(design.dialect).schemaLabel

  const dismiss = (): void => {
    setAdding('')
    setEditingName(null)
    setDraft('')
    close()
  }

  const addCheck = checkSchemaName(adding, schemas)
  const renameCheck = checkSchemaName(draft, schemas.filter((s) => s !== editingName))

  const commitAdd = (): void => {
    if (!addCheck.ok) return
    void setDeclared(design.id, addSchema(declared, adding.trim()))
    setAdding('')
  }

  const commitRename = (): void => {
    if (!renameCheck.ok || editingName == null) return
    const to = draft.trim()
    // 선언과 표를 함께 옮긴다 — 한쪽만 바꾸면 목록에 유령 스키마가 남는다.
    void setDeclared(design.id, renameSchema(resolveSchemas(declared, tables), editingName, to))
    moveSchema(design.id, editingName, to)
    setEditingName(null)
    setDraft('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>

        {issues.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              <b className="font-mono">{issues.join(', ')}</b> 은 PostgreSQL 의 기본 스키마 이름입니다.
              이 벤더에는 그런 데이터베이스가 없어서, 이대로 두면 계획이 실 DB 와 짝을 못 찾습니다.
              이름을 실제 데이터베이스 이름으로 고치세요.
            </span>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-1">
          {schemas.map((s, i) => {
            const n = counts.get(s) ?? 0
            const editing = editingName === s
            return (
              <div
                key={s}
                className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2 text-[13px]"
              >
                {editing ? (
                  <>
                    <Input
                      autoFocus
                      data-schema-rename
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') setEditingName(null)
                      }}
                      className="h-7 min-w-0 flex-1 font-mono text-[13px]"
                    />
                    <span className="shrink-0 text-[11.5px] text-destructive">{renameCheck.reason}</span>
                    <Button size="sm" variant="ghost" disabled={!renameCheck.ok} onClick={commitRename}>
                      <Check />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingName(null)}>
                      <X />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate font-mono text-fg">{s}</span>
                    {/* 첫째가 새 표가 태어날 자리다 — 그 사실을 배지로만 말한다. */}
                    {i === 0 && (
                      <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                        기본
                      </Badge>
                    )}
                    <span className="shrink-0 tabular-nums text-muted">표 {n}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="이름 바꾸기"
                      onClick={() => {
                        setEditingName(s)
                        setDraft(s)
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={n > 0 ? `표 ${n}개가 있어 지울 수 없습니다` : '지우기'}
                      disabled={n > 0}
                      onClick={() => void setDeclared(design.id, removeSchema(declared, s))}
                    >
                      <Trash2 />
                    </Button>
                  </>
                )}
              </div>
            )
          })}

          {schemas.length === 0 && (
            <p className="px-1 py-2 text-[12.5px] text-muted">{label} 없음</p>
          )}

          {/* 이름 없는 표 — 어디로 갈지 사람이 정해야 하니 옮길 자리를 여기서 준다. */}
          {orphans > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-panel px-2.5 py-2 text-[12px]">
              <span className="min-w-0 flex-1 text-fg">이름이 없는 표 {orphans}개</span>
              {schemas.map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => moveSchema(design.id, '', s)}>
                  {s} 로 옮기기
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-2 flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Input
              data-schema-add
              value={adding}
              placeholder={`새 ${label} 이름`}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commitAdd()}
              className="h-8 font-mono text-[13px]"
            />
            {adding.trim() !== '' && !addCheck.ok && (
              <span className="text-[11.5px] text-destructive">{addCheck.reason}</span>
            )}
          </div>
          <Button size="sm" variant="outline" disabled={!addCheck.ok} onClick={commitAdd}>
            <Plus /> 추가
          </Button>
        </div>

        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
          이름을 바꾸면 그 안의 표가 모두 따라 옮겨집니다. 실 DB 에 반영할 때는 옛 이름을 지우고
          새 이름을 만드는 계획이 되니 Migration › 계획에서 확인하고 미세요.
        </p>

        <DialogFooter>
          <Button type="button" size="sm" onClick={dismiss}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
