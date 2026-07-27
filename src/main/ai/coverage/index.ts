import type { ServiceCoverage } from './types'
import { shellCoverage } from './shell'
import { uiuxCoverage } from './uiux'
import { apiCoverage } from './api'
import { dbCoverage } from './db'
import { infraCoverage } from './infra'
import { aiCoverage } from './ai'

export type { ServiceCoverage } from './types'

/**
 * MCP 노출 지도 — "앱 능력(IPC 채널) ↔ MCP 도구" 대응의 단일 정본.
 *
 * 스테일 방지 핀: `coverage.test.ts` 가 `src/main/ipc/**` 를 스캔해 실제 채널 전수를
 * 이 지도와 대조한다. 새 IPC 채널이 등재(노출 또는 제외+사유) 없이 생기면,
 * 혹은 지도에 남은 채널이 코드에서 사라지면(유령 등재) `npm test` 가 실패한다.
 * → 앱이 발전할 때 MCP 서버가 낡은 채로 방치되는 것을 게이트가 막는다(AGENTS.md 불변식 4).
 *
 * 새 채널을 추가하는 개발자/에이전트의 선택지 — **자기 서비스 파일에서만** 한다:
 *  ① `tools.ts` 에 도구를 만들고 `coverage/<서비스>.ts` 의 `tools` 에 대응 등재
 *  ② `coverage/<서비스>.ts` 의 `excluded` 에 "왜 노출하지 않는지" 사유와 함께 등재
 *
 * 이 배열 자체는 새 서비스를 만들 때만 바뀐다(병렬 개발 충돌 지점 제거).
 */
export const SERVICE_COVERAGE: ServiceCoverage[] = [
  shellCoverage,
  uiuxCoverage,
  apiCoverage,
  dbCoverage,
  infraCoverage,
  aiCoverage
]

/**
 * 서비스 지도를 하나로 합친다. 같은 키를 두 서비스가 주장하면 **던진다** —
 * 조용히 덮어써 한쪽 서비스의 등재가 사라지는 것이 분할이 새로 만드는 위험이다.
 */
function merge<V>(pick: (c: ServiceCoverage) => Record<string, V>, what: string): Record<string, V> {
  const out: Record<string, V> = {}
  const owner = new Map<string, string>()
  for (const c of SERVICE_COVERAGE) {
    for (const [k, v] of Object.entries(pick(c))) {
      const prev = owner.get(k)
      if (prev) {
        throw new Error(
          `${what} '${k}' 을(를) 서비스 '${prev}' 와 '${c.service}' 가 함께 등재했습니다 — ` +
            `합칠 때 한쪽이 조용히 덮이므로 금지합니다. 한 채널/도구는 한 서비스만 소유합니다.`
        )
      }
      owner.set(k, c.service)
      out[k] = v
    }
  }
  return out
}

/** 도구명 → 그 도구가 덮는 IPC 채널. 키 집합은 `tools.ts` TOOL_NAMES 와 일치해야 한다(테스트 강제). */
export const AI_TOOL_CHANNELS: Record<string, string[]> = merge((c) => c.tools, '도구')

/** 의도적으로 노출하지 않는 채널 → 사유. "아직 결정 안 함"은 사유가 아니다 — 보류라면 왜 보류인지 적는다. */
export const AI_EXCLUDED_CHANNELS: Record<string, string> = merge((c) => c.excluded, '채널')
