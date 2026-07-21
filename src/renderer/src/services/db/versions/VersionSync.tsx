import { useEffect } from 'react'
import { useNav } from '@renderer/nav/useNav'
import { useContextOptions } from '@renderer/nav/contextOptions'
import type { ContextOption } from '@renderer/nav/types'
import { useVersionsStore } from './store'

/**
 * 컨텍스트 바 Version 렌즈(설계 영역)의 옵션을 활성 Design 기준으로 동기화한다.
 * Version 은 설계↔운영 경계에 있는 공유 객체 — Studio 는 이 포인터를 읽어 draft/커밋본을 렌더한다.
 *
 * DB 서비스 오버레이에 항상 마운트되어:
 *  - 활성 설계의 버전을 로드하고
 *  - Version 셀렉터 옵션(Draft + 커밋 버전들)을 갱신하며
 *  - 설계 전환 시 렌즈를 Draft 로 되돌린다(다른 설계의 버전을 이어보지 않도록).
 */
export function VersionSync(): null {
  const designId = useNav((s) => s.contextValues['design'])
  const ensureLoaded = useVersionsStore((s) => s.ensureLoaded)
  const versions = useVersionsStore((s) => (designId ? s.byDesign[designId] : undefined))
  const setOptions = useContextOptions((s) => s.setOptions)

  useEffect(() => {
    if (designId) void ensureLoaded(designId)
    // 설계가 바뀌면 렌즈는 Draft 로 리셋
    const v = useNav.getState().contextValues['version']
    if (v && v !== 'draft') useNav.getState().setContextValue('version', 'draft')
  }, [designId, ensureLoaded])

  useEffect(() => {
    const opts: ContextOption[] = [{ id: 'draft', label: 'Draft', hint: '편집 중' }]
    for (const v of versions ?? []) opts.push({ id: v.number, label: v.number, hint: v.note || undefined })
    setOptions('version', opts)
  }, [versions, setOptions])

  return null
}
