import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createDesign, listDesigns, updateDesign } from '../store/designs'
import { listTables, replaceTablesForDesign, type TableRecord } from '../store/tables'
import { createVersion, listVersions } from '../store/versions'
import { DIALECT_IDS } from '../../shared/dialects'
import { formatVersion, nextVersion, parseVersion } from '../../shared/versionNumber'

/**
 * MCP 도구 정의 — AI 에이전트에게 노출되는 Rockury 능력의 단일 목록.
 *
 * 읽기 4종(설계·스키마·버전 열람) + 쓰기 4종(설계 생성/수정·스키마 반영·버전 컷).
 * 삭제류는 노출하지 않는다 — 파괴적 조작은 사람이 앱에서만(spec tools.write AC-7).
 *
 * 도구 ↔ IPC 채널 대응은 coverage.ts 가 정본이고 coverage.test.ts 가 스테일을 막는다:
 * 앱에 새 IPC 채널이 생기면 여기(도구) 또는 제외 지도에 등재될 때까지 npm test 가 실패한다.
 */

interface ToolDef {
  name: string
  description: string
  /** zod raw shape — SDK 가 JSON Schema 로 변환해 에이전트에 노출. */
  inputSchema: z.ZodRawShape
  /** JSON 직렬화 가능한 값을 반환. 오류는 throw(핸들러 래퍼가 isError 로 변환). */
  handler: (args: Record<string, unknown>) => unknown
}

// ── 리하이드레이션 알림 seam ──────────────────────────────────────────────
// 쓰기 도구가 성공했을 때만 발행(spec tools.rehydration AC-1). electron 을 여기서
// import 하지 않는 기존 테스트 seam 유지 — 실제 창 전파는 main/index.ts 가 주입한다.

export interface StoreChangedEvent {
  domain: 'designs' | 'tables' | 'versions'
  designId: string
}

let notifyStoreChanged: (e: StoreChangedEvent) => void = () => {}

export function setStoreChangeNotifier(fn: (e: StoreChangedEvent) => void): void {
  notifyStoreChanged = fn
}

function requireDesign(designId: unknown): { id: string; name: string; description: string; dialect: string } {
  const id = String(designId ?? '')
  const d = listDesigns().find((x) => x.id === id)
  if (!d) throw new Error(`설계 "${id}" 가 없습니다 — list_designs 로 사용 가능한 id 를 확인하세요.`)
  return d
}

// ── set_schema 입력 검증 ─────────────────────────────────────────────────
// looseObject: 미지의 필드(예: drift 표식)를 버리지 않는다 — get_schema 결과를 고쳐
// 되보내는 왕복(round-trip)에서 데이터가 소실되면 안 된다.
// 검증은 SDK 프로토콜 층이 아니라 핸들러 안에서 한다 — 실패가 프로토콜 오류가 아닌
// isError + 해결 안내로 나가야 하기 때문(spec tools.write AC-6).

const FK_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'NO ACTION'] as const

const columnSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().min(1, '컬럼 name 은 비울 수 없습니다'),
  type: z.string().min(1, '컬럼 type 은 비울 수 없습니다'),
  nullable: z.boolean().optional(),
  defaultValue: z.string().nullable().optional(),
  comment: z.string().optional()
})

const constraintSchema = z.looseObject({
  id: z.string().optional(),
  kind: z.enum(['pk', 'uk', 'fk', 'check', 'idx']),
  name: z.string().optional(),
  columns: z.array(z.looseObject({ columnId: z.string(), direction: z.enum(['ASC', 'DESC']).optional() })).optional(),
  refTable: z.string().optional(),
  refColumns: z.array(z.string()).optional(),
  onDelete: z.enum(FK_ACTIONS).optional(),
  onUpdate: z.enum(FK_ACTIONS).optional(),
  expression: z.string().optional()
})

const tableSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().min(1, '테이블 name 은 비울 수 없습니다'),
  comment: z.string().optional(),
  columns: z.array(columnSchema),
  constraints: z.array(constraintSchema).optional()
})

