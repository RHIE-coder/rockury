import { useState } from 'react'
import { AlertTriangle, Download, Upload } from 'lucide-react'
import { Button } from '@renderer/ui/button'
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
import { formatsFor } from '@shared/api/exportSpec'
import { useApiStore } from '../store'
import type { ImportPreview, ImportSourceKind } from '../../../../../preload/services/api'

/**
 * 가져오기·내보내기 — `docs/spec/api-studio.md` § requests.import/export.
 *
 * 가져오기는 **기존 명세를 덮지 않는다**: 미리보기에서 추가/충돌/미해석을 먼저 보이고,
 * 겹치는 이름은 기존 것을 남긴다. 내보내기는 **값 없이** 나간다.
 */

const KINDS: { id: ImportSourceKind; label: string; hint: string }[] = [
  { id: 'openapi', label: 'OpenAPI 3.x', hint: 'JSON 또는 YAML' },
  { id: 'proto', label: 'gRPC .proto', hint: 'service·rpc 정의' },
  { id: 'graphql', label: 'GraphQL', hint: 'SDL 또는 introspection JSON' }
]

export function TransferDialog() {
  const open = useApiStore((s) => s.transferOpen)
  const close = useApiStore((s) => s.closeTransfer)
  const active = useApiStore((s) => s.active)
  const init = useApiStore((s) => s.init)
  const loadSpec = useApiStore((s) => s.loadSpec)
  const setContextValue = useNav((s) => s.setContextValue)

  const [kind, setKind] = useState<ImportSourceKind>('openapi')
  const [source, setSource] = useState('')
  const [into, setInto] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exported, setExported] = useState<{ filename: string; unsupported: string[] } | null>(null)

  const dismiss = (): void => {
    setSource('')
    setPreview(null)
    setError(null)
    setExported(null)
    setInto(false)
    close()
  }

  const makePreview = async (): Promise<void> => {
    setError(null)
    try {
      setPreview(await window.rockury.apiTransfer.preview(kind, source, into ? active?.id : undefined))
    } catch (e) {
      setPreview(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const runImport = async (): Promise<void> => {
    try {
      const { specId } = await window.rockury.apiTransfer.run(kind, source, into ? active?.id : undefined)
      await init()
      setContextValue('spec', specId)
      await loadSpec(specId)
      dismiss()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const runExport = async (): Promise<void> => {
    if (!active) return
    setError(null)
    try {
      const out = await window.rockury.apiTransfer.export(active.id, formatsFor(active.kind)[0])
      await navigator.clipboard.writeText(out.content)
      setExported({ filename: out.filename, unsupported: out.unsupported })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>가져오기 · 내보내기</DialogTitle>
          <DialogDescription>
            기존 API 문서를 명세로 옮기거나, 지금 명세를 문서로 내보냅니다. 옮기지 못한 것은
            버리지 않고 목록으로 보여 드립니다.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p
            data-api-transfer-error
            className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-[12px] whitespace-pre-wrap text-danger"
          >
            <AlertTriangle className="mt-[2px] size-3.5 shrink-0" />
            {error}
          </p>
        )}

        <section className="mt-2 flex flex-col gap-2">
          <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-fg">
            <Upload className="size-3.5" /> 가져오기
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                data-api-import-kind={k.id}
                onClick={() => {
                  setKind(k.id)
                  setPreview(null)
                }}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition-colors',
                  kind === k.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-panel'
                )}
              >
                <span className="block text-[13px] font-semibold text-fg">{k.label}</span>
                <span className="block text-[11px] text-muted">{k.hint}</span>
              </button>
            ))}
          </div>

          <textarea
            value={source}
            rows={8}
            data-api-import-source
            placeholder="문서 내용을 붙여 넣으세요"
            className="rounded-md border border-line bg-canvas px-2.5 py-2 font-mono text-[11.5px] text-fg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(e) => {
              setSource(e.target.value)
              setPreview(null)
            }}
          />

          {active && (
            <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
              <input type="checkbox" checked={into} data-api-import-into onChange={(e) => setInto(e.target.checked)} />
              새 명세를 만들지 않고 <b className="text-fg">{active.name}</b> 에 합치기 (겹치는 이름은 기존 것을 남깁니다)
            </label>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-[12px]" disabled={!source.trim()} data-api-import-preview onClick={() => void makePreview()}>
              미리보기
            </Button>
            {preview && (
              <Button size="sm" className="h-7 text-[12px]" data-api-import-run onClick={() => void runImport()}>
                가져오기
              </Button>
            )}
          </div>

          {preview && (
            <div className="flex flex-col gap-1.5 rounded-md border border-accent p-3" data-api-import-preview-panel>
              <p className="text-[12px] text-fg">
                <b>{preview.additions.length}개</b> 추가
                {preview.conflicts.length > 0 && (
                  <span className="text-danger"> · {preview.conflicts.length}개 이름 충돌(기존 것을 남깁니다)</span>
                )}
              </p>
              {preview.additions.length > 0 && (
                <p className="font-mono text-[11px] break-all text-muted">{preview.additions.join(', ')}</p>
              )}
              {preview.conflicts.length > 0 && (
                <p className="font-mono text-[11px] break-all text-danger" data-api-import-conflicts>
                  {preview.conflicts.join(', ')}
                </p>
              )}
              {preview.unsupported.length > 0 ? (
                <div data-api-import-unsupported>
                  <p className="text-[11.5px] font-semibold text-fg">옮기지 못한 것 {preview.unsupported.length}개</p>
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {preview.unsupported.map((u, i) => (
                      <li key={i} className="text-[11px] text-muted">
                        · {u}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-[11.5px] text-muted">전부 옮겼습니다.</p>
              )}
            </div>
          )}
        </section>

        <section className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-fg">
            <Download className="size-3.5" /> 내보내기
          </h4>
          <p className="rounded-md bg-panel px-2.5 py-1.5 text-[11.5px] text-muted">
            값은 빠지고 <b className="text-fg">이름만</b> 나갑니다 — 내보낸 파일을 git 에 올려도 키가 박히지 않습니다.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-[12px]"
              disabled={!active}
              data-api-export
              onClick={() => void runExport()}
            >
              {active ? `${formatsFor(active.kind)[0]} 로 복사` : '명세를 먼저 고르세요'}
            </Button>
            {exported && (
              <span className="text-[11.5px] text-muted" data-api-export-done>
                {exported.filename} 내용을 복사했습니다
                {exported.unsupported.length > 0 && ` · 못 옮긴 것 ${exported.unsupported.length}개`}
              </span>
            )}
          </div>
          {exported && exported.unsupported.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {exported.unsupported.map((u, i) => (
                <li key={i} className="text-[11px] text-muted">
                  · {u}
                </li>
              ))}
            </ul>
          )}
        </section>

        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={dismiss}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
