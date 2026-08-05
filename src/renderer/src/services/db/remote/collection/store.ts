import { create } from 'zustand'
import type { LibNode } from './tree'
import type { QueryResult } from '../query/store'
import { allReadOnly, classifyStatement } from '../query/classify'

/** 구조적 레코드 타입(main 과 동일 형태). */
interface Folder { id: string; connectionId: string; designId: string; parentId: string | null; name: string; sortOrder: number }
interface SavedQuery { id: string; connectionId: string; designId: string; folderId: string | null; name: string; description: string; sql: string; sortOrder: number }
interface CollFolder { id: string; connectionId: string; designId: string; parentId: string | null; name: string; sortOrder: number }
interface Collection { id: string; connectionId: string; designId: string; folderId: string | null; name: string; description: string; sortOrder: number }
interface Item { id: string; collectionId: string; savedQueryId: string | null; name: string; sql: string; sortOrder: number }

/**
 * 라이브러리를 **어느 소속으로 볼 것인가**(main 과 동일 형태 · `@shared/db/libraryOwner`).
 * 설계 화면은 `designId`, 운영 화면은 `connectionId` 를 준다 — 연결로 주면 그 연결에 물린
 * 설계 것까지 함께 온다. 그래서 같은 설계를 쓰는 DEV·STG·PROD 가 한 벌을 같이 본다.
 */
export interface LibraryScope {
  connectionId?: string | null
  designId?: string | null
}

export type ItemStatus = 'pending' | 'running' | 'ok' | 'error' | 'skipped'

/**
 * Collection 렌더러 스토어(§ops 향상). 저장쿼리 트리 + 컬렉션 + Run-All 러너.
 * 러너는 2c 트랜잭션 게이트 재사용 — 한 트랜잭션에 아이템을 순차 실행하고 최종 커밋/롤백.
 */
interface CollectionState {
  /** 지금 보고 있는 라이브러리의 소속. 목록·만들기가 전부 이걸 기준으로 돈다. */
  scope: LibraryScope | null
  /** 실행 대상 연결 — 라이브러리 소속과 **다르다**. 설계 화면엔 없어서 실행이 안 된다. */
  connectionId: string | null
  /** 지금 보는 라이브러리를 가진 설계. 연결 소속이면 null(그 연결만의 것). */
  libraryDesignId: string | null
  folders: Folder[]
  queries: SavedQuery[]
  collectionFolders: CollFolder[]
  collections: Collection[]
  activeCollectionId: string | null
  items: Item[]

  running: boolean
  aborting: boolean
  itemStatus: Record<string, ItemStatus>
  /** SELECT 아이템의 결과(인라인 펼침용). 아이템 id → 결과. */
  results: Record<string, QueryResult>
  tx: { txId: string; affected: number } | null
  error: string | null
  /** 읽기 전용 실행처럼 커밋이 필요 없을 때 보여줄 안내(다음 실행/선택 시 사라짐). */
  info: string | null

  load: (scope: LibraryScope) => Promise<void>
  selectCollection: (id: string) => Promise<void>

  addFolder: (name: string, parentId?: string | null) => Promise<void>
  addQuery: (name: string, sql: string, folderId?: string | null) => Promise<void>
  rename: (kind: 'folder' | 'query', id: string, name: string) => Promise<void>
  remove: (kind: 'folder' | 'query', id: string) => Promise<void>
  applyReorder: (flat: { id: string; kind: 'folder' | 'query'; parentId: string | null }[]) => Promise<void>

  addCollection: (name: string, folderId?: string | null) => Promise<void>
  renameCollection: (id: string, name: string) => Promise<void>
  updateCollection: (id: string, patch: { name?: string; description?: string }) => Promise<void>
  removeCollection: (id: string) => Promise<void>
  addCollectionFolder: (name: string, parentId?: string | null) => Promise<void>
  renameCollectionFolder: (id: string, name: string) => Promise<void>
  removeCollectionFolder: (id: string) => Promise<void>
  applyCollectionReorder: (flat: { id: string; kind: 'folder' | 'collection'; parentId: string | null }[]) => Promise<void>
  addItem: (name: string, sql: string) => Promise<void>
  addReference: (savedQueryId: string) => Promise<void>
  updateItem: (id: string, patch: { name?: string; sql?: string }) => Promise<void>
  removeItem: (id: string) => Promise<void>
  reorderItems: (orderedIds: string[]) => Promise<void>

