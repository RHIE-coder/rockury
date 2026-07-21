import { useEffect } from 'react'
import { useNav } from '@renderer/nav/useNav'
import { useContextOptions } from '@renderer/nav/contextOptions'
import type { ContextOption } from '@renderer/nav/types'
import { useEnvironmentsStore } from './store'

/**
 * 컨텍스트 바 Env 셀렉터(운영 영역)의 옵션을 활성 Design 기준으로 동기화한다.
 * VersionSync 의 쌍둥이 — Env 는 운영부에서 "지금 어느 환경 기준으로 보는가"를 운반한다.
 *
 * DB 서비스 오버레이에 항상 마운트되어:
 *  - 활성 설계의 환경을 로드하고
 *  - Env 셀렉터 옵션(환경 카드들)을 갱신하며
 *  - 설계 전환 시 Env 선택을 비운다(다른 설계의 환경을 이어보지 않도록 · REAL 오조작 방지).
 */
export function EnvSync(): null {
  const designId = useNav((s) => s.contextValues['design'])
  const ensureLoaded = useEnvironmentsStore((s) => s.ensureLoaded)
  const environments = useEnvironmentsStore((s) => (designId ? s.byDesign[designId] : undefined))
  const setOptions = useContextOptions((s) => s.setOptions)

  useEffect(() => {
    if (designId) void ensureLoaded(designId)
    // 설계가 바뀌면 Env 선택을 비운다(IA: Env 는 명시적으로 고를 때까지 비어 있다).
    const cur = useNav.getState().contextValues['env']
    if (cur) useNav.getState().setContextValue('env', '')
  }, [designId, ensureLoaded])

  useEffect(() => {
    const opts: ContextOption[] = (environments ?? []).map((e) => ({
      id: e.id,
      label: e.name,
      hint: e.targetVersion || undefined,
      subtitle: e.dbType === 'sqlite' ? e.database : `${e.dbType} · ${e.database}@${e.host}`
    }))
    setOptions('env', opts)
  }, [environments, setOptions])

  return null
}
