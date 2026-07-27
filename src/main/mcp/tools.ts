import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createDesign, listDesigns, updateDesign } from '../store/designs'
import { listTables, replaceTablesForDesign, type TableRecord } from '../store/tables'
import { createVersion, listVersions } from '../store/versions'
import { DIALECT_IDS, DIALECT_META } from '../../shared/dialects'
import { formatVersion, nextVersion, parseVersion } from '../../shared/versionNumber'
import { applyOperations, assertTablesConsistent, patchOpSchema } from './patch'
import { assertCleanText } from './textGuard'

/**
 * MCP 도구 정의 — AI 에이전트에게 노출되는 Rockury 능력의 단일 목록.
 *
 * 읽기 4종(설계·스키마·버전 열람) + 쓰기 5종(설계 생성/수정·스키마 전체 반영·부분 수정·버전 컷).
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

const SHAPE_GUIDE = 'get_schema 결과와 같은 형태(tables[].name/columns[].name·type)로 보내세요.'

function invalid(prefix: string, error: z.ZodError, guide: string = SHAPE_GUIDE): never {
  const issues = error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(루트)'}: ${i.message}`)
    .join(' · ')
  throw new Error(`${prefix} — ${issues}. ${guide}`)
}

/**
 * 에이전트가 임의로 못 정하는 값 — 사용자에게 고르게 시킨다.
 *
 * 방언은 생성 후 못 바꾸는 고정 속성이라 잘못 고르면 설계를 새로 파야 한다. 사용자가 벤더를
 * 말하지 않았다는 것은 "아무거나"가 아니라 "아직 안 정했다"에 가깝다 — 그런데 도구가 평범한
 * 검증 오류만 돌려주면 에이전트는 그럴듯한 값을 채워 재시도한다. 그래서 앱이 직접
 * "묻고 오라"고 지시한다(선택지 문구는 앱 생성 모달과 같은 정본 @shared/dialects).
 * 반대로 이름은 나중에 update_design 으로 바꿀 수 있으므로 에이전트가 제안해도 된다.
 */
function askUserForDialect(lead: string): never {
  const options = DIALECT_META.map((d) => `  · ${d.id} — ${d.label} · ${d.blurb}`).join('\n')
  throw new Error(
    `${lead}\n` +
      '에이전트가 임의로 고르지 마세요 — 사용자에게 아래 중 무엇으로 만들지 물어보고, 답을 받은 뒤\n' +
      'dialect 를 넣어 create_design 을 다시 호출하세요. 방언은 생성 후 바꿀 수 없습니다.\n' +
      options
  )
}

/**
 * 검증된(zod 구조) 입력을 저장 레코드로 정규화. 도메인 정합 검증은 patch.ts 의
 * assertTablesConsistent 가 맡는다 — set_schema(통째 반영)와 patch_schema(부분 수정)가
 * 같은 안전선을 통과해야 하므로 검증을 한 곳에 모았다(부분 반영 없음, spec tools.write AC-6).
 */
function normalizeTables(designId: string, input: z.infer<typeof tableSchema>[]): TableRecord[] {
  const records = input.map((t) => ({
    // 미지의 필드(isView·drift 표식 등)를 흘리지 않고 보존한다 — 왕복 손실 금지.
    ...t,
    id: t.id ?? newId(),
    designId,
    name: t.name,
    comment: t.comment ?? '',
    columns: t.columns.map((c) => ({
      ...c,
      id: c.id ?? newId(),
      nullable: c.nullable ?? true,
      defaultValue: c.defaultValue ?? null,
      comment: c.comment ?? ''
    })),
    constraints: (t.constraints ?? []).map((k) => ({
      ...k,
      id: k.id ?? newId(),
      name: k.name ?? '',
      columns: k.columns ?? []
    }))
  })) as TableRecord[]
  assertTablesConsistent(records)
  return records
}

/**
 * 쓰기 응답 요약 — 스키마 본문을 되돌려주지 않는다.
 * 33개 테이블 반영 한 번이 127KB 에코를 낳아 호출자의 문맥을 통째로 잡아먹은 사고가 있었다.
 * 본문이 필요하면 get_schema(테이블 필터 가능)로 필요한 만큼만 읽는다.
 */
