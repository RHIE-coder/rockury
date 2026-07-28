import { parseCatalog } from '../schema'
import type { Catalog } from '../types'
import awsJson from './aws.json'
import dockerJson from './docker.json'
import presetsJson from './presets.json'

/**
 * 앱이 배포와 함께 들고 오는 카탈로그.
 *
 * **내장도 사용자 카탈로그와 똑같은 검증을 거친다.** 우리 파일이라고 봐주면 오타가 배포 뒤에
 * 터진다 — 여기서 걸리면 `builtin.test.ts` 가 `npm test` 단계에서 잡는다.
 *
 * 프리셋(그라파나·Redis 등)도 같은 형식이다 — `discover` 가 없는 노드 종류가 곧 프리셋이라
 * 형식·검증기를 따로 둘 이유가 없다.
 */
const SOURCES: { id: string; raw: unknown }[] = [
  { id: 'builtin-aws', raw: awsJson },
  { id: 'builtin-docker', raw: dockerJson },
  { id: 'builtin-presets', raw: presetsJson }
]

export interface BuiltinCatalog {
  id: string
  catalog: Catalog
}

/** 검증을 통과한 내장 카탈로그. 통과 못 하면 `loadBuiltins()` 가 사유를 함께 돌려준다. */
export function loadBuiltins(): { ok: BuiltinCatalog[]; failed: { id: string; errors: string[] }[] } {
  const ok: BuiltinCatalog[] = []
  const failed: { id: string; errors: string[] }[] = []
  for (const s of SOURCES) {
    const parsed = parseCatalog(s.raw)
    if (parsed.ok) ok.push({ id: s.id, catalog: parsed.catalog })
    else failed.push({ id: s.id, errors: parsed.errors })
  }
  return { ok, failed }
}

export const BUILTIN_CATALOGS: BuiltinCatalog[] = loadBuiltins().ok
