import { describe, expect, it } from 'vitest'
import { errorMessage } from './errorMessage'

describe('오류 한 줄 뽑기', () => {
  it('메시지가 있으면 그대로', () => {
    expect(errorMessage(new Error('연결을 찾을 수 없습니다: conn_1'))).toBe(
      '연결을 찾을 수 없습니다: conn_1'
    )
  })

  it('문자열·비-Error 도 받는다', () => {
    expect(errorMessage('접속 실패')).toBe('접속 실패')
    expect(errorMessage(42)).toBe('42')
  })
})

describe('빈 메시지를 절대 그대로 흘리지 않는다 (mysql2 ECONNREFUSED 회귀)', () => {
  /** mysql2 가 실제로 던지는 모양 — message 는 빈 문자열이고 사유는 code 에만 있다(실측). */
  const socketError = (): Error =>
    Object.assign(new Error(''), {
      code: 'ECONNREFUSED',
      errno: -61,
      syscall: 'connect',
      address: '127.0.0.1',
      port: 33306
    })

  it('code 와 주소로 사유를 복원한다', () => {
    expect(errorMessage(socketError())).toBe('ECONNREFUSED (127.0.0.1:33306)')
  })

  it('주소가 없으면 code 만', () => {
    expect(errorMessage(Object.assign(new Error(''), { code: 'ETIMEDOUT' }))).toBe('ETIMEDOUT')
  })

  it('아무 단서도 없으면 기본 문구 — 어떤 입력에도 빈 문자열은 없다', () => {
    for (const v of [new Error(''), new Error('   '), '', '  ', null, undefined, {}]) {
      expect(errorMessage(v)).not.toBe('')
    }
    expect(errorMessage(new Error(''), 'IPC 호출에 실패했습니다.')).toBe('IPC 호출에 실패했습니다.')
  })

  it('이름이 붙은 오류는 이름이라도 보인다', () => {
    const e = new Error('')
    e.name = 'AbortError'
    expect(errorMessage(e)).toBe('AbortError')
  })
})
