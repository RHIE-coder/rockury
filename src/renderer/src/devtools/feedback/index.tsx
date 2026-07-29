import { FeedbackOverlay } from './FeedbackOverlay'
import { startConsoleTap } from './consoleTap'

/**
 * 개발용 화면 피드백 도구의 진입점 — 개발 서버에서만 뜬다.
 *
 * 왜 개발 서버에서만인가: 빌드된 앱은 e2e 스모크와 화면 품질 게이트(surface-verify)가
 * 순회하며 찍는 대상이다. 거기에 이 오버레이의 손잡이가 얹히면 기존 화면 기준선이
 * 흔들린다 — 도구 하나 때문에 검증 인프라를 흔들지 않는다.
 *
 * 콘솔 기록은 화면을 그리기 전부터 켜야 부팅 중 난 오류도 잡힌다 — 그래서 모듈이
 * 읽히는 시점(앱 부팅 시 import 사슬)에 건다.
 */
if (import.meta.env.DEV) startConsoleTap()

export function DevFeedback(): React.JSX.Element | null {
  // AppShell 쪽에도 같은 가드가 있다. 여기 한 겹 더 두는 것은, 이 컴포넌트를 다른 데서
  // 붙였을 때 배포본에 조용히 섞여 들어가지 않게 하기 위한 것.
  if (import.meta.env.PROD) return null
  return <FeedbackOverlay />
}