  runAll: () => Promise<void>
  /** 아이템 하나만 실행 — 열린 트랜잭션에 이어 붙인다(개별 커밋 안 함 → 원자성 유지). */
  runOne: (itemId: string) => Promise<void>
  abort: () => Promise<void>
  retry: () => Promise<void>
  confirm: () => Promise<void>
  rollback: () => Promise<void>
  dismissError: () => void
}

/** 활성 컬렉션의 (id, 이름). 이름은 삭제·개명돼도 로그에 남게 실행 시점 값을 박아 둔다. */
function activeCollId(collections: Collection[], activeId: string | null): { id: string | null; name: string | null } {
  const c = collections.find((x) => x.id === activeId)
  return { id: c?.id ?? activeId, name: c?.name ?? null }
}

/**
 * 성공(ok)한 아이템을 History 에 적재(source=collection). 한 번의 실행 배치는 같은 runId 로 묶고,
 * 각 행에 컬렉션 이름과 **컬렉션 내 순번(seq = 목록에서의 위치)** 을 박아 아코디언 그룹으로 볼 수 있게 한다.
 */
async function logCollectionHistory(
  connectionId: string,
  coll: { id: string | null; name: string | null },
  runId: string,
  items: Item[],
  itemStatus: Record<string, ItemStatus>,
  results: Record<string, QueryResult>
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (itemStatus[it.id] !== 'ok') continue
    const r = results[it.id]
    try {
      await window.rockury.query.historyAppend({
        connectionId,
        source: 'collection',
        sql: it.sql,
        kind: classifyStatement(it.sql).kind,
        status: 'success',
        rowCount: r?.rowCount,
        affectedRows: r?.affectedRows ?? null,
        execMs: r?.executionTimeMs ?? null,
        collectionId: coll.id,
        collectionName: coll.name,
        runId,
        seq: i + 1
      })
    } catch {
      // 히스토리 실패는 실행에 영향 없음 — 무시.
    }
  }
}

/** 트리 소스(folders+queries) → LibNode[] (tree 유틸 입력). */
export function toLibNodes(folders: Folder[], queries: SavedQuery[]): LibNode[] {
  return [
    ...folders.map((f) => ({ id: f.id, parentId: f.parentId, kind: 'folder' as const, name: f.name, sortOrder: f.sortOrder })),
    ...queries.map((q) => ({ id: q.id, parentId: q.folderId, kind: 'query' as const, name: q.name, sql: q.sql, sortOrder: q.sortOrder }))
  ]
}

/** 컬렉션 트리 소스(collectionFolders+collections) → LibNode[]. 컬렉션은 리프('query' 로 매핑해 tree 유틸 재사용). */
export function toCollLibNodes(folders: CollFolder[], collections: Collection[]): LibNode[] {
  return [
    ...folders.map((f) => ({ id: f.id, parentId: f.parentId, kind: 'folder' as const, name: f.name, sortOrder: f.sortOrder })),
    ...collections.map((c) => ({ id: c.id, parentId: c.folderId, kind: 'query' as const, name: c.name, sortOrder: c.sortOrder }))
  ]
}

