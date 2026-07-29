import * as grpc from '@grpc/grpc-js'
import { fromJSON } from '@grpc/proto-loader'

/**
 * 검사용 gRPC 서버 — **reflection 을 켠 진짜 서버**다.
 *
 * 왜 진짜로 세우나: gRPC 판정·전송의 알맹이는 "서버에게 정의를 받아 온다"는 것이라,
 * 정의를 손으로 넣은 가짜에 붙이면 **정작 검사하려는 부분이 빠진다**. 여기서 세우는 서버는
 * 실제 라이브러리로 손잡기·프레이밍·reflection 응답을 다 한다.
 *
 * 검사 코드(vitest)와 앱 구동 스위트(e2e)가 **같은 서버**를 쓴다 — 둘이 다른 서버를 보면
 * 한쪽만 통과하는 자리가 생긴다.
 *
 * 포트는 언제나 0(운영체제가 골라 준다) — 병렬 개발에서 고정 포트를 잡으면 옆 워크트리의
 * 검사를 깨뜨린다(`AGENTS.md` 의 "한 번에 한 명" 목록에 들어가 버린다).
 *
 * **폴더가 `lib/api/` 인 이유**: `e2e/lib/` 는 공용이고 `harness.mjs` 가 사는 자리다.
 * 서비스 전용 픽스처를 접두어 없이 두면 다른 서비스가 자기 것으로 여겨 같은 파일에 정의를
 * 얹게 된다 — 저장소의 다른 공용 폴더가 전부 `<서비스>` 접두어를 쓰는 것과 같은 이유다.
 *
 * **여기 적힌 reflection 규약 정의는 `src/shared/api/reflectionProto.ts` 의 복사본이다**
 * (이 파일은 순수 JS 라 TS 를 못 읽는다). 복사본끼리 사이좋게 틀리는 것은
 * `reflectionProto.test.ts` 의 골든 바이트 검사가 막는다 — 거기서 칸 번호를 규약 기준으로
 * 못 박고, 여기서는 둘이 실제로 통신에 성공하는지를 본다.
 */

/** 검사용 서비스 정의. 세 모양(계속 받기만 함 · 서로 주고받음 · 단발)을 모두 담는다. */
const APP_JSON = {
  nested: {
    e2e: {
      nested: {
        v1: {
          nested: {
            Tick: {
              fields: {
                n: { type: 'int32', id: 1 },
                label: { type: 'string', id: 2 },
                kind: { type: 'Kind', id: 3 },
                // 64비트 정수 — 수로 바꾸면 큰 값에서 조용히 자릿수를 잃는 자리다.
                big: { type: 'int64', id: 4 },
                // 바이트 — 글자로 지어내지 않고 크기만 적는지 보는 자리다.
                blob: { type: 'bytes', id: 5 },
                // 서버가 **안 채우는** 칸. 기본값으로 메워지면 "받았다"가 되어 버린다.
                never: { type: 'string', id: 6 }
              },
              nested: { Kind: { values: { PLAIN: 0, LOUD: 1 } } }
            },
            Who: { fields: { name: { type: 'string', id: 1 } } },
            Ask: {
              fields: {
                count: { type: 'int32', id: 1 },
                text: { type: 'string', id: 2 },
                // 메시지 칸 — 여기에 글자를 넣으면 **우리 쪽 인코딩**이 실패한다.
                // 그 실패를 서버 탓으로 적지 않는지 보는 자리다.
                who: { type: 'Who', id: 3 }
              }
            },
            Ticker: {
              methods: {
                Watch: {
                  requestType: 'Ask',
                  responseType: 'Tick',
                  responseStream: true,
                  comment: ''
                },
                Chat: {
                  requestType: 'Ask',
                  responseType: 'Tick',
                  requestStream: true,
                  responseStream: true,
                  comment: ''
                },
                Once: { requestType: 'Ask', responseType: 'Tick', comment: '' }
              }
            }
          }
        }
      }
    }
  }
}

/** reflection 규약의 정의. 서버 쪽도 같은 규약이 필요하다(칸 번호가 곧 규약). */
function reflectionJson(pkg) {
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
      fields: { containingType: { type: 'string', id: 1 }, extensionNumber: { type: 'int32', id: 2 } }
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
  let nested = { nested: types }
  for (const part of pkg.split('.').reverse()) nested = { nested: { [part]: nested } }
  return nested
}

/**
 * @param {{ reflection?: boolean, reflectionVersions?: string[], authToken?: string }} [options]
 *   `reflection: false` 로 두면 **정의를 안 주는 서버**가 된다 — 그때 우리가 관측으로
 *   내려가지 않고 사유를 다는지 확인하는 데 쓴다.
 */
