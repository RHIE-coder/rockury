import { useState } from 'react'
import { Link2, Plus, Unlink } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/ui/select'
import { dialectInfo } from '../dialects'
import { useDesignsStore, useScopedDesigns } from '../designs/store'
import { useDesignVersions } from '../versions/store'
import { useConnectionsStore } from './store'
import { useEnvManageStore, type ConnectionBinding } from '../environments/store'

/**
 * 설계 바인딩(Environment) 관리 다이얼로그 — 한 연결이 어떤 설계에 · 어느 버전 기준으로
 * 묶여 있는지 보고, 연결·해제·기준(타깃) 버전 변경을 한다. Connection 카드에서 연다.
 */
export function BindingsDialog() {
  const connId = useEnvManageStore((s) => s.manageConnId)
  const close = useEnvManageStore((s) => s.close)
  const error = useEnvManageStore((s) => s.error)
  const conn = useConnectionsStore((s) => s.connections.find((c) => c.id === connId) ?? null)
  const bindings = useEnvManageStore((s) => (connId ? s.byConnection[connId] : undefined)) ?? []

  const open = !!connId
  if (!conn) return open ? <Dialog open onOpenChange={() => close()}><DialogContent /></Dialog> : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>설계 바인딩 · {conn.name}</DialogTitle>
          <DialogDescription>
            이 연결이 어떤 설계에 · 어느 버전을 기준으로 묶여 있는지 관리합니다. 마이그레이션·드리프트는 이 결속 위에서 동작합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 flex flex-col gap-3">
          {bindings.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line bg-panel/40 px-4 py-6 text-center text-[12.5px] text-muted">
              아직 이 연결에 물린 설계가 없습니다. 아래에서 설계를 연결하거나, 드리프트 뷰에서 운영 DB 를 새 설계로 가져오세요.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {bindings.map((b) => (
                <BindingRow key={b.id} connectionId={conn.id} binding={b} />
              ))}
            </div>
          )}

          <AddBinding connectionId={conn.id} boundDesignIds={new Set(bindings.map((b) => b.designId))} />

          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</div>}
        </div>

        <DialogFooter className="mt-1">
          <Button type="button" variant="ghost" size="sm" onClick={close}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 바인딩 한 줄 — 설계명 · 타깃/적용 버전 · 재타깃 · 해제. */
function BindingRow({ connectionId, binding }: { connectionId: string; binding: ConnectionBinding }) {
  const design = useDesignsStore((s) => s.designs.find((d) => d.id === binding.designId) ?? null)
  const versions = useDesignVersions(binding.designId)
  const retarget = useEnvManageStore((s) => s.retarget)
  const unbind = useEnvManageStore((s) => s.unbind)
  const busy = useEnvManageStore((s) => s.busy)
  const [confirming, setConfirming] = useState(false)
  const info = design ? dialectInfo(design.dialect) : null

  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-fg">
          {info && <span className="size-2 shrink-0 rounded-full" style={{ background: info.dot }} />}
          {design ? design.name : <span className="text-destructive">(삭제된 설계)</span>}
        </span>
        <span className="text-[11px] text-muted">
          적용 <b className="font-mono text-fg">{binding.appliedVersion || '—'}</b>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Select value={binding.targetVersion || undefined} onValueChange={(v) => void retarget(connectionId, binding.id, v)}>
          <SelectTrigger size="sm" className="w-32 font-mono" disabled={busy || !design}>
            <SelectValue placeholder={versions.length ? '타깃 버전' : '버전 없음'} />
          </SelectTrigger>
          <SelectContent>
            {versions.map((v) => (
              <SelectItem key={v.number} value={v.number}>{v.number}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {confirming ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-1.5 text-[11px]" onClick={() => setConfirming(false)} disabled={busy}>취소</Button>
            <Button variant="destructive" size="sm" className="h-7 px-1.5 text-[11px]" onClick={() => void unbind(connectionId, binding.id)} disabled={busy}>해제</Button>
          </div>
        ) : (
          <Button variant="ghost" size="icon" className="size-7 text-muted hover:text-destructive" title="바인딩 해제" onClick={() => setConfirming(true)} disabled={busy}>
            <Unlink className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

/** 설계 연결 추가 — 아직 안 묶인 설계 선택 + (선택) 타깃 버전. */
function AddBinding({ connectionId, boundDesignIds }: { connectionId: string; boundDesignIds: Set<string> }) {
  // 접속에 맬 설계도 지금 범위 안에서 고른다.
  const designs = useScopedDesigns()
  const bind = useEnvManageStore((s) => s.bind)
  const busy = useEnvManageStore((s) => s.busy)
  const [designId, setDesignId] = useState<string>('')
  const versions = useDesignVersions(designId || null)
  const [target, setTarget] = useState<string>('')

  const available = designs.filter((d) => !boundDesignIds.has(d.id))

  const submit = async () => {
    if (!designId) return
    await bind(connectionId, designId, target)
    setDesignId('')
    setTarget('')
  }

  if (available.length === 0)
    return <p className="px-1 text-[11.5px] text-muted">연결할 수 있는 다른 설계가 없습니다.</p>

  return (
    <div className="flex items-end gap-2 rounded-lg border border-dashed border-line bg-panel/30 p-2.5">
      <div className="flex flex-1 flex-col gap-1">
        <span className="flex items-center gap-1 text-[11px] font-semibold text-muted"><Link2 className="size-3" /> 설계 연결</span>
        <Select value={designId || undefined} onValueChange={(v) => { setDesignId(v); setTarget('') }}>
          <SelectTrigger size="sm" className="w-full"><SelectValue placeholder="설계 선택" /></SelectTrigger>
          <SelectContent>
            {available.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex w-32 flex-col gap-1">
        <span className="text-[11px] font-semibold text-muted">타깃 버전</span>
        <Select value={target || undefined} onValueChange={setTarget} >
          <SelectTrigger size="sm" className="w-full font-mono" disabled={!designId}>
            <SelectValue placeholder={versions.length ? '(선택)' : '버전 없음'} />
          </SelectTrigger>
          <SelectContent>
            {versions.map((v) => (
              <SelectItem key={v.number} value={v.number}>{v.number}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" onClick={() => void submit()} disabled={!designId || busy}>
        <Plus /> 연결
      </Button>
    </div>
  )
}
