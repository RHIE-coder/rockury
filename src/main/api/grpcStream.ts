import * as grpc from '@grpc/grpc-js'
import { buildMetadata, droppedNote, reflectGrpc } from './grpcReflect'
import { methodsOf, resolveMethodPath, shapeOfMethod, unknownFields } from '../../shared/api/proto'
import { parseJsonBody } from '../../shared/api/stream'
import { assumedNote, type GrpcTarget } from '../../shared/api/grpcTarget'
import { SHAPE_LABEL, type InteractionShape, type RunStatus } from '../../shared/api/types'

/**
 * gRPC 스트리밍 전송.
 *
 * WebSocket·SSE 와 결정적으로 다른 점: **글자를 그대로 흘려보낼 수 없다.** gRPC 메시지는
 * 그 메서드의 메시지 정의로 인코딩된 바이트다. 정의가 없으면 보낼 수도 읽을 수도 없다 —
 * 그래서 붙기 전에 서버에게 정의를 받아 온다(reflection).
 *
 * 정의를 못 받으면 **붙지 않는다.** 그냥 붙어 놓고 아무것도 못 읽는 편이 나빠 보이지
 * 않겠지만, 그건 "연결됨인데 아무것도 안 옴"이고 사용자는 서버를 의심하게 된다.
 *
 * `.proto` 파일을 사용자에게 달라고 하지 않는 이유: 그 파일과 지금 떠 있는 서버가
 * 다를 수 있다. 서버에게 물어보면 **지금 그 서버의 정의**다.
 */

/**
 * 붙는 데까지의 예산(정의 받아 오기 + 연결). 세션 쪽 제한시간(30초)보다 **확실히 짧아야**
 * 한다 — 여기서 안 끝나면 세션이 대신 끊는데, 그러면 이유가 "30초 안에 연결되지 않았습니다"
 * 로 뭉개져 주소를 의심할 근거가 사라진다. 정의 받기에 그중 절반을 준다.
 */
const CONNECT_MS = 20_000
const REFLECT_MS = 10_000

export interface GrpcStreamInput {
  target: GrpcTarget
  /** 요청 정의의 `grpcMethod` 칸. 서버가 아는 경로로 우리가 맞춘다. */
  method: string
  /** 요청에 **선언된** 모양. 서버가 말하는 것과 다르면 안 연다(아래 참조). */
  declaredShape: InteractionShape
  headers: Record<string, string>
  /**
   * 처음 한 번 보낼 본문(JSON) — 실값 / 기록용 가림 두 벌.
   * 서버 스트리밍은 이걸로 시작한다. 양방향에서는 보내기 패널이 따로 있어 안 쓴다.
   */
  body: string
  displayBody: string
  /** 사용자가 끊었을 때 **정의 받아 오는 중이라도** 멈추는 창구. */
  signal?: AbortSignal
}

export interface GrpcStreamCallbacks {
  /** 붙었고 정의도 받았다. 이 뒤부터 보내기가 가능하다. */
  onOpen: () => void
  /** 붙기 전·붙는 중에 사용자에게 알릴 것(가정한 암호화 방식·못 실은 헤더 …). */
  onNote: (text: string) => void
  /** 서버가 준 메시지 하나. 이미 JSON 글자로 바꾼 뒤다. */
  onMessage: (text: string) => void
}

export type GrpcOpenOutcome =
  | { ok: true; handle: GrpcStreamHandle }
  | { ok: false; reason: string; failure: RunStatus }

export interface GrpcStreamHandle {
  /** 양방향에서만 쓴다. JSON 글자를 그 메서드의 메시지로 인코딩해 보낸다. */
  send: (real: string, display: string) => void
  close: () => void
  /** 회차가 끝났다 — 서버가 닫았든 오류든. 부르는 쪽이 재접속을 판단한다. */
  onEnd: (fn: (reason: string, failure?: RunStatus) => void) => void
}

/**
 * gRPC-js 는 요청 메시지 **직렬화 실패**도 콜 오류로 돌려준다(코드 INTERNAL).
 * 그건 서버가 끊은 것이 아니라 **바이트가 한 번도 안 나간 것**이다 — 서버 탓으로 적으면
 * 사용자가 엉뚱한 곳을 보고, 자동 재접속까지 돌아 오타 한 번에 연결이 죽는다.
 */
