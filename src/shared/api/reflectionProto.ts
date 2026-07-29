/**
 * gRPC server reflection 규약의 정의 — `docs/spec/api-contract.md` § drift.complete.
 *
 * **파일(`.proto`)로 두지 않고 여기 적는 이유**: `.proto` 를 빌드 산출물에 함께 실어 나르려면
 * 패키징 규칙을 건드려야 하는데(그건 `main` 몫이다), 이건 고정 규약이라 그럴 값이 없다.
 *
 * **여기(순수)에 있는 이유**: 네트워크를 모르는 데이터·판단이라 테스트 의무의 사정권에 있어야
 * 한다. 규약에서 진짜 중요한 것은 이름이 아니라 **칸 번호**이고, 번호가 틀리면 서버가
 * 우리 말을 못 알아듣는데 그 사실이 조용히 지나간다 — `reflectionProto.test.ts` 의
 * **골든 바이트 검사**가 그 번호를 규약 문서 기준으로 못 박는다.
 *
 * (검사용 서버 `e2e/lib/api/grpcServer.mjs` 는 순수 JS 라 이 파일을 못 읽어 같은 정의를
 * 손으로 들고 있다. 그 복사본이 맞다는 근거는 "둘이 실제로 통신에 성공한다"(e2e) +
 * "이쪽 정의의 바이트가 규약과 같다"(골든 검사) 두 개가 맞물린 데서 나온다 —
 * 복사본끼리 사이좋게 틀리는 경우는 골든 검사가 막는다.)
 */

/** `grpc.reflection.v1` 이 정본이지만 **현장에는 v1alpha 만 켠 서버가 훨씬 많다.** */
export const REFLECTION_PACKAGES = ['grpc.reflection.v1', 'grpc.reflection.v1alpha'] as const

/**
 * 받은 정의를 풀 때의 규칙. 기본값을 그대로 쓰면 **조용히 틀린 값**이 나온다:
 *   · 열거형이 번호(`1`)로 와서 우리가 선언에 실은 이름(`LOUD`)과 안 맞는다
 *   · 64비트 정수가 `{low, high}` 덩어리로 와서 사람도 판정기도 못 읽는다 —
 *     `Number` 로 바꾸면 큰 수에서 **조용히 자릿수를 잃는다.** 글자로 받아 원값을 지킨다
 *   · `defaults` 는 끈다 — 서버가 안 보낸 칸을 기본값으로 채우면 "받았다"가 되어 버린다
 */
export const LOAD_OPTIONS = { enums: String, longs: String, defaults: false } as const

/**
 * reflection 서비스 자신처럼 **사용자의 API 가 아닌** 서비스인가.
 * 판정 대상에서 빼는 판단이라 여기서 한 번만 정한다 — 넓게 잡으면 사용자 서비스가
 * 목록에서 조용히 사라지고, 좁게 잡으면 우리 것이 어긋남으로 잡힌다.
 */
export function isInfrastructureService(name: string): boolean {
  return (
    name.startsWith('grpc.reflection.') ||
    name.startsWith('grpc.health.') ||
    name.startsWith('grpc.channelz.')
  )
}

/**
 * reflection 규약을 protobufjs JSON 으로. `pkg` 는 `grpc.reflection.v1` 같은 패키지 이름.
 * **칸 번호가 곧 규약이다** — 이름은 우리 편의고, 번호가 서버와의 약속이다.
 */
export function reflectionJson(pkg: string): Record<string, unknown> {
  const types = {
    ServerReflectionRequest: {
      oneofs: {
        messageRequest: {
          oneof: [
            'fileByFilename',
            'fileContainingSymbol',
            'fileContainingExtension',
            'allExtensionNumbersOfType',
            'listServices'
          ]
        }
      },
      fields: {
        host: { type: 'string', id: 1 },
        fileByFilename: { type: 'string', id: 3 },
        fileContainingSymbol: { type: 'string', id: 4 },
        fileContainingExtension: { type: 'ExtensionRequest', id: 5 },
        allExtensionNumbersOfType: { type: 'string', id: 6 },
        listServices: { type: 'string', id: 7 }
      }
    },
    ExtensionRequest: {
      fields: {
        containingType: { type: 'string', id: 1 },
        extensionNumber: { type: 'int32', id: 2 }
      }
    },
    ServerReflectionResponse: {
      oneofs: {
        messageResponse: {
          oneof: [
            'fileDescriptorResponse',
            'allExtensionNumbersResponse',
            'listServicesResponse',
            'errorResponse'
          ]
        }
      },
      fields: {
        validHost: { type: 'string', id: 1 },
        originalRequest: { type: 'ServerReflectionRequest', id: 2 },
        fileDescriptorResponse: { type: 'FileDescriptorResponse', id: 4 },
        allExtensionNumbersResponse: { type: 'ExtensionNumberResponse', id: 5 },
        listServicesResponse: { type: 'ListServiceResponse', id: 6 },
        errorResponse: { type: 'ErrorResponse', id: 7 }
      }
    },
    FileDescriptorResponse: {
      fields: { fileDescriptorProto: { rule: 'repeated', type: 'bytes', id: 1 } }
    },
    ExtensionNumberResponse: {
      fields: {
        baseTypeName: { type: 'string', id: 1 },
        extensionNumber: { rule: 'repeated', type: 'int32', id: 2 }
      }
    },
    ListServiceResponse: {
      fields: { service: { rule: 'repeated', type: 'ServiceResponse', id: 1 } }
    },
    ServiceResponse: { fields: { name: { type: 'string', id: 1 } } },
    ErrorResponse: {
      fields: { errorCode: { type: 'int32', id: 1 }, errorMessage: { type: 'string', id: 2 } }
    },
    ServerReflection: {
      methods: {
        ServerReflectionInfo: {
          requestType: 'ServerReflectionRequest',
          responseType: 'ServerReflectionResponse',
          requestStream: true,
          responseStream: true,
          comment: ''
        }
      }
    }
  }

  // `grpc.reflection.v1` 을 중첩 객체로 펼친다.
  let nested: Record<string, unknown> = { nested: types }
  for (const part of pkg.split('.').reverse()) nested = { nested: { [part]: nested } }
  return nested
}
