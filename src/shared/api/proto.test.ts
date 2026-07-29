import { describe, expect, it } from 'vitest'
import {
  fieldsOfMessage,
  fileDescriptorSet,
  methodsOf,
  resolveMethodPath,
  resolveTypeName,
  rootFieldsFor,
  shapeOfMethod,
  typeIndex,
  unknownFields,
  type LoadedPackage
} from './proto'

/** 판정이 실제로 하는 두 걸음 — 목록을 읽고, **필요한 것만** 펼친다. */
const schema = (pkg: LoadedPackage): {
  rootFields: Record<string, ReturnType<typeof fieldsOfMessage>>
  methods: ReturnType<typeof methodsOf>
} => {
  const methods = methodsOf(pkg)
  return { methods, rootFields: rootFieldsFor(pkg, methods, methods.keys()) }
}

/** TestPlan: api-contract · CASE-apicontract-005b~005g (drift.complete — gRPC reflection). */

const msg = (name: string, type: Record<string, unknown>): unknown => ({
  format: 'Protocol Buffer 3 DescriptorProto',
  type: { name, ...type }
})
const enm = (name: string, values: string[]): unknown => ({
  format: 'Protocol Buffer 3 EnumDescriptorProto',
  type: { name, value: values.map((v) => ({ name: v })) }
})
const f = (name: string, type: string, extra: Record<string, unknown> = {}): unknown => ({
  name,
  type,
  label: 'LABEL_OPTIONAL',
  typeName: '',
  proto3Optional: false,
  ...extra
})

const orderDesc = {
  field: [
    f('id', 'TYPE_STRING'),
    f('total', 'TYPE_INT32'),
    f('paid', 'TYPE_BOOL'),
    f('memo', 'TYPE_STRING', { proto3Optional: true }),
    f('tags', 'TYPE_STRING', { label: 'LABEL_REPEATED' }),
    f('buyer', 'TYPE_MESSAGE', { typeName: '.shop.v1.User' }),
    f('state', 'TYPE_ENUM', { typeName: '.shop.v1.Order.State' })
  ],
  enumType: [{ name: 'State', value: [{ name: 'NEW' }, { name: 'PAID' }] }]
}

const pkg: LoadedPackage = {
  'shop.v1.Order': msg('Order', orderDesc),
  'shop.v1.User': msg('User', { field: [f('email', 'TYPE_STRING')] }),
  'shop.v1.Orders': {
    Get: {
      path: '/shop.v1.Orders/Get',
      requestStream: false,
      responseStream: false,
      responseType: msg('shop.v1.Order', orderDesc)
    },
    Watch: {
      path: '/shop.v1.Orders/Watch',
      requestStream: false,
      responseStream: true,
      responseType: msg('shop.v1.Order', orderDesc)
    },
    Chat: {
      path: '/shop.v1.Orders/Chat',
      requestStream: true,
      responseStream: true,
      responseType: msg('shop.v1.Order', orderDesc)
    }
  }
}

const byName = (fields: ReturnType<typeof fieldsOfMessage>, n: string) =>
  fields.find((x) => x.name === n)!

describe('타입 색인', () => {
  const index = typeIndex(pkg)

  it('최상위 메시지를 전체 이름으로 담는다', () => {
    expect([...index.messages.keys()]).toContain('shop.v1.Order')
  })

  it('**중첩된 것까지 걸어 들어간다** — 최상위 키에는 안 나온다', () => {
    const nested: LoadedPackage = {
      'a.Outer': msg('Outer', {
        nestedType: [{ name: 'Inner', field: [f('z', 'TYPE_STRING')] }],
        enumType: [{ name: 'Kind', value: [{ name: 'K' }] }]
      })
    }
    const ix = typeIndex(nested)
    expect([...ix.messages.keys()]).toContain('a.Outer.Inner')
    expect(ix.enums.get('a.Outer.Kind')).toEqual(['K'])
  })

  it('열거형 허용 값을 모은다', () => {
    expect(index.enums.get('shop.v1.Order.State')).toEqual(['NEW', 'PAID'])
  })

  it('최상위 열거형은 메시지가 아니라 열거형으로 담는다', () => {
    // 서술자 형식이 달라서(값 목록 vs 필드 목록) 섞이면 필드가 통째로 빈다.
    const ix = typeIndex({ 'a.Status': enm('Status', ['OK', 'BAD']) })
    expect(ix.enums.get('a.Status')).toEqual(['OK', 'BAD'])
    expect(ix.messages.has('a.Status')).toBe(false)
  })
})