export async function startGrpcServer(options = {}) {
  const {
    reflection = true,
    /** 심볼 조회를 **in-band 오류**로 거절한다 — 콜 오류와 다른 경로다. */
    symbolError = null,
    /** 이만큼의 서비스 이름을 알려 준다 — 상한에 닿는지 보는 데 쓴다. */
    floodServices = 0,
    /** 서비스 이름에 `__proto__` 를 섞는다 — 열쇠로 쓰면 프로토타입을 갈아치우는 이름이다. */
    poisonName = false,
    /** 스트림을 한 건 보내고 곧바로 끊는다 — 자동 재접속이 실제로 도는지 보는 데 쓴다. */
    dropAfterFirst = false,
    // 옛 서버는 v1alpha 만 켠다. 기본값을 그쪽으로 둬서 **판 넘기기(v1 → v1alpha)** 가
    // 실제로 도는지 늘 확인되게 한다.
    reflectionVersions = ['grpc.reflection.v1alpha'],
    authToken = null
  } = options

  const appPd = fromJSON(APP_JSON, {})
  const fileDescriptorProtos = appPd['e2e.v1.Ticker'].Watch.responseType.fileDescriptorProtos

  const server = new grpc.Server()
  const denied = (call) =>
    authToken !== null && call.metadata?.get('authorization')?.[0] !== authToken

  server.addService(appPd['e2e.v1.Ticker'], {
    Watch: (call) => {
      if (dropAfterFirst) {
        call.write({ n: 1, label: 'tick-1', kind: 'LOUD', big: '1', blob: Buffer.from([1]) })
        // 붙자마자 끊는 서버 — 재접속이 돌면 이 왕복이 반복된다.
        setTimeout(() => call.end(), 30)
        return
      }
      const n = Number(call.request?.count) || 3
      for (let i = 1; i <= n; i += 1) {
        call.write({
          n: i,
          label: `tick-${i}`,
          kind: 'LOUD',
          // 2^53 을 넘는 값 — 수로 옮기면 마지막 자리가 조용히 바뀐다.
          big: '9007199254740993',
          blob: Buffer.from([1, 2, 3, 4, 5])
          // `never` 는 일부러 안 채운다.
        })
      }
      call.end()
    },
    Chat: (call) => {
      call.on('data', (msg) =>
        call.write({ n: Number(msg?.count) || 0, label: `echo:${msg?.text ?? ''}`, kind: 'PLAIN' })
      )
      call.on('end', () => call.end())
    },
    Once: (_call, cb) => cb(null, { n: 1, label: 'once', kind: 'PLAIN' })
  })

  if (reflection) {
    for (const pkg of reflectionVersions) {
      const reflPd = fromJSON(reflectionJson(pkg), {})
      server.addService(reflPd[`${pkg}.ServerReflection`], {
        ServerReflectionInfo: (call) => {
          if (denied(call)) {
            call.emit('error', {
              code: grpc.status.UNAUTHENTICATED,
              details: '토큰이 없거나 틀립니다'
            })
            return
          }
          call.on('data', (req) => {
            // 어느 갈래인지는 **칸이 실렸는지**로 가른다. proto-loader 는 기본값에서
            // 가상 구분 칸(`messageRequest`)을 안 채워 준다 — 그걸 믿으면 전부 else 로 샌다.
            if (req.fileContainingSymbol && symbolError) {
              call.write({ errorResponse: symbolError })
            } else if (req.fileContainingSymbol) {
              call.write({ fileDescriptorResponse: { fileDescriptorProto: fileDescriptorProtos } })
            } else if (req.listServices !== undefined) {
              const names = []
              if (poisonName) names.push({ name: '__proto__' })
              names.push({ name: 'e2e.v1.Ticker' })
              for (let i = 0; i < floodServices; i += 1) names.push({ name: `flood.v1.S${i}` })
              call.write({ listServicesResponse: { service: names } })
            } else {
              call.write({
                errorResponse: { errorCode: grpc.status.NOT_FOUND, errorMessage: '모르는 요청' }
              })
            }
          })
          call.on('end', () => call.end())
        }
      })
    }
  }

  const port = await new Promise((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) =>
      err ? reject(err) : resolve(p)
    )
  })

  return {
    port,
    address: `127.0.0.1:${port}`,
    url: `grpc://127.0.0.1:${port}`,
    stop: () =>
      new Promise((resolve) => {
        // 붙어 있는 스트림을 기다리지 않는다 — 검사가 끝났는데 서버가 안 죽으면 프로세스가 안 끝난다.
        server.forceShutdown()
        resolve()
      })
  }
}
