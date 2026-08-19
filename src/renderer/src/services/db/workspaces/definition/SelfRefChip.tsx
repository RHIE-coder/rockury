import { isSelfRef, type TableRef } from '@shared/db/tableRef'
import { cn } from '@renderer/lib/utils'
import type { Constraint } from './types'

/**
 * 자기참조 칩 — 제가 걸린 테이블 자신을 가리키는 FK 에만 붙는다(댓글의 `parent_comment_id`).
 *
 * 왜 필요한가: 제약 한 줄은 `fk_comments_parent (parent_comment_id) → comments (id)` 로 그려지는데,
 * 지금 보고 있는 표가 `comments` 라는 사실은 저 위 제목에만 있어서 **화살표 오른쪽 이름과
 * 대조해야** 자기참조인 줄 안다(2026-08-19 사용자 제보). 다이어그램은 이미 SELF 루프로 한눈에
 * 보이는데 상세 목록만 안 보였다.
 *
 * 색은 다이어그램의 SELF 라벨과 같은 accent-2 계열이다 — 두 화면이 같은 것을 같은 색으로 말한다.
 * `from` 이 없으면 판정 근거가 없으므로 아무것도 안 그린다(잘못된 확신보다 침묵이 낫다).
 */
export function SelfRefChip({
  from,
  con,
  className
}: {
  /** 이 제약이 걸린 테이블. 스키마까지 봐야 동명 테이블과 안 헷갈린다. */
  from: TableRef | undefined
  con: Constraint
  className?: string
}) {
  if (!from || !isSelfRef(from, con)) return null
  return (
    <span
      title="제 테이블을 다시 가리키는 FK — 계층(부모-자식) 구조예요"
      className={cn(
        'inline-flex shrink-0 items-center rounded border border-accent-2/40 bg-accent-2-soft px-1.5 py-0.5 text-[10px] font-semibold leading-[1.5] text-accent-2',
        className
      )}
    >
      자기참조
    </span>
  )
}
