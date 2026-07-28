import { ipcMain } from 'electron'
import { envelope } from '../envelope'
import { decrypt, encrypt } from '../../infra/crypto'
import { prepareCommand, redactSecrets, runCli } from './command'
import type { ProviderPublic, RunOutcome } from './contract'
import {
  appendRun,
  createDesign,
  deleteCatalog,
  deleteDesign,
  deleteMwConnection,
  deleteProvider,
  getMwConnection,
  getProvider,
  latestSnapshot,
  listCatalogs,
  listDesigns,
  listEdges,
  listMwConnections,
  listNodes,
  listProviders,
  listRuns,
  replaceGraph,
  saveCatalog,
  saveMwConnection,
  saveProvider,
  saveSnapshot,
  updateDesign,
  type EdgeRow,
  type MwConnectionPublic,
  type NodeRow,
  type ProbeOutcomeRow,
  type ResourceRow,
  type SaveCatalogInput
} from './store'
import { redisRun } from './middleware/redis'
import { flattenReply, isRespError, type RespValue } from './middleware/resp'

/**
 * Infra 서비스의 IPC 채널.
 *
 * 새 채널은 `src/main/ai/coverage/infra.ts` 에 노출 또는 제외로 등재해야 `npm test` 를 통과한다
 * (절대 불변식 4). 이 폴더 밖(진입점·다른 서비스)은 건드리지 않는다.
 */

/** 공급자 레코드에서 비밀을 걷어내고 렌더러로 보낼 형태만 남긴다. */
const toPublic = (p: {
  id: string
  catalogId: string
  name: string
  readOnly: boolean
  credEncrypted: string
}): ProviderPublic => ({
  id: p.id,
  catalogId: p.catalogId,
  name: p.name,
  readOnly: p.readOnly,
  hasCredentials: p.credEncrypted.length > 0
})

/**
 * 저장된 암호문을 풀어 `{{cred.*}}` 에 채울 값 묶음으로 만든다.
 * 못 풀면 빈 묶음을 준다 — 그러면 명령이 자리표시자에서 멎고(오류) 조용히 반쪽 명령이 돌지 않는다.
 */
function credentialsOf(providerId: string | null | undefined): Record<string, string> {
  if (!providerId) return {}
  const p = getProvider(providerId)
  if (!p || !p.credEncrypted) return {}
  try {
    const parsed = JSON.parse(decrypt(p.credEncrypted)) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export interface RunProbeInput {
  providerId?: string | null
  cmd: string
  args: string[]
  /** 비밀이 아닌 치환값(액션 인자·노드 값). */
  vars?: Record<string, string>
  timeoutMs?: number
}

/**
 * 명령 하나를 돌리고 결과를 그대로 돌려준다 — 탐침 편집기의 "한 번 돌려보기".
 *
 * 실패를 삼키지 않는다: 종료 코드·표준 오류·시간 초과를 그대로 실어 보낸다.
 * 이력에는 **치환 전** 인자만 남긴다(자격증명이 이력에 눌러앉지 않게).
 */
async function runProbe(input: RunProbeInput): Promise<RunOutcome> {
  const cred = credentialsOf(input.providerId)
  const prepared = prepareCommand(
    { cmd: input.cmd, args: input.args },
    { cred, arg: input.vars, node: input.vars }
  )
  const raw = await runCli(prepared, { timeoutMs: input.timeoutMs })
  // 상대가 자기 오류에 자격증명을 실어 돌려보내는 길을 여기서 끊는다 — **경계를 넘기 전에.**
  // 이걸 렌더러에서 하면 평문이 이미 프로세스를 건넌 뒤라 늦다.
  const result = {
    ...raw,
    stdout: redactSecrets(raw.stdout, cred),
    stderr: redactSecrets(raw.stderr, cred),
    error: raw.error ? redactSecrets(raw.error, cred) : raw.error
  }
  appendRun({
    providerId: input.providerId ?? null,
    kind: 'probe',
    cmd: prepared.cmd,
    displayArgs: prepared.display,
    ok: result.ok,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    error: result.error ?? result.stderr.slice(0, 500)
  })
  return { ...result, displayCommand: [prepared.cmd, ...prepared.display].join(' ') }
}

export interface RunActionInput {
  providerId: string
  cmd: string
  args: string[]
  /** 실물에서 온 값(`{{node.*}}`). */
  node?: Record<string, string>
  /** 사용자가 폼에 채운 값(`{{arg.*}}`). */
  arg?: Record<string, string>
  /** 실물을 바꾸는 액션인가 — 읽기 전용 연결에서 막을 근거. */
  danger?: boolean
  timeoutMs?: number
}

/**
 * 액션 하나를 실행한다 — **Rockury 가 실물을 바꾸는 유일한 통로**(D1).
 *
 * 그래서 잠금을 여기서 **다시** 강제한다. 화면에서만 막으면 그건 잠금이 아니라 권유다 —
 * 창구는 렌더러가 부르는 것이고, 렌더러 코드가 바뀌면(또는 버그가 나면) 그대로 열린다.
 * 읽기 전용 표시는 보조선이지만, 보조선조차 우회되면 표시가 거짓말이 된다.
 */
async function runAction(input: RunActionInput): Promise<RunOutcome> {
  const provider = getProvider(input.providerId)
  if (!provider) throw new Error('공급자 연결을 찾을 수 없습니다.')
  if (input.danger && provider.readOnly) {
    throw new Error('이 연결은 읽기 전용으로 표시돼 있어 실물을 바꾸는 액션을 돌릴 수 없습니다.')
  }
  const cred = credentialsOf(input.providerId)
  const prepared = prepareCommand(
    { cmd: input.cmd, args: input.args },
    { cred, node: input.node, arg: input.arg }
  )
  const raw = await runCli(prepared, { timeoutMs: input.timeoutMs })
  const result = {
    ...raw,
    stdout: redactSecrets(raw.stdout, cred),
    stderr: redactSecrets(raw.stderr, cred),
    error: raw.error ? redactSecrets(raw.error, cred) : raw.error
  }
  appendRun({
    providerId: input.providerId,
    kind: 'action',
    cmd: prepared.cmd,
    displayArgs: prepared.display,
    ok: result.ok,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    error: result.error ?? result.stderr.slice(0, 500)
  })
  return { ...result, displayCommand: [prepared.cmd, ...prepared.display].join(' ') }
}

// ---------- 미들웨어 (M5) ----------

/** 화면으로 나가는 접속 — 암호문도 평문도 담지 않는다. */
const toMwPublic = (r: {
  id: string
  kind: string
  name: string
  host: string
  port: number
  username: string
  secretEncrypted: string
  options: string
}): MwConnectionPublic => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  host: r.host,
  port: r.port,
  username: r.username,
  hasSecret: r.secretEncrypted !== '',
  options: r.options
})

