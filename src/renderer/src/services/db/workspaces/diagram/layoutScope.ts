import { isReadOnlyLens } from '../../versions/store'

/**
 * Design › Diagram 의 **배치 저장 키**(위치·화면·그룹).
 *
 * Draft 와 커밋 버전을 갈라 둔다 — 지나간 버전의 그림을 손봤다고 작업본(Draft)의 그림까지
 * 바뀌면 안 되기 때문이다. 대신 그림은 정본(스냅샷)이 아니라 보기용이라, 스키마가 잠긴
 * 버전에서도 **배치는 바꿀 수 있다**(운영부 ERD 도 `editable=false` + 배치 저장으로 같다).
 *
 *   Draft        → `design:<설계 id>`
 *   버전 1.0.0   → `design:<설계 id>@1.0.0`
 */
export function designLayoutScope(designId: string | null | undefined, lens: string): string | null {
  if (!designId) return null
  return isReadOnlyLens(lens) ? `design:${designId}@${lens}` : `design:${designId}`
}

/**
 * 버전 키에 아직 자기 기록이 없을 때 **물려받을** 키 — Draft 것.
 * 없으면 방금 컷한 버전을 여는 순간 그림이 dagre 자동 배치로 튀어, 보던 모습과 딴판이 된다.
 * Draft 렌즈에는 물려받을 윗대가 없다(자기가 뿌리).
 */
export function designLayoutFallbackScope(
  designId: string | null | undefined,
  lens: string
): string | null {
  if (!designId || !isReadOnlyLens(lens)) return null
  return `design:${designId}`
}
