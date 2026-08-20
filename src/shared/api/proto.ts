import type { FieldDef, FieldType, InteractionShape } from './types'

/**
 * proto 서술자 → 우리 응답 모양
 *
 * gRPC 는 서버가 자기 스키마를 **표준으로** 뱉는다(reflection = 서버에게 "네 정의를 내놔"라고
 * 물어보는 표준 기능). 그래서 완전 판정 대상인데, 뱉는 것이 protobuf 자체 형식이라 우리
 * `FieldDef` 로 옮겨야 한다. 이 파일은 그 옮기는 일만 한다 — 네트워크를 모른다(순수).
 *
 * **입력 모양은 `@grpc/proto-loader` 가 풀어 준 것**이다(`loadFileDescriptorSetFromBuffer`).
 * 바이트를 손으로 뜯지 않는 이유: 그 디코더는 이미 의존성 안에 있고, 손으로 뜯으면
 * protobuf 형식 자체를 우리가 떠안게 된다.
 *
 * 이 파일이 지키는 것 — **모르는 것을 안다고 말하지 않는다:**
 *   · proto3 의 `optional` 은 "없을 수 있다"를 **명시한 것**이라 `nullable` 이다
 *   · 그 표시가 없는 단일 필드는 proto3 에서 늘 기본값이 있어 "없음"이 구분되지 않는다 —
 *     그래서 `required` 라고 못 박지 않고 **`unknown`(모름)** 으로 둔다
 *   · 이름이 두 곳에 맞으면 아무거나 고르지 않는다(짐작 금지)
 *   · 모르는 타입은 추측하지 않고 `object` 로 두되 **안쪽을 지어내지 않는다**
 */

/** protobuf 필드 타입 이름 → 우리 타입. 서술자의 `FieldDescriptorProto.Type`. */
const SCALARS: Record<string, FieldType> = {
  TYPE_DOUBLE: 'number',
  TYPE_FLOAT: 'number',
  TYPE_INT64: 'number', // JS 에서 문자열로 실려 오기도 하지만 뜻은 수다
  TYPE_UINT64: 'number',
  TYPE_INT32: 'number',
  TYPE_FIXED64: 'number',
  TYPE_FIXED32: 'number',
  TYPE_BOOL: 'boolean',
  TYPE_STRING: 'string',
  TYPE_BYTES: 'string', // 글자로 실려 온다
  TYPE_UINT32: 'number',
  TYPE_ENUM: 'string', // 이름이 온다
  TYPE_SFIXED32: 'number',
  TYPE_SFIXED64: 'number',
  TYPE_SINT32: 'number',
  TYPE_SINT64: 'number'
}

/** 안쪽으로 파고드는 최대 깊이. 이보다 깊으면 안쪽을 안 싣는다(있다/없다는 그대로 남는다). */
const MAX_DEPTH = 6

export interface ProtoFieldDesc {
  name?: string
  /** `TYPE_STRING` 같은 이름. */
  type?: string
  /** `LABEL_REPEATED` 면 배열. */
  label?: string
  /** 메시지·열거형 필드가 가리키는 이름. protoc 은 `.패키지.이름`, 다른 도구는 짧은 이름을 준다. */
  typeName?: string
  /** proto3 `optional` 표시. */
  proto3Optional?: boolean
  options?: { mapEntry?: boolean } | null
}

export interface ProtoMessageDesc {
  name?: string
  field?: ProtoFieldDesc[]
  nestedType?: ProtoMessageDesc[]
  enumType?: ProtoEnumDesc[]
  options?: { mapEntry?: boolean } | null
}

export interface ProtoEnumDesc {
  name?: string
  value?: { name?: string }[]
}

/** proto-loader 가 메시지·열거형에 붙여 주는 껍데기. */
export interface LoadedType {
  format?: string
  type?: ProtoMessageDesc & ProtoEnumDesc
}

/** proto-loader 가 만든 메서드 정의(우리가 읽는 칸만). */
export interface LoadedMethod {
  path?: string
  requestStream?: boolean
  responseStream?: boolean
  requestType?: LoadedType
  responseType?: LoadedType
  requestSerialize?: unknown
  responseDeserialize?: unknown
}

