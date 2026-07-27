import type { DatabaseSync } from 'node:sqlite'
import { SERVICE_IDS, type ServiceMigration } from './types'
import { uiuxMigration } from './uiux'
import { apiMigration } from './api'
import { dbMigration } from './db'
import { infraMigration } from './infra'
import { mcpMigration } from './mcp'

export type { ServiceMigration, ServiceId } from './types'
export { SERVICE_IDS, addColumnIfMissing } from './types'

/**
 * 서비스별 마이그레이션 등록부 — 순서는 `nav/registry.ts` 의 서비스 순서를 따른다.
 *
 * 새 서비스를 만들 때만 이 배열을 건드린다. **테이블을 더할 때는 자기 서비스 파일만** 고친다
 * (병렬 개발에서 공용 파일 편집을 0으로 만드는 것이 이 분할의 목적이다).
 */
export const MIGRATIONS: ServiceMigration[] = [
  uiuxMigration,
  apiMigration,
  dbMigration,
  infraMigration,
  mcpMigration
]

/** 등록된 마이그레이션이 소유를 주장하는 테이블 전집합. */
export function declaredTables(list: ServiceMigration[] = MIGRATIONS): Set<string> {
  const all = new Set<string>()
  for (const m of list) for (const t of m.tables) all.add(t)
  return all
}

/**
 * 등록부의 정합성 검사 — 적용 **전에** 돌아 앱 시작을 막는다.
 * 조용히 어긋난 채 굴러가는 것보다 못 켜지는 편이 낫다(어긋남은 데이터 손상으로 이어진다).
 */
function assertConsistent(list: ServiceMigration[]): void {
  if (list.length === 0) {
    // 안전핀: 등록부가 통째로 비면 테이블이 하나도 안 생기고, 저장소 호출이 전부 런타임에
    // 터진다. "조용히 아무것도 안 함"을 실패로 바꾼다.
    throw new Error('마이그레이션 등록부가 비어 있습니다 — store/migrations/index.ts 의 MIGRATIONS 를 확인하세요.')
  }

  const owner = new Map<string, string>()
  for (const m of list) {
    if (!(SERVICE_IDS as readonly string[]).includes(m.service)) {
      throw new Error(
        `알 수 없는 서비스 id '${m.service}' — 허용: ${SERVICE_IDS.join(', ')} (nav/registry.ts 의 Service.id 와 같아야 합니다).`
      )
    }
    for (const t of m.tables) {
      const prev = owner.get(t)
      if (prev) {
        throw new Error(
          `테이블 '${t}' 을(를) 서비스 '${prev}' 와 '${m.service}' 가 함께 선언했습니다 — ` +
            `CREATE TABLE IF NOT EXISTS 탓에 뒤에 온 쪽이 조용히 무시됩니다. 한 테이블은 한 서비스만 소유합니다.`
        )
      }
      owner.set(t, m.service)
    }
  }
}

/**
 * 모든 서비스 마이그레이션을 적용한다. 앱을 켤 때마다 다시 도므로 재실행 안전해야 한다.
 * 서비스마다 before(정리) → schema(생성) → alter(구 스키마 보정) 순으로 돈다.
 */
export function applyMigrations(d: DatabaseSync, list: ServiceMigration[] = MIGRATIONS): void {
  assertConsistent(list)
  for (const m of list) {
    m.before?.(d)
    if (m.schema.trim()) d.exec(m.schema)
    m.alter?.(d)
  }
}
