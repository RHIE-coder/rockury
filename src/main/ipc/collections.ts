import { ipcMain } from 'electron'
import {
  createFolder,
  createSavedQuery,
  deleteFolder,
  deleteSavedQuery,
  listTree,
  renameFolder,
  reorderTree,
  updateSavedQuery
} from '../store/savedQueries'
import {
  addItem,
  addReference,
  createCollection,
  createCollectionFolder,
  deleteCollection,
  deleteCollectionFolder,
  deleteItem,
  listCollectionFolders,
  listCollections,
  listItems,
  renameCollection,
  renameCollectionFolder,
  reorderCollectionTree,
  reorderItems,
  updateCollection,
  updateItem
} from '../store/collections'
import { envelope } from './envelope'

/**
 * 저장 쿼리 라이브러리(트리) + 컬렉션 IPC(§ops 향상). 봉투 패턴.
 */
export function registerCollectionIpc(): void {
  // ── 저장 쿼리 트리 ──
  ipcMain.handle('sq:tree', (_e, connectionId: string) => envelope(() => listTree(connectionId)))
  ipcMain.handle('sq:createFolder', (_e, input: { connectionId: string; parentId: string | null; name: string }) =>
    envelope(() => createFolder(input))
  )
  ipcMain.handle('sq:createQuery', (_e, input: { connectionId: string; folderId: string | null; name: string; sql: string }) =>
    envelope(() => createSavedQuery(input))
  )
  ipcMain.handle('sq:renameFolder', (_e, id: string, name: string) => envelope(() => renameFolder(id, name)))
  ipcMain.handle('sq:updateQuery', (_e, id: string, patch: { name?: string; description?: string; sql?: string }) =>
    envelope(() => updateSavedQuery(id, patch))
  )
  ipcMain.handle('sq:deleteFolder', (_e, id: string) => envelope(() => deleteFolder(id)))
  ipcMain.handle('sq:deleteQuery', (_e, id: string) => envelope(() => deleteSavedQuery(id)))
  ipcMain.handle('sq:reorderTree', (_e, items: { id: string; kind: 'folder' | 'query'; parentId: string | null; sortOrder: number }[]) =>
    envelope(() => reorderTree(items))
  )

  // ── 컬렉션 ──
  ipcMain.handle('col:list', (_e, connectionId: string) => envelope(() => listCollections(connectionId)))
  ipcMain.handle('col:folders', (_e, connectionId: string) => envelope(() => listCollectionFolders(connectionId)))
  ipcMain.handle('col:items', (_e, collectionId: string) => envelope(() => listItems(collectionId)))
  ipcMain.handle('col:create', (_e, input: { connectionId: string; name: string; folderId?: string | null }) => envelope(() => createCollection(input)))
  ipcMain.handle('col:createFolder', (_e, input: { connectionId: string; parentId: string | null; name: string }) => envelope(() => createCollectionFolder(input)))
  ipcMain.handle('col:rename', (_e, id: string, name: string) => envelope(() => renameCollection(id, name)))
  ipcMain.handle('col:update', (_e, id: string, patch: { name?: string; description?: string }) => envelope(() => updateCollection(id, patch)))
  ipcMain.handle('col:renameFolder', (_e, id: string, name: string) => envelope(() => renameCollectionFolder(id, name)))
  ipcMain.handle('col:deleteFolder', (_e, id: string) => envelope(() => deleteCollectionFolder(id)))
  ipcMain.handle('col:reorderTree', (_e, items: { id: string; kind: 'folder' | 'collection'; parentId: string | null; sortOrder: number }[]) => envelope(() => reorderCollectionTree(items)))
  ipcMain.handle('col:delete', (_e, id: string) => envelope(() => deleteCollection(id)))
  ipcMain.handle('col:addItem', (_e, input: { collectionId: string; name: string; sql: string }) => envelope(() => addItem(input)))
  ipcMain.handle('col:addReference', (_e, input: { collectionId: string; savedQueryId: string }) => envelope(() => addReference(input)))
  ipcMain.handle('col:updateItem', (_e, id: string, patch: { name?: string; sql?: string }) => envelope(() => updateItem(id, patch)))
  ipcMain.handle('col:deleteItem', (_e, id: string) => envelope(() => deleteItem(id)))
  ipcMain.handle('col:reorderItems', (_e, orderedIds: string[]) => envelope(() => reorderItems(orderedIds)))
}
