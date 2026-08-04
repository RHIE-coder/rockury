import { describe, expect, it } from 'vitest'
import { describeConnectionError } from './connectionProblem'

/**
 * 2026-08-04 사용자 실측: 접속이 죽은 줄 모르고 "앱이 고장 났나" 했다. 화면에 뜬 것은
 * `역설계 실패: connect ECONNREFUSED 127.0.0.1:59999` 였다 — 개발자 문구라 무엇을 해야
 * 할지 알 수 없었다. 여기서는 **원인과 할 일**이 사람 말로 나오는지만 본다.
 */
describe('describeConnectionError', () => {
  it('연결 거부 — 서버가 꺼졌거나 포트가 다르다', () => {
    const p = describeConnectionError('connect ECONNREFUSED 127.0.0.1:59999')
    expect(p.reason).toBe('서버가 연결을 거부했습니다')
    expect(p.hint).toContain('포트')
    // 원문은 버리지 않는다 — 진짜 원인이 여기에만 있을 때가 있다.
    expect(p.raw).toContain('ECONNREFUSED')
  })

  it.each([
    ['getaddrinfo ENOTFOUND db.internal', '서버 주소를 찾을 수 없습니다'],
    ['connect ETIMEDOUT 10.0.0.5:5432', '서버가 응답하지 않습니다'],
    ['password authentication failed for user "app"', '아이디 또는 비밀번호가 맞지 않습니다'],
    ['ER_ACCESS_DENIED_ERROR: Access denied for user', '아이디 또는 비밀번호가 맞지 않습니다'],
    ['database "shop" does not exist', '그 이름의 데이터베이스가 없습니다'],
    ['Unknown database \'shop\'', '그 이름의 데이터베이스가 없습니다'],
    ['permission denied for schema public', '이 계정에는 볼 권한이 없습니다'],
    ['self signed certificate in certificate chain', '보안 연결(SSL)에서 막혔습니다'],
    ['socket hang up', '연결이 도중에 끊겼습니다'],
    ['SQLITE_CANTOPEN: unable to open database file', '데이터베이스 파일을 열 수 없습니다']
  ])('%s → %s', (raw, reason) => {
    expect(describeConnectionError(raw).reason).toBe(reason)
  })

  it('아는 오류에는 확인할 것이 함께 나온다', () => {
    // 원인만 알려 주고 할 일을 안 주면 결국 어디를 봐야 할지 모른다.
    for (const raw of ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'Access denied']) {
      expect(describeConnectionError(raw).hint, raw).toBeTruthy()
    }
  })

  it('모르는 오류는 원인을 지어내지 않는다 — 원문만 남긴다', () => {
    const p = describeConnectionError('Something entirely unexpected happened')
    expect(p.reason).toBe('연결하지 못했습니다')
    expect(p.hint).toBe(null)
    expect(p.raw).toBe('Something entirely unexpected happened')
  })

  it('빈 오류에도 안전하다', () => {
    expect(describeConnectionError('')).toEqual({
      reason: '연결하지 못했습니다',
      hint: null,
      raw: ''
    })
  })

  it('인증 실패를 연결 거부보다 먼저 보지 않는다 — 둘 다 들어 있으면 연결이 먼저다', () => {
    // 접속조차 못 했으면 인증은 시도되지도 않았다. 순서가 뒤집히면 엉뚱한 데(비밀번호)를 고치게 된다.
    expect(describeConnectionError('ECONNREFUSED while auth').reason).toBe(
      '서버가 연결을 거부했습니다'
    )
  })
})