function summarize(design: { id: string; name: string; dialect: string }, records: TableRecord[]) {
  return {
    design: { id: design.id, name: design.name, dialect: design.dialect },
    tableCount: records.length,
    tables: records.map((t) => ({
      name: t.name,
      columns: (t.columns as unknown[]).length,
      constraints: (t.constraints as unknown[]).length
    }))
  }
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
      '설계의 현재 작업본(draft) 스키마를 반환한다 — 테이블·컬럼(이름/타입/NULL/기본값/주석)·제약(PK/UK/FK/CHECK/IDX). 스키마 검토·분석의 기본 입력. tables 로 필요한 테이블만 추려 읽을 수 있다(큰 설계에서 권장).',
    inputSchema: {
      designId: z.string().describe('설계 id (list_designs 로 확인)'),
      tables: z
        .array(z.string())
        .optional()
        .describe('읽을 테이블 이름만 추린다(생략 시 전체) — 한두 테이블만 고칠 때 전체를 읽지 않기 위한 것')
    },
    handler: ({ designId, tables }) => {
      const d = requireDesign(designId)
      const all = listTables().filter((t) => t.designId === d.id)
      const want = Array.isArray(tables) ? tables.map(String) : []
      if (want.length === 0) return { design: d, tables: all }
      // 오타로 조용히 빈 결과를 받는 것보다 이름이 틀렸다고 알려주는 편이 낫다.
      const missing = want.filter((n) => !all.some((t) => t.name === n))
      if (missing.length > 0)
        throw new Error(
          `설계 "${d.id}" 에 없는 테이블: ${missing.join(', ')} — 이 설계의 테이블: ${all.map((t) => t.name).join(', ') || '(없음)'}`
        )
      return { design: d, tables: all.filter((t) => want.includes(t.name)) }
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

  // ── 쓰기 5종 — 성공 시에만 store:changed 를 발행해 열린 앱 화면이 따라온다. ──
  // 입력 검증은 핸들러 안(zod) — 실패는 프로토콜 오류가 아닌 isError 로(spec tools.write AC-6).
  {
    name: 'create_design',
    description:
      '새 설계(Design)를 만든다 — 이름·방언(dialect: postgresql|mysql|mariadb|sqlite)·설명. id 는 이름 슬러그로 자동 생성되어 반환된다. 방언은 생성 후 변경 불가이므로, 사용자가 DB 벤더를 말하지 않았으면 임의로 고르지 말고 물어본 뒤 호출할 것(안 넣고 부르면 선택지를 돌려준다).',
    inputSchema: {
      name: z.string().optional().describe('설계 이름 (필수)'),
      dialect: z
        .string()
        .optional()
        .describe('DB 방언: postgresql | mysql | mariadb | sqlite (필수 — 사용자가 안 정했으면 물어볼 것)'),
      description: z.string().optional().describe('한 줄 설명 (선택)')
    },
    handler: (args) => {
      // 방언 판정을 zod 앞에 세운다 — 평범한 구조 오류로 섞이면 에이전트가 값을 지어내 재시도한다.
      const dialect = typeof args.dialect === 'string' ? args.dialect.trim().toLowerCase() : ''
      if (!dialect) askUserForDialect('방언(dialect)이 지정되지 않았습니다.')
      if (!(DIALECT_IDS as readonly string[]).includes(dialect))
        askUserForDialect(`"${String(args.dialect)}" 는 Rockury 가 지원하지 않는 방언입니다.`)

      const parsed = z
        .object({
          name: z.string().min(1, '설계 이름은 비울 수 없습니다'),
          dialect: z.enum(DIALECT_IDS),
          description: z.string().optional()
        })
        .safeParse({ ...args, dialect })
      if (!parsed.success) invalid('create_design 입력이 올바르지 않습니다', parsed.error)
      assertCleanText(parsed.data, 'create_design')
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
      assertCleanText(parsed.data, 'update_design')
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
      '설계 하나의 작업본(draft) 스키마 전체를 통째로 반영한다 — 보낸 tables 배열이 그 설계의 새 스키마가 된다(빠진 테이블은 삭제됨). **일부만 고칠 때는 patch_schema 를 쓸 것** — 이 도구는 새 설계를 처음 채우거나 전체를 갈아엎을 때만. 응답은 요약(테이블별 개수)이며 본문은 get_schema 로 읽는다. 다른 설계는 건드리지 않는다.',
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
      assertCleanText(parsed.data, 'set_schema', 'tables')
      const records = normalizeTables(d.id, parsed.data)
      replaceTablesForDesign(d.id, records)
      notifyStoreChanged({ domain: 'tables', designId: d.id })
      return summarize(d, records)
    }
  },
  {
    name: 'patch_schema',
    description:
      '설계 스키마를 **부분 수정**한다 — 연산 목록을 순서대로 원자 적용(하나라도 실패하면 전부 미반영). 주석 한 줄·컬럼 하나를 고치려고 스키마 전체를 다시 보내지 않기 위한 도구다. 조준은 테이블·컬럼 **이름**으로 하고(내부 id 불필요), 제약의 대상 컬럼도 이름으로 적는다. 남이 가리키는 참조는 따라 고치거나(테이블 개명·컬럼 개명) 막는다(참조 남은 채 삭제 금지).',
    inputSchema: {
      designId: z.string().optional().describe('설계 id (list_designs 로 확인, 필수)'),
      operations: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe(
          '연산 목록 (필수, 순서대로 적용). 각 연산의 op 와 인자: ' +
            'add_table{table,comment?,columns:[{name,type,nullable?,defaultValue?,comment?}],constraints?:[{kind,name?,columns:[컬럼이름],refTable?,refColumns?,onDelete?,onUpdate?,expression?}]} · ' +
            'drop_table{table} · rename_table{table,newName} · set_table_comment{table,comment} · ' +
            'add_column{table,column:{name,type,...},after?} · update_column{table,column,set:{name?,type?,nullable?,defaultValue?,comment?}} · drop_column{table,column} · ' +
            'add_constraint{table,constraint:{kind,name?,columns:[컬럼이름],...}} · drop_constraint{table,name}'
        )
    },
    handler: (args) => {
      const d = requireDesign(args.designId)
      const guide =
        'op 는 add_table·drop_table·rename_table·set_table_comment·add_column·update_column·drop_column·add_constraint·drop_constraint 중 하나입니다.'
      const parsed = z.array(patchOpSchema).min(1, '연산을 최소 1개 보내세요').safeParse(args.operations)
      if (!parsed.success) invalid(`patch_schema 연산 목록이 올바르지 않습니다`, parsed.error, guide)
      assertCleanText(parsed.data, 'patch_schema', 'operations')

      const current = listTables().filter((t) => t.designId === d.id)
      const { tables, changes, warnings } = applyOperations(d.id, current, parsed.data, newId)
      assertTablesConsistent(tables) // 연산 조합이 만든 어긋남까지 저장 전에 잡는다
      replaceTablesForDesign(d.id, tables)
      notifyStoreChanged({ domain: 'tables', designId: d.id })
      return { ...summarize(d, tables), applied: parsed.data.length, changes, warnings }
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
      assertCleanText(args.note ?? '', 'create_version')
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
