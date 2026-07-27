import { registerStoreIpc } from './store'
import { registerConnectionIpc } from './connections'
import { registerEnvironmentIpc } from './environments'
import { registerIntrospectionIpc } from './introspection'
import { registerQueryIpc } from './query'
import { registerMigrationIpc } from './migration'
import { registerCollectionIpc } from './collections'
import { registerDiagramIpc } from './diagram'

/**
 * DB 서비스의 IPC 채널 전부. 설계부(store)와 운영부(connections~diagram)를 함께 등록한다.
 *
 * 새 채널을 만들 때는 이 폴더 안에서만 움직인다 — `src/main/index.ts` 나 다른 서비스
 * 폴더는 건드리지 않는다(병렬 개발 파일 소유권, AGENTS.md).
 * 새 채널은 `src/main/ai/coverage/db.ts` 에 노출 또는 제외로 등재해야 `npm test` 를 통과한다.
 */
export function registerDbIpc(): void {
  registerStoreIpc()
  registerConnectionIpc()
  registerEnvironmentIpc()
  registerIntrospectionIpc()
  registerQueryIpc()
  registerMigrationIpc()
  registerCollectionIpc()
  registerDiagramIpc()
}
