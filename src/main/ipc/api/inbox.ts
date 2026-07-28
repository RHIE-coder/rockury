import { app, BrowserWindow, ipcMain } from 'electron'
import { getSpec, versionMatchingDraft } from '../../store/apiSpecs'
import { appendRun, getEnvironment, pruneRuns, RUN_KEEP } from '../../store/apiOps'
import {
  inboxState,
  MAX_RECEIVED,
  PortInUseError,
  startInbox,
  stopInbox,
  type InboxState,
  type RawInbound
} from '../../api/inboxServer'
import {
  DEFAULT_INBOX_PORT,
  inboxUrl,
  matchExpectedBody,
  receivedToRun,
  type ReceivedRequest
} from '../../../shared/api/inbox'
import { redactHeaders, redactText, secretValues } from '../../../shared/api/redact'
import type { RunRecord } from '../../../shared/api/types'

export interface StartInboxInput {
  specId: string
  requestName: string
  environmentId: string
  port?: number
  /** 되돌려줄 코드 (AC-5). 기본 200 — 재전송을 유도하려면 실패 코드도 낼 수 있어야 한다. */
  responseCode?: number
}

export interface InboxStatus extends InboxState {
  /** 화면에 보이는 수신 주소. 로컬 전용이라 호스트가 고정이다. */
  url: string | null
  specId: string | null
  requestName: string | null
  responseCode: number
  /** 상한으로 목록에서 버린 건수 — 조용한 소실 금지. */
  dropped: number
}

/** 수신 하나가 들어왔을 때 화면으로 밀어 주는 것. */
export interface InboxReceivedEvent {
  received: ReceivedRequest
  run: RunRecord | null
  /** 보관 상한으로 지워진 기록 건수. */
  pruned: number
  dropped: number
}

interface Listening {
  specId: string
  requestName: string
  environmentId: string
  environmentName: string
  /** 이 요청이 선언한 기대 본문. 없으면 대조가 `선언 없음` 이 된다. */
  expectedBody: string | undefined
  responseCode: number
  secrets: string[]
}

let active: Listening | null = null
let received: ReceivedRequest[] = []
let dropped = 0

function status(): InboxStatus {
  const s = inboxState()
  return {
    ...s,
    url: s.port === null ? null : inboxUrl(s.port),
    specId: active?.specId ?? null,
    requestName: active?.requestName ?? null,
    responseCode: active?.responseCode ?? 200,
    dropped
  }
}

/**
 * 웹훅 수신 IPC — `docs/spec/api-runner.md` § inbox.
 *
 * 4모양 중 방향이 반대인 하나다. 그래서 관문도 반대다:
 *   · 보낼 수 있나를 안 묻는다 — 대신 **들어온 것이 선언한 모양과 맞나**를 묻는다
 *   · 스트림처럼 오래 살지만, 무엇이 언제 올지 우리가 모른다 → 전부 이벤트로 밀어 준다
 *   · **로컬 전용**이라 화면 문구가 그 사실을 말하고, 호스트를 바꿀 손잡이가 없다
 */