function isOurEncodingFailure(err: grpc.ServiceError): boolean {
  return (
    err.code === grpc.status.INTERNAL && /serialization failure/i.test(err.details || err.message)
  )
}

export async function openGrpcStream(
  input: GrpcStreamInput,
  cb: GrpcStreamCallbacks
): Promise<GrpcOpenOutcome> {
  // 붙기 전에 알린다 — 정의 받아 오는 왕복이 먼저 일어나므로, 여기서 안 알리면
  // "평문으로 붙는다" 가 이미 나간 뒤에 닿는다.
  const note = assumedNote(input.target)
  if (note) cb.onNote(note)

  const reflected = await reflectGrpc(input.target, input.headers, {
    timeoutMs: REFLECT_MS,
    signal: input.signal
  })
  if (!reflected.ok) {
    return {
      ok: false,
      reason: `${reflected.message} — 정의를 못 받으면 메시지를 읽을 수 없어 붙지 않습니다.`,
      failure: reflected.reason === 'no-permission' ? 'http-error' : 'connect-failed'
    }
  }

  // **판정과 같은 함수로 목록을 읽는다.** 각자 훑으면 "무엇이 서비스인가" 의 규칙이 갈려,
  // 판정 화면은 아는 메서드를 전송 화면은 모른다고 말하는 상태가 생긴다.
  const methods = methodsOf(reflected.package)
  const paths = [...methods.keys()]
  const path = resolveMethodPath(input.method, paths)
  if (!path) {
    return {
      ok: false,
      // 못 맞춘 이유를 **후보와 함께** 준다. "그런 메서드 없음"만 던지면 오타인지 패키지가
      // 다른 것인지 알 수 없다. 다만 서버가 메서드를 수백 개 알 수 있으므로 앞부분만 보인다 —
      // 사유 배너에는 잘림도 스크롤도 없어서 길면 타임라인을 밀어낸다.
      reason:
        `서버에 '${input.method || '(빈 칸)'}' 메서드가 없습니다 — 서버가 아는 것: ` +
        `${summarize(paths)}`,
      failure: 'connect-failed'
    }
  }

  const method = methods.get(path)!
  const shape = shapeOfMethod(method)
  if (shape === 'unary') {
    // 서버가 "이 메서드는 단발"이라고 말했다. 우리 선언과 다르면 **서버 말이 맞다** —
    // 스트림으로 열어 놓고 한 건 받고 끝나면 사용자는 서버가 끊었다고 오해한다.
    // (Send 로 안내하지 않는다: 이 앱은 아직 gRPC 단발 실행을 안 만들었다 — 막다른 길이다.)
    return {
      ok: false,
      reason:
        `서버 정의상 '${path}' 는 한 번 묻고 한 번 받는 메서드입니다 — 스트림으로 열 수 없습니다. ` +
        '(이 앱은 gRPC 단발 실행을 아직 만들지 않았습니다.)',
      failure: 'connect-failed'
    }
  }
  if (shape !== input.declaredShape) {
    // **선언과 서버가 어긋나면 열지 않는다.** 열면 화면은 선언대로 그려지므로
    // "보내야 답하는 메서드인데 보내기 패널이 없다" 같은 무피드백 교착이 생긴다.
    return {
      ok: false,
      reason:
        `'${path}' 를 '${SHAPE_LABEL[input.declaredShape]}' 로 선언했는데 서버 정의는 ` +
        `'${SHAPE_LABEL[shape]}' 입니다 — 화면이 선언대로 그려져 쓸 수 없으므로 열지 않습니다. ` +
        '명세의 상호작용 모양을 서버에 맞춰 고치세요.',
      failure: 'connect-failed'
    }
  }

  const credentials = input.target.secure
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure()
  const client = new grpc.Client(input.target.address, credentials)
  const { metadata, dropped } = buildMetadata(input.headers)
  const droppedText = droppedNote(dropped)
  if (droppedText) cb.onNote(droppedText)

  let ended = false
  let onEnd: (reason: string, failure?: RunStatus) => void = () => {}
  const end = (reason: string, failure?: RunStatus): void => {
    if (ended) return
    ended = true
    client.close()
    onEnd(reason, failure)
  }

  let call: grpc.ClientDuplexStream<unknown, unknown> | grpc.ClientReadableStream<unknown>

  if (method.requestStream) {
    call = client.makeBidiStreamRequest(path, ser(method), de(method), metadata)
  } else {
    const parsed = parseJsonBody(input.body, input.displayBody)
    if ('reason' in parsed) {
      client.close()
      return { ok: false, reason: parsed.reason, failure: 'connect-failed' }
    }
    const missing = unknownFields(parsed.value, method.request)
    if (missing.length > 0) {
      client.close()
      return { ok: false, reason: unknownFieldsReason(missing, path), failure: 'connect-failed' }
    }
    call = client.makeServerStreamRequest(path, ser(method), de(method), parsed.value, metadata)
  }

  call.on('data', (msg: unknown) => cb.onMessage(toText(msg)))
  call.on('error', (err: grpc.ServiceError) => {
    // 우리가 끊었을 때 오는 CANCELLED 는 오류가 아니다 — 사용자가 누른 것이다.
    if (err.code === grpc.status.CANCELLED && ended) return
    if (isOurEncodingFailure(err)) {
      // **바이트가 한 번도 안 나갔다.** 서버 탓으로 적지 않는다.
      end(
        `보낸 메시지를 서버 정의대로 만들 수 없어 연결이 끊겼습니다 — ${err.details || err.message}`,
        'connect-failed'
      )
      return
    }
    // gRPC 에서 오류는 프로토콜이 정한 **응답**이다(상태 코드가 실려 온다) — 연결 실패가 아니다.
    end(`서버가 스트림을 끊었습니다 — ${statusText(err)}`, 'http-error')
  })
  call.on('end', () => end('서버가 스트림을 닫았습니다.'))

  /**
   * "붙었다"를 **연결 자체**로 판단한다.
   *
   * 서버가 보내는 머리말(metadata)을 기다리면, 서버가 우리가 먼저 보내기 전까지 조용한
   * 양방향 메서드에서 **영원히 '접속 중'** 이다 — 그런데 '접속 중' 에서는 보내기가 막혀 있어
   * 사용자가 그 교착을 풀 방법이 없다(실측: 검사용 Chat 메서드가 딱 그 모양이다).
   */
  let announced = false
  const announce = (): void => {
    if (announced || ended) return
    announced = true
    cb.onOpen()
  }
  client.waitForReady(Date.now() + CONNECT_MS, (err) => {
    if (err) {
      end(`서버에 붙지 못했습니다 — ${input.target.address} (${err.message})`, 'connect-failed')
      return
    }
    announce()
  })
  // 머리말이 먼저 오면 그것도 붙은 증거다 — 둘 중 빠른 쪽을 쓴다(한 번만 알린다).
  call.on('metadata', () => announce())

  const duplex = method.requestStream ? (call as grpc.ClientDuplexStream<unknown, unknown>) : null

  const handle: GrpcStreamHandle = {
    send(real: string, display: string): void {
      if (!duplex) throw new Error('이 메서드는 보내기가 없습니다 — 서버가 일방으로 보냅니다.')
      const parsed = parseJsonBody(real, display)
      if ('reason' in parsed) throw new Error(parsed.reason)
      // protobuf 는 모르는 칸을 **아무 말 없이 버린다.** 그대로 보내면 빈 메시지가 나가고
      // 기록에는 보낸 것으로 남아, 나중에 그 기록으로 원인을 되짚을 수 없다.
      const missing = unknownFields(parsed.value, method.request)
      if (missing.length > 0) throw new Error(unknownFieldsReason(missing, path))
      duplex.write(parsed.value)
    },
    close(): void {
      ended = true
      try {
        duplex?.end()
        call.cancel()
      } catch {
        /* 이미 닫혔으면 그만이다 */
      }
      client.close()
    },
    onEnd(fn): void {
      onEnd = fn
    }
  }

  // 정의를 받는 사이 사용자가 끊었으면 열어 둔 것을 남기지 않는다.
  if (input.signal?.aborted) {
    handle.close()
    return { ok: false, reason: '접속을 취소했습니다.', failure: 'cancelled' }
  }
  return { ok: true, handle }
}

