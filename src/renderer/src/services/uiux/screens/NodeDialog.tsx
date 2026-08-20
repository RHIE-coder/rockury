import { useEffect, useState } from 'react'
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
import { keyProblem } from '../address'
import { SURFACE_KINDS } from '../catalog'
import { useSpecStore, type SpecLevel } from '../store'

/**
 * 위계 노드(프로젝트·앱·서비스·화면) 만들기·고치기
 *
 * 층마다 모달을 따로 두지 않는다: 네 층의 입력이 같아서(주소 조각·이름·설명) 나누면 같은 폼이
 * 네 벌 복제되고, 주소 규칙 안내가 한 군데만 낡는다.
 */

const LEVEL_LABEL: Record<SpecLevel, string> = {
  project: '프로젝트',
  application: '앱',
  service: '서비스',
  surface: '화면'
}

const LEVEL_HINT: Record<SpecLevel, string> = {
  project: '설계 전체를 담는 그릇이에요. 예: 쿠팡',
  application: '따로 배포되는 앱이에요. 예: 이용자 앱 · 판매자 앱',
  service: '앱을 이루는 업무 묶음이에요. 예: 로그인 · 상품 관리',
  surface: '화면 한 장이에요. 모달·드로어도 화면과 동급으로 둡니다.'
}

export function NodeDialog() {
  const dialog = useSpecStore((s) => s.dialog)
  const closeDialog = useSpecStore((s) => s.closeDialog)
  const createNode = useSpecStore((s) => s.createNode)
  const updateNode = useSpecStore((s) => s.updateNode)
  const error = useSpecStore((s) => s.error)

  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState('page')
  const [busy, setBusy] = useState(false)

  const editing = dialog?.editing
  // 모달이 열릴 때마다 폼을 그 노드의 값으로 되돌린다(닫았다 다시 열면 이전 입력이 남지 않게).
  useEffect(() => {
    setKey(editing?.key ?? '')
    setName(editing?.name ?? '')
    setDescription(editing?.description ?? '')
    setKind(editing?.kind ?? 'page')
    setBusy(false)
  }, [dialog, editing])

  if (!dialog) return null

  const level = dialog.level
  const problem = key.length > 0 ? keyProblem(key) : null
  const canSubmit = key.length > 0 && !problem && name.trim().length > 0 && !busy

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setBusy(true)
    const payload = { key, name, description, ...(level === 'surface' ? { kind } : {}) }
    const ok = editing
      ? await updateNode(level, editing.id, payload)
      : (await createNode(level, dialog.parentId, payload)) !== null
    setBusy(false)
    if (ok) closeDialog()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? `${LEVEL_LABEL[level]} 고치기` : `새 ${LEVEL_LABEL[level]}`}
          </DialogTitle>
          <DialogDescription>{LEVEL_HINT[level]}</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">이름</span>
            <Input
              autoFocus
              data-node-field="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={level === 'surface' ? '로그인 화면' : '로그인'}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">주소 조각</span>
            <Input
              data-node-field="key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="login"
              aria-invalid={problem ? true : undefined}
            />
            <span className={problem ? 'text-[12px] text-destructive' : 'text-[12px] text-muted'}>
              {problem ??
                '흐름·규칙·의견이 이 주소에 걸려요. 이름과 달리 영문 소문자로 두면 나중에 안 흔들립니다.'}
            </span>
          </label>

          {level === 'surface' && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[13px] font-medium">종류</legend>
              <div className="flex flex-wrap gap-1.5">
                {SURFACE_KINDS.map((k) => (
                  <Button
                    key={k.kind}
                    type="button"
                    size="sm"
                    variant={kind === k.kind ? 'default' : 'outline'}
                    onClick={() => setKind(k.kind)}
                  >
                    {k.label}
                  </Button>
                ))}
              </div>
            </fieldset>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">설명 (선택)</span>
            <Input
              data-node-field="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={level === 'surface' ? '이 화면이 하는 일 한 줄' : '이 묶음이 하는 일 한 줄'}
            />
          </label>

          {error && <p className="text-[13px] text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog}>
              취소
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {editing ? '저장' : '만들기'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
