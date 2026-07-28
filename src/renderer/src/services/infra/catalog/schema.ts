import { z } from 'zod'
import { APP_SCHEMA_VERSION, type Catalog } from './types'

/**
 * 카탈로그 형식 검증 — **믿을 수 없는 입력**을 다루는 자리다.
 * 사용자가 만든 것도, 남에게서 가져온 것도 여기를 통과해야 앱에 들어온다.
 *
 * 원칙 셋:
 *  1. **전부 아니면 전무.** 한 종류가 틀리면 성한 종류만 골라 담지 않는다 —
 *     반쯤 적재된 카탈로그는 "왜 이 노드가 안 보이지"로 나타나 추적이 어렵다.
 *  2. **자격증명 값은 파일에 못 들어온다.** 참조(`{{cred.x}}`)만 허용한다.
 *  3. **형식 버전이 앱보다 높으면 읽지 않는다.** 모르는 형식을 짐작해 읽지 않는다.
 */

const STATUS = z.enum(['ok', 'warn', 'stopped', 'gone', 'unknown'])

const cliCall = z.strictObject({
  type: z.literal('cli'),
  cmd: z.string().min(1, '명령 이름은 비울 수 없습니다'),
  // 배열인 것이 핵심 — 셸을 안 거치므로 치환값이 인자를 쪼개거나 명령을 덧붙이지 못한다.
  args: z.array(z.string())
})

const httpCall = z.strictObject({
  type: z.literal('http'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional()
})

const builtinCall = z.strictObject({
  type: z.literal('builtin'),
  adapter: z.string().min(1),
  op: z.string().min(1),
  params: z.record(z.string(), z.string()).optional()
})

const probeCall = z.discriminatedUnion('type', [cliCall, httpCall, builtinCall])

const discover = z.strictObject({
  call: probeCall,
  format: z.enum(['json', 'ndjson']).optional(),
  list: z.string().min(1, '목록 표현식은 비울 수 없습니다'),
  map: z.strictObject({
    externalId: z.string().min(1, 'externalId 표현식은 필수입니다'),
    name: z.string().optional(),
    status: z.string().optional(),
    parentExternalId: z.string().optional(),
    designNodeRef: z.string().optional()
  }),
  statusMap: z.record(z.string(), STATUS).optional()
})

const actionDef = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  danger: z.boolean().optional(),
  call: probeCall,
  args: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
        required: z.boolean().optional(),
        placeholder: z.string().optional()
      })
    )
    .optional()
})

const docTemplate = z
  .strictObject({
    role: z.string().optional(),
    impact: z.string().optional(),
    owner: z.string().optional(),
    deps: z.string().optional(),
    beforeTouch: z.string().optional(),
    notes: z.string().optional(),
    links: z.array(z.strictObject({ label: z.string(), url: z.string() })).optional()
  })
  .optional()

const nodeType = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().min(1),
  color: z.string().optional(),
  canNestIn: z.array(z.string()).optional(),
  canContain: z.array(z.string()).optional(),
  canLinkTo: z.array(z.string()).optional(),
  docTemplate,
  discover: discover.optional(),
  actions: z.array(actionDef).optional(),
  compareFields: z.array(z.enum(['status', 'parent', 'type'])).optional()
})

const catalogSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
  catalogVersion: z.string().min(1),
  provider: z.strictObject({ id: z.string().min(1), label: z.string().min(1) }),
  credentials: z
    .array(z.strictObject({ id: z.string().min(1), label: z.string().min(1), hint: z.string().optional() }))
    .optional(),
  nodeTypes: z.array(nodeType).min(1, '노드 종류가 하나도 없습니다')
})

/**
 * 파일에 박힌 비밀값 탐지.
 *
 * **이건 완전한 검사가 아니다** — 모든 비밀을 알아볼 수는 없다. 흔한 모양만 막아
 * 실수로 키가 든 카탈로그를 공유하는 사고를 줄이는 것이 목적이고, 진짜 방어선은
 * "자격증명은 참조로만 쓴다"는 규칙 자체다.
 */