describe('이름 맞추기(범위 규칙)', () => {
  const known = new Set(['shop.v1.Order.Inner', 'shop.v1.Inner', 'shop.v1.User'])

  it('전체 이름은 앞의 점을 떼고 그대로 쓴다', () => {
    expect(resolveTypeName('.shop.v1.User', 'shop.v1.Order', known)).toBe('shop.v1.User')
  })

  it('**짧은 이름은 안쪽 범위부터 올려 본다** — 가까운 것이 이긴다', () => {
    expect(resolveTypeName('Inner', 'shop.v1.Order', known)).toBe('shop.v1.Order.Inner')
  })

  it('안쪽에 없으면 바깥에서 찾는다', () => {
    expect(resolveTypeName('User', 'shop.v1.Order', known)).toBe('shop.v1.User')
  })

  it('어디에도 없으면 null 이다 — 짐작해서 아무거나 고르지 않는다', () => {
    expect(resolveTypeName('Nope', 'shop.v1.Order', known)).toBeNull()
    expect(resolveTypeName('', 'shop.v1.Order', known)).toBeNull()
  })
})

describe('필드 옮기기', () => {
  const index = typeIndex(pkg)
  const fields = fieldsOfMessage(index.messages.get('shop.v1.Order')!, 'shop.v1.Order', index)

  it('스칼라 타입을 옮긴다', () => {
    expect(byName(fields, 'id').type).toBe('string')
    expect(byName(fields, 'total').type).toBe('number')
    expect(byName(fields, 'paid').type).toBe('boolean')
  })

  it('**`optional` 을 명시한 것만 `없을 수 있음`이다**', () => {
    expect(byName(fields, 'memo').requiredness).toBe('nullable')
  })

  it('**표시 없는 단일 필드는 `required` 로 못 박지 않는다** — proto3 는 없음과 기본값이 안 갈린다', () => {
    expect(byName(fields, 'id').requiredness).toBe('unknown')
    expect(byName(fields, 'total').requiredness).toBe('unknown')
  })

  it('`repeated` 는 배열이다', () => {
    expect(byName(fields, 'tags').type).toBe('array')
  })

  it('메시지 필드는 안쪽까지 들어간다', () => {
    const buyer = byName(fields, 'buyer')
    expect(buyer.type).toBe('object')
    expect(buyer.fields?.map((x) => x.name)).toEqual(['email'])
  })

  it('열거형은 허용 값을 함께 싣는다', () => {
    expect(byName(fields, 'state').enumValues).toEqual(['NEW', 'PAID'])
  })

  it('**map 은 배열이 아니라 객체다** — 속은 반복 메시지지만 JSON 으로는 객체 하나로 온다', () => {
    const mapPkg: LoadedPackage = {
      'm.M': msg('M', {
        field: [f('labels', 'TYPE_MESSAGE', { label: 'LABEL_REPEATED', typeName: '.m.M.LabelsEntry' })],
        nestedType: [
          {
            name: 'LabelsEntry',
            options: { mapEntry: true },
            field: [f('key', 'TYPE_STRING'), f('value', 'TYPE_STRING')]
          }
        ]
      })
    }
    const ix = typeIndex(mapPkg)
    const out = fieldsOfMessage(ix.messages.get('m.M')!, 'm.M', ix)
    expect(out[0].type).toBe('object')
    // 어떤 키가 오는지는 서술자에 없다 — 안쪽을 지어내지 않는다.
    expect(out[0].fields).toBeUndefined()
  })

  it('모르는 타입은 추측하지 않고 object 로 두되 안쪽을 안 지어낸다', () => {
    const weird: LoadedPackage = { 'x.M': msg('M', { field: [f('g', 'TYPE_GROUP')] }) }
    const ix = typeIndex(weird)
    const out = fieldsOfMessage(ix.messages.get('x.M')!, 'x.M', ix)
    expect(out[0].type).toBe('object')
    expect(out[0].fields).toBeUndefined()
  })

  it('**자기를 참조하는 메시지에서 무한히 파고들지 않는다**', () => {
    const tree: LoadedPackage = {
      't.Node': msg('Node', { field: [f('child', 'TYPE_MESSAGE', { typeName: '.t.Node' })] })
    }
    const ix = typeIndex(tree)
    expect(() => fieldsOfMessage(ix.messages.get('t.Node')!, 't.Node', ix)).not.toThrow()
  })
})

