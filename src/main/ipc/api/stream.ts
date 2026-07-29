import { BrowserWindow, ipcMain } from 'electron'
import { getSpec, versionMatchingDraft } from '../../store/apiSpecs'
import { appendRun, getEnvironment, pruneRuns, RUN_KEEP } from '../../store/apiOps'
import {
  closeAllSessions,
  closeSession,
  openSession,
  sendToSession,
  type EndedSessionHandle,
  type SessionEvent
} from '../../api/streamSession'
import { composeRequest } from '../../../shared/api/compose'
import { buildScope, type Scope } from '../../../shared/api/resolve'
import { blockingIssues, renderTemplate } from '../../../shared/api/template'
import { redactText, secretValues } from '../../../shared/api/redact'
import { nodeFunctionEnv } from '../../../shared/api/nodeFunctionEnv'
import { parseGrpcTarget } from '../../../shared/api/grpcTarget'
import { grpcStreamBlocker } from '../../../shared/api/stream'
import {
  sendPanelVisible,
  sessionToRun,
  transportFor,
  type StreamTransport
} from '../../../shared/api/stream'
import { SHAPE_LABEL, type InteractionShape, type RunRecord, type StreamMessage } from '../../../shared/api/types'

export interface OpenStreamInput {
  /**
   * **렌더러가 만들어 보낸다.** 메인이 만들어 응답으로 돌려주면, 붙자마자 동기로 실패하는
   * 경우(주소 스킴 오타 등) 오류·종료 이벤트가 **응답보다 먼저** 도착해 화면이 그걸
   * 자기 세션 것으로 못 알아보고 버린다 — 그러면 상태가 '접속 중' 에 영구히 갇히고
   * 끊기 버튼도 죽는다(세션은 이미 정리됐으므로 no-op). 화면이 먼저 id 를 알면
   * 이벤트를 놓칠 창이 아예 없다.
   */
  sessionId: string
  specId: string
  requestName: string
  environmentId: string
  call: Record<string, string>
  /** 자동 재접속 (AC-4). */
  autoReconnect: boolean
  baseVersion?: string | null
}

export interface OpenStreamResult {
  transport: StreamTransport
  /** **가려진** 접속 주소 — 화면이 "어디에 붙었나"를 보이는 데 쓴다. */
  url: string
}

/**
 * 세션이 끝났을 때 화면으로 밀어 주는 것.
 * 끝맺음이 사용자 조작이 아닐 수도 있어서(서버가 끊음·재접속 소진) 응답이 아니라 이벤트다.
 */
export interface StreamEndedEvent {
  sessionId: string
  run: RunRecord
  /** 보관 상한으로 지워진 기록 건수. */
  pruned: number
  /** 타임라인 상한으로 버린 메시지 건수 — 조용한 소실 금지. */
  dropped: number
}

/**
 * 세션을 저장할 때 필요한 것들. 세션이 살아 있는 동안 메인이 들고 있는다 —
 * 화면을 나갔다 와도 세션은 살아 있어야 하므로 렌더러에 맡길 수 없다.
 */
interface SessionContext {
  input: OpenStreamInput
  transport: StreamTransport
  shape: InteractionShape
  /** 가려진 것 — Run 에 그대로 들어간다. */
  maskedUrl: string
  maskedHeaders: Record<string, string>
  /** 가린 호출 파라미터 — Run 에 그대로 들어간다. */
  maskedCall: Record<string, string>
  baseVersion: string | null
  environmentName: string
  /** 보낼 메시지의 `{{변수}}` 를 실값으로 바꿀 때 쓰는 자리. */
  scope: Scope
}

const contexts = new Map<string, SessionContext>()

/**
 * 지금 이 환경이 아는 비밀 전부.
 *
 * 세션을 열 때 뜬 목록을 그대로 쓰면, 세션 도중에 환경에 비밀을 추가한 뒤 오는 메시지가
 * **안 가려진다**(리뷰가 짚은 자리). 매번 환경을 다시 읽되 **읽기 실패는 세션을 안 죽인다** —
 * 그때는 시작 시점 목록으로 물러난다(가리는 것이 없는 것보다 낫다).
 */
function currentSecrets(environmentId: string, fallback: string[]): string[] {
  try {
    const env = getEnvironment(environmentId)
    return env ? secretValues(env.values) : fallback
  } catch {
    return fallback
  }
}

