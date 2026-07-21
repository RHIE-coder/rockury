import { create } from 'zustand'
import type { ContextOption } from './types'

/**
 * 런타임 컨텍스트 옵션 레지스트리.
 *
 * 셀렉터 옵션이 정적 config 가 아니라 런타임 데이터일 때(예: DB 의 Design 목록),
 * 서비스 스토어가 여기로 옵션을 밀어 넣고 ContextBar 가 정적 옵션 대신 읽는다.
 * nav 골격(useNav → registry → 서비스 config)과 서비스 데이터 스토어 사이의
 * 순환 의존을 피하기 위해 독립 모듈로 둔다.
 */
interface ContextOptionsState {
  /** selectorId → 런타임 옵션. 등록된 셀렉터는 config 의 정적 options 를 대체한다. */
  options: Record<string, ContextOption[]>
  setOptions: (selectorId: string, options: ContextOption[]) => void
}

export const useContextOptions = create<ContextOptionsState>()((set) => ({
  options: {},
  setOptions: (selectorId, options) =>
    set((s) => ({ options: { ...s.options, [selectorId]: options } }))
}))
