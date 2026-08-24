import { useCallback, useEffect, useRef, useState } from 'react'
import type { Viewport } from '@xyflow/react'
import type { Positions } from './layout'
import { withInheritedLayout, type InheritedLayout, type LayoutPatch } from './inherit'
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
  /**
   * 새 그룹을 만들고 id 를 준다. 상자는 **지금 보고 있는 한가운데**에 놓는다
   * (`setViewCenterProbe` 로 캔버스가 알려 준 자리). 아무도 안 알려 줬으면 기존 내용 오른쪽 빈 자리.
   */
  createGroup: () => string
  /**
   * 캔버스가 "지금 화면 한가운데의 캔버스 좌표"를 알려 주는 통로.
   * 상단 도구줄의 `그룹` 버튼은 `ReactFlowProvider` **밖**에 있어 뷰포트를 직접 볼 수 없다 —
   * 어디서 만들든 같은 자리에 생기도록 캔버스가 이 통로에 물어보는 함수를 걸어 둔다.
   */
  setViewCenterProbe: (probe: (() => { x: number; y: number } | null) | null) => void
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
 * ERD 배치·그룹의 로드/저장(세 캔버스 공용). 스코프 키는 Remote = 연결 id,
 * Design = `design:<설계 id>`(Draft) · `design:<설계 id>@<버전 번호>`(커밋 버전).
 *
 * 저장은 **부분 갱신**이다 — 캔버스는 위치·뷰포트만, 패널은 그룹만 넘긴다.
 * 메인 저장소가 안 넘어온 항목을 그대로 두므로 서로의 저장을 지우지 않는다.
 *
 * `fallbackScopeKey` 를 주면 **자기 기록이 없는 동안 그 스코프의 배치를 물려받아** 보여 준다
 * (커밋 버전 → Draft). 처음 손대는 순간 물려받은 한 벌을 통째로 자기 키에 적고 갈라선다 —
 * 그 뒤로 Draft 를 아무리 고쳐도 이 버전의 그림은 그대로다.
 *
 * ⚠ 저장 함수는 `scopeKey` 를 **인자로 묶는다**(ref 로 읽지 않는다). 렌즈를 바꾸는 순간
 *   대기 중이던 저장이 flush 되는데, ref 로 읽으면 그 값이 이미 **새 키**라 옛 화면의 배치가
 *   새 버전 키에 적힌다.
 */
