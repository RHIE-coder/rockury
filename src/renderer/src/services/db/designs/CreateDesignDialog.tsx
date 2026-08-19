import { useState } from 'react'
import { Info } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/ui/dialog'
import { useNav } from '@renderer/nav/useNav'
import { cn } from '@renderer/lib/utils'
import { DIALECTS, type DialectId } from '../dialects'
import { DialectMark } from '../DialectMark'
import { checkSchemaName, suggestSchemaName, supportsSchemas } from '@shared/db/schemaCatalog'
import { scopeModel } from '../scope'
import { useDesignsStore } from './store'

/**
 * 새 설계 모달 — 이름 · 설명 · 벤더(방언) · **첫 스키마 이름**.
 * 벤더는 Design 의 고정 속성(생성 시 1회 결정) — 이후 변경은 포팅으로 새 설계를 만든다.
 * 생성 즉시 컨텍스트 바의 active Design 으로 선택된다.
 *
 * 스키마 이름을 여기서 받는 이유: 이것이 없던 동안 설계는 자기 스키마 이름을 몰랐고, 읽을 때
 * `public` 으로 채워졌다 — MySQL 에는 없는 이름이다(2026-08-11 사용자 지적). 미리 채워 주되
 * **고칠 수 있는 칸**으로 둔다: 설계 이름은 사람이 읽는 라벨이라 식별자로 못 쓸 글자가 흔하고,
 * 설계 이름을 나중에 바꿨을 때 스키마 이름이 따라 바뀌면 안 된다(그건 데이터가 딸린 DDL 이다).
 */
export function CreateDesignDialog() {
  const open = useDesignsStore((s) => s.createOpen)
  const closeCreate = useDesignsStore((s) => s.closeCreate)
  const addDesign = useDesignsStore((s) => s.addDesign)
  const setContextValue = useNav((s) => s.setContextValue)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [dialect, setDialect] = useState<DialectId | null>(null)
  /** 사람이 손댄 적이 있나 — 손댄 뒤에는 이름·벤더를 고쳐도 덮어쓰지 않는다. */
  const [schemaTouched, setSchemaTouched] = useState(false)
  const [schemaName, setSchemaName] = useState('')

  const suggested = dialect ? suggestSchemaName(dialect, name) : ''
  const effectiveSchema = schemaTouched ? schemaName : suggested
  const schemaCheck = checkSchemaName(effectiveSchema, [])
  const needsSchema = dialect != null && supportsSchemas(dialect)

  const canSubmit = name.trim().length > 0 && dialect != null && (!needsSchema || schemaCheck.ok)

  const dismiss = () => {
    setName('')
    setDescription('')
    setDialect(null)
    setSchemaTouched(false)
    setSchemaName('')
    closeCreate()
  }

  const submit = async () => {
    if (!canSubmit || !dialect) return
    const id = await addDesign({
      name,
      description: description.trim(),
      dialect,
      schemaName: effectiveSchema
    })
    setContextValue('design', id)
    dismiss()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>새 설계</DialogTitle>
          <DialogDescription>
            이름과 벤더를 정하면 설계가 만들어져요. 테이블·버전·환경은 이 설계 아래에서
            관리됩니다.
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
            이름
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: commerce-core"
              className="h-8 font-mono text-[13px] font-normal"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
            설명 <span className="font-normal text-muted">(선택)</span>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="이 설계가 다루는 도메인"
              className="h-8 text-[13px] font-normal"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-fg">벤더</span>
            <div className="grid grid-cols-2 gap-2">
              {DIALECTS.map((d) => {
                const selected = dialect === d.id
                return (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDialect(d.id)}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      selected
                        ? 'border-accent bg-accent-soft'
                        : 'border-line hover:bg-panel'
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                      <DialectMark dialect={d.id} className="size-4" />
                      {d.label}
                    </span>
                    <span className="text-[11px] leading-snug text-muted">{d.blurb}</span>
                  </button>
                )
              })}
            </div>
            <p className="mt-0.5 flex items-start gap-1.5 rounded-md bg-panel px-2.5 py-2 text-[11.5px] leading-relaxed text-muted">
              <Info className="mt-[3px] size-3.5 shrink-0" />
              <span>
                벤더는 설계의 고정 속성이라 생성 후 바꿀 수 없어요. 설계 화면과 DDL 은 이 벤더의
                네이티브 구문 그대로 다뤄지고, 다른 벤더가 필요해지면 포팅으로 새 설계를 만듭니다.
              </span>
            </p>
          </div>

          {/*
            벤더를 고른 뒤에 뜬다 — 낱말이 벤더마다 다르고(스키마 / 데이터베이스), sqlite 는
            층 자체가 없어 물을 것이 없다.
          */}
          {needsSchema && dialect && (
            <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
              {scopeModel(dialect).schemaLabel} 이름
              <Input
                value={effectiveSchema}
                onChange={(e) => {
                  setSchemaTouched(true)
                  setSchemaName(e.target.value)
                }}
                className="h-8 font-mono text-[13px] font-normal"
              />
              {schemaCheck.ok ? (
                <span className="font-normal text-[11.5px] text-muted">
                  {dialect === 'postgresql'
                    ? '새 데이터베이스에 언제나 있는 이름입니다. 표가 이 아래 만들어집니다.'
                    : '설계 이름에서 따왔어요. 표가 이 이름 아래 만들어집니다.'}
                </span>
              ) : (
                <span className="font-normal text-[11.5px] text-destructive">{schemaCheck.reason}</span>
              )}
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
              취소
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              설계 만들기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
