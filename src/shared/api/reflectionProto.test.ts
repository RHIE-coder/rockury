import { describe, expect, it } from 'vitest'
import { fromJSON } from '@grpc/proto-loader'
import {
  isInfrastructureService,
  LOAD_OPTIONS,
  REFLECTION_PACKAGES,
  reflectionJson
} from './reflectionProto'

/** TestPlan: api-contract · CASE-apicontract-005i (reflection 규약 정의). */

/**
 * **골든 바이트 검사** — 규약에서 진짜 약속인 것은 이름이 아니라 **칸 번호**다.
 *
 * 이 검사가 없으면 우리 정의와 검사용 서버(`e2e/lib/api/grpcServer.mjs`, 같은 정의의 복사본)가
 * **사이좋게 틀린 채** 서로 합의하고, 단위·e2e 는 전부 초록인데 실제 서버에서만 안 붙는다.
 * 여기서 기대하는 바이트는 코드에서 유도한 것이 아니라 **규약 문서의 칸 번호에서** 손으로
 * 계산한 것이다(그래서 독립적인 근거가 된다).
 *
 * protobuf 인코딩: 칸마다 `(번호 << 3) | 형식` 한 바이트 + 길이 + 값.
 * 문자열·메시지는 형식 2(길이 붙는 것).
 */

const codec = (pkg: string): { ser: (v: unknown) => Buffer; de: (b: Buffer) => unknown } => {
  const def = fromJSON(reflectionJson(pkg), {}) as Record<string, Record<string, unknown>>
  const m = def[`${pkg}.ServerReflection`].ServerReflectionInfo as {
    requestSerialize: (v: unknown) => Buffer
    responseDeserialize: (b: Buffer) => unknown
  }
  return { ser: m.requestSerialize, de: m.responseDeserialize }
}

describe('reflection 규약 — 칸 번호를 바이트로 못 박는다', () => {
  for (const pkg of REFLECTION_PACKAGES) {
    describe(pkg, () => {
      const { ser, de } = codec(pkg)

      it('`list_services` 는 7번 칸이다', () => {
        // (7 << 3) | 2 = 0x3A, 길이 0
        expect([...ser({ listServices: '' })]).toEqual([0x3a, 0x00])
      })

      it('`file_containing_symbol` 은 4번 칸이다', () => {
        // (4 << 3) | 2 = 0x22, 길이 1, 'x'
        expect([...ser({ fileContainingSymbol: 'x' })]).toEqual([0x22, 0x01, 0x78])
      })

      it('`list_services_response` 는 6번 칸이고 그 안의 `service` 는 1번이다', () => {
        // ServiceResponse{name:'a'}      = 0x0A 0x01 0x61
        // ListServiceResponse{service:…} = 0x0A 0x03 (위 3바이트)
        // ServerReflectionResponse{…}    = 0x32 0x05 (위 5바이트)
        const bytes = Buffer.from([0x32, 0x05, 0x0a, 0x03, 0x0a, 0x01, 0x61])
        expect(de(bytes)).toMatchObject({
          listServicesResponse: { service: [{ name: 'a' }] }
        })
      })

      it('`file_descriptor_response` 는 4번 칸이고 그 안의 바이트 목록은 1번이다', () => {
        // FileDescriptorResponse{fileDescriptorProto:[0x07]} = 0x0A 0x01 0x07
        // ServerReflectionResponse{…}                        = 0x22 0x03 (위 3바이트)
        const bytes = Buffer.from([0x22, 0x03, 0x0a, 0x01, 0x07])
        const out = de(bytes) as { fileDescriptorResponse: { fileDescriptorProto: Uint8Array[] } }
        expect([...out.fileDescriptorResponse.fileDescriptorProto[0]]).toEqual([0x07])
      })

      it('`error_response` 는 7번 칸이다', () => {
        // ErrorResponse{errorCode:5}  = 0x08 0x05   (1번 칸, 형식 0=정수)
        // ServerReflectionResponse{…} = 0x3A 0x02
        const bytes = Buffer.from([0x3a, 0x02, 0x08, 0x05])
        expect(de(bytes)).toMatchObject({ errorResponse: { errorCode: 5 } })
      })
    })
  }

  it('정본 판이 먼저 온다 — 옛 판은 물러설 자리다', () => {
    expect(REFLECTION_PACKAGES[0]).toBe('grpc.reflection.v1')
    expect(REFLECTION_PACKAGES).toContain('grpc.reflection.v1alpha')
  })
})

describe('읽기 규칙', () => {
  it('열거형은 이름으로, 64비트 정수는 글자로, 안 보낸 칸은 안 채운다', () => {
    // 기본값을 그대로 쓰면 조용히 틀린 값이 나온다 — 그 셋을 여기서 못 박는다.
    expect(LOAD_OPTIONS.enums).toBe(String)
    expect(LOAD_OPTIONS.longs).toBe(String)
    expect(LOAD_OPTIONS.defaults).toBe(false)
  })
})

describe('판정 대상이 아닌 서비스', () => {
  it('reflection·health·channelz 는 사용자의 API 가 아니다', () => {
    expect(isInfrastructureService('grpc.reflection.v1.ServerReflection')).toBe(true)
    expect(isInfrastructureService('grpc.health.v1.Health')).toBe(true)
    expect(isInfrastructureService('grpc.channelz.v1.Channelz')).toBe(true)
  })

  it('**사용자 서비스를 걸러 내지 않는다** — 넓게 잡으면 목록에서 조용히 사라진다', () => {
    expect(isInfrastructureService('grpc.reflectionary.MyService')).toBe(false)
    expect(isInfrastructureService('shop.v1.Orders')).toBe(false)
    expect(isInfrastructureService('myapp.health.Checker')).toBe(false)
  })
})
