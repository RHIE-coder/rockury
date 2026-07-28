import { ipcMain } from 'electron'
import { envelope } from '../envelope'
import { decrypt, encrypt } from '../../infra/crypto'
import { prepareCommand, runCli } from './command'
import type { ProviderPublic, RunOutcome } from './contract'
import {
  appendRun,
  createDesign,
  deleteCatalog,
  deleteDesign,
  deleteProvider,
  getProvider,
  latestSnapshot,
  listCatalogs,
  listDesigns,
  listEdges,
  listNodes,
  listProviders,
  listRuns,
  replaceGraph,
  saveCatalog,
  saveProvider,
  saveSnapshot,
  updateDesign,
  type EdgeRow,
  type NodeRow,
  type ProbeOutcomeRow,
  type ResourceRow,
  type SaveCatalogInput
} from './store'

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
  const prepared = prepareCommand(
    { cmd: input.cmd, args: input.args },
    { cred: credentialsOf(input.providerId), arg: input.vars, node: input.vars }
  )
  const result = await runCli(prepared, { timeoutMs: input.timeoutMs })
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
  ipcMain.handle('infra:listRuns', (_e, limit?: number) => envelope(() => listRuns(limit)))
}
