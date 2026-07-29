/**
 * 환경의 서버 주소 → gRPC 가 받는 접속 대상 — `docs/spec/api-contract.md` § drift.complete.
 *
 * gRPC 는 `http://호스트/경로` 가 아니라 **`호스트:포트`** 하나를 받고, 암호화(TLS) 여부를
 * 부르는 쪽이 **따로 정해서** 넘긴다. 주소만 보고는 그걸 알 수 없다 —
 * 그래서 이 함수는 "정했다"와 "몰라서 가정했다"를 갈라서 돌려준다(`assumed`).
 *
 * 왜 굳이 가르나: 평문으로 붙어야 할 자리에 TLS 로 붙으면 손잡기 단계에서 알 수 없는 오류만
 * 나고, 반대로 TLS 서버에 평문으로 붙으면 그냥 조용히 멎는다. 둘 다 "왜 안 되는지"가
 * 화면에 안 나온다 — 가정했다는 사실을 알려야 사용자가 주소에 `grpcs://` 를 붙일 수 있다.
 */

export interface GrpcTarget {
  /** `호스트:포트`. gRPC 라이브러리에 그대로 넘긴다. */
  address: string
  /** TLS 로 붙을 것인가. */
  secure: boolean
  /** 주소에 표시가 없어 **우리가 정한** 것인가. 화면에 그 사실을 적기 위한 칸. */
  assumed: boolean
  /** 주소를 못 읽었을 때의 사유. 채워져 있으면 `address` 는 빈 값이다. */
  problem: string | null
}

const SECURE_SCHEMES = new Set(['grpcs', 'https'])
const PLAIN_SCHEMES = new Set(['grpc', 'http'])

export function parseGrpcTarget(baseUrl: string): GrpcTarget {
  const raw = (baseUrl ?? '').trim()
  if (!raw) {
    return { address: '', secure: false, assumed: false, problem: '환경에 서버 주소가 없습니다.' }
  }

  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(raw)
  const scheme = m ? m[1].toLowerCase() : null
  // 경로·쿼리는 gRPC 접속 대상이 아니다(경로 자리는 메서드 이름이 쓴다) — 잘라 낸다.
  // `사용자:비번@` 도 잘라 낸다: 안 자르면 그 글자가 접속 대상에 남아 오류 문구·기록에
  // 그대로 실린다. 그건 환경의 비밀 값이 아니라 주소에 박힌 것이라 **가리는 그물에 안 걸린다.**
  const authority = (m ? m[2] : raw).replace(/[/?#].*$/, '').replace(/^[^@]*@/, '')
  if (!authority) {
    return { address: '', secure: false, assumed: false, problem: `주소에 호스트가 없습니다 — '${raw}'` }
  }

  if (scheme && !SECURE_SCHEMES.has(scheme) && !PLAIN_SCHEMES.has(scheme)) {
    return {
      address: '',
      secure: false,
      assumed: false,
      problem: `'${scheme}://' 는 gRPC 주소가 아닙니다 — grpc:// · grpcs:// · http:// · https:// 를 쓰세요.`
    }
  }

  const secure = scheme ? SECURE_SCHEMES.has(scheme) : false
  const hasPort = /:\d+$/.test(authority)
  // 포트가 없으면 웹의 기본 포트를 쓴다. 이건 **가정이 아니라 규약**이라 `assumed` 를 켜지 않는다 —
  // `assumed` 는 오직 "암호화 여부를 우리가 정했다"만 가리킨다(그것만이 조용히 멎는 원인이 된다).
  const address = hasPort ? authority : `${authority}:${secure ? 443 : 80}`

  return { address, secure, assumed: scheme === null, problem: null }
}

/**
 * 사용자에게 보일 한 줄. 가정했을 때만 채워진다 — 아니면 굳이 말하지 않는다.
 *
 * **꾸밈 문법(`**`·백틱)을 쓰지 않는다.** 이 글은 타임라인 행·사유 배너에 **글자 그대로**
 * 그려지는 자리로 간다 — 별표를 넣으면 사용자가 별표를 본다.
 */
export function assumedNote(target: GrpcTarget): string | null {
  if (!target.assumed) return null
  return (
    `주소에 방식이 없어 평문(암호화 없음)으로 붙습니다 — ${target.address}. ` +
    'TLS 서버라면 주소를 grpcs:// 로 시작하세요.'
  )
}

/**
 * **암호화되는지 모르는 채로 비밀을 보내지 않는다.**
 *
 * 주소에 방식이 없으면 우리는 평문으로 붙는데(위 `assumed`), 그 채널로 인증 토큰이 나가면
 * 경로상의 누구나 읽는다. 더 나쁜 것은 순서다 — 정의를 받아 오는 왕복이 **먼저** 일어나므로
 * "평문으로 붙었다"는 안내가 닿을 때는 토큰이 이미 나간 뒤다.
 *
 * 그래서 짐작하지 않고 **멈추고 사람에게 정하게 한다.** `grpc://` 라고 적으면 "평문으로
 * 보내도 된다"는 뜻이 되고, `grpcs://` 면 암호화한다. 둘 다 사용자의 명시적 선택이다.
 * (비밀이 안 실린 요청은 막지 않는다 — 평문 자체가 잘못은 아니다.)
 */
export function plaintextSecretBlock(
  target: GrpcTarget,
  headers: Record<string, string>,
  secrets: readonly string[]
): string | null {
  if (!target.assumed || secrets.length === 0) return null
  const values = Object.values(headers)
  const leaking = secrets.some((s) => s.length > 0 && values.some((v) => v.includes(s)))
  if (!leaking) return null
  return (
    `이 요청에는 비밀 값이 실려 있는데 주소(${target.address})에 암호화 여부가 없습니다 — ` +
    '암호화되는지 모르는 채로는 보내지 않습니다. 환경 주소를 grpcs:// (암호화) 또는 ' +
    'grpc:// (평문으로 보내도 됨)로 시작하도록 고쳐 주세요.'
  )
}