/**
 * 운영부 IPC — 스트림 세션(`docs/spec/api-runner.md` § stream.session).
 *
 * 단발 전송(`api:send`)과 같은 규율을 그대로 쓴다:
 *   · 조립을 **두 번** 한다 — 실제로 붙을 것(실값) / 남길 것(가림)
 *   · 못 보내는 이유는 실행 전에 막고 이름을 지목한다
 *   · 실행은 사람이 앱에서만 한다 — MCP 에는 이 채널이 없다
 *
 * 다른 점 하나: 세션은 **오래 살고 스스로 끝날 수도 있다.** 그래서 결과를 응답으로
 * 돌려주는 대신 `api:stream` 으로 밀어 주고, 끝나는 자리 **한 곳**에서 Run 으로 굳힌다
 * (사용자가 껐든 서버가 끊었든 같은 자리로 모인다 — 두 경로를 두면 한쪽이 기록을 빠뜨린다).
 */
export function registerApiStreamIpc(): void {
  const send = (channel: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }
  const emit = (e: SessionEvent): void => send('api:stream', e)

  const finalize = (handle: EndedSessionHandle): void => {
    const ctx = contexts.get(handle.id)
    contexts.delete(handle.id)
    if (!ctx) return

    // 세션 하나가 Run 하나가 된다 (AC-6). 메시지는 이미 가려진 채로 쌓여 있다.
    const run = appendRun(
      sessionToRun({
        specId: ctx.input.specId,
        requestName: ctx.input.requestName,
        environmentId: ctx.input.environmentId,
        environmentName: ctx.environmentName,
        baseVersion: ctx.baseVersion,
        shape: ctx.shape,
        call: ctx.maskedCall,
        transport: ctx.transport,
        url: ctx.maskedUrl,
        headers: ctx.maskedHeaders,
        messages: handle.messages,
        startedAt: handle.startedAt,
        endedAt: new Date().toISOString(),
        outcome: handle.outcome,
        closeReason:
          handle.droppedCount > 0
            ? `${handle.closeReason ?? ''} 타임라인 상한으로 오래된 메시지 ${handle.droppedCount}건이 빠졌습니다.`.trim()
            : handle.closeReason
      })
    )

    const ended: StreamEndedEvent = {
      sessionId: handle.id,
      run,
      pruned: pruneRuns(ctx.input.specId, RUN_KEEP).removed,
      dropped: handle.droppedCount
    }
    send('api:streamEnded', ended)
  }

  ipcMain.handle('api:openStream', (_e, input: OpenStreamInput): OpenStreamResult => {
    const spec = getSpec(input.specId)
    if (!spec) throw new Error(`명세 "${input.specId}" 가 없습니다.`)
    const request = spec.requests.find((r) => r.name === input.requestName)
    if (!request) throw new Error(`요청 "${input.requestName}" 이(가) 없습니다.`)

    const pick = transportFor(spec.kind, request.shape)
    // 못 하는 것을 있는 전송으로 흉내 내지 않는다 — 사유를 그대로 올린다.
    if (!pick.transport) throw new Error(pick.unsupported ?? '이 요청은 스트림으로 열 수 없습니다.')

    const env = getEnvironment(input.environmentId)
    if (!env) throw new Error('환경을 먼저 고르세요 — 어디로 붙을지 정해지지 않았습니다.')

    const base = { kind: spec.kind, request, env, call: input.call, functions: nodeFunctionEnv }
    const real = composeRequest(base)
    const masked = composeRequest({ ...base, maskSecrets: true })
    // 화면이 이미 막고 있지만, 다른 경로도 같은 관문을 지나야 한다(단발 전송과 같은 이유).
    // 문구는 **가린 쪽**을 쓴다 — 내장 함수 오류가 받은 인자를 그대로 인용하기 때문이다.
    if (!real.canSend) {
      throw new Error(masked.blocking.map((b) => `${b.where}: ${b.message}`).join('\n'))
    }

    const secrets = secretValues(env.values)

    // gRPC 는 붙기 전에 조건이 더 있다. **붙어 본 뒤가 아니라 여기서** 막는다 —
    // 정의를 받아 오는 왕복이 최대 20초라, 뒤에서 막으면 그만큼 기다렸다 실패한다.
    const grpcTarget = parseGrpcTarget(env.baseUrl)
    if (pick.transport === 'grpc') {
      const why = grpcStreamBlocker(request, grpcTarget, real.headers, secrets)
      if (why) throw new Error(why)
    }

    const sessionId = input.sessionId

    contexts.set(sessionId, {
      input,
      transport: pick.transport,
      shape: request.shape,
      maskedUrl: masked.url,
      maskedHeaders: masked.headers,
      maskedCall: Object.fromEntries(
        Object.entries(input.call).map(([k, v]) => [k, redactText(v, secrets)])
      ),
      // 호출자가 안 정했으면 Draft 가 어느 버전과 똑같은지로 정한다(단발과 같은 규칙).
      baseVersion: input.baseVersion ?? versionMatchingDraft(spec.id),
      environmentName: env.name,
      scope: buildScope({ params: request.params, env, call: input.call })
    })

    openSession(
      {
        sessionId,
        transport: pick.transport,
        url: real.url,
        // 화면·기록에 적을 것은 **조립기가 가린 것**을 쓴다. `redact` 는 글자 그대로 일치만
        // 지우는데 주소 값은 URL 인코딩을 거쳐 원문과 안 맞는다(그래서 안 지워졌었다).
        displayUrl: masked.url,
        headers: real.headers,
        autoReconnect: input.autoReconnect,
        // gRPC 는 주소만으로 못 연다 — 어느 메서드인지와 암호화 여부가 따로 필요하다.
        // 메서드 이름은 요청 정의에 있고(`grpcMethod`), 접속 대상은 환경 주소에서 읽는다.
        ...(pick.transport === 'grpc'
          ? {
              grpc: {
                target: grpcTarget,
                method: request.request.grpcMethod ?? '',
                declaredShape: request.shape,
                // 서버 스트리밍의 첫 메시지 — 실값 / 기록·문구용 가림 두 벌.
                body: real.body,
                displayBody: masked.body
              }
            }
          : {}),
        // **비밀 목록을 세션 시작 시점에 가두지 않는다.** 세션은 오래 사는데 그동안 환경에
        // 비밀이 새로 추가될 수 있고, 가둬 두면 그 뒤 오는 메시지가 안 가려진다.
        // 붙어 있는 것(주소·헤더)은 안 바뀌는 게 맞지만 **가리는 그물은 늘 최신이어야 한다.**
        redact: (t) => redactText(t, currentSecrets(env.id, secrets))
      },
      emit,
      finalize
    )

    return { transport: pick.transport, url: masked.url }
  })

  ipcMain.handle('api:sendStream', (_e, sessionId: string, text: string): StreamMessage => {
    const ctx = contexts.get(sessionId)
    if (!ctx) throw new Error('세션이 없습니다 — 이미 끊겼거나 열린 적이 없습니다.')
    // 화면은 보내기 패널을 안 그리지만 창구는 열려 있다. 여기서 안 막으면 서버 스트리밍
    // 세션에 "연결돼 있지 않습니다" 라는 **틀린 이유**가 돌아간다(배지는 '연결됨' 인데).
    if (!sendPanelVisible(ctx.shape)) {
      // 모양 이름은 `SHAPE_LABEL` 을 쓴다 — 여기서만 옛말("서버 스트리밍")을 쓰면
      // 같은 개념이 화면과 오류 문구에서 두 어휘가 된다.
      throw new Error(
        `이 전송은 한 방향입니다 — '${SHAPE_LABEL[ctx.shape]}' 세션에는 보내기가 없습니다.`
      )
    }

    // 보낼 메시지도 `{{변수}}` 를 쓴다. 안 그러면 사용자가 토큰을 손으로 붙여넣게 되고,
    // 그 글자가 그대로 기록에 남는다 — 가리는 장치를 우회하는 길이 하나 생기는 셈이다.
    //
    // 단발 전송과 같이 **두 벌**을 만든다: 소켓에 나갈 것 / 남길 것.
    // 한 벌만 만들고 `redact` 로 때우면 `{{base64(apiKey)}}` 처럼 **가공된 비밀**이 새어
    // 나간다 — 글자 그대로 일치가 아니라서 안 지워지고, 디코드하면 원 키다.
    const opts = { scope: ctx.scope, env: nodeFunctionEnv }
    const real = renderTemplate(text, opts)
    const issues = blockingIssues(real)
    if (issues.length > 0) {
      // 가린 쪽 문구를 올린다 — 내장 함수 오류는 받은 인자를 그대로 인용한다.
      const safe = blockingIssues(renderTemplate(text, { ...opts, maskSecrets: true }))
      throw new Error((safe.length > 0 ? safe : issues).map((i) => i.message).join('\n'))
    }
    const masked = renderTemplate(text, { ...opts, maskSecrets: true })

    return sendToSession(sessionId, real.text, masked.text)
  })

  // 렌더러가 새로 뜨면(개발 리로드·창 재생성) 세션의 주인이 사라진다 — 끊을 창구가 없는
  // 소켓이 남고, 자동 재접속이 켜져 있었으면 계속 다시 붙는다. 새 화면은 자기가 여는 것만
  // 안다는 규율(Inbox 도 같다: 앱을 켜면 대기는 꺼짐)에 맞춰 여기서 정리한다.
  ipcMain.handle('api:closeAllStreams', (): void => closeAllSessions())

  // 끊기는 값을 안 돌려준다 — Run 은 `api:streamEnded` 로 온다(서버가 먼저 끊었을 때와 같은 길).
  ipcMain.handle('api:closeStream', (_e, sessionId: string): void => closeSession(sessionId))
}

/** 앱이 꺼질 때 열린 소켓을 남기지 않는다. */
export function shutdownApiStreams(): void {
  closeAllSessions()
  contexts.clear()
}