// 정의 목록이 `unknown` 으로 들고 있는 인코딩·디코딩 함수를 여기서만 형태를 밝힌다
// (그 파일은 순수라 라이브러리 타입을 모른다).
const ser = (m: { serialize: unknown }): ((v: unknown) => Buffer) =>
  m.serialize as (v: unknown) => Buffer
const de = (m: { deserialize: unknown }): ((b: Buffer) => unknown) =>
  m.deserialize as (b: Buffer) => unknown

function unknownFieldsReason(missing: string[], path: string): string {
  return (
    `보낼 본문의 ${missing.join(', ')} 은(는) '${path}' 의 요청 메시지에 없는 칸입니다 — ` +
    'gRPC 는 모르는 칸을 아무 말 없이 버리므로, 보내면 기록과 실제가 달라집니다.'
  )
}

/** 상태 코드를 사람 말과 함께. 원시 이름만 내보내면 화면마다 어휘가 갈린다. */
function statusText(err: grpc.ServiceError): string {
  const name = grpc.status[err.code] ?? String(err.code)
  const detail = err.details || err.message
  switch (err.code) {
    case grpc.status.UNIMPLEMENTED:
      return `서버에 그 메서드가 없습니다 (${name}) — ${detail}`
    case grpc.status.UNAUTHENTICATED:
    case grpc.status.PERMISSION_DENIED:
      return `권한이 없습니다 (${name}) — 환경의 인증 값을 확인하세요. ${detail}`
    case grpc.status.UNAVAILABLE:
      return `서버가 받지 않습니다 (${name}) — 주소와 암호화 방식(grpc:// · grpcs://)을 확인하세요. ${detail}`
    default:
      return `${name} — ${detail}`
  }
}

