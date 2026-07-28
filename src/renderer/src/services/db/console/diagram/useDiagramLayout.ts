import { useCallback, useEffect, useRef, useState } from 'react'
import type { Viewport } from '@xyflow/react'
import type { Positions } from './layout'
import { nextGroupAnchor, nextGroupId, type DiagramGroup } from './group'

/** 그룹 저장 지연 — 이름표를 끄는 동안 매 프레임 IPC 를 때리지 않기 위한 것. */
const GROUP_SAVE_DELAY = 350

export interface DiagramLayoutApi {
  loaded: boolean
  storedPositions: Positions
  storedViewport: Viewport | null
  groups: DiagramGroup[]
  /** 캔버스가 위치·뷰포트를 저장할 때 부른다. */
  saveLayout: (patch: { positions?: Positions; viewport?: Viewport | null }) => void
  /** 그룹이 바뀔 때 부른다(지연 저장 — 화면을 떠나면 마저 저장한다). */
  setGroups: (next: DiagramGroup[]) => void
  createGroup: () => string
  deleteGroup: (id: string) => void
  patchGroup: (id: string, patch: Partial<DiagramGroup>) => void
  /** `자동 배치` — 배치만 지우고 그룹은 남긴다. */
  resetLayout: () => Promise<void>
  /** 저장본을 다시 읽는다 — 같은 스코프를 다른 화면(편집 모드)이 고쳤을 때. */
  reload: () => void
  /** 캔버스를 통째로 다시 태우기 위한 키(자동 배치·스코프 전환). */
  nonce: number
}

/**
 * ERD 배치·그룹의 로드/저장(세 캔버스 공용). 스코프 키는 Console = 연결 id, Studio = `design:<설계 id>`.
 * 정본: `docs/spec/db-console.md` §db-console.diagram.layout / .group.
 *
 * 저장은 **부분 갱신**이다 — 캔버스는 위치·뷰포트만, 패널은 그룹만 넘긴다.
 * 메인 저장소가 안 넘어온 항목을 그대로 두므로 서로의 저장을 지우지 않는다.
 */
export function useDiagramLayout(scopeKey: string | null, persist: boolean): DiagramLayoutApi {
  const [storedPositions, setStoredPositions] = useState<Positions>({})
  const [storedViewport, setStoredViewport] = useState<Viewport | null>(null)
  const [groups, setGroupsState] = useState<DiagramGroup[]>([])
  const [loaded, setLoaded] = useState(false)
  const [nonce, setNonce] = useState(0)

  /** 마지막으로 저장된 전체 위치 — 새 그룹 상자를 놓을 빈 자리를 고르는 데 쓴다. */
  const positionsRef = useRef<Positions>({})
  const groupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingGroups = useRef<DiagramGroup[] | null>(null)
  const scopeRef = useRef(scopeKey)
  scopeRef.current = scopeKey
  const persistRef = useRef(persist)
  persistRef.current = persist

  useEffect(() => {
    if (!scopeKey) return
    let alive = true
    setLoaded(false)
    void window.rockury.diagram
      .getLayout(scopeKey)
      .then((l) => {
        if (!alive) return
        setStoredPositions(l?.positions ?? {})
        setStoredViewport(l?.viewport ?? null)
        setGroupsState(l?.groups ?? [])
        positionsRef.current = l?.positions ?? {}
        setLoaded(true)
      })
      .catch(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [scopeKey, nonce])

  const flushGroups = useCallback(() => {
    const next = pendingGroups.current
    pendingGroups.current = null
    const scope = scopeRef.current
    if (!next || !scope || !persistRef.current) return
    void window.rockury.diagram.saveLayout({ connectionId: scope, groups: next }).catch(() => {})
  }, [])

  // 떠날 때 대기 중이던 그룹 저장을 마저 보낸다 — 취소만 하면 마지막 변경이 날아간다.
  useEffect(() => {
    return () => {
      if (groupTimer.current) {
        clearTimeout(groupTimer.current)
        groupTimer.current = null
        flushGroups()
      }
    }
  }, [flushGroups])

  const setGroups = useCallback(
    (next: DiagramGroup[]) => {
      setGroupsState(next)
      if (!persistRef.current || !scopeRef.current) return
      pendingGroups.current = next
      if (groupTimer.current) clearTimeout(groupTimer.current)
      groupTimer.current = setTimeout(() => {
        groupTimer.current = null
        flushGroups()
      }, GROUP_SAVE_DELAY)
    },
    [flushGroups]
  )

  const saveLayout = useCallback((patch: { positions?: Positions; viewport?: Viewport | null }) => {
    const scope = scopeRef.current
    if (!scope || !persistRef.current) return
    if (patch.positions) positionsRef.current = patch.positions
    void window.rockury.diagram.saveLayout({ connectionId: scope, ...patch }).catch(() => {})
  }, [])

  const createGroup = useCallback((): string => {
    const id = nextGroupId(groups)
    // 이름은 **id 순번**을 따른다 — 목록 길이로 지으면 하나 지운 뒤 만들 때 이름이 겹친다.
    const anchor = nextGroupAnchor(positionsRef.current, groups)
    setGroups([
      ...groups,
      { id, name: `그룹 ${id.replace(/^g/, '')}`, color: '', tableIds: [], collapsed: false, ...anchor }
    ])
    return id
  }, [groups, setGroups])

  const deleteGroup = useCallback(
    (id: string) => {
      // 그룹만 푼다 — 테이블은 그대로 캔버스에 남는다(정본 §group-panel AC-2).
      setGroups(groups.filter((g) => g.id !== id))
    },
    [groups, setGroups]
  )

  const patchGroup = useCallback(
    (id: string, patch: Partial<DiagramGroup>) => {
      setGroups(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)))
    },
    [groups, setGroups]
  )

  const resetLayout = useCallback(async () => {
    if (!scopeKey) return
    // ⚠ 되돌리기 전에 **대기 중인 그룹 저장을 먼저 보낸다.** 자동 배치는 저장본을 다시 읽어
    //   화면 상태를 덮으므로, 방금 만든 그룹이 아직 저장 전이면 그 그룹이 조용히 사라진다(실측).
    if (groupTimer.current) {
      clearTimeout(groupTimer.current)
      groupTimer.current = null
      flushGroups()
    }
    await window.rockury.diagram.clearLayout(scopeKey).catch(() => {})
    setStoredPositions({})
    setStoredViewport(null)
    positionsRef.current = {}
    setNonce((x) => x + 1)
  }, [scopeKey, flushGroups])

  const reload = useCallback(() => setNonce((x) => x + 1), [])

  return {
    loaded,
    storedPositions,
    storedViewport,
    groups,
    saveLayout,
    setGroups,
    createGroup,
    deleteGroup,
    patchGroup,
    resetLayout,
    reload,
    nonce
  }
}