/** 렌더러 id 시퀀스(`-N` 접미 스캔)와 절대 안 겹치는 생성 id — 하이픈+숫자 꼬리 없음. */
const newId = (): string => `mcp_${randomUUID().replace(/-/g, '').slice(0, 8)}`

function invalid(prefix: string, error: z.ZodError): never {
  const issues = error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(루트)'}: ${i.message}`)
    .join(' · ')
  throw new Error(`${prefix} — ${issues}. get_schema 결과와 같은 형태(tables[].name/columns[].name·type)로 보내세요.`)
}

/**
 * 검증된(zod 구조) 입력을 저장 레코드로 정규화 + 도메인 정합 검증.
 * 화면 편집기가 능동적으로 지키는 불변식(제약은 실재 컬럼만 참조·중복 이름 금지)을 여기서도
 * 강제한다 — set_schema 는 그 안전선을 우회하는 별도 진입 경로이기 때문. 위반은 저장 전
 * 친절한 오류(throw→isError)로 돌려보낸다(부분 반영 없음, spec tools.write AC-6).
 */
function normalizeTables(designId: string, input: z.infer<typeof tableSchema>[]): TableRecord[] {
  const guide = 'get_schema 결과 형태를 참고하세요 — 제약이 참조할 새 컬럼은 columns[].id 를 직접 정해 columnId 로 가리키면 됩니다.'
  const tableNames = new Set<string>()
  const allIds = new Set<string>()
  const claimId = (id: string, what: string): string => {
    if (allIds.has(id)) throw new Error(`중복 id "${id}"(${what}) — 각 테이블·컬럼 id 는 유일해야 합니다. ${guide}`)
    allIds.add(id)
    return id
  }

  return input.map((t) => {
    if (tableNames.has(t.name)) throw new Error(`중복 테이블 이름 "${t.name}" — 한 설계 안에서 테이블 이름은 유일해야 합니다.`)
    tableNames.add(t.name)

    const colNames = new Set<string>()
    const columns = t.columns.map((c) => {
      if (colNames.has(c.name)) throw new Error(`테이블 "${t.name}" 에 중복 컬럼 이름 "${c.name}" — 컬럼 이름은 테이블 안에서 유일해야 합니다.`)
      colNames.add(c.name)
      return {
        ...c,
        id: claimId(c.id ?? newId(), `테이블 ${t.name}.${c.name}`),
        nullable: c.nullable ?? true,
        defaultValue: c.defaultValue ?? null,
        comment: c.comment ?? ''
      }
    })

    const validColIds = new Set(columns.map((c) => c.id))
    const constraints = (t.constraints ?? []).map((k) => {
      // 제약이 실재하지 않는 컬럼을 가리키면 조용히 깨진 스키마를 저장하지 않고 되돌린다.
      for (const ref of k.columns ?? []) {
        if (!validColIds.has(ref.columnId))
          throw new Error(
            `테이블 "${t.name}" 의 ${k.kind.toUpperCase()} 제약이 없는 컬럼 "${ref.columnId}" 를 참조합니다. ${guide}`
          )
      }
      return {
        ...k,
        id: claimId(k.id ?? newId(), `테이블 ${t.name} 제약`),
        name: k.name ?? '',
        columns: k.columns ?? []
      }
    })

    return { id: claimId(t.id ?? newId(), '테이블'), designId, name: t.name, comment: t.comment ?? '', columns, constraints }
  })
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_designs',
    description:
      'Rockury 의 모든 설계(Design) 목록을 반환한다 — id·이름·설명·방언(dialect)·테이블 수·최신 버전 번호. 다른 도구의 designId 인자는 여기서 얻는다.',
    inputSchema: {},
    handler: () => {
      const tables = listTables()
      return listDesigns().map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        dialect: d.dialect,
        tableCount: tables.filter((t) => t.designId === d.id).length,
        // listVersions 는 created_at DESC — 첫 행이 최신.
        latestVersion: listVersions(d.id)[0]?.number ?? null
      }))
    }
  },
  {
    name: 'get_schema',
    description:
      '설계의 현재 작업본(draft) 스키마 전체를 반환한다 — 테이블·컬럼(이름/타입/NULL/기본값/주석)·제약(PK/UK/FK/CHECK/IDX). 스키마 검토·분석의 기본 입력.',
    inputSchema: { designId: z.string().describe('설계 id (list_designs 로 확인)') },
    handler: ({ designId }) => {
      const d = requireDesign(designId)
      return { design: d, tables: listTables().filter((t) => t.designId === d.id) }
    }
  },
  {
    name: 'list_versions',
    description:
      '설계의 버전(불변 스냅샷) 이력 메타를 반환한다 — 번호·메모·잠금·생성시각 (최신순, 스냅샷 본문 제외). 스냅샷 본문은 get_version 으로.',
    inputSchema: { designId: z.string().describe('설계 id (list_designs 로 확인)') },
    handler: ({ designId }) => {
      const d = requireDesign(designId)
      return listVersions(d.id).map((v) => ({
        number: v.number,
        note: v.note,
        locked: v.locked,
        createdAt: v.createdAt
      }))
    }
  },
  {
    name: 'get_version',
    description: '설계의 특정 버전 스냅샷 전체(그 시점의 테이블·컬럼·제약)를 반환한다. 버전 간 비교·회귀 검토용.',
    inputSchema: {
      designId: z.string().describe('설계 id (list_designs 로 확인)'),
      number: z.string().describe('버전 번호 (예: v0.1.0 — list_versions 로 확인)')
    },
    handler: ({ designId, number }) => {
      const d = requireDesign(designId)
      const v = listVersions(d.id).find((x) => x.number === String(number ?? ''))
      if (!v) throw new Error(`버전 "${String(number)}" 가 설계 "${d.id}" 에 없습니다 — list_versions 로 확인하세요.`)
      return v
    }
  },

  // ── 쓰기 4종 — 성공 시에만 store:changed 를 발행해 열린 앱 화면이 따라온다. ──
  // 입력 검증은 핸들러 안(zod) — 실패는 프로토콜 오류가 아닌 isError 로(spec tools.write AC-6).
  {
    name: 'create_design',
    description:
      '새 설계(Design)를 만든다 — 이름·방언(dialect: postgresql|mysql|mariadb|sqlite)·설명. id 는 이름 슬러그로 자동 생성되어 반환된다. 방언은 생성 후 변경 불가.',
    inputSchema: {
      name: z.string().optional().describe('설계 이름 (필수)'),
      dialect: z.string().optional().describe('DB 방언: postgresql | mysql | mariadb | sqlite (필수)'),
      description: z.string().optional().describe('한 줄 설명 (선택)')
    },
    handler: (args) => {
      const parsed = z
        .object({
          name: z.string().min(1, '설계 이름은 비울 수 없습니다'),
          dialect: z.enum(DIALECT_IDS),
          description: z.string().optional()
        })
        .safeParse(args)
      if (!parsed.success) invalid('create_design 입력이 올바르지 않습니다', parsed.error)
      const rec = createDesign(parsed.data)
      notifyStoreChanged({ domain: 'designs', designId: rec.id })
      return rec
    }
  },
  {
    name: 'update_design',
    description:
      '설계의 이름·설명을 수정한다(방언은 고정 속성이라 못 바꾼다). 바꾸지 않을 필드는 생략하면 기존 값이 유지된다.',
    inputSchema: {
      designId: z.string().optional().describe('설계 id (list_designs 로 확인, 필수)'),
      name: z.string().optional().describe('새 이름 (선택)'),
      description: z.string().optional().describe('새 설명 (선택)')
    },
    handler: (args) => {
      const parsed = z
        .object({
          designId: z.string().min(1, 'designId 는 필수입니다'),
          name: z.string().min(1, '이름은 비울 수 없습니다').optional(),
          description: z.string().optional()
        })
        .safeParse(args)
      if (!parsed.success) invalid('update_design 입력이 올바르지 않습니다', parsed.error)
      const d = requireDesign(parsed.data.designId)
      const rec = updateDesign(d.id, {
        name: parsed.data.name ?? d.name,
        description: parsed.data.description ?? d.description
      })
      notifyStoreChanged({ domain: 'designs', designId: d.id })
      return rec
    }
  },
  {
    name: 'set_schema',
    description:
      '설계 하나의 작업본(draft) 스키마 전체를 통째로 반영한다 — 보낸 tables 배열이 그 설계의 새 스키마가 된다(빠진 테이블은 삭제됨). 부분 수정은 get_schema 로 현재를 읽어 고친 전체를 되보내는 방식으로. 다른 설계는 건드리지 않는다.',
    inputSchema: {
      designId: z.string().optional().describe('설계 id (list_designs 로 확인, 필수)'),
      tables: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe(
          '테이블 전체 배열 (필수). 각 테이블: { name(필수), comment?, columns: [{ id?, name(필수), type(필수), nullable?, defaultValue?, comment? }], constraints?: [{ kind: pk|uk|fk|check|idx, columns?: [{ columnId }], refTable?, refColumns?, onDelete?, onUpdate?, expression? }] }. id 를 생략하면 자동 생성 — 기존 항목을 유지하려면 get_schema 가 준 id 를 그대로 보낼 것. 제약(PK 등)이 참조할 새 컬럼은 columns[].id 를 직접 정하고 constraints[].columns[].columnId 로 그 id 를 가리킬 것(없는 컬럼 참조는 거부됨). 테이블·컬럼 이름은 중복 불가.'
        )
    },
    handler: (args) => {
      const d = requireDesign(args.designId)
      const parsed = z.array(tableSchema).safeParse(args.tables)
      if (!parsed.success) invalid(`설계 "${d.id}" 스키마 구조가 올바르지 않습니다`, parsed.error)
      const records = normalizeTables(d.id, parsed.data)
      replaceTablesForDesign(d.id, records)
      notifyStoreChanged({ domain: 'tables', designId: d.id })
      return { design: d, tableCount: records.length, tables: records }
    }
  },
  {
    name: 'create_version',
    description:
      '설계의 현재 작업본(draft)을 그 시점 스냅샷으로 잘라 버전을 만든다(버전 컷 — 스냅샷은 서버가 뜬다). number 를 생략하면 최신 버전에서 patch 증가(v0.1.0 형태). 같은 번호로 다시 컷할 수 없다.',
    inputSchema: {
      designId: z.string().optional().describe('설계 id (list_designs 로 확인, 필수)'),
      number: z.string().optional().describe('버전 번호 (선택, 예: v0.2.0 — 생략 시 최신에서 patch 증가)'),
      note: z.string().optional().describe('버전 메모 (선택)')
    },
    handler: (args) => {
      const d = requireDesign(args.designId)
      const versions = listVersions(d.id)
      let number: string
      const raw = args.number == null ? '' : String(args.number).trim()
      if (raw) {
        const p = parseVersion(raw)
        if (!p) throw new Error(`버전 번호 형식이 아닙니다("${raw}") — v0.1.0 같은 형태로 보내세요.`)
        number = formatVersion(p) // v 접두·자리 생략을 정규형으로 통일
      } else {
        number = nextVersion(versions[0]?.number ?? null, 'patch')
      }
      if (versions.some((v) => v.number === number))
        throw new Error(`버전 "${number}" 가 이미 있습니다 — list_versions 로 확인하고 다른 번호를 쓰세요.`)
      const snapshot = { tables: listTables().filter((t) => t.designId === d.id) }
      const v = createVersion({ designId: d.id, number, note: typeof args.note === 'string' ? args.note : '', snapshot })
      notifyStoreChanged({ domain: 'versions', designId: d.id })
      // 스냅샷 본문은 크다 — 메타만 반환(본문은 get_version 으로).
      return { id: v.id, designId: v.designId, number: v.number, note: v.note, createdAt: v.createdAt, tableCount: snapshot.tables.length }
    }
  }
]

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name)

/** 세션당 1개 — SDK 규약상 서버 인스턴스는 전송(transport) 하나에만 연결된다. */
export function createMcpServer(appVersion: string): McpServer {
  const server = new McpServer({ name: 'rockury', version: appVersion })
  for (const t of TOOL_DEFS) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.inputSchema },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: Record<string, unknown>) => {
        try {
          const data = t.handler(args ?? {})
          return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
        } catch (e) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }]
          }
        }
      }) as any
    )
  }
  return server
}
