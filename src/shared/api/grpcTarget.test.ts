import { describe, expect, it } from 'vitest'
import { assumedNote, parseGrpcTarget, plaintextSecretBlock } from './grpcTarget'

/** TestPlan: api-contract · CASE-apicontract-005h (gRPC 접속 대상 읽기). */

describe('gRPC 접속 대상', () => {
  it('평문 방식은 암호화 없이 붙는다', () => {
    const t = parseGrpcTarget('grpc://localhost:50051')
    expect(t).toMatchObject({ address: 'localhost:50051', secure: false, assumed: false })
  })

  it('암호화 방식은 TLS 로 붙는다', () => {
    expect(parseGrpcTarget('grpcs://api.example.com:443')).toMatchObject({
      address: 'api.example.com:443',
      secure: true,
      assumed: false
    })
    expect(parseGrpcTarget('https://api.example.com:8443').secure).toBe(true)
  })

  it('경로·쿼리는 접속 대상이 아니다 — 잘라 낸다', () => {
    // 경로 자리는 gRPC 에서 메서드 이름이 쓴다.
    expect(parseGrpcTarget('http://localhost:50051/pkg.Svc/Method?x=1').address).toBe(
      'localhost:50051'
    )
  })

  it('포트가 없으면 방식의 기본 포트를 쓴다', () => {
    expect(parseGrpcTarget('https://api.example.com').address).toBe('api.example.com:443')
    expect(parseGrpcTarget('http://api.example.com').address).toBe('api.example.com:80')
  })

  it('**방식이 없으면 평문으로 가정하되 가정했다고 밝힌다**', () => {
    const t = parseGrpcTarget('localhost:50051')
    expect(t).toMatchObject({ address: 'localhost:50051', secure: false, assumed: true })
    // 조용히 정하면 TLS 서버에서 아무 말 없이 멎는다 — 사용자가 원인을 못 찾는다.
    expect(assumedNote(t)).toContain('평문')
  })

  it('**안내에 꾸밈 문법을 넣지 않는다** — 글자 그대로 그려지는 자리로 간다', () => {
    // 별표·백틱을 넣으면 사용자가 별표·백틱을 본다(타임라인 행·사유 배너 둘 다 평문 렌더).
    const note = assumedNote(parseGrpcTarget('localhost:50051'))!
    expect(note).not.toMatch(/[*`]/)
  })

  it('**주소에 박힌 사용자:비번을 잘라 낸다** — 안 자르면 오류 문구·기록에 남는다', () => {
    // 그 값은 환경의 비밀이 아니라 주소에 박힌 것이라 **가리는 그물에 안 걸린다.**
    const t = parseGrpcTarget('grpcs://svc:p4ssw0rd@api.example.com')
    expect(t.address).toBe('api.example.com:443')
    expect(JSON.stringify(t)).not.toContain('p4ssw0rd')
  })

  it('정한 것이 아니면 굳이 말하지 않는다', () => {
    expect(assumedNote(parseGrpcTarget('grpcs://x.io:443'))).toBeNull()
  })

  it('기본 포트를 채운 것은 가정으로 세지 않는다 — 그건 규약이다', () => {
    expect(parseGrpcTarget('https://api.example.com').assumed).toBe(false)
  })

  it('빈 주소는 사유를 단다', () => {
    expect(parseGrpcTarget('').problem).toContain('없습니다')
    expect(parseGrpcTarget('   ').address).toBe('')
  })

  it('gRPC 가 아닌 방식은 짐작하지 않고 사유를 단다', () => {
    const t = parseGrpcTarget('ws://localhost:50051')
    expect(t.address).toBe('')
    expect(t.problem).toContain('ws://')
  })

  it('호스트가 없으면 사유를 단다', () => {
    expect(parseGrpcTarget('grpc:///only/path').problem).toContain('호스트가 없습니다')
  })
})

// ── 암호화되는지 모르는 채로 비밀을 보내지 않는다 ─────────────────────────

describe('평문 가정 + 비밀 (CASE-apicontract-005j)', () => {
  const secrets = ['sk_live_ABC']

  it('**방식이 없는 주소로 비밀을 보내려 하면 막는다**', () => {
    // 정의를 받아 오는 왕복이 먼저라, 안 막으면 "평문으로 붙었다" 안내가 닿기 전에 토큰이 나간다.
    const why = plaintextSecretBlock(
      parseGrpcTarget('api.example.com:443'),
      { authorization: 'Bearer sk_live_ABC' },
      secrets
    )
    expect(why).toContain('grpcs://')
  })

  it('방식을 적었으면 사람이 정한 것이다 — 안 막는다', () => {
    const headers = { authorization: 'Bearer sk_live_ABC' }
    expect(plaintextSecretBlock(parseGrpcTarget('grpc://h:1'), headers, secrets)).toBeNull()
    expect(plaintextSecretBlock(parseGrpcTarget('grpcs://h:1'), headers, secrets)).toBeNull()
  })

  it('비밀이 안 실렸으면 안 막는다 — 평문 자체가 잘못은 아니다', () => {
    expect(plaintextSecretBlock(parseGrpcTarget('h:1'), { accept: 'x' }, secrets)).toBeNull()
    expect(plaintextSecretBlock(parseGrpcTarget('h:1'), {}, [])).toBeNull()
  })

  it('빈 비밀 값이 모든 헤더에 걸리지 않는다', () => {
    expect(plaintextSecretBlock(parseGrpcTarget('h:1'), { a: 'x' }, [''])).toBeNull()
  })
})