describe('스키마 조립', () => {
  const { rootFields, methods } = schema(pkg)

  it('키가 gRPC 가 실제로 쓰는 경로 모양이다', () => {
    expect(Object.keys(rootFields)).toContain('/shop.v1.Orders/Get')
  })

  it('응답 메시지의 필드가 실린다', () => {
    expect(rootFields['/shop.v1.Orders/Get'].map((x) => x.name)).toContain('total')
  })

  it('**응답 모양을 못 읽으면 빈 목록을 지어내지 않는다** — 아예 안 싣는다', () => {
    const orphan: LoadedPackage = {
      'o.S': { M: { path: '/o.S/M', requestStream: false, responseStream: false } }
    }
    const out = schema(orphan)
    expect(out.rootFields['/o.S/M']).toBeUndefined()
    // 메서드가 있다는 사실은 안다 — "모양을 못 읽었다"와 "없다"는 다르다.
    expect(out.methods.get('/o.S/M')).toBeDefined()
  })

  it('상호작용 모양을 proto 정의가 정한다 — 사람이 고르지 않는다', () => {
    expect(shapeOfMethod(methods.get('/shop.v1.Orders/Get')!)).toBe('unary')
    expect(shapeOfMethod(methods.get('/shop.v1.Orders/Watch')!)).toBe('server-stream')
    expect(shapeOfMethod(methods.get('/shop.v1.Orders/Chat')!)).toBe('duplex')
  })

  it('보내기만 스트리밍인 메서드도 보낼 자리가 있는 모양으로 둔다', () => {
    // `server-stream` 으로 두면 보내는 패널이 없어 그 메서드를 아예 못 쓴다.
    expect(shapeOfMethod({ requestStream: true, responseStream: false })).toBe('duplex')
  })
})

describe('메서드 이름 맞추기', () => {
  const known = ['/shop.v1.Orders/Get', '/shop.v1.Orders/Watch', '/other.v1.Orders/Get']

  it('전체 경로가 정확히 맞으면 고른다', () => {
    expect(resolveMethodPath('/shop.v1.Orders/Get', known)).toBe('/shop.v1.Orders/Get')
    expect(resolveMethodPath('shop.v1.Orders/Get', known)).toBe('/shop.v1.Orders/Get')
  })

  it('꼬리만 적어도 하나뿐이면 고른다', () => {
    expect(resolveMethodPath('Orders/Watch', known)).toBe('/shop.v1.Orders/Watch')
  })

  it('**둘 이상 맞으면 짐작하지 않는다** — 어느 것인지 모른다', () => {
    expect(resolveMethodPath('Orders/Get', known)).toBeNull()
  })

  it('안 맞으면 null 이다', () => {
    expect(resolveMethodPath('Nope/Nope', known)).toBeNull()
    expect(resolveMethodPath('', known)).toBeNull()
  })
})

describe('보낼 본문의 모르는 칸', () => {
  const desc = { name: 'M', field: [{ name: 'count' }, { name: 'text' }] }

  it('**선언에 없는 칸을 이름으로 짚는다** — protobuf 는 그걸 아무 말 없이 버린다', () => {
    expect(unknownFields({ count: 1, cont: 2, zzz: 3 }, desc)).toEqual(['cont', 'zzz'])
  })

  it('다 아는 칸이면 조용하다', () => {
    expect(unknownFields({ count: 1, text: 'a' }, desc)).toEqual([])
  })

  it('요청 정의를 못 읽었으면 아무것도 짚지 않는다 — 모르면 모른다고 둔다', () => {
    expect(unknownFields({ any: 1 }, null)).toEqual([])
    expect(unknownFields({ any: 1 }, { name: 'M', field: [] })).toEqual([])
  })

  it('객체가 아니면 대상이 아니다', () => {
    expect(unknownFields([1, 2], desc)).toEqual([])
    expect(unknownFields('x', desc)).toEqual([])
  })
})

describe('서버가 준 이름을 열쇠로 쓸 때', () => {
  it('**`__proto__` 는 걸러 낸다** — 열쇠를 만드는 대신 프로토타입을 갈아치운다', () => {
    const evil: LoadedPackage = {
      __proto__: { format: 'Protocol Buffer 3 DescriptorProto', type: { name: 'X' } },
      'ok.M': msg('M', { field: [f('a', 'TYPE_STRING')] })
    }
    const ix = typeIndex(evil)
    expect([...ix.messages.keys()]).toEqual(['ok.M'])
  })
})

