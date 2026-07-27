import { shellApi } from './shell'
import { uiuxApi } from './uiux'
import { apiApi } from './api'
import { dbApi } from './db'
import { infraApi } from './infra'
import { mcpApi } from './mcp'

/**
 * 서비스별 preload 창구 등록부 — 순서는 `nav/registry.ts` 의 서비스 순서를 따른다.
 * 창 제어(shell)는 어느 서비스에도 안 속하는 공용 크롬이라 맨 앞에 둔다.
 *
 * 이 배열은 새 서비스를 만들 때만 바뀐다. 창구를 더할 때는 자기 서비스 파일만 고친다.
 */
export const SERVICE_APIS = [
  { service: 'shell', api: shellApi },
  { service: 'uiux', api: uiuxApi },
  { service: 'api', api: apiApi },
  { service: 'db', api: dbApi },
  { service: 'infra', api: infraApi },
  { service: 'mcp', api: mcpApi }
] as const

/**
 * 서비스 창구를 하나의 `window.rockury` 표면으로 조립한다.
 *
 * 같은 최상위 키를 두 서비스가 내놓으면 **던진다** — 조용히 덮으면 한쪽 서비스의 창구가
 * 통째로 사라지고, 그 서비스 화면만 런타임에 알 수 없는 이유로 깨진다.
 */
export function assembleApi(
  services: readonly { service: string; api: Record<string, unknown> }[] = SERVICE_APIS
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const owner = new Map<string, string>()
  for (const s of services) {
    for (const [key, value] of Object.entries(s.api)) {
      const prev = owner.get(key)
      if (prev) {
        throw new Error(
          `preload 창구 '${key}' 를 서비스 '${prev}' 와 '${s.service}' 가 함께 내놓았습니다 — ` +
            `조립할 때 한쪽이 조용히 덮이므로 금지합니다. 최상위 키는 서비스마다 달라야 합니다.`
        )
      }
      owner.set(key, s.service)
      out[key] = value
    }
  }
  return out
}

/** 조립된 표면의 정적 타입 — `RockuryApi` 의 원천. */
export type AssembledApi = typeof shellApi &
  typeof uiuxApi &
  typeof apiApi &
  typeof dbApi &
  typeof infraApi &
  typeof mcpApi
