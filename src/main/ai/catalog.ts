import type { z } from 'zod'
import { TOOL_DEFS, type ToolDef } from './tools'
import { SERVICE_COVERAGE, type ServiceCoverage } from './coverage'

/**
 * MCP 도구 카탈로그 — "이 앱이 에이전트에게 무엇을 열어 뒀나"를 **서비스별로** 묶어 보여주기 위한 조립.
 *
 * 두 정본을 합친다:
 *   - `tools.ts` 의 `TOOL_DEFS`        → 도구 이름·설명·인자 (에이전트가 실제로 보는 것)
 *   - `coverage/<서비스>.ts`            → 그 도구가 어느 서비스 소속이고 어떤 앱 능력을 덮는지 + 미노출 사유
 *
 * 두 정본은 이미 `coverage.test.ts` 가 서로 어긋나지 않게 붙들고 있으므로, 여기서는 **조립만** 한다 —
 * 화면용 목록을 따로 손으로 관리하면 그 순간부터 낡기 시작한다(그게 이 앱이 피하려는 것이다).
 */

/** 도구 인자 하나 — 이름과 "빼도 되는지". */
export interface McpToolArg {
  name: string
  optional: boolean
}

export interface McpToolInfo {
  name: string
  description: string
  args: McpToolArg[]
  /** 이 도구가 덮는 앱 능력(IPC 채널). "이 도구가 앱의 어느 기능이냐"의 답. */
  channels: string[]
}

/** 노출하지 않은 앱 능력 하나 — "왜 이건 도구가 없나"의 답. */
export interface McpExcludedInfo {
  channel: string
  reason: string
}

export interface McpServiceTools {
  /** 서비스 id (`uiux`·`api`·`db`·`infra`·`ai`) 또는 어느 서비스에도 안 속하는 `shell`. */
  service: string
  tools: McpToolInfo[]
  excluded: McpExcludedInfo[]
}

/**
 * zod 스키마가 "빼도 되는 인자"인지 본다.
 *
 * `.isOptional()` 같은 내부 API 대신 **undefined 를 통과시키는가**로 판정한다 —
 * zod 메이저가 올라가도 이 질문의 답은 안 바뀐다(내부 모양에 안 매달린다).
 */
function isOptional(schema: unknown): boolean {
  const s = schema as z.ZodType
  if (typeof s?.safeParse !== 'function') return false
  return s.safeParse(undefined).success
}

function toolInfo(def: ToolDef, channels: string[]): McpToolInfo {
  return {
    name: def.name,
    description: def.description,
    args: Object.entries(def.inputSchema).map(([name, schema]) => ({
      name,
      optional: isOptional(schema)
    })),
    channels
  }
}

/**
 * 서비스별 도구 카탈로그를 만든다. 순서는 `SERVICE_COVERAGE` 순서를 그대로 따른다.
 *
 * 지도에는 있는데 `TOOL_DEFS` 에 없는 이름은 **조용히 버리지 않고 던진다** — 그 상태로 화면에
 * 목록을 그리면 "있다고 적혀 있는데 실제론 없는 도구"를 사용자가 믿게 된다.
 * (평소엔 `coverage.test.ts` 가 먼저 막지만, 화면이 그 가정에 기대고 있다는 것을 여기에 남긴다.)
 */
export function buildToolCatalog(
  defs: readonly ToolDef[] = TOOL_DEFS,
  coverage: readonly ServiceCoverage[] = SERVICE_COVERAGE
): McpServiceTools[] {
  const byName = new Map(defs.map((d) => [d.name, d]))

  return coverage.map((c) => ({
    service: c.service,
    tools: Object.entries(c.tools).map(([name, channels]) => {
      const def = byName.get(name)
      if (!def) {
        throw new Error(
          `MCP 노출 지도의 도구 '${name}'(서비스 ${c.service}) 이 TOOL_DEFS 에 없습니다 — ` +
            `지도와 도구 정의가 어긋났습니다.`
        )
      }
      return toolInfo(def, channels)
    }),
    excluded: Object.entries(c.excluded).map(([channel, reason]) => ({ channel, reason }))
  }))
}