export function useDiagramLayout(scopeKey: string | null, fallbackScopeKey: string | null = null): DiagramLayoutApi {
  const [storedPositions, setStoredPositions] = useState<Positions>({})
  const [storedViewport, setStoredViewport] = useState<Viewport | null>(null)
  const [groups, setGroupsState] = useState<DiagramGroup[]>([])
  const [loaded, setLoaded] = useState(false)
  const [nonce, setNonce] = useState(0)

  /** 마지막으로 저장된 전체 위치 — 새 그룹 상자를 놓을 빈 자리를 고르는 데 쓴다. */
  const positionsRef = useRef<Positions>({})
  /** 캔버스가 걸어 두는 "지금 어디를 보고 있나" 물음. 캔버스가 없으면 비어 있다. */
  const viewCenterProbe = useRef<(() => { x: number; y: number } | null) | null>(null)
  const groupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingGroups = useRef<DiagramGroup[] | null>(null)
  /** 윗대에서 물려받아 화면에 깔린 배치 — 자기 행을 만드는 첫 저장에 통째로 실린다. */
  const inheritedRef = useRef<InheritedLayout | null>(null)

  useEffect(() => {
    if (!scopeKey) return
    let alive = true
    setLoaded(false)
    void (async () => {
      const own = await window.rockury.diagram.getLayout(scopeKey).catch(() => null)
      const rec = own ?? (fallbackScopeKey ? await window.rockury.diagram.getLayout(fallbackScopeKey).catch(() => null) : null)
      if (!alive) return
      const positions = rec?.positions ?? {}
      const viewport = rec?.viewport ?? null
      const nextGroups = rec?.groups ?? []
      setStoredPositions(positions)
      setStoredViewport(viewport)
      setGroupsState(nextGroups)
      positionsRef.current = positions
      // 자기 행이 없어 윗대 것을 빌려 왔을 때만 물려받은 상태다.
      inheritedRef.current = !own && rec ? { positions, viewport, groups: nextGroups } : null
      setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [scopeKey, fallbackScopeKey, nonce])

  /** 저장 한 통로 — 물려받은 상태면 안 넘어온 항목을 채워 자기 행을 통째로 만든다. */
  const write = useCallback(
    (patch: LayoutPatch): Promise<unknown> => {
      if (!scopeKey) return Promise.resolve()
      const full = withInheritedLayout(inheritedRef.current, patch)
      // 곧바로 비운다 — 뒤이어 오는 부분 저장(예: 그룹만)이 물려받은 위치를 다시 실어
      // 방금 옮긴 자리를 되돌리면 안 된다. 이 저장으로 자기 행이 생기므로 그 뒤는 부분 갱신이 맞다.
      inheritedRef.current = null
      return window.rockury.diagram.saveLayout({ connectionId: scopeKey, ...full }).catch(() => {})
    },
    [scopeKey]
  )

  const flushGroups = useCallback(() => {
    const next = pendingGroups.current
    pendingGroups.current = null
    if (!next) return
    void write({ groups: next })
  }, [write])

  // 떠날 때(스코프가 바뀔 때 포함) 대기 중이던 그룹 저장을 마저 보낸다 —
  // 취소만 하면 마지막 변경이 날아간다. `write` 가 옛 스코프에 묶여 있어 옛 키로 간다.
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
      if (!scopeKey) return
      pendingGroups.current = next
      if (groupTimer.current) clearTimeout(groupTimer.current)
      groupTimer.current = setTimeout(() => {
        groupTimer.current = null
        flushGroups()
      }, GROUP_SAVE_DELAY)
    },
    [scopeKey, flushGroups]
  )

  const saveLayout = useCallback(
    (patch: { positions?: Positions; viewport?: Viewport | null }) => {
      if (patch.positions) positionsRef.current = patch.positions
      void write(patch)
    },
    [write]
  )

  const createGroup = useCallback((): string => {
    const id = nextGroupId(groups)
    // 이름은 **id 순번**을 따른다 — 목록 길이로 지으면 하나 지운 뒤 만들 때 이름이 겹친다.
    // 자리는 지금 보고 있는 한가운데 — 안 보이는 곳에 만들면 끌어다 놓을 수가 없다.
    const anchor = nextGroupAnchor(positionsRef.current, groups, viewCenterProbe.current?.() ?? undefined)
    setGroups([
      ...groups,
      { id, name: `그룹 ${id.replace(/^g/, '')}`, color: '', tableIds: [], collapsed: false, ...anchor }
    ])
    return id
  }, [groups, setGroups])

  const setViewCenterProbe = useCallback(
    (probe: (() => { x: number; y: number } | null) | null) => {
      viewCenterProbe.current = probe
    },
    []
  )

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
    if (fallbackScopeKey) {
      // 물려받는 스코프에서는 행을 **지우면 안 된다** — 지우는 순간 다시 윗대(Draft) 배치를
      // 물려받아 자동 배치가 없던 일이 된다. 빈 배치를 명시로 적어 자기 행을 세운다.
      await write({ positions: {}, viewport: null, groups })
    } else {
      await window.rockury.diagram.clearLayout(scopeKey).catch(() => {})
    }
    setStoredPositions({})
    setStoredViewport(null)
    positionsRef.current = {}
    setNonce((x) => x + 1)
  }, [scopeKey, fallbackScopeKey, groups, write, flushGroups])

  const reload = useCallback(() => setNonce((x) => x + 1), [])

  return {
    loaded,
    storedPositions,
    storedViewport,
    groups,
    saveLayout,
    setGroups,
    createGroup,
    setViewCenterProbe,
    deleteGroup,
    patchGroup,
    resetLayout,
    reload,
    nonce
  }
}
