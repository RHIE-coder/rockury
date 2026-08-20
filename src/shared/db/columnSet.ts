/**
 * 컬럼 묶음 — 여러 표에 되풀이해 넣는 컬럼 세트(`created_at`·`updated_at` 같은 것)의
 * **공용 모양과 정제 규칙**. 메인(저장소)·preload·렌더러가 함께 쓴다.
 *
 * 규칙이 두 벌이면 한쪽만 고쳐진다 — `shared/db/tableRef` 를 공용으로 올린 것과 같은 이유다.
 */

/** 묶음에 담기는 컬럼 한 줄 — 화면 `Column` 에서 **id 와 drift 를 뺀 것**. */
export interface ColumnSetColumn {
  name: string
  type: string
  nullable: boolean
  defaultValue: string | null
  comment: string
}

export interface ColumnSetRecord {
  id: string
  name: string
  columns: ColumnSetColumn[]
  createdAt: string
  updatedAt: string
}

/**
 * 저장 전 정제 — 이름 없는 줄은 버리고, **모르는 필드는 안 담는다.**
 *
 * 후자가 중요하다: 화면 `Column` 을 그대로 넘기면 `id`·`drift` 까지 저장된다. id 는 넣을 때
 * 대상마다 새로 발급하므로 담아 둔 값이 뜻이 없고, 남아 있으면 언젠가 그걸 그대로 쓰는 코드가
 * 생겨 **같은 id 가 두 표에** 들어간다. drift 는 "운영에서 흡수됐다"는 표식이라 복제본에 붙으면
 * 거짓말이 된다.
 */
export function sanitizeColumnSet(columns: readonly ColumnSetColumn[]): ColumnSetColumn[] {
  return columns
    .filter((c) => typeof c?.name === 'string' && c.name.trim() !== '')
    .map((c) => ({
      name: c.name.trim(),
      type: typeof c.type === 'string' ? c.type : '',
      nullable: c.nullable !== false,
      defaultValue: c.defaultValue ?? null,
      comment: typeof c.comment === 'string' ? c.comment : ''
    }))
}
