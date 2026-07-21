import { create } from 'zustand'
import type { LibNode } from './tree'

/** 구조적 레코드 타입(main 과 동일 형태). */
interface Folder { id: string; connectionId: string; parentId: string | null; name: string; sortOrder: number }
interface SavedQuery { id: string; connectionId: string; folderId: string | null; name: string; sql: string; sortOrder: number }
interface Collection { id: string; connectionId: string; name: string; sortOrder: number }
interface Item { id: string; collectionId: string; name: string; sql: string; sortOrder: number }

export type ItemStatus = 'pending' | 'running' | 'ok' | 'error' | 'skipped'

/**
 * Collection 렌더러 스토어(§ops 향상). 저장쿼리 트리 + 컬렉션 + Run-All 러너.
 * 러너는 2c 트랜잭션 게이트 재사용 — 한 트랜잭션에 아이템을 순차 실행하고 최종 커밋/롤백.
 */
interface CollectionState {
  connectionId: string | null
  folders: Folder[]
  queries: SavedQuery[]
  collections: Collection[]
  activeCollectionId: string | null
  items: Item[]

  running: boolean
  itemStatus: Record<string, ItemStatus>
  tx: { txId: string; affected: number } | null
  error: string | null

  load: (connectionId: string) => Promise<void>
  selectCollection: (id: string) => Promise<void>

  addFolder: (name: string, parentId?: string | null) => Promise<void>
  addQuery: (name: string, sql: string, folderId?: string | null) => Promise<void>
  rename: (kind: 'folder' | 'query', id: string, name: string) => Promise<void>
  remove: (kind: 'folder' | 'query', id: string) => Promise<void>
  applyReorder: (flat: { id: string; kind: 'folder' | 'query'; parentId: string | null }[]) => Promise<void>

  addCollection: (name: string) => Promise<void>
  removeCollection: (id: string) => Promise<void>
  addItem: (name: string, sql: string) => Promise<void>
  removeItem: (id: string) => Promise<void>
  reorderItems: (orderedIds: string[]) => Promise<void>

  runAll: () => Promise<void>
  confirm: () => Promise<void>
  rollback: () => Promise<void>
  dismissError: () => void
}

/** 트리 소스(folders+queries) → LibNode[] (tree 유틸 입력). */
export function toLibNodes(folders: Folder[], queries: SavedQuery[]): LibNode[] {
  return [
    ...folders.map((f) => ({ id: f.id, parentId: f.parentId, kind: 'folder' as const, name: f.name, sortOrder: f.sortOrder })),
    ...queries.map((q) => ({ id: q.id, parentId: q.folderId, kind: 'query' as const, name: q.name, sql: q.sql, sortOrder: q.sortOrder }))
  ]
}

export const useCollectionStore = create<CollectionState>()((set, get) => ({
  connectionId: null,
  folders: [],
  queries: [],
  collections: [],
  activeCollectionId: null,
  items: [],
  running: false,
  itemStatus: {},
  tx: null,
  error: null,

  load: async (connectionId) => {
    try {
      const [tree, collections] = await Promise.all([
        window.rockury.savedQueries.tree(connectionId),
        window.rockury.collections.list(connectionId)
      ])
      set({ connectionId, folders: tree.folders, queries: tree.queries, collections })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  selectCollection: async (id) => {
    set({ activeCollectionId: id, tx: null, itemStatus: {} })
    const items = await window.rockury.collections.items(id)
    set({ items })
  },

  addFolder: async (name, parentId = null) => {
    const cid = get().connectionId
    if (!cid) return
    await window.rockury.savedQueries.createFolder({ connectionId: cid, parentId, name })
    await get().load(cid)
  },
  addQuery: async (name, sql, folderId = null) => {
    const cid = get().connectionId
    if (!cid) return
    await window.rockury.savedQueries.createQuery({ connectionId: cid, folderId, name, sql })
    await get().load(cid)
  },
  rename: async (kind, id, name) => {
    if (kind === 'folder') await window.rockury.savedQueries.renameFolder(id, name)
    else await window.rockury.savedQueries.updateQuery(id, { name })
    const cid = get().connectionId
    if (cid) await get().load(cid)
  },
  remove: async (kind, id) => {
    if (kind === 'folder') await window.rockury.savedQueries.deleteFolder(id)
    else await window.rockury.savedQueries.deleteQuery(id)
    const cid = get().connectionId
    if (cid) await get().load(cid)
  },
  applyReorder: async (flat) => {
    await window.rockury.savedQueries.reorderTree(flat.map((f, i) => ({ ...f, sortOrder: i })))
    const cid = get().connectionId
    if (cid) await get().load(cid)
  },

  addCollection: async (name) => {
    const cid = get().connectionId
    if (!cid) return
    const col = await window.rockury.collections.create({ connectionId: cid, name })
    await get().load(cid)
    await get().selectCollection(col.id)
  },
  removeCollection: async (id) => {
    await window.rockury.collections.delete(id)
    const cid = get().connectionId
    set({ activeCollectionId: null, items: [] })
    if (cid) await get().load(cid)
  },
  addItem: async (name, sql) => {
    const colId = get().activeCollectionId
    if (!colId) return
    await window.rockury.collections.addItem({ collectionId: colId, name, sql })
    await get().selectCollection(colId)
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
    set({ running: true, error: null, itemStatus: {}, tx: null })
    try {
      const { txId } = await window.rockury.query.txBegin(connectionId)
      let affected = 0
      for (const item of items) {
        set((s) => ({ itemStatus: { ...s.itemStatus, [item.id]: 'running' } }))
        try {
          const r = await window.rockury.query.txExec(txId, item.sql)
          affected += r.affectedRows ?? 0
          set((s) => ({ itemStatus: { ...s.itemStatus, [item.id]: 'ok' } }))
        } catch (e) {
          // 실패 → 이 아이템 error, 나머지 skipped, 세션은 main 이 롤백/정리.
          set((s) => {
            const status = { ...s.itemStatus, [item.id]: 'error' as ItemStatus }
            const idx = items.findIndex((x) => x.id === item.id)
            for (const later of items.slice(idx + 1)) status[later.id] = 'skipped'
            return { itemStatus: status, error: e instanceof Error ? e.message : String(e), running: false, tx: null }
          })
          return
        }
      }
      set({ tx: { txId, affected }, running: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), running: false, tx: null })
    }
  },

  confirm: async () => {
    const tx = get().tx
    if (!tx) return
    try {
      await window.rockury.query.txCommit(tx.txId)
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
    set({ tx: null, itemStatus: {} })
  },
  dismissError: () => set({ error: null })
}))