/** 이름 → 메시지·열거형·서비스. `loadFileDescriptorSetFromBuffer` 의 반환값. */
export type LoadedPackage = Record<string, unknown>

export interface TypeIndex {
  messages: Map<string, ProtoMessageDesc>
  enums: Map<string, string[]>
  /**
   * 이름 찾기에 쓰는 열쇠 모음. **목록을 만들 때 한 번만 짓는다.**
   *
   * 전에는 `fieldsOfMessage` 가 호출마다 `new Set(index.messages.keys())` 를 새로 만들었는데,
   * 그 함수는 펼치는 노드마다 재귀로 불리므로 `노드 수 × 전체 타입 수` 로 돌았다 —
   * 게다가 "전체 타입" 에는 이 메서드와 아무 상관 없는 의존 파일 타입이 전부 들어 있어
   * **무관한 데이터에 비례해 느려졌다**(실측: 타입 2,000·메서드 40 에서 3,113ms → 48ms).
   * 그 시간 동안 메인 프로세스가 통째로 멎는다.
   */
  knownMessages: Set<string>
  knownEnums: Set<string>
}

/**
 * 서버가 준 이름을 객체 열쇠로 쓸 때 걸러야 하는 것.
 * `__proto__` 는 열쇠를 만드는 대신 **프로토타입을 갈아치운다** — 남의 서버가 준 이름을
 * 그대로 쓰는 자리라 여기서 막는다(우리는 Map 을 쓰지만, 돌려받은 객체 자체가 이미 오염돼
 * 있을 수 있어 훑을 때 건너뛴다).
 */
const POISON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isLoadedType(v: unknown): v is LoadedType {
  return typeof v === 'object' && v !== null && 'format' in v && 'type' in v
}

function isService(v: unknown): v is Record<string, LoadedMethod> {
  if (typeof v !== 'object' || v === null || isLoadedType(v)) return false
  return Object.values(v).some((m) => typeof m === 'object' && m !== null && 'path' in m)
}

/**
 * 전체 이름 → 메시지·열거형.
 *
 * proto-loader 는 **최상위 것만** 키로 준다 — 메시지 안에 중첩된 메시지·열거형은
 * 그 메시지의 서술자 안에 들어 있어서 직접 걸어 들어가야 한다. 안 걸으면
 * `Order.Inner` 같은 필드가 "모르는 타입"이 되어 안쪽이 통째로 빈다.
 */
export function typeIndex(pkg: LoadedPackage): TypeIndex {
  const messages = new Map<string, ProtoMessageDesc>()
  const enums = new Map<string, string[]>()

  const walkEnum = (full: string, e: ProtoEnumDesc): void => {
    enums.set(
      full,
      (e.value ?? []).map((v) => v.name ?? '').filter(Boolean)
    )
  }
  const walkMessage = (full: string, m: ProtoMessageDesc): void => {
    messages.set(full, m)
    for (const n of m.nestedType ?? []) if (n.name && !POISON_KEYS.has(n.name)) walkMessage(`${full}.${n.name}`, n)
    for (const e of m.enumType ?? []) if (e.name && !POISON_KEYS.has(e.name)) walkEnum(`${full}.${e.name}`, e)
  }

  for (const [name, entry] of Object.entries(pkg)) {
    if (POISON_KEYS.has(name)) continue
    if (!isLoadedType(entry) || !entry.type) continue
    // 열거형 서술자는 `value` 를, 메시지 서술자는 `field` 를 가진다.
    if (entry.format?.includes('EnumDescriptorProto')) walkEnum(name, entry.type)
    else walkMessage(name, entry.type)
  }
  return {
    messages,
    enums,
    knownMessages: new Set(messages.keys()),
    knownEnums: new Set(enums.keys())
  }
}

