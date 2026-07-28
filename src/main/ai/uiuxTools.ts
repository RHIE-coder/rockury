import { z } from 'zod'
import {
  createNode,
  findByAddress,
  getSurface,
  getTree,
  listProjects,
  saveSurfaceContent,
  setSurfaceStatus,
  type SpecLevel
} from '../store/uiuxSpecs'

/**
 * UI/UX 서비스의 MCP 도구 — 명세 정본 `docs/spec/uiux-ia.md` §1·§8.
 *
 * 도구를 `tools.ts` 에 직접 쓰지 않고 이 파일로 뺀 이유는 병렬 개발이다 — 다섯 서비스가 같은
 * 배열에 줄을 더하면 매번 충돌한다. `tools.ts` 는 이 배열을 펼쳐 넣기만 한다(두 줄).
 *
 * **읽기와 쓰기를 함께 연다.** 읽기만 열면 에이전트가 본 것이 대화창에서 휘발되고, 그러면 이
 * 서비스가 풀려던 문제("설계가 어디까지 됐는지 아무도 모른다")가 그대로 남는다.
 *
 * 지목은 **안정 주소**(`coupang.buyer.auth.login`)로 한다. 저장소 id 는 무작위라 밖에서 알 수
 * 없고, 주소는 사람도 에이전트도 읽고 쓸 수 있으며 이름이 바뀌어도 흔들리지 않는다.
 *
 * 삭제는 노출하지 않는다 — 연쇄 삭제라 되돌릴 수 없다(DB 서비스와 같은 규율).
 */

interface ToolDef {
  name: string
  description: string
  inputSchema: z.ZodRawShape
  handler: (args: Record<string, unknown>) => unknown
}

const STATUSES = ['designed', 'implemented', 'verified'] as const

/** 주소로 찾되, 못 찾으면 **무엇이 왜 없는지** 알린다 — 빈 결과를 조용히 돌려주면 오타를 못 찾는다. */
function requireAddress(address: unknown, want: SpecLevel) {
  const addr = String(address ?? '')
  const hit = findByAddress(addr)
  if (!hit) {
    throw new Error(
      `주소 "${addr}" 를 찾을 수 없습니다 — get_ui_tree 로 실제 주소를 확인하세요. ` +
        `주소는 프로젝트.앱.서비스.화면 순으로 잇습니다(예: coupang.buyer.auth.login).`
    )
  }
  if (hit.level !== want) {
    throw new Error(`주소 "${addr}" 는 ${hit.level} 입니다 — 이 도구는 ${want} 주소를 받습니다.`)
  }
  return hit
}

function countByStatus(rows: { status: string }[]) {
  return {
    total: rows.length,
    designed: rows.filter((r) => r.status === 'designed').length,
    implemented: rows.filter((r) => r.status === 'implemented').length,
    verified: rows.filter((r) => r.status === 'verified').length
  }
}

