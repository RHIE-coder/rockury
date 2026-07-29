import { app, BrowserWindow, ipcMain } from 'electron'
import { getSpec } from '../../store/apiSpecs'
import {
  mockState,
  MockPortInUseError,
  startMock,
  stopMock,
  type MockReply,
  type MockState
} from '../../api/mockServer'
import {
  DEFAULT_MOCK_PORT,
  matchRoute,
  mockBody,
  MOCK_GUESSED_HEADER,
  MOCK_HEADER,
  mockUnsupportedReason
} from '../../../shared/api/mock'

export interface StartMockInput {
  specId: string
  port?: number
  /** 요청 이름 → 낼 상태. 안 적으면 가장 낮은 2xx. 오류 경로를 짜 보려고 쓴다. */
  statusFor?: Record<string, string>
}

export interface MockStatus extends MockState {
  url: string | null
  specId: string | null
  /** 지금 흉내 내는 요청 수. */
  routes: number
  statusFor: Record<string, string>
}

/** 무엇이 오갔는지 화면이 보는 한 줄. **관측 기록(Run)이 아니다** — 우리가 만든 가짜다. */
export interface MockHitEvent {
  at: string
  method: string
  path: string
  status: number
  /** 어느 요청 선언이 답했나. 아무것도 안 맞았으면 null. */
  requestName: string | null
  /** 짐작으로 채운 필드 수. */
  guessed: number
  /** 못 답한 이유. 답했으면 null. */
  unavailable: string | null
}

interface Serving {
  specId: string
  statusFor: Record<string, string>
}

let active: Serving | null = null

function status(): MockStatus {
  const s = mockState()
  const spec = active ? getSpec(active.specId) : null
  return {
    ...s,
    url: s.port === null ? null : `http://127.0.0.1:${s.port}/`,
    specId: active?.specId ?? null,
    routes: spec ? spec.requests.filter((r) => r.shape === 'unary' && r.responses.length > 0).length : 0,
    statusFor: active?.statusFor ?? {}
  }
}

/**
 * 모의 서버 IPC — `docs/spec/api-studio.md` § mocking.server.
 *
 * 이 서비스의 한 문장이 여기서 특히 세게 걸린다 — **모르는 것을 안다고 말하지 않는다.**
 * 선언이 없으면 그럴듯한 JSON 을 지어내지 않고 **501 과 사유**를 준다. 지어내 주면
 * 프론트가 없는 계약 위에 화면을 짓고, 나중에 진짜 서버가 오면 통째로 다시 짓는다.
 *
 * **가짜 응답은 관측 기록(Run)이 되지 않는다.** 우리가 만든 것을 관측으로 쌓으면
 * 판정이 "선언 대 실제" 가 아니라 "선언 대 선언" 이 되어 늘 이상 없음이 된다.
 */
export function registerApiMockIpc(): void {
  const send = (channel: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }

  const reply = (input: { method: string; path: string }): MockReply => {
    const cur = active
    const spec = cur ? getSpec(cur.specId) : null
    const base: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      // 진짜 서버 응답과 섞이지 않게 **가짜임을 헤더로 밝힌다**.
      [MOCK_HEADER]: 'true'
    }

    const fail = (status: number, why: string, requestName: string | null): MockReply => {
      send('api:mockHit', {
        at: new Date().toISOString(),
        method: input.method,
        path: input.path,
        status,
        requestName,
        guessed: 0,
        unavailable: why
      } satisfies MockHitEvent)
      return { status, headers: base, body: JSON.stringify({ rockuryMock: why }, null, 2) }
    }

    if (!spec) return fail(503, '모의 서버가 어느 명세도 들고 있지 않습니다.', null)

    const match = matchRoute(spec, input.method, input.path, cur!.statusFor)
    if (!match) {
      return fail(
        404,
        `'${input.method} ${input.path}' 와 맞는 요청 선언이 없습니다 — 흉내 낼 근거가 없어 지어내지 않습니다.`,
        null
      )
    }
    if (!match.response) {
      // 선언이 없다 → **501(아직 안 만듦)**. 404 로 답하면 "그런 길이 없다"로 읽혀
      // 사람이 경로를 의심하게 된다. 없는 것은 길이 아니라 선언이다.
      return fail(501, match.unavailable ?? '가짜 응답을 만들 수 없습니다.', match.request.name)
    }

    const made = mockBody(match.response)
    const httpStatus = Number(match.response.status)
    send('api:mockHit', {
      at: new Date().toISOString(),
      method: input.method,
      path: input.path,
      status: Number.isFinite(httpStatus) ? httpStatus : 200,
      requestName: match.request.name,
      guessed: made.guessed,
      unavailable: null
    } satisfies MockHitEvent)

    return {
      status: Number.isFinite(httpStatus) ? httpStatus : 200,
      // 짐작한 필드 수를 **응답에 싣는다** — 0 이어도 싣는다(없는 것과 0 은 다르다).
      headers: { ...base, [MOCK_GUESSED_HEADER]: String(made.guessed) },
      body: made.body
    }
  }

  ipcMain.handle('api:startMock', async (_e, input: StartMockInput): Promise<MockStatus> => {
    const spec = getSpec(input.specId)
    if (!spec) throw new Error(`명세 "${input.specId}" 가 없습니다.`)
    const why = mockUnsupportedReason(spec)
    // 흉내 못 내는 종류를 **흉내 내는 척하지 않는다**(Stream 이 전송을 안 흉내 낸 것과 같은 선).
    if (why) throw new Error(why)

    active = { specId: spec.id, statusFor: input.statusFor ?? {} }
    try {
      await startMock(input.port ?? DEFAULT_MOCK_PORT, { onRequest: reply })
    } catch (err) {
      active = null
      throw err instanceof MockPortInUseError ? new Error(err.message) : err
    }
    const s = status()
    send('api:mockStatus', s)
    return s
  })

  ipcMain.handle('api:stopMock', async (): Promise<MockStatus> => {
    await stopMock()
    active = null
    const s = status()
    send('api:mockStatus', s)
    return s
  })

  ipcMain.handle('api:getMock', (): MockStatus => status())

  /** 어느 상태로 답할지 바꾼다. **서버를 안 끊는다** — 오류 경로를 켜고 끄는 자리다. */
  ipcMain.handle('api:setMockStatus', (_e, requestName: string, statusCode: string): MockStatus => {
    if (!active) throw new Error('모의 서버가 꺼져 있습니다.')
    const next = { ...active.statusFor }
    if (statusCode) next[requestName] = statusCode
    else delete next[requestName]
    active = { ...active, statusFor: next }
    const s = status()
    send('api:mockStatus', s)
    return s
  })

  app.on('before-quit', () => void shutdownApiMock())
}

export async function shutdownApiMock(): Promise<void> {
  await stopMock()
  active = null
}