/**
 * 메서드의 응답 서술자가 목록의 **어느 이름**인지 찾는다.
 *
 * 서술자 안의 `name` 은 **짧은 이름**(`Order`)이라 그것만으로는 어느 패키지인지 모른다.
 * 그래서 그 메서드가 사는 서비스 이름을 시작 범위로 삼아 proto 의 이름 찾기 규칙대로 올려 보고,
 * 그래도 못 찾으면 꼬리가 맞는 것이 **딱 하나**일 때만 고른다. 둘 이상이면 null 이다 —
 * 아무거나 고르면 엉뚱한 패키지의 필드로 판정하게 된다.
 *
 * (전에는 "서술자 객체가 목록의 것과 같은 객체인가"를 먼저 봤는데, proto-loader 는 꺼낼 때마다
 * 서술자를 새로 만들어서 **그 길은 한 번도 안 맞았다.** 픽스처가 같은 객체를 재사용하는 바람에
 * 테스트에서도 안 드러났다 — 지금은 그 길을 지웠다.)
 */
export function fullNameOfMessage(
  desc: ProtoMessageDesc,
  scope: string,
  index: TypeIndex
): string | null {
  const name = desc.name ?? ''
  if (!name) return null

  const scoped = resolveTypeName(name, scope, index.knownMessages)
  if (scoped) return scoped

  const tail = [...index.knownMessages].filter((k) => k.endsWith(`.${name}`))
  return tail.length === 1 ? tail[0] : null
}

/**
 * 필드가 가리키는 이름을 실제 타입으로 맞춘다.
 *
 * protoc 이 만든 서술자는 `.shop.v1.User` 처럼 전체 이름을 주지만, 다른 도구는 `User` 처럼
 * 짧은 이름을 준다. proto 의 이름 찾기 규칙 그대로 **안쪽 범위부터 바깥으로** 올려 본다 —
 * `shop.v1.Order` 안의 `Inner` 는 `shop.v1.Order.Inner` 가 먼저고 `shop.v1.Inner` 가 다음이다.
 * 어디에도 없으면 null 이다(짐작해서 아무거나 고르지 않는다).
 */
export function resolveTypeName(
  typeName: string,
  scope: string,
  known: ReadonlySet<string>
): string | null {
  const want = typeName.replace(/^\./, '')
  if (!want) return null
  if (known.has(want)) return want

  const parts = scope.split('.')
  for (let i = parts.length; i > 0; i -= 1) {
    const candidate = `${parts.slice(0, i).join('.')}.${want}`
    if (known.has(candidate)) return candidate
  }
  return null
}

/**
 * 메시지 하나 → 필드 목록.
 *
 * `depth`·`seen` 은 **자기를 참조하는 메시지**(트리 구조)에서 멈추기 위한 것이다 —
 * 안 두면 무한히 파고든다.
 */
export function fieldsOfMessage(
  message: ProtoMessageDesc,
  scope: string,
  index: TypeIndex,
  depth = 0,
  seen: ReadonlySet<string> = new Set()
): FieldDef[] {
  return (message.field ?? [])
    .filter((f) => f.name)
    .map((f) => {
      const repeated = f.label === 'LABEL_REPEATED'
      // proto3 에서 `optional` 이 붙은 것만 "없을 수 있다"를 **선언한** 것이다.
      // 나머지 단일 필드는 늘 기본값이 있어 "없음"이 구분되지 않는다 → 모름.
      const requiredness: FieldDef['requiredness'] = f.proto3Optional ? 'nullable' : 'unknown'

      // 한 필드는 메시지이거나 열거형이지 둘 다일 수 없다 — 메시지부터 보고, 아니면 열거형.
      const messageName = f.typeName ? resolveTypeName(f.typeName, scope, index.knownMessages) : null
      const nested = messageName ? index.messages.get(messageName)! : null
      const enumName =
        !nested && f.typeName ? resolveTypeName(f.typeName, scope, index.knownEnums) : null

      // proto 의 map 은 속으로는 `XxxEntry` 라는 **반복 메시지**다. 그대로 옮기면
      // "키/값 쌍의 배열"이 되는데 JSON 에서는 객체 하나로 온다 — 배열이라 적으면 거짓말이다.
      const isMap = nested?.options?.mapEntry === true

      let inner: FieldDef[] | undefined
      if (nested && !isMap && depth < MAX_DEPTH && messageName && !seen.has(messageName)) {
        inner = fieldsOfMessage(
          nested,
          messageName,
          index,
          depth + 1,
          new Set([...seen, messageName])
        )
      }

      const base: FieldDef = {
        name: f.name!,
        type: isMap
          ? 'object'
          : repeated
            ? 'array'
            : nested
              ? 'object'
              : (SCALARS[f.type ?? ''] ?? 'object'),
        requiredness
      }
      const values = enumName ? index.enums.get(enumName) : undefined
      if (values && values.length > 0) base.enumValues = values
      if (inner && inner.length > 0) base.fields = inner
      return base
    })
}

