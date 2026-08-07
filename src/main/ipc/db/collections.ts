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
} from '../../store/savedQueries'
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
} from '../../store/collections'
import type { LibraryScope } from '../../store/libraryScope'
import { envelope } from '../envelope'
import { writing } from '../peers'

/**
 * 저장 쿼리 라이브러리(트리) + 컬렉션 IPC(§ops 향상). 봉투 패턴.
 */
export function registerCollectionIpc(): void {
  // ── 저장 쿼리 트리 ──
  // 스코프는 **연결 아니면 설계**다 — 운영 화면은 연결을, 설계 화면은 설계를 준다.
  // 연결로 물어보면 저장소가 그 연결에 물린 설계까지 찾아 함께 보여 준다(`store/libraryScope`).
  ipcMain.handle('sq:tree', (_e, scope: LibraryScope) => envelope(() => listTree(scope)))
  ipcMain.handle('sq:createFolder', (e, input: { scope: LibraryScope; parentId: string | null; name: string }) =>
    writing(e, { domain: 'library' }, () => createFolder(input))
  )
  ipcMain.handle('sq:createQuery', (e, input: { scope: LibraryScope; folderId: string | null; name: string; sql: string }) =>
    writing(e, { domain: 'library' }, () => createSavedQuery(input))
  )
  ipcMain.handle('sq:renameFolder', (e, id: string, name: string) => writing(e, { domain: 'library' }, () => renameFolder(id, name)))
  ipcMain.handle('sq:updateQuery', (e, id: string, patch: { name?: string; description?: string; sql?: string }) =>
    writing(e, { domain: 'library' }, () => updateSavedQuery(id, patch))
  )
  ipcMain.handle('sq:deleteFolder', (e, id: string) => writing(e, { domain: 'library' }, () => deleteFolder(id)))
  ipcMain.handle('sq:deleteQuery', (e, id: string) => writing(e, { domain: 'library' }, () => deleteSavedQuery(id)))
  ipcMain.handle('sq:reorderTree', (e, items: { id: string; kind: 'folder' | 'query'; parentId: string | null; sortOrder: number }[]) =>
    writing(e, { domain: 'library' }, () => reorderTree(items))
  )

  // ── 컬렉션 ──
  ipcMain.handle('col:list', (_e, scope: LibraryScope) => envelope(() => listCollections(scope)))
  ipcMain.handle('col:folders', (_e, scope: LibraryScope) => envelope(() => listCollectionFolders(scope)))
  ipcMain.handle('col:items', (_e, collectionId: string) => envelope(() => listItems(collectionId)))
  ipcMain.handle('col:create', (e, input: { scope: LibraryScope; name: string; folderId?: string | null }) => writing(e, { domain: 'library' }, () => createCollection(input)))
  ipcMain.handle('col:createFolder', (e, input: { scope: LibraryScope; parentId: string | null; name: string }) => writing(e, { domain: 'library' }, () => createCollectionFolder(input)))
  ipcMain.handle('col:rename', (e, id: string, name: string) => writing(e, { domain: 'library' }, () => renameCollection(id, name)))
  ipcMain.handle('col:update', (e, id: string, patch: { name?: string; description?: string }) => writing(e, { domain: 'library' }, () => updateCollection(id, patch)))
  ipcMain.handle('col:renameFolder', (e, id: string, name: string) => writing(e, { domain: 'library' }, () => renameCollectionFolder(id, name)))
  ipcMain.handle('col:deleteFolder', (e, id: string) => writing(e, { domain: 'library' }, () => deleteCollectionFolder(id)))
  ipcMain.handle('col:reorderTree', (e, items: { id: string; kind: 'folder' | 'collection'; parentId: string | null; sortOrder: number }[]) => writing(e, { domain: 'library' }, () => reorderCollectionTree(items)))
  ipcMain.handle('col:delete', (e, id: string) => writing(e, { domain: 'library' }, () => deleteCollection(id)))
  ipcMain.handle('col:addItem', (e, input: { collectionId: string; name: string; sql: string }) => writing(e, { domain: 'library' }, () => addItem(input)))
  ipcMain.handle('col:addReference', (e, input: { collectionId: string; savedQueryId: string }) => writing(e, { domain: 'library' }, () => addReference(input)))
  ipcMain.handle('col:updateItem', (e, id: string, patch: { name?: string; sql?: string }) => writing(e, { domain: 'library' }, () => updateItem(id, patch)))
  ipcMain.handle('col:deleteItem', (e, id: string) => writing(e, { domain: 'library' }, () => deleteItem(id)))
  ipcMain.handle('col:reorderItems', (e, orderedIds: string[]) => writing(e, { domain: 'library' }, () => reorderItems(orderedIds)))
}