export interface SaveMwInput {
  id?: string
  kind: string
  name: string
  host: string
  port: number
  username?: string
  /** 평문. **여기서 즉시 암호화하고 저장 뒤에는 어디에도 남기지 않는다.** */
  secret?: string
  options?: string
}

export interface RunMwInput {
  connectionId: string
  /** 명령 한 줄씩. 인자는 배열이라 값에 공백·줄바꿈이 있어도 명령이 쪼개지지 않는다. */
  commands: string[][]
  timeoutMs?: number
}

export interface RunMwResult {
  ok: boolean
  /** 화면 콘솔에 뿌릴 한 덩어리(명령별). */
  outputs: string[]
  /** 서버가 거절한 명령이 있었나 — 못 붙은 것(`error`)과 구분한다. */
  hadCommandError: boolean
  error?: string
  durationMs: number
}

/**
 * 미들웨어 명령을 돌린다 — 지금은 Redis 만.
 *
 * 접속을 들고 있지 않고 **한 번 붙어 돌리고 끊는다**(`middleware/redis.ts` 주석의 근거).
 * 못 붙은 것과 서버가 거절한 것을 구분해 돌려준다 — 뭉개면 "주소가 틀렸다"와 "명령이 틀렸다"를
 * 사용자가 못 가른다.
 */
async function runMw(input: RunMwInput): Promise<RunMwResult> {
  const conn = getMwConnection(input.connectionId)
  if (!conn) throw new Error('미들웨어 접속을 찾을 수 없습니다.')
  if (conn.kind !== 'redis') {
    throw new Error(`아직 Redis 만 지원합니다(이 접속은 '${conn.kind}').`)
  }
  const secret = conn.secretEncrypted ? decrypt(conn.secretEncrypted) : undefined
  const opts = JSON.parse(conn.options || '{}') as { db?: number }
  const r = await redisRun(
    {
      host: conn.host,
      port: conn.port,
      username: conn.username || undefined,
      password: secret,
      db: opts.db,
      timeoutMs: input.timeoutMs
    },
    input.commands
  )
  appendRun({
    providerId: null,
    kind: 'middleware',
    cmd: `${conn.kind}:${conn.name}`,
    // 명령 이름만 남긴다 — 값(키·비밀)을 이력에 눌러앉히지 않는다.
    displayArgs: input.commands.map((c) => c[0] ?? ''),
    ok: r.ok,
    exitCode: null,
    durationMs: r.durationMs,
    error: r.error ?? ''
  })
  const replies: RespValue[] = r.replies
  return {
    ok: r.ok,
    outputs: replies.map((v) => flattenReply(v)),
    hadCommandError: replies.some(isRespError),
    error: r.error,
    durationMs: r.durationMs
  }
}

