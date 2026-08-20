/**
 * 대조에 오가는 것들 — **정본은 공용 자리(`@shared/infra/types`)에 있다.**
 *
 * 왜 옮겼나: 대조 계산이 렌더러에만 있으면 메인이 그걸 못 부르고, 그러면 MCP 로 대조 결과를
 * 내보낼 수 없다. 억지로 열려면 메인에
 * 같은 규칙을 한 벌 더 쓰게 되는데, 그건 **두 곳이 서로 다른 답을 말하게 되는** 사고다.
 *
 * 이 파일은 화면 쪽 import 경로를 지키기 위한 통과 지점이다 —
 * 규칙을 옮겼다고 화면 코드 수십 곳을 한꺼번에 고칠 이유는 없다.
 */
export {
  BASIS_LABEL,
  STATUS_LABEL,
  VERDICT_LABEL,
  type CompareField,
  type LiveResource,
  type MatchBasis,
  type NodeStatus,
  type ReconNode,
  type ReconType,
  type Verdict
} from '@shared/infra/types'
