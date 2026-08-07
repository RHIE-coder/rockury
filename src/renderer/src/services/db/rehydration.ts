import { activeContext, useNav } from '@renderer/nav/useNav'
import { useProjectStore } from '@renderer/shell/projectStore'
import { useConnectionsStore } from './connections/store'
import { useDesignsStore } from './designs/store'
import { useEnvManageStore } from './environments/store'
import { useMigrationStore } from './migration/store'
import { useCollectionStore } from './remote/collection/store'
import { useQueryStore } from './remote/query/store'
import { useVersionsStore } from './versions/store'
import { toTableDef } from './workspaces/definition/designScope'
import { rehydrateDesignTables } from './workspaces/definition/store'
import { useSeedStore } from './workspaces/seed/store'

/**
 * 리하이드레이션 — 메인이 보내는 store:changed 를 받아 해당 스코프만 다시 읽는다
 * (spec ai-server tools.rehydration AC-2 · AC-4).
 *
 * 여기 도착한 변경은 전부 **이 창 밖에서 온 것**이다: 에이전트(MCP) 쓰기이거나, 다른 창이 한
 * 쓰기다. 이 창이 한 쓰기는 안 온다(AC-3) — 그건 낙관 반영으로 이미 화면에 있다.
 *
 * **아직 안 읽은 것은 안 읽는다.** 연결·설계에 딸려 열리는 목록(바인딩·라이브러리·기록 …)은
 * 그 창이 이미 들고 있는 열쇠로만 다시 읽는다 — 안 그러면 열어 보지도 않은 화면 때문에
 * 창마다 실 DB 조회가 줄줄이 나간다.
 */
window.rockury.store.onChanged((e) => {
  void (async () => {
    switch (e.domain) {
      case 'designs':
        await useDesignsStore.getState().init() // 목록 전체 재조회(설계 수는 작다)
        return
      case 'tables': {
        const recs = await window.rockury.tables.list()
        rehydrateDesignTables(
          e.designId,
          recs.filter((r) => r.designId === e.designId).map(toTableDef)
        )
        return
      }
      case 'versions':
        await useVersionsStore.getState().refresh(e.designId)
        return
      case 'seeds':
        // 시드는 설계 스코프로 저장되지만 스토어는 전부를 한 배열로 든다 — 통째로 다시 읽는다.
        await useSeedStore.getState().init()
        return
      case 'connections':
        // 접속·그룹은 한 덩이로 다시 읽는다 — 목록이 작고, 그룹 이동이 둘을 함께 바꾼다.
        await useConnectionsStore.getState().init()
        await useConnectionsStore.getState().loadSample()
        return
      case 'environments': {
        // 이 창이 이미 펼쳐 본 연결만 — 바인딩은 연결마다 따로 읽힌다.
        const env = useEnvManageStore.getState()
        for (const connectionId of Object.keys(env.byConnection)) await env.reload(connectionId)
        return
      }
      case 'projects': {
        await useProjectStore.getState().load()
        // 소속이 바뀌었을 수 있다 — 각 서비스 목록이 제 사본을 다시 읽게 신호를 올린다.
        useProjectStore.getState().markItemsChanged()
        return
      }
      case 'library': {
        // 저장쿼리 나무와 컬렉션은 한 스토어가 함께 든다 — 열어 둔 범위가 있을 때만.
        const lib = useCollectionStore.getState()
        if (lib.scope) await lib.load(lib.scope)
        return
      }
      case 'migrationLogs': {
        // 로그는 (연결×설계)로 읽힌다 — 스토어가 그 짝을 안 들고 있어 **지금 보는 대상**으로 읽는다
        // (화면이 뜰 때 쓰는 것과 같은 값이다). 둘 중 하나라도 안 골랐으면 읽을 것도 없다.
        const ctx = activeContext(useNav.getState())
        if (ctx['conn'] && ctx['design']) {
          await useMigrationStore.getState().loadLogs(ctx['conn'], ctx['design'])
        }
        return
      }
      case 'queryHistory': {
        const q = useQueryStore.getState()
        if (q.lastConn) await q.loadHistory(q.lastConn)
        return
      }
      case 'diagram':
        // 실 ERD 배치는 화면이 뜰 때 그 연결로 읽는다 — 여기서 미리 읽어 둘 자리가 없다.
        // (알림은 보낸다: 나중에 배치를 든 스토어가 생기면 여기에 붙인다.)
        return
    }
  })().catch((err) => console.error('[rehydration] 재조회 실패:', err))
})
