import * as grpc from '@grpc/grpc-js'
import { fromJSON, loadFileDescriptorSetFromBuffer } from '@grpc/proto-loader'
import { fileDescriptorSet, type LoadedPackage } from '../../shared/api/proto'
import {
  isInfrastructureService,
  LOAD_OPTIONS,
  REFLECTION_PACKAGES,
  reflectionJson
} from '../../shared/api/reflectionProto'
import type { GrpcTarget } from '../../shared/api/grpcTarget'
import type { UnavailableReason } from '../../shared/api/drift'

/**
 * 서버에게 자기 정의를 물어본다(gRPC reflection) — `docs/spec/api-contract.md` § drift.complete.
 *
 * GraphQL 쪽 `introspect.ts` 와 같은 규율이다: **실패를 갈래로 나누고**, 어떤 경우에도
 * 관측 판정으로 조용히 내려가지 않는다. "완전 판정 못 했다"를 뭉뚱그리면 사용자는
 * 서버 설정을 봐야 할지, 권한을 봐야 할지, 주소를 봐야 할지 모른다.
 *
 * reflection 은 **양방향 스트림**이다 — 한 연결 위에서 "무슨 서비스가 있냐" 묻고,
 * 받은 이름마다 "그 정의 내놔"를 이어서 묻는다.
 */

export type ReflectOutcome =
  | { ok: true; package: LoadedPackage; services: string[] }
  | { ok: false; reason: UnavailableReason; message: string }

interface ReflectionRequest {
  listServices?: string
  fileContainingSymbol?: string
}
interface ReflectionResponse {
  listServicesResponse?: { service?: { name?: string }[] }
  fileDescriptorResponse?: { fileDescriptorProto?: Uint8Array[] }
  errorResponse?: { errorCode?: number; errorMessage?: string }
}

/**
 * 받아 쌓는 서술자의 총량 상한. reflection 응답은 **남의 서버가 주는 데이터**라
 * 상한이 없으면 계속 흘려보내는 것만으로 메인 프로세스를 메모리로 죽일 수 있다
 * (메인이 죽으면 창이 전부 사라져 안내 한 줄도 못 띄운다).
 */
const MAX_DESCRIPTOR_BYTES = 16 * 1024 * 1024
/** 한 서버에서 볼 서비스 수 상한. 목록이 크면 그만큼 왕복을 만들게 된다. */
const MAX_SERVICES = 500

export interface ReflectOptions {
  /**
   * **판 두 개를 합친** 예산이다. 판마다 이만큼씩 쓰면 총 두 배가 되어, 세션 쪽 연결
   * 제한시간(30초)이 먼저 터진다 — 그러면 사용자가 보는 사유가 '30초 안에 연결되지
   * 않았습니다' 로 뭉개져 주소를 의심할 근거가 사라진다(실측으로 그렇게 됐다).
   */
  timeoutMs?: number
  /** 사용자가 끊었을 때 진행 중인 왕복을 실제로 멈추는 창구. */
  signal?: AbortSignal
}

export async function reflectGrpc(
  target: GrpcTarget,
  headers: Record<string, string>,
  options: ReflectOptions = {}
): Promise<ReflectOutcome> {
  if (target.problem) return { ok: false, reason: 'connect-failed', message: target.problem }
  const { timeoutMs = 15_000, signal } = options

  const credentials = target.secure
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure()
  const client = new grpc.Client(target.address, credentials)
  // 판을 나눠 쓴다 — 합쳐서 예산을 넘지 않게.
  const perVersion = Math.max(2_000, Math.floor(timeoutMs / REFLECTION_PACKAGES.length))

  try {
    let lastFailure: ReflectOutcome | null = null
    for (const pkg of REFLECTION_PACKAGES) {
      if (signal?.aborted) return CANCELLED
      const outcome = await reflectOnce(client, `${pkg}.ServerReflection`, headers, perVersion, signal)
      if (outcome.ok) return outcome
      // "그런 서비스 없다"만 다음 판으로 넘어갈 사유다. 권한·연결 문제는 판을 바꿔도 같다 —
      // 그걸로 계속 재시도하면 사용자는 제한시간을 두 배로 기다리고 사유는 뒤엣것만 본다.
      if (outcome.reason !== 'feature-off') return outcome
      lastFailure = outcome
    }
    return (
      lastFailure ?? {
        ok: false,
        reason: 'feature-off',
        message: '서버가 reflection 을 켜지 않았습니다.'
      }
    )
  } finally {
    client.close()
  }
}

const CANCELLED: ReflectOutcome = {
  ok: false,
  reason: 'connect-failed',
  message: '정의를 받아 오는 중에 취소했습니다.'
}