export const UIUX_TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_ui_projects',
    description:
      'UI/UX 설계 프로젝트 목록을 반환한다 — 주소 조각(key)·이름·설명. 다른 ui 도구의 주소는 이 key 로 시작한다.',
    inputSchema: {},
    handler: () =>
      listProjects().map((p) => ({
        address: p.key,
        name: p.name,
        description: p.description
      }))
  },

  {
    name: 'get_ui_tree',
    description:
      '프로젝트의 화면 위계 전체를 반환한다 — 앱 › 서비스 › 화면과 각 화면의 안정 주소·종류·상태(설계됨/구현됨/확인됨), 그리고 능력별 집계. **화면 내용(구조)은 빼고 목차만** 준다(전체를 한 번에 읽지 않기 위한 것) — 내용은 get_ui_surface 로.',
    inputSchema: {
      project: z.string().describe('프로젝트 주소 조각 (list_ui_projects 로 확인)')
    },
    handler: ({ project }) => {
      const hit = requireAddress(project, 'project')
      const tree = getTree(hit.projectId)
      const projectKey = String(project)

      const applications = tree.applications.map((app) => {
        const services = tree.services
          .filter((s) => s.application_id === app.id)
          .map((svc) => {
            const surfaces = tree.surfaces
              .filter((sf) => sf.service_id === svc.id)
              .map((sf) => ({
                address: `${projectKey}.${app.key}.${svc.key}.${sf.key}`,
                name: sf.name,
                description: sf.description,
                kind: sf.kind,
                status: sf.status,
                checkedAt: sf.checked_at || null,
                checkedBy: sf.checked_by || null,
                checkedNote: sf.checked_note || null
              }))
            return {
              address: `${projectKey}.${app.key}.${svc.key}`,
              name: svc.name,
              description: svc.description,
              counts: countByStatus(surfaces),
              surfaces
            }
          })
        return {
          address: `${projectKey}.${app.key}`,
          name: app.name,
          description: app.description,
          counts: countByStatus(services.flatMap((s) => s.surfaces)),
          services
        }
      })

      return {
        project: projectKey,
        counts: countByStatus(tree.surfaces),
        applications
      }
    }
  },

  {
    name: 'get_ui_surface',
    description:
      '화면 한 장의 설계 내용을 반환한다 — 영역(section)과 그 안의 요소(component: 종류·이름표·속성), 이벤트, 뷰포트 덮어쓰기. 화면을 구현하기 전에 읽어야 할 정본이다.',
    inputSchema: {
      address: z.string().describe('화면 주소 (예: coupang.buyer.auth.login — get_ui_tree 로 확인)')
    },
    handler: ({ address }) => {
      const hit = requireAddress(address, 'surface')
      const row = getSurface(hit.surfaceId as string)
      if (!row) throw new Error(`화면 "${String(address)}" 를 읽을 수 없습니다.`)
      let content: unknown
      try {
        content = JSON.parse(row.content)
      } catch {
        // 내용이 깨져도 나머지는 쓸모가 있다 — 통째로 실패시키지 않고 사실을 알린다.
        content = { sections: [], _error: '저장된 내용이 올바른 JSON 이 아닙니다.' }
      }
      return {
        address: String(address),
        name: row.name,
        description: row.description,
        kind: row.kind,
        status: row.status,
        checkedAt: row.checked_at || null,
        checkedBy: row.checked_by || null,
        checkedNote: row.checked_note || null,
        updatedAt: row.updated_at,
        content
      }
    }
  },

  {
    name: 'create_ui_node',
    description:
      '화면 위계에 노드를 만든다 — 부모 주소의 깊이가 층을 정한다(빈 문자열이면 프로젝트, 프로젝트 주소면 앱, 앱 주소면 서비스, 서비스 주소면 화면). key 는 주소 조각이라 소문자 영숫자·하이픈·밑줄만 쓰고 같은 부모 아래 유일해야 한다.',
    inputSchema: {
      parent: z
        .string()
        .describe('부모 주소. 프로젝트를 만들려면 빈 문자열 (예: "" · "coupang" · "coupang.buyer")'),
      key: z.string().describe('주소 조각 (예: login) — 소문자 영숫자·하이픈·밑줄'),
      name: z.string().describe('사람이 읽는 이름 (예: 로그인 화면) — 한글도 된다'),
      description: z.string().optional().describe('이 노드가 하는 일 한 줄'),
      kind: z
        .enum(['page', 'modal', 'dialog', 'drawer', 'toast'])
        .optional()
        .describe('화면을 만들 때만 — 기본 page. 모달·드로어도 화면과 동급으로 둔다')
    },
    handler: ({ parent, key, name, description, kind }) => {
      const parentAddress = String(parent ?? '')
      if (parentAddress === '') {
        const { id } = createNode('project', null, {
          key: String(key),
          name: String(name),
          description: description ? String(description) : ''
        })
        return { address: String(key), level: 'project', id }
      }

      const hit = findByAddress(parentAddress)
      if (!hit) throw new Error(`부모 주소 "${parentAddress}" 를 찾을 수 없습니다 — get_ui_tree 로 확인하세요.`)

      const nextLevel: Record<SpecLevel, SpecLevel | null> = {
        project: 'application',
        application: 'service',
        service: 'surface',
        surface: null
      }
      const level = nextLevel[hit.level]
      if (!level) throw new Error(`화면 안(영역·요소)은 set_ui_surface 로 통째로 씁니다 — 여기서 만들지 않습니다.`)

      const parentId =
        level === 'application' ? hit.projectId : level === 'service' ? hit.applicationId! : hit.serviceId!
      const { id } = createNode(level, parentId, {
        key: String(key),
        name: String(name),
        description: description ? String(description) : '',
        kind: kind ? String(kind) : undefined
      })
      return { address: `${parentAddress}.${String(key)}`, level, id }
    }
  },

  {
    name: 'set_ui_surface',
    description:
      '화면 한 장의 설계 내용을 통째로 교체한다 — 영역(sections)과 요소(components). get_ui_surface 로 읽어 고친 뒤 되보내는 왕복이 기본 사용법이다. 요소 id 는 흐름·규칙이 가리키는 손잡이라 함부로 바꾸지 않는다.',
    inputSchema: {
      address: z.string().describe('화면 주소 (예: coupang.buyer.auth.login)'),
      content: z
        .looseObject({ sections: z.array(z.unknown()) })
        .describe('{ sections: [...], events?: [...], layout?: {...} } — get_ui_surface 의 content 와 같은 모양')
    },
    handler: ({ address, content }) => {
      const hit = requireAddress(address, 'surface')
      const value = content as { sections?: unknown }
      if (!Array.isArray(value?.sections)) {
        throw new Error('content.sections 는 배열이어야 합니다 — get_ui_surface 결과를 고쳐 되보내세요.')
      }
      saveSurfaceContent(hit.surfaceId as string, JSON.stringify(content))
      return { address: String(address), sectionCount: value.sections.length }
    }
  },

  {
    name: 'set_ui_surface_status',
    description:
      '화면이 설계대로 구현됐는지 **확인 결과를 기록한다** — designed(설계만) / implemented(코드가 있다) / verified(설계대로임을 확인했다). UI 적합성은 기계로 가르기 어려워 앱이 스스로 판정하지 않는다: 설계를 읽고 실제 코드·화면을 본 에이전트가 판정하고, 앱은 그 결과를 받아 적는다. note 에 근거를 남기면 사람이 나중에 왜 그렇게 판정했는지 볼 수 있다.',
    inputSchema: {
      address: z.string().describe('화면 주소 (예: coupang.buyer.auth.login)'),
      status: z.enum(STATUSES).describe('designed | implemented | verified'),
      by: z.string().optional().describe('누가 확인했나 (예: claude-code) — 생략 시 agent'),
      note: z.string().optional().describe('판정 근거 한 줄 (예: src/pages/Login.tsx 의 폼 구조가 설계와 일치)')
    },
    handler: ({ address, status, by, note }) => {
      const hit = requireAddress(address, 'surface')
      setSurfaceStatus(
        hit.surfaceId as string,
        String(status),
        by ? String(by) : 'agent',
        note ? String(note) : ''
      )
      return { address: String(address), status: String(status) }
    }
  }
]