/** 메서드 하나에 대해 우리가 아는 것. `service` 는 이름 찾기의 시작 범위로 쓴다. */
export interface KnownMethod {
  path: string
  service: string
  requestStream: boolean
  responseStream: boolean
  /** 응답 메시지 서술자. **없을 수 있다** — 그때는 "모양을 못 읽었다"이지 "없다"가 아니다. */
  response: ProtoMessageDesc | null
  /** 요청 메시지 서술자. 보낼 본문의 칸 이름을 검사하는 데 쓴다. */
  request: ProtoMessageDesc | null
  /**
   * 인코딩·디코딩 함수. **`unknown` 으로 들고 다닌다** — 이 파일은 순수(네트워크·라이브러리를
   * 모른다)여야 하고, 실제로 쓰는 곳은 전송 계층 하나뿐이다.
   */
  serialize: unknown
  deserialize: unknown
}

/**
 * 정의 목록 → `/패키지.서비스/메서드` → 메서드.
 *
 * 키를 이 모양으로 잡은 이유는 요청 정의의 `grpcMethod` 칸에 적히는 것과 같은 말이기
 * 때문이다 — 중간에 이름을 한 번 더 번역하면 그 자리에서 어긋난다.
 *
 * **판정도 전송도 이 함수 하나만 쓴다.** 각자 목록을 훑으면 "무엇이 서비스인가"의 규칙이
 * 갈려, 판정 화면은 아는 메서드를 전송 화면은 모른다고 말하는 상태가 생긴다.
 */
export function methodsOf(pkg: LoadedPackage): Map<string, KnownMethod> {
  const out = new Map<string, KnownMethod>()
  for (const [serviceName, entry] of Object.entries(pkg)) {
    if (POISON_KEYS.has(serviceName) || !isService(entry)) continue
    for (const method of Object.values(entry)) {
      if (!method?.path) continue
      out.set(method.path, {
        path: method.path,
        service: serviceName,
        requestStream: method.requestStream === true,
        responseStream: method.responseStream === true,
        response: method.responseType?.type ?? null,
        request: method.requestType?.type ?? null,
        serialize: method.requestSerialize,
        deserialize: method.responseDeserialize
      })
    }
  }
  return out
}

/**
 * **필요한 메서드의 응답 모양만** 짓는다.
 *
 * 서버가 노출한 모든 메서드의 필드 트리를 다 지으면, 명세가 요청 3개만 선언한 상태에서도
 * 서버 전체를 펼치게 된다 — 실측으로 `FieldDef` 30만 개·힙 32MB·3.6초였고 그중 쓰는 것은
 * 3개였다. 판정이 실제로 꺼내 쓰는 경로만 받아서 짓는다.
 */
export function rootFieldsFor(
  pkg: LoadedPackage,
  methods: Map<string, KnownMethod>,
  wanted: Iterable<string>
): Record<string, FieldDef[]> {
  const index = typeIndex(pkg)
  const out: Record<string, FieldDef[]> = {}
  for (const path of new Set(wanted)) {
    const m = methods.get(path)
    // 응답 메시지를 못 읽었으면 **빈 목록을 지어내지 않는다** — 아예 안 싣는다.
    // ("모양을 못 읽었다"와 "그런 메서드가 없다"는 다르다 — 부르는 쪽이 그 둘을 안 뭉쳐야 한다.)
    if (!m?.response) continue
    // 범위를 못 잡으면 서비스 이름에서 시작한다 — 같은 패키지 안의 타입은 그걸로도 풀린다.
    const scope = fullNameOfMessage(m.response, m.service, index) ?? m.service
    out[path] = fieldsOfMessage(m.response, scope, index)
  }
  return out
}