export const useCollectionStore = create<CollectionState>()((set, get) => ({
  scope: null,
  connectionId: null,
  libraryDesignId: null,
  folders: [],
  queries: [],
  collectionFolders: [],
  collections: [],
  activeCollectionId: null,
  items: [],
  running: false,
  aborting: false,
  itemStatus: {},
  results: {},
  tx: null,
  error: null,
  info: null,

  load: async (scope) => {
    try {
      // 연결로 볼 때는 **어느 설계 것을 보고 있는지**도 같이 알아 둔다 — 운영 화면엔 설계
      // 손잡이가 안 뜨므로, 이 값이 없으면 "이게 형제 연결과 공유되는 한 벌인지"를 알 길이 없다.
      const bound =
        scope.connectionId && !scope.designId
          ? [...new Set((await window.rockury.environments.listByConnection(scope.connectionId)).map((b) => b.designId))]
          : []
      const [tree, collections, collectionFolders] = await Promise.all([
        window.rockury.savedQueries.tree(scope),
        window.rockury.collections.list(scope),
        window.rockury.collections.folders(scope)
      ])
      set({
        scope,
        // 설계 화면(연결 없음)에서는 비워 둔다 — 실행 버튼이 살아 있으면 안 된다.
        connectionId: scope.connectionId ?? null,
        // 물린 설계가 둘 이상이면 만들 자리를 못 고른다(= 연결 소속) → 표시도 안 한다.
        libraryDesignId: scope.designId ?? (bound.length === 1 ? bound[0] : null),
        folders: tree.folders,
        queries: tree.queries,
        collections,
        collectionFolders
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  selectCollection: async (id) => {
    set({ activeCollectionId: id, tx: null, itemStatus: {}, results: {}, info: null })
    const items = await window.rockury.collections.items(id)
    set({ items })
  },

  // 아래 라이브러리 조작은 전부 **소속(scope)** 을 기준으로 돈다 — 연결이 아니다.
  // 설계 소속이면 형제 연결(DEV·STG·PROD)에서 만든 것도 같은 목록에 들어온다.
  addFolder: async (name, parentId = null) => {
    const sc = get().scope
    if (!sc) return
    await window.rockury.savedQueries.createFolder({ scope: sc, parentId, name })
    await get().load(sc)
  },
  addQuery: async (name, sql, folderId = null) => {
    const sc = get().scope
    if (!sc) return
    await window.rockury.savedQueries.createQuery({ scope: sc, folderId, name, sql })
    await get().load(sc)
  },
  rename: async (kind, id, name) => {
    if (kind === 'folder') await window.rockury.savedQueries.renameFolder(id, name)
    else await window.rockury.savedQueries.updateQuery(id, { name })
    const sc = get().scope
    if (sc) await get().load(sc)
  },
  remove: async (kind, id) => {
    try {
      if (kind === 'folder') await window.rockury.savedQueries.deleteFolder(id)
      else await window.rockury.savedQueries.deleteQuery(id) // 컬렉션이 참조 중이면 main 이 거부(throw).
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return
    }
    const sc = get().scope
    if (sc) await get().load(sc)
  },
  applyReorder: async (flat) => {
    await window.rockury.savedQueries.reorderTree(flat.map((f, i) => ({ ...f, sortOrder: i })))
    const sc = get().scope
    if (sc) await get().load(sc)
  },

  addCollection: async (name, folderId = null) => {
    const sc = get().scope
    if (!sc) return
    const col = await window.rockury.collections.create({ scope: sc, name, folderId })
    await get().load(sc)
    await get().selectCollection(col.id)
  },
  addCollectionFolder: async (name, parentId = null) => {
    const sc = get().scope
    if (!sc) return
    await window.rockury.collections.createFolder({ scope: sc, parentId, name })
    await get().load(sc)
  },
  renameCollectionFolder: async (id, name) => {
    await window.rockury.collections.renameFolder(id, name)
    const sc = get().scope
    if (sc) await get().load(sc)
  },
  removeCollectionFolder: async (id) => {
    await window.rockury.collections.deleteFolder(id)
    const sc = get().scope
    if (sc) await get().load(sc)
  },
  applyCollectionReorder: async (flat) => {
    await window.rockury.collections.reorderTree(flat.map((f, i) => ({ ...f, sortOrder: i })))
    const sc = get().scope
    if (sc) await get().load(sc)
  },
  renameCollection: async (id, name) => {
    await window.rockury.collections.rename(id, name)
    const sc = get().scope
    if (sc) await get().load(sc)
  },
  updateCollection: async (id, patch) => {
    await window.rockury.collections.update(id, patch)
    const sc = get().scope
    if (sc) await get().load(sc)
  },
  removeCollection: async (id) => {
    await window.rockury.collections.delete(id)
    const sc = get().scope
    set({ activeCollectionId: null, items: [] })
    if (sc) await get().load(sc)
  },
  addItem: async (name, sql) => {
    const colId = get().activeCollectionId
    if (!colId) return
    await window.rockury.collections.addItem({ collectionId: colId, name, sql })
    await get().selectCollection(colId)
  },
  addReference: async (savedQueryId) => {
    const colId = get().activeCollectionId
    if (!colId) return
    await window.rockury.collections.addReference({ collectionId: colId, savedQueryId })
    await get().selectCollection(colId)
  },
  updateItem: async (id, patch) => {
    await window.rockury.collections.updateItem(id, patch)
    const colId = get().activeCollectionId
    if (colId) await get().selectCollection(colId)
  },
  removeItem: async (id) => {
    await window.rockury.collections.deleteItem(id)
    const colId = get().activeCollectionId
    if (colId) await get().selectCollection(colId)
  },
  reorderItems: async (orderedIds) => {
    // 낙관적 반영 후 영속.
    set((s) => {
      const byId = new Map(s.items.map((i) => [i.id, i]))
      return { items: orderedIds.map((id) => byId.get(id)).filter((i): i is Item => !!i) }
    })
    await window.rockury.collections.reorderItems(orderedIds)
  },

  runAll: async () => {
    const { connectionId, items } = get()
    if (!connectionId || items.length === 0) return
    set({ running: true, aborting: false, error: null, itemStatus: {}, results: {}, tx: null, info: null })
    // 전부 조회(read)면 커밋이 필요 없다 — 실행 후 트랜잭션을 조용히 닫고 결과만 보인다.
    const readOnly = allReadOnly(items.map((i) => i.sql))
    try {
      const { txId } = await window.rockury.query.txBegin(connectionId)
      let affected = 0
      for (const item of items) {
        // 중단 요청 시 남은 아이템 skip + 세션 롤백.
        if (get().aborting) {
          set((s) => {
            const status = { ...s.itemStatus }
            const idx = items.findIndex((x) => x.id === item.id)
            for (const later of items.slice(idx)) if (!status[later.id] || status[later.id] === 'pending') status[later.id] = 'skipped'
            return { itemStatus: status }
          })
          try { await window.rockury.query.txRollback(txId) } catch { /* 이미 정리됨 */ }
          set({ running: false, aborting: false, tx: null, error: '실행을 중단하고 롤백했습니다.' })
          return
        }
        set((s) => ({ itemStatus: { ...s.itemStatus, [item.id]: 'running' } }))
        try {
          const r = await window.rockury.query.txExec(txId, item.sql)
          affected += r.affectedRows ?? 0
          // SELECT 결과는 모달로 볼 수 있게 보관.
          if (classifyStatement(item.sql).kind === 'read' && r.columns.length > 0) {
            set((s) => ({ results: { ...s.results, [item.id]: r } }))
          }
          set((s) => ({ itemStatus: { ...s.itemStatus, [item.id]: 'ok' } }))
        } catch (e) {
          // 실패 → 이 아이템 error, 나머지 skipped, 세션은 main 이 롤백/정리.
          set((s) => {
            const status = { ...s.itemStatus, [item.id]: 'error' as ItemStatus }
            const idx = items.findIndex((x) => x.id === item.id)
            for (const later of items.slice(idx + 1)) status[later.id] = 'skipped'
            return { itemStatus: status, error: e instanceof Error ? e.message : String(e), running: false, aborting: false, tx: null }
          })
          return
        }
      }
      if (readOnly) {
        // 읽기 전용 — 커밋 강요하지 않는다. 트랜잭션을 닫고(no-op) 실행을 즉시 히스토리에 적재.
        try { await window.rockury.query.txCommit(txId) } catch { /* 읽기라 사실상 no-op */ }
        await logCollectionHistory(connectionId, activeCollId(get().collections, get().activeCollectionId), crypto.randomUUID(), items, get().itemStatus, get().results)
        set({ running: false, tx: null, info: `조회 완료 · ${items.length}개 쿼리 · 커밋 불필요 (읽기 전용)` })
      } else {
        set({ tx: { txId, affected }, running: false })
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), running: false, aborting: false, tx: null })
    }
  },

  runOne: async (itemId) => {
    const { connectionId, items, tx, running } = get()
    if (!connectionId || running) return
    const item = items.find((i) => i.id === itemId)
    if (!item) return
    set({ running: true, error: null, info: null })
    // 열린 트랜잭션(쓰기 대기)이 없고 이 아이템이 조회면 커밋을 요구하지 않는다(단독 읽기).
    const standaloneRead = !tx && classifyStatement(item.sql).kind === 'read'
    try {
      // 열린 트랜잭션이 있으면 그 위에 이어 붙이고, 없으면 새로 연다 → 하나씩 실행해도 한 덩어리.
      let txId = tx?.txId
      let affected = tx?.affected ?? 0
      if (!txId) txId = (await window.rockury.query.txBegin(connectionId)).txId
      set((s) => ({ itemStatus: { ...s.itemStatus, [itemId]: 'running' } }))
      try {
        const r = await window.rockury.query.txExec(txId, item.sql)
        affected += r.affectedRows ?? 0
        if (classifyStatement(item.sql).kind === 'read' && r.columns.length > 0) {
          set((s) => ({ results: { ...s.results, [itemId]: r } }))
        }
        if (standaloneRead) {
          try { await window.rockury.query.txCommit(txId) } catch { /* 읽기라 no-op */ }
          // 전체 items 목록 + 이 아이템만 ok 인 상태 → seq 가 컬렉션 내 실제 순번으로 기록된다.
          await logCollectionHistory(connectionId, activeCollId(get().collections, get().activeCollectionId), crypto.randomUUID(), items, { [itemId]: 'ok' }, get().results)
          set((s) => ({ itemStatus: { ...s.itemStatus, [itemId]: 'ok' }, tx: null, running: false, info: '조회 완료 · 커밋 불필요 (읽기 전용)' }))
        } else {
          set((s) => ({ itemStatus: { ...s.itemStatus, [itemId]: 'ok' }, tx: { txId: txId!, affected }, running: false }))
        }
      } catch (e) {
        // 실패 → main 이 세션 전체를 롤백/정리 → 이미 실행한 아이템도 무효(원자성). 열린 tx 폐기.
        set((s) => ({ itemStatus: { ...s.itemStatus, [itemId]: 'error' }, error: e instanceof Error ? e.message : String(e), tx: null, running: false }))
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), running: false, tx: null })
    }
  },

  abort: async () => {
    // 실행 루프가 다음 아이템 경계에서 감지해 롤백한다.
    if (get().running) set({ aborting: true })
  },

  retry: async () => {
    // 세션은 실패/중단 시 롤백됐으므로 처음부터 재실행(원자성 유지).
    await get().runAll()
  },

  confirm: async () => {
    const { tx, connectionId, items, itemStatus, results } = get()
    if (!tx) return
    try {
      await window.rockury.query.txCommit(tx.txId)
      // 커밋된(ok) 아이템을 History 에 기록(source=collection · 한 커밋 = 한 실행배치).
      if (connectionId) await logCollectionHistory(connectionId, activeCollId(get().collections, get().activeCollectionId), crypto.randomUUID(), items, itemStatus, results)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
    set({ tx: null })
  },
  rollback: async () => {
    const tx = get().tx
    if (!tx) return
    try {
      await window.rockury.query.txRollback(tx.txId)
    } catch {
      // 이미 정리됐을 수 있음
    }
    set({ tx: null, itemStatus: {}, info: null })
  },
  dismissError: () => set({ error: null })
}))