/** 후보 목록을 사유에 실을 만큼만. 전부 실으면 사유 배너가 화면을 밀어낸다. */
const MAX_CANDIDATES = 8
function summarize(paths: readonly string[]): string {
  if (paths.length === 0) return '(없음)'
  if (paths.length <= MAX_CANDIDATES) return paths.join(', ')
  return `${paths.slice(0, MAX_CANDIDATES).join(', ')} … 외 ${paths.length - MAX_CANDIDATES}개`
}

/**
 * 받은 메시지를 타임라인에 적을 글자로.
 *
 * 들여쓰기를 안 넣는다 — 글자 수가 두 배가 되고 그 부피가 가림·상한·IPC·저장까지
 * 전 구간을 그대로 탄다(같은 스트림인데 gRPC 만 두 배가 된다).
 */
function toText(msg: unknown): string {
  try {
    return JSON.stringify(msg, binaryReplacer)
  } catch {
    return String(msg)
  }
}

/**
 * 바이트 칸은 글자로 지어내지 않고 **크기만** 적는다(단발 응답과 같은 규율).
 *
 * `Buffer` 를 `instanceof Uint8Array` 로 잡으려 하면 **한 번도 안 걸린다**:
 * `JSON.stringify` 는 replacer 보다 **먼저** `toJSON()` 을 부르고, Node `Buffer` 에는
 * 그게 있어서 replacer 에는 이미 `{type:'Buffer', data:[...]}` 가 들어온다.
 * 그러면 64KB 조각 하나가 6만 개짜리 숫자 배열이 되어 타임라인·저장소로 들어간다.
 */
function binaryReplacer(this: unknown, key: string, value: unknown): unknown {
  const raw = (this as Record<string, unknown>)?.[key]
  if (raw instanceof Uint8Array) return binaryPlaceholder(raw.byteLength)
  if (isBufferJson(value)) return binaryPlaceholder(value.data.length)
  return value
}

function isBufferJson(v: unknown): v is { type: 'Buffer'; data: number[] } {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((v as { data?: unknown }).data)
  )
}

/** 바이트 표기는 한 자리에서만 만든다 — 두 곳이 각자 만들면 같은 목록에 두 표기가 뜬다. */
export function binaryPlaceholder(byteLength: number): string {
  return `(바이너리 ${byteLength} 바이트)`
}