/**
 * 요청 정의의 `grpcMethod` 를 서버가 아는 경로로 맞춘다.
 *
 * 사람은 `Greeter/SayHello`·`SayHello`·`/pkg.Greeter/SayHello` 를 섞어 쓴다 —
 * **짐작해서 아무거나 고르지 않고**, 정확히 하나만 맞을 때 고른다.
 * 둘 이상 맞으면 어느 것인지 모르므로 null 이다.
 */
export function resolveMethodPath(declared: string, known: readonly string[]): string | null {
  const want = declared.trim().replace(/^\//, '')
  if (!want) return null

  const exact = known.filter((k) => k.replace(/^\//, '') === want)
  if (exact.length === 1) return exact[0]

  const tail = known.filter(
    (k) => k.endsWith(`/${want}`) || k.replace(/^\//, '').endsWith(`.${want}`)
  )
  return tail.length === 1 ? tail[0] : null
}

/**
 * 보낼 본문에서 **서버 정의에 없는 칸**을 골라낸다.
 *
 * protobuf 는 모르는 칸을 **아무 말 없이 버린다.** 그래서 `{"cont":3}` 처럼 이름을 한 글자
 * 틀리면 빈 메시지가 나가고, 서버는 기본값으로 답하고, 기록에는 `{"cont":3}` 을 보낸 것으로
 * 남는다 — 나중에 그 기록으로 원인을 되짚을 수 없다. 보내기 전에 이름을 대 준다.
 *
 * 안쪽까지는 안 본다: 중첩 메시지의 칸을 따라가려면 타입 목록이 필요한데, 여기서 잡으려는
 * 것은 **맨 위 오타**이고 그게 실제로 나는 실수다. 못 보는 자리가 있다는 사실은 그대로 둔다.
 */
export function unknownFields(body: unknown, request: ProtoMessageDesc | null): string[] {
  if (!request || typeof body !== 'object' || body === null || Array.isArray(body)) return []
  const declared = new Set((request.field ?? []).map((f) => f.name).filter(Boolean) as string[])
  if (declared.size === 0) return []
  return Object.keys(body).filter((k) => !declared.has(k))
}

/**
 * proto 정의 → 우리 상호작용 모양. **사람이 고르지 않는다** — proto 가 이미 정해 놨다.
 *
 * 보내기만 스트리밍인 메서드는 우리 모양 넷에 딱 맞는 칸이 없다. `duplex`(서로 계속
 * 주고받음)로 둔다 — **보내는 패널이 있어야** 쓸 수 있는 메서드이기 때문이다.
 * `server-stream` 으로 두면 보낼 자리가 없어 아예 못 쓴다.
 */
export function shapeOfMethod(m: {
  requestStream?: boolean
  responseStream?: boolean
}): InteractionShape {
  if (m.requestStream) return 'duplex'
  if (m.responseStream) return 'server-stream'
  return 'unary'
}

/**
 * `FileDescriptorProto` 조각들 → `FileDescriptorSet` 한 덩어리.
 *
 * reflection 은 파일을 **하나씩** 준다. 디코더(`loadFileDescriptorSetFromBuffer`)는
 * 묶음을 받으므로 여기서 묶는다 — `FileDescriptorSet` 은 `repeated FileDescriptorProto file = 1`
 * 하나뿐이라, 조각마다 `필드1·길이제한` 머리(태그 `0x0A` + 길이)를 붙여 이으면 그대로 묶음이다.
 * 같은 파일이 여러 번 오므로(의존 파일이 겹친다) 중복은 이름이 아니라 **바이트로** 거른다.
 */
export function fileDescriptorSet(chunks: readonly Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = []
  const seen = new Set<string>()
  let total = 0

  for (const chunk of chunks) {
    const key = Buffer.from(chunk).toString('base64')
    if (seen.has(key)) continue
    seen.add(key)

    const header = [0x0a, ...varint(chunk.length)]
    parts.push(Uint8Array.from(header), chunk)
    total += header.length + chunk.length
  }

  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** protobuf 의 길이 표기(7비트씩 끊고, 더 남았으면 최상위 비트를 세운다). */
function varint(n: number): number[] {
  const out: number[] = []
  let rest = n
  do {
    let byte = rest & 0x7f
    rest >>>= 7
    if (rest > 0) byte |= 0x80
    out.push(byte)
  } while (rest > 0)
  return out
}
