import { describe, expect, it } from 'vitest'
import { envelope } from './envelope'

describe('envelope', () => {
  it('동기 반환값을 success 봉투로 감싼다', async () => {
    const res = await envelope(() => 42)
    expect(res).toEqual({ success: true, data: 42 })
  })

  it('비동기(Promise) 반환값을 await 해서 감싼다', async () => {
    const res = await envelope(async () => ({ id: 'x' }))
    expect(res).toEqual({ success: true, data: { id: 'x' } })
  })

  it('data 가 undefined 여도 success 는 true (void 핸들러)', async () => {
    const res = await envelope(() => undefined)
    expect(res.success).toBe(true)
    expect(res.error).toBeUndefined()
  })

  it('Error 를 던지면 message 를 error 로 담고 success=false', async () => {
    const res = await envelope(() => {
      throw new Error('연결 실패')
    })
    expect(res).toEqual({ success: false, error: '연결 실패' })
  })

  it('비동기 reject 도 봉투로 잡는다', async () => {
    const res = await envelope(async () => {
      throw new Error('타임아웃')
    })
    expect(res).toEqual({ success: false, error: '타임아웃' })
  })

  it('Error 가 아닌 값을 던져도 문자열로 정규화한다', async () => {
    const res = await envelope(() => {
      throw 'bare string'
    })
    expect(res).toEqual({ success: false, error: 'bare string' })
  })

  it('message 가 빈 드라이버 오류도 사유를 담는다 (mysql2 ECONNREFUSED 회귀)', async () => {
    // 빈 문자열을 그대로 담으면 화면이 `error && (…)` 로 falsy 판정해 오류를 안 그린다.
    const res = await envelope(() => {
      throw Object.assign(new Error(''), { code: 'ECONNREFUSED', address: '127.0.0.1', port: 33306 })
    })
    expect(res.success).toBe(false)
    expect(res.error).toBe('ECONNREFUSED (127.0.0.1:33306)')
  })
})
