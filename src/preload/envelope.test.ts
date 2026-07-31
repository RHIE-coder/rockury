import { describe, expect, it } from 'vitest'
import { unwrap } from './envelope'

describe('봉투 언랩', () => {
  it('성공이면 data 를 돌려준다', async () => {
    await expect(unwrap(Promise.resolve({ success: true, data: [1, 2] }))).resolves.toEqual([1, 2])
  })

  it('실패면 문구를 담아 throw', async () => {
    await expect(unwrap(Promise.resolve({ success: false, error: '연결 실패' }))).rejects.toThrow(
      '연결 실패'
    )
  })

  it('문구가 비어 있어도 빈 오류를 만들지 않는다 (mysql2 ECONNREFUSED 회귀)', async () => {
    // `??` 는 빈 문자열을 통과시켜 new Error('') 를 만들고, 화면은 그걸 오류로 안 본다.
    for (const error of ['', '   ', undefined]) {
      await expect(unwrap(Promise.resolve({ success: false, error }))).rejects.toThrow(
        'IPC 호출에 실패했습니다.'
      )
    }
  })
})