const SECRET_PATTERNS: { re: RegExp; what: string }[] = [
  { re: /\bAKIA[0-9A-Z]{16}\b/, what: 'AWS 액세스 키로 보이는 값' },
  { re: /Bearer\s+[A-Za-z0-9._~+/-]{20,}/, what: 'Bearer 토큰으로 보이는 값' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: '개인키로 보이는 값' }
]

const CRED_REF_RE = /\{\{cred\.([A-Za-z0-9_-]+)\}\}/g

function credentialProblems(catalog: Catalog): string[] {
  const errors: string[] = []
  const text = JSON.stringify(catalog)

  for (const { re, what } of SECRET_PATTERNS) {
    if (re.test(text)) {
      errors.push(`자격증명 값이 카탈로그에 박혀 있습니다(${what}). 참조 '{{cred.<이름>}}' 만 쓸 수 있습니다.`)
    }
  }

  const declared = new Set((catalog.credentials ?? []).map((c) => c.id))
  const used = new Set<string>()
  for (const m of text.matchAll(CRED_REF_RE)) used.add(m[1])
  for (const id of used) {
    if (!declared.has(id)) {
      errors.push(`선언되지 않은 자격증명을 참조합니다: '${id}' (credentials 에 먼저 선언하세요)`)
    }
  }
  return errors
}

/** 종류 사이 참조(중첩·연결)가 실재하는 종류를 가리키는지. 여기서 막아야 그림이 조용히 깨지지 않는다. */
function referenceProblems(catalog: Catalog): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  for (const t of catalog.nodeTypes) {
    if (ids.has(t.id)) {
      errors.push(`노드 종류 id 가 중복입니다: '${t.id}' — 뒤엣것이 조용히 덮이므로 금지합니다.`)
    }
    ids.add(t.id)
  }
  for (const t of catalog.nodeTypes) {
    for (const parent of t.canNestIn ?? []) {
      if (!ids.has(parent)) {
        errors.push(`'${t.id}' 의 canNestIn 이 없는 종류를 가리킵니다: '${parent}'`)
      }
    }
    for (const child of t.canContain ?? []) {
      // '*' 는 "무엇이든" 이라는 뜻이라 실재하는 종류일 필요가 없다.
      if (child !== '*' && !ids.has(child)) {
        errors.push(`'${t.id}' 의 canContain 이 없는 종류를 가리킵니다: '${child}'`)
      }
    }
    for (const target of t.canLinkTo ?? []) {
      if (!ids.has(target)) {
        errors.push(`'${t.id}' 의 canLinkTo 가 없는 종류를 가리킵니다: '${target}'`)
      }
    }
  }
  return errors
}

export type CatalogParse = { ok: true; catalog: Catalog } | { ok: false; errors: string[] }

/**
 * 카탈로그 하나를 검증해 들여온다. 실패하면 **결과에 catalog 가 아예 없다** —
 * 부분 적재가 물리적으로 불가능하도록 반환 형태로 못 박는다.
 */
export function parseCatalog(raw: unknown): CatalogParse {
  // 형식 버전 먼저 — 모르는 형식은 파싱조차 하지 않는다.
  const version = (raw as { schemaVersion?: unknown })?.schemaVersion
  if (typeof version === 'number' && version > APP_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `schemaVersion ${version} 은 이 앱이 아는 형식(${APP_SCHEMA_VERSION})보다 높습니다. ` +
          `Rockury 를 업데이트한 뒤 다시 가져오세요.`
      ]
    }
  }

  const parsed = catalogSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(최상위)'}: ${i.message}`)
    }
  }

  const catalog = parsed.data as Catalog
  const errors = [...referenceProblems(catalog), ...credentialProblems(catalog)]
  if (errors.length) return { ok: false, errors }
  return { ok: true, catalog }
}

/**
 * 내보내기 — 파일로 나가기 직전 마지막 관문.
 * 검증을 통과해 들어온 카탈로그라도 편집 중에 값이 박힐 수 있으므로 여기서 한 번 더 본다.
 */
export function serializeCatalog(catalog: Catalog): string {
  const problems = credentialProblems(catalog)
  if (problems.length) throw new Error(problems.join('\n'))
  return JSON.stringify(catalog, null, 2)
}