async function reflectOnce(
  client: grpc.Client,
  serviceName: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ReflectOutcome> {
  const definition = fromJSON(reflectionJson(serviceName.replace(/\.[^.]+$/, '')), {})
  const method = (
    definition[serviceName] as Record<
      string,
      {
        path: string
        requestSerialize: (v: ReflectionRequest) => Buffer
        responseDeserialize: (b: Buffer) => ReflectionResponse
      }
    >
  )?.ServerReflectionInfo
  if (!method) {
    return { ok: false, reason: 'not-implemented', message: 'reflection 정의를 못 만들었습니다.' }
  }

  const { metadata, dropped } = buildMetadata(headers)

  return await new Promise<ReflectOutcome>((resolve) => {
    let settled = false
    const done = (o: ReflectOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      try {
        call.end()
        call.cancel()
      } catch {
        /* 이미 닫혔으면 그만이다 */
      }
      resolve(o)
    }
    const onAbort = (): void => done(CANCELLED)
    signal?.addEventListener('abort', onAbort, { once: true })

    const timer = setTimeout(
      () =>
        done({
          ok: false,
          reason: 'connect-failed',
          message: `${timeoutMs / 1000}초 안에 서버가 정의를 주지 않았습니다.`
        }),
      timeoutMs
    )

    const call = client.makeBidiStreamRequest<ReflectionRequest, ReflectionResponse>(
      method.path,
      method.requestSerialize,
      method.responseDeserialize,
      metadata
    )

    const services: string[] = []
    const chunks: Uint8Array[] = []
    /** 이미 받은 파일. 심볼마다 딸린 파일이 통째로 오므로 **도착할 때** 걸러야 안 쌓인다. */
    const seenFiles = new Set<string>()
    let bytes = 0
    /** 아직 답을 못 받은 서비스 수. 0 이 되면 다 받은 것이다. */
    let pending = 0
    let listed = false
    /** 개별 심볼 조회가 거절당한 사유. 전부 거절이면 이것이 진짜 사유다. */
    let symbolError: { code?: number; text: string } | null = null

    /** 응답이 예상보다 하나 더 와도 음수로 내려가지 않게 — 내려가면 0 을 영영 못 만난다. */
    const settle = (): void => {
      pending = Math.max(0, pending - 1)
      if (pending === 0) done(finish(chunks, services, symbolError))
    }

    call.on('data', (res: ReflectionResponse) => {
      if (res.errorResponse) {
        const code = res.errorResponse.errorCode
        const text = res.errorResponse.errorMessage ?? '(사유 없음)'
        // 목록 단계의 오류는 "reflection 이 없다"에 가깝고, 개별 정의 오류는 그 하나만 못 읽은 것이다.
        if (!listed) {
          done({
            ok: false,
            reason: code === grpc.status.UNIMPLEMENTED ? 'feature-off' : 'no-permission',
            message: `서버가 정의를 주지 않았습니다 — ${text}`
          })
          return
        }
        // **서버가 준 사유를 버리지 않는다.** 버리면 "하나도 못 받았다"가 되어
        // 권한 문제를 '기능 꺼짐' 으로 잘못 말하게 된다 — 봐야 할 곳이 서로 다르다.
        symbolError ??= { code, text }
        settle()
        return
      }

      if (res.listServicesResponse) {
        // 목록을 두 번 보내는 서버에 우리가 요청을 증폭해 주지 않는다.
        if (listed) return
        listed = true
        for (const s of res.listServicesResponse.service ?? []) {
          if (s.name && !isInfrastructureService(s.name)) services.push(s.name)
        }
        if (services.length === 0) {
          done({
            ok: false,
            reason: 'feature-off',
            message: 'reflection 은 켜져 있지만 공개된 서비스가 없습니다.'
          })
          return
        }
        if (services.length > MAX_SERVICES) {
          done({
            ok: false,
            reason: 'feature-off',
            message: `서버가 서비스를 ${services.length}개 알려 왔습니다 — ${MAX_SERVICES}개가 상한이라 여기서 멈춥니다.`
          })
          return
        }
        pending = services.length
        for (const name of services) call.write({ fileContainingSymbol: name })
        return
      }

      if (res.fileDescriptorResponse) {
        for (const b of res.fileDescriptorResponse.fileDescriptorProto ?? []) {
          const key = Buffer.from(b).toString('base64')
          if (seenFiles.has(key)) continue
          seenFiles.add(key)
          bytes += b.length
          if (bytes > MAX_DESCRIPTOR_BYTES) {
            done({
              ok: false,
              reason: 'feature-off',
              message:
                `서버가 준 정의가 ${Math.round(MAX_DESCRIPTOR_BYTES / 1024 / 1024)}MB 를 넘었습니다 — ` +
                '여기서 멈춥니다(정의를 다 못 읽었으므로 판정하지 않습니다).'
            })
            return
          }
          chunks.push(b)
        }
        settle()
      }
    })

    call.on('error', (err: grpc.ServiceError) => {
      const note = droppedNote(dropped)
      done({
        ok: false,
        reason: reasonOf(err),
        // 못 실은 헤더가 있으면 그것도 원인 후보다 — 특히 권한 오류에서 그렇다.
        message: note ? `${messageOf(err)} ${note}` : messageOf(err)
      })
    })

    // 서버가 끝냈는데 우리가 아무것도 못 모았으면 그 사실을 그대로 말한다.
    call.on('end', () => done(finish(chunks, services, symbolError)))

    call.write({ listServices: '' })
  })
}

/** 모은 서술자를 하나로 묶어 푼다. 여기서 터지면 **의존 파일이 빠진 것**이다. */
function finish(
  chunks: Uint8Array[],
  services: string[],
  symbolError: { code?: number; text: string } | null
): ReflectOutcome {
  if (chunks.length === 0) {
    // 심볼 조회가 거절당해서 빈 것이라면 **그 사유를 그대로 말한다.**
    // '하나도 안 줬다' 로 뭉치면 권한 문제를 보러 가야 할 사람이 서버 설정을 보러 간다.
    if (symbolError) {
      return {
        ok: false,
        reason: symbolError.code === grpc.status.UNIMPLEMENTED ? 'feature-off' : 'no-permission',
        message: `서버가 개별 정의를 주지 않았습니다 — ${symbolError.text}`
      }
    }
    return { ok: false, reason: 'feature-off', message: '서버가 정의를 하나도 주지 않았습니다.' }
  }
  try {
    // 이미 도착할 때 걸렀으므로 여기서 또 거를 것이 없다.
    const merged = fileDescriptorSet(chunks)
    const set = Buffer.from(merged.buffer, merged.byteOffset, merged.byteLength)
    return {
      ok: true,
      package: loadFileDescriptorSetFromBuffer(set, LOAD_OPTIONS) as LoadedPackage,
      services
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'feature-off',
      message:
        '서버가 준 정의를 못 읽었습니다 — 딸린 파일까지 함께 주는지 확인하세요 ' +
        `(${err instanceof Error ? err.message : String(err)}).`
    }
  }
}

function reasonOf(err: grpc.ServiceError): UnavailableReason {
  switch (err.code) {
    case grpc.status.UNIMPLEMENTED:
      return 'feature-off'
    case grpc.status.UNAUTHENTICATED:
    case grpc.status.PERMISSION_DENIED:
      return 'no-permission'
    default:
      return 'connect-failed'
  }
}

function messageOf(err: grpc.ServiceError): string {
  switch (err.code) {
    case grpc.status.UNIMPLEMENTED:
      return '이 서버는 reflection 을 켜지 않았습니다 — 서버에 reflection 서비스를 등록해야 완전 판정이 됩니다.'
    case grpc.status.UNAUTHENTICATED:
    case grpc.status.PERMISSION_DENIED:
      return `정의를 읽을 권한이 없습니다 — 환경의 인증 값을 확인하세요 (${err.details || err.message}).`
    case grpc.status.UNAVAILABLE:
      return `서버에 붙지 못했습니다 — 주소와 암호화 방식(grpc:// · grpcs://)을 확인하세요 (${err.details || err.message}).`
    default:
      return `정의를 못 받았습니다 — ${err.details || err.message}`
  }
}

/**
 * 헤더 → gRPC 메타데이터. **못 실은 것을 조용히 버리지 않는다.**
 *
 * gRPC 메타데이터는 `-bin` 이 아니면 ASCII 만 받는다(`x-tenant: 한국지사` 같은 값이 걸린다).
 * 조용히 빼면 서버가 권한 없다고 답하고, 사용자는 **맞게 들어 있는** 환경 값을 계속 들여다본다.
 * WebSocket 경로가 "헤더를 못 싣는다"를 타임라인에 적는 것과 같은 처방이다.
 */
export function buildMetadata(headers: Record<string, string>): {
  metadata: grpc.Metadata
  dropped: string[]
} {
  const metadata = new grpc.Metadata()
  const dropped: string[] = []
  for (const [k, v] of Object.entries(headers)) {
    try {
      metadata.set(k.toLowerCase(), v)
    } catch {
      dropped.push(k)
    }
  }
  return { metadata, dropped }
}

/** 못 실은 헤더를 사람 말로. 없으면 굳이 말하지 않는다. */
export function droppedNote(dropped: readonly string[]): string | null {
  if (dropped.length === 0) return null
  return (
    `${dropped.join(', ')} 헤더는 gRPC 에 실을 수 없어 빼고 붙습니다 — ` +
    '값에 ASCII 가 아닌 글자가 있습니다(규약이 그렇게 정했습니다).'
  )
}