export function registerInfraIpc(): void {
  // --- 카탈로그 ---
  ipcMain.handle('infra:listCatalogs', () => envelope(() => listCatalogs()))
  ipcMain.handle('infra:saveCatalog', (_e, input: SaveCatalogInput) =>
    envelope(() => saveCatalog(input))
  )
  ipcMain.handle('infra:deleteCatalog', (_e, id: string) => envelope(() => deleteCatalog(id)))

  // --- 공급자 연결 ---
  ipcMain.handle('infra:listProviders', () => envelope(() => listProviders().map(toPublic)))
  ipcMain.handle(
    'infra:saveProvider',
    (
      _e,
      input: {
        id?: string
        catalogId: string
        name: string
        readOnly: boolean
        credentials?: Record<string, string>
      }
    ) =>
      envelope(() => {
        // 평문은 여기서 곧바로 암호문이 된다 — 저장 계층으로는 암호문만 내려간다.
        const existing = input.id ? getProvider(input.id) : null
        const credEncrypted = input.credentials
          ? encrypt(JSON.stringify(input.credentials))
          : (existing?.credEncrypted ?? '')
        return toPublic(saveProvider({ ...input, credEncrypted }))
      })
  )
  ipcMain.handle('infra:deleteProvider', (_e, id: string) => envelope(() => deleteProvider(id)))

  // --- 설계본 ---
  ipcMain.handle('infra:listDesigns', () => envelope(() => listDesigns()))
  ipcMain.handle('infra:createDesign', (_e, input: { name: string; description?: string }) =>
    envelope(() => createDesign(input))
  )
  ipcMain.handle(
    'infra:updateDesign',
    (_e, id: string, patch: { name?: string; description?: string }) =>
      envelope(() => updateDesign(id, patch))
  )
  ipcMain.handle('infra:deleteDesign', (_e, id: string) => envelope(() => deleteDesign(id)))
  ipcMain.handle('infra:getGraph', (_e, designId: string) =>
    envelope(() => ({ nodes: listNodes(designId), edges: listEdges(designId) }))
  )
  ipcMain.handle(
    'infra:saveGraph',
    (_e, designId: string, nodes: Omit<NodeRow, 'designId'>[], edges: Omit<EdgeRow, 'designId'>[]) =>
      envelope(() => replaceGraph(designId, nodes, edges))
  )

  // --- 실물 스냅샷 ---
  // 탐침 해석(형식·표현식·상태 사전)은 카탈로그를 들고 있는 렌더러가 한다 —
  // 메인은 명령을 돌리고 결과를 담아 둘 뿐이다.
  ipcMain.handle(
    'infra:saveSnapshot',
    (_e, input: { providerId: string; probes: ProbeOutcomeRow[]; resources: ResourceRow[] }) =>
      envelope(() => saveSnapshot(input))
  )
  ipcMain.handle('infra:latestSnapshot', (_e, providerId: string) =>
    envelope(() => latestSnapshot(providerId))
  )

  // --- 탐침 실행·이력 ---
  ipcMain.handle('infra:runProbe', (_e, input: RunProbeInput) => envelope(() => runProbe(input)))
  ipcMain.handle('infra:runAction', (_e, input: RunActionInput) => envelope(() => runAction(input)))
  ipcMain.handle('infra:listRuns', (_e, limit?: number) => envelope(() => listRuns(limit)))

  // --- 미들웨어 접속·콘솔 (M5) ---
  ipcMain.handle('infra:listMwConnections', () =>
    envelope(() => listMwConnections().map(toMwPublic))
  )
  ipcMain.handle('infra:saveMwConnection', (_e, input: SaveMwInput) =>
    envelope(() =>
      toMwPublic(
        saveMwConnection({
          ...input,
          // 평문은 여기서 즉시 암호문으로 바뀌고, 그 뒤로는 어디에도 남지 않는다.
          secretEncrypted: input.secret ? encrypt(input.secret) : undefined
        })
      )
    )
  )
  ipcMain.handle('infra:deleteMwConnection', (_e, id: string) =>
    envelope(() => deleteMwConnection(id))
  )
  ipcMain.handle('infra:runMw', (_e, input: RunMwInput) => envelope(() => runMw(input)))
}
