/**
 * 대조 — **정본은 `@shared/infra/reconcile/diff`** 다(메인도 같은 것을 부른다).
 * 여기는 화면 쪽 import 경로를 지키는 통과 지점이다. 근거는 `./types.ts` 주석에.
 *
 * 화면은 좌표·문서까지 달린 `DesignNode` 를 넘기고, 그 객체가 결과에 **그대로 실려 나온다**
 * (공용 쪽이 노드 타입을 열어 뒀다) — 그래서 `설명 없음` 판정을 이어서 볼 수 있다.
 */
export { reconcile, type DiffRow, type DriftField, type ReconcileInput } from '@shared/infra/reconcile/diff'
