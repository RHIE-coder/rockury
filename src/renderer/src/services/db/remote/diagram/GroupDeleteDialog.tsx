import { useEffect, useState } from 'react'
import { AlertTriangle, Layers } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@renderer/ui/dialog'
import { groupDeletePhrase, matchesGroupDeletePhrase, type DiagramGroup } from './group'

/**
 * 그룹 지우기 확인 — 정본: §db-remote.diagram.group-panel AC-2a/AC-2b.
 *
 * 1단(어디서나): "그룹만 지울까요?" — 테이블은 남는다는 걸 분명히 말한다.
 * 2단(설계부에서 소속이 있을 때만): **소속 테이블까지** 지우려면 `{N}개 테이블도 함께 삭제합니다` 를
 *   그대로 입력해야 한다. 버튼 한 번으로 테이블 여러 개가 사라지면 안 되기 때문.
 *
 * 운영부(Remote)는 2단 자체가 없다 — 거기 테이블은 실 DB 객체라, 지우는 길은
 * 편집 모드의 대기 변경 → DDL 미리보기 → 트랜잭션 게이트 하나뿐이다.
 */
export function GroupDeleteDialog({
  group,
  memberNames,
  onClose,
  onDeleteGroupOnly,
  onDeleteWithTables
}: {
  /** 열려 있는 대상. null 이면 닫힘. */
  group: DiagramGroup | null
  /** 소속 테이블 이름 — 몇 개가 걸려 있는지 눈으로 보이게. */
  memberNames: string[]
  onClose: () => void
  onDeleteGroupOnly: () => void
  /** 주면 "테이블도 함께" 선택지가 생긴다(설계부 전용). 없으면 1단만. */
  onDeleteWithTables?: (tableIds: string[]) => void
}) {
  const [step, setStep] = useState<'ask' | 'with-tables'>('ask')
  const [typed, setTyped] = useState('')

  // 다른 그룹으로 다시 열릴 때 앞 단계·입력이 남아 있으면 안 된다.
  useEffect(() => {
    setStep('ask')
    setTyped('')
  }, [group?.id])

  if (!group) return null
  const count = memberNames.length
  const canOfferTables = !!onDeleteWithTables && count > 0
  const phrase = groupDeletePhrase(count)
  const ok = matchesGroupDeletePhrase(typed, count)

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-group-delete-dialog={group.name} className="max-w-md">
        {step === 'ask' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Layers className="size-4 text-muted" />
                그룹 “{group.name || '이름 없는 그룹'}” 을 지울까요?
              </DialogTitle>
              <DialogDescription>
                {count === 0
                  ? '이 그룹에는 테이블이 없습니다. 묶음만 사라집니다.'
                  : `묶음만 풀립니다 — 소속 테이블 ${count}개는 그대로 남습니다.`}
              </DialogDescription>
            </DialogHeader>

            {count > 0 && (
              <div className="mt-1 max-h-28 overflow-auto rounded-md border border-line bg-panel px-2.5 py-1.5">
                <p className="font-mono text-[11.5px] leading-relaxed text-muted">{memberNames.join(', ')}</p>
              </div>
            )}

            <div className="mt-3 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                취소
              </Button>
              {canOfferTables && (
                <Button
                  variant="outline"
                  size="sm"
                  data-group-delete-with-tables
                  className="text-destructive"
                  onClick={() => setStep('with-tables')}
                >
                  테이블도 함께 지우기
                </Button>
              )}
              <Button variant="destructive" size="sm" data-group-delete-only onClick={onDeleteGroupOnly}>
                그룹만 지우기
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-4" />
                테이블 {count}개를 설계에서 지웁니다
              </DialogTitle>
              <DialogDescription>
                그룹과 함께 아래 테이블이 <span className="font-semibold text-fg">설계에서</span> 사라집니다.
                되돌리기가 없으니 확인 문구를 그대로 입력해야 지워집니다.
                (실 DB 는 건드리지 않습니다 — 반영은 Migration 몫입니다.)
              </DialogDescription>
            </DialogHeader>

            <div className="mt-1 max-h-28 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5">
              <p className="font-mono text-[11.5px] leading-relaxed text-destructive">{memberNames.join(', ')}</p>
            </div>

            <label className="mt-3 block text-[12px] text-muted">
              확인 문구: <span className="font-semibold text-fg">{phrase}</span>
              <Input
                autoFocus
                data-group-delete-phrase
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={phrase}
                className="mt-1.5 h-8 text-[12.5px]"
              />
            </label>

            <div className="mt-3 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep('ask')}>
                뒤로
              </Button>
              <Button
                variant="destructive"
                size="sm"
                data-group-delete-confirm
                disabled={!ok}
                onClick={() => onDeleteWithTables?.(group.tableIds)}
              >
                그룹과 테이블 {count}개 지우기
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