describe('서술자 묶기', () => {
  it('조각마다 태그·길이 머리를 붙여 잇는다', () => {
    const out = fileDescriptorSet([Uint8Array.from([1, 2, 3])])
    expect([...out]).toEqual([0x0a, 3, 1, 2, 3])
  })

  it('길이가 127 을 넘으면 두 바이트로 적는다', () => {
    const big = new Uint8Array(200).fill(7)
    const out = fileDescriptorSet([big])
    expect([...out.slice(0, 3)]).toEqual([0x0a, 0xc8, 0x01])
    expect(out.length).toBe(203)
  })

  it('**같은 파일이 여러 번 와도 한 번만 담는다** — 의존 파일은 겹쳐서 온다', () => {
    const a = Uint8Array.from([1, 2])
    const out = fileDescriptorSet([a, Uint8Array.from([1, 2]), Uint8Array.from([9])])
    expect([...out]).toEqual([0x0a, 2, 1, 2, 0x0a, 1, 9])
  })

  it('빈 목록은 빈 묶음이다', () => {
    expect(fileDescriptorSet([]).length).toBe(0)
  })
})

/**
 * **진짜 디코더에 물려 본다.** 위 픽스처는 손으로 적은 것이라 실제 형식과 어긋나도 통과할 수
 * 있다 — 여기서는 `@grpc/proto-loader` 가 만든 진짜 서술자 바이트를 우리 묶기 함수로 묶고,
 * 진짜 디코더로 풀어 그 결과를 옮긴다. 이 한 건이 형식 가정 전체를 붙잡아 준다.
 */
describe('실제 서술자 왕복', async () => {
  const loader = await import('@grpc/proto-loader')
  const { LOAD_OPTIONS } = await import('./reflectionProto')
  const definition = loader.fromJSON(
    {
      nested: {
        shop: {
          nested: {
            v1: {
              nested: {
                Order: {
                  fields: {
                    id: { type: 'string', id: 1 },
                    total: { type: 'int32', id: 2 },
                    tags: { rule: 'repeated', type: 'string', id: 3 },
                    buyer: { type: 'User', id: 4 },
                    state: { type: 'State', id: 5 }
                  },
                  nested: { State: { values: { NEW: 0, PAID: 1 } } }
                },
                User: { fields: { email: { type: 'string', id: 1 } } },
                Orders: {
                  methods: {
                    Get: { requestType: 'User', responseType: 'Order', comment: '' },
                    Watch: { requestType: 'User', responseType: 'Order', responseStream: true, comment: '' }
                  }
                }
              }
            }
          }
        }
      }
    },
    {}
  )

  const service = definition['shop.v1.Orders'] as Record<
    string,
    { responseType: { fileDescriptorProtos: Uint8Array[] } }
  >
  const set = fileDescriptorSet(service.Get.responseType.fileDescriptorProtos)
  // **운영과 같은 옵션으로 푼다.** 다른 옵션으로 풀면 `LOAD_OPTIONS` 를 고쳐도 이 검사는
  // 안 움직여, 왕복 검사가 실제 동작을 안 지키게 된다.
  const decoded = loader.loadFileDescriptorSetFromBuffer(
    Buffer.from(set),
    LOAD_OPTIONS
  ) as LoadedPackage
  const { rootFields, methods } = schema(decoded)

  it('묶은 것을 진짜 디코더가 읽는다', () => {
    expect([...methods.keys()]).toEqual(
      expect.arrayContaining(['/shop.v1.Orders/Get', '/shop.v1.Orders/Watch'])
    )
  })

  it('필드 타입이 실제 서술자에서도 옮겨진다', () => {
    const fields = rootFields['/shop.v1.Orders/Get']
    expect(byName(fields, 'id').type).toBe('string')
    expect(byName(fields, 'total').type).toBe('number')
    expect(byName(fields, 'tags').type).toBe('array')
  })

  it('**짧은 이름으로 온 중첩 타입도 풀린다** — 도구마다 전체 이름을 안 준다', () => {
    const fields = rootFields['/shop.v1.Orders/Get']
    expect(byName(fields, 'buyer').fields?.map((x) => x.name)).toEqual(['email'])
    expect(byName(fields, 'state').enumValues).toEqual(['NEW', 'PAID'])
  })

  it('스트리밍 여부가 실제 서술자에서도 읽힌다', () => {
    expect(shapeOfMethod(methods.get('/shop.v1.Orders/Watch')!)).toBe('server-stream')
  })
})