export function registerApiInboxIpc(): void {
  const send = (channel: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }

  /** 들어온 요청 하나를 대조하고 기록한다. 서버 스레드에서 동기로 불린다. */
  const handle = (raw: RawInbound): { status: number } => {
    const cur = active
    if (!cur) return { status: 503 }

    // 비밀은 **기록에 들어가기 전에** 지운다(가린 뒤 저장 — send.observe AC-3 와 같은 규율).
    // 웹훅은 서명 헤더에 우리 비밀이 실려 오는 경우가 흔하다.
    const body = redactText(raw.body, cur.secrets)
    const item: ReceivedRequest = {
      id: raw.id,
      at: raw.at,
      method: raw.method,
      path: redactText(raw.path, cur.secrets),
      headers: redactHeaders(raw.headers, cur.secrets),
      // 상한을 넘겨 잘렸으면 **잘렸다고 적는다** — 조용히 짧아지면 안 된다.
      body: raw.truncated ? `${body}\n…(상한을 넘어 잘렸습니다 — 받은 크기 ${raw.size}바이트)` : body,
      size: raw.size,
      respondedWith: cur.responseCode,
      // 대조는 **원문 기준**이다. 가린 본문으로 대조하면 비밀이 실린 필드가 타입까지 바뀐다.
      match: matchExpectedBody(raw.body, cur.expectedBody)
    }

    received.push(item)
    if (received.length > MAX_RECEIVED) {
      received.shift()
      dropped += 1
    }

    let run: RunRecord | null = null
    let pruned = 0
    try {
      run = appendRun(
        receivedToRun({
          specId: cur.specId,
          requestName: cur.requestName,
          environmentId: cur.environmentId,
          environmentName: cur.environmentName,
          baseVersion: versionMatchingDraft(cur.specId),
          received: item
        })
      )
      pruned = pruneRuns(cur.specId, RUN_KEEP).removed
    } catch {
      // 기록이 실패해도 받은 사실은 화면에 보인다 — 기록은 부가물이지 관문이 아니다.
    }

    const event: InboxReceivedEvent = { received: item, run, pruned, dropped }
    send('api:inbox', event)
    return { status: cur.responseCode }
  }

  ipcMain.handle('api:startInbox', async (_e, input: StartInboxInput): Promise<InboxStatus> => {
    const spec = getSpec(input.specId)
    if (!spec) throw new Error(`명세 "${input.specId}" 가 없습니다.`)
    const request = spec.requests.find((r) => r.name === input.requestName)
    if (!request) throw new Error(`요청 "${input.requestName}" 이(가) 없습니다.`)
    if (request.shape !== 'inbound') {
      // 보내는 요청에 수신 대기를 걸 수 없다 — 모양이 곧 방향이다.
      throw new Error(`요청 "${request.name}" 은 받는 모양이 아닙니다 — 웹훅 요청에만 대기를 걸 수 있습니다.`)
    }
    const env = getEnvironment(input.environmentId)
    if (!env) throw new Error('환경을 먼저 고르세요 — 어느 환경의 관측으로 남길지 정해지지 않았습니다.')

    const code = input.responseCode ?? 200
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      throw new Error(`응답 코드 ${code} 는 HTTP 코드가 아닙니다 (100~599).`)
    }

    active = {
      specId: spec.id,
      requestName: request.name,
      environmentId: env.id,
      environmentName: env.name,
      expectedBody: request.request.expectedBody,
      responseCode: code,
      secrets: secretValues(env.values)
    }
    received = []
    dropped = 0

    try {
      await startInbox(input.port ?? DEFAULT_INBOX_PORT, { onReceived: handle })
    } catch (err) {
      active = null
      // 포트 충돌은 사유와 제안을 그대로 올린다 — 몰래 다른 포트로 옮기지 않는다(AC-2).
      throw err instanceof PortInUseError ? new Error(err.message) : err
    }
    const s = status()
    send('api:inboxStatus', s)
    return s
  })

  ipcMain.handle('api:stopInbox', async (): Promise<InboxStatus> => {
    await stopInbox()
    active = null
    const s = status()
    send('api:inboxStatus', s)
    return s
  })

  /** 지금 상태 + 받아 둔 것. 화면이 새로 떠도 대기 중인 것을 따라잡는다. */
  ipcMain.handle('api:getInbox', (): { status: InboxStatus; received: ReceivedRequest[] } => ({
    status: status(),
    received: received.slice()
  }))

  /** 되돌려줄 코드를 바꾼다 (AC-5). 대기를 끊지 않는다 — 재전송 유도를 켜고 끄는 자리다. */
  ipcMain.handle('api:setInboxResponse', (_e, code: number): InboxStatus => {
    if (!active) throw new Error('수신 대기가 꺼져 있습니다.')
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      throw new Error(`응답 코드 ${code} 는 HTTP 코드가 아닙니다 (100~599).`)
    }
    active.responseCode = code
    const s = status()
    send('api:inboxStatus', s)
    return s
  })

  // 앱이 꺼질 때 열린 포트를 남기지 않는다(스트림 소켓과 같은 자리).
  app.on('before-quit', () => void shutdownApiInbox())
}

export async function shutdownApiInbox(): Promise<void> {
  await stopInbox()
  active = null
  received = []
  dropped = 0
}
