import { useEffect } from 'react'
import { useContextValue } from '@renderer/nav/useNav'
import { DRAFT_LENS, useVersionsStore } from './store'

/**
 * 활성 Design 이 바뀔 때 버전 쪽을 따라 맞춘다.
 * Version 은 설계↔운영 경계에 있는 공유 객체 — Design 은 렌즈(시점)를 읽어 draft/커밋본을 렌더한다.
 *
 * DB 서비스 오버레이에 항상 마운트되어:
 *  - 활성 설계의 버전을 로드하고
 *  - 설계 전환 시 렌즈를 Draft 로 되돌린다(다른 설계의 버전 번호를 이어보지 않도록).
 *
 * **화면 밖에서도 돌아야 한다** — 손잡이(VersionLens)는 Design 도구줄에만 있어서, 다른 모듈에
 * 있는 동안 설계를 바꾸면 손잡이가 마운트돼 있지 않다. 리셋을 손잡이에 넣으면 그때 새 설계에
 * 없는 버전 번호를 든 채 Design 으로 들어가게 된다.
 */
export function VersionSync(): null {
  const designId = useContextValue('design')
  const ensureLoaded = useVersionsStore((s) => s.ensureLoaded)

  useEffect(() => {
    if (designId) void ensureLoaded(designId)
    if (useVersionsStore.getState().lens !== DRAFT_LENS) {
      useVersionsStore.getState().setLens(DRAFT_LENS)
    }
  }, [designId, ensureLoaded])

  return null
}
