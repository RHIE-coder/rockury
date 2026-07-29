import type { FeedbackLocation } from '@shared/devFeedback'
import { useActive, useNav } from '../../nav/useNav'
import { useContextOptions } from '../../nav/contextOptions'

/**
 * 지금 보고 있는 화면을 피드백에 실을 형태로 읽는다 (개발 전용).
 *
 * Rockury 는 주소창이 없으므로 nav 경로가 "어느 화면인가"의 유일한 이름이다.
 * 컨텍스트 바 선택값(Design·Env)까지 같이 담는 이유: 같은 화면이라도 무엇을 고르고
 * 있었느냐에 따라 보이는 것이 달라져, 그것 없이는 재현이 안 되는 제보가 생긴다.
 */
export function useFeedbackLocation(): FeedbackLocation {
  const { service, module, view } = useActive()
  const values = useNav((s) => s.contextValues)
  const runtimeOptions = useContextOptions((s) => s.options)

  const parts = [service.id, module.id, ...(view ? [view.id] : [])]
  const labels = [service.label, module.label, ...(view ? [view.label] : [])]

  const context = (service.context ?? []).map((sel) => {
    const options = runtimeOptions[sel.id] ?? sel.options
    const selectedId = values[sel.id] ?? sel.defaultOptionId
    return { label: sel.label, value: options.find((o) => o.id === selectedId)?.label ?? '' }
  })

  return { route: `/${parts.join('/')}`, label: labels.join(' › '), context }
}
