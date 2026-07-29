/**
 * AI › Tools 화면의 순수 파생 로직 — 목록 걸러내기·서명 문자열·개수 세기.
 * 화면(JSX)에서 떼어 놓아 테스트가 붙는다(AGENTS.md 테스트 의무 1).
 *
 * 타입은 여기서 다시 적는다 — 렌더러 tsconfig 는 `src/main/**` 을 안 본다(창구는 preload 뿐).
 * 같은 서비스의 `store.ts` 가 `AiStatus` 를 그렇게 두고 있는 것과 같은 규칙이다.
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
  /** 이 도구가 덮는 앱 능력(IPC 채널). */
  channels: string[]
}

/** 노출하지 않은 앱 능력 하나 — "왜 이건 도구가 없나"의 답. */
export interface McpExcludedInfo {
  channel: string
  reason: string
}

export interface McpServiceTools {
  service: string
  tools: McpToolInfo[]
  excluded: McpExcludedInfo[]
}

/**
 * 서비스 id → 사람이 읽는 이름. 좌측 레일 라벨과 같은 말을 쓴다 —
 * 같은 것을 두 이름으로 부르면 "이게 그거 맞나"를 매번 확인하게 된다.
 * `shell` 은 좌측 레일에 없는 공용 크롬(창 제어)이라 여기서만 이름을 준다.
 */
export const SERVICE_LABEL: Record<string, string> = {
  uiux: 'UI/UX',
  api: 'API',
  db: 'DB',
  infra: 'Infra',
  ai: 'AI',
  shell: '앱 셸(공용)'
}

export function serviceLabel(id: string): string {
  return SERVICE_LABEL[id] ?? id
}

/** 좌측 레일에 보이는 서비스 순서. 화면 두 곳(레일·이 목록)의 순서가 다르면 매번 눈으로 다시 찾게 된다. */
const RAIL_ORDER = ['uiux', 'api', 'db', 'infra', 'ai']

/**
 * 목록 순서를 좌측 레일과 맞춘다. 레일에 없는 것(`shell` — 창 제어 같은 공용 크롬)은 **맨 뒤**로 보낸다.
 * 사용자가 찾는 것은 자기가 쓰는 서비스의 도구지, 도구가 하나도 없는 공용 크롬이 아니다.
 */
export function orderByRail(catalog: readonly McpServiceTools[]): McpServiceTools[] {
  const rank = (id: string): number => {
    const i = RAIL_ORDER.indexOf(id)
    return i === -1 ? RAIL_ORDER.length : i
  }
  return [...catalog].sort((a, b) => rank(a.service) - rank(b.service))
}

/**
 * 도구 호출 모양 한 줄 — `get_schema(designId, tables?)`.
 * 물음표는 "빼도 되는 인자"라는 뜻이고, 화면이 범례로 그 뜻을 같이 보여 준다.
 */
export function toolSignature(tool: McpToolInfo): string {
  const args = tool.args.map((a) => (a.optional ? `${a.name}?` : a.name))
  return `${tool.name}(${args.join(', ')})`
}

/** 카탈로그 전체 도구 수. */
export function countTools(catalog: readonly McpServiceTools[]): number {
  return catalog.reduce((n, s) => n + s.tools.length, 0)
}

function matches(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle)
}

/**
 * 검색어로 도구를 걸러낸다. 이름·설명·인자 이름·덮는 앱 능력(채널)까지 본다 —
 * 사용자가 "테이블"로 찾든 "db:listTables"로 찾든 같은 도구가 나와야 한다.
 *
 * 검색어가 비면 원본을 그대로(빈 서비스 포함) 돌려준다 — 평소 화면은 "AI 는 도구가 0개"라는
 * 사실도 보여 줘야 하기 때문이다. 검색 중에는 걸린 게 없는 서비스를 빼서 결과만 남긴다.
 */
export function filterCatalog(
  catalog: readonly McpServiceTools[],
  query: string
): McpServiceTools[] {
  const q = query.trim().toLowerCase()
  if (!q) return catalog.map((s) => ({ ...s }))

  return catalog
    .map((s) => ({
      ...s,
      tools: s.tools.filter(
        (t) =>
          matches(t.name, q) ||
          matches(t.description, q) ||
          t.args.some((a) => matches(a.name, q)) ||
          t.channels.some((c) => matches(c, q))
      ),
      // 미노출 목록도 같이 걸러 준다 — "왜 이건 없지"를 검색으로 찾는 것이 이 화면의 쓰임 하나다.
      excluded: s.excluded.filter((e) => matches(e.channel, q) || matches(e.reason, q))
    }))
    .filter((s) => s.tools.length > 0 || s.excluded.length > 0)
}
