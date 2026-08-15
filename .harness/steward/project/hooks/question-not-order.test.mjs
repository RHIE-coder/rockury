import { describe, expect, it } from 'vitest'
import { shouldPause } from './question-not-order.mjs'

/**
 * 물음을 지시로 알아듣는 것을 막는 가드의 판정.
 *
 * 정규식 뭉치라 조용히 헐거워지기 쉽다 — 한 줄 고쳤다가 아무것도 안 잡는 가드가 되는 것이
 * 이 검사가 막는 사고다. 사례는 실제 대화에서 그대로 떠 왔다(2026-08-13).
 */
describe('물음이라 멈춰야 하는 말', () => {
  it('사고 그 자체 — 답답해하는 말투 + 어미형 물음', () => {
    // 여기서 "없애"는 조건절이다. 지시로 세면 이 가드가 통째로 헐거워진다.
    expect(shouldPause('아 시발 결정을 못하게 하네. 그러니까 그냥 없애면 되는거냐고')).toBe(true)
  })

  it.each([
    '로그중에서 기준선 관련 정보는 의미가 있어?',
    '아니 우리 설계 기준으로 하기로 했잖아... 갑자기 또 기준선을 살린다고?',
    '이게 맞나',
    '이렇게 하면 되나요',
    '지금 어떤 문제가 있는거야?',
    '어떻게 생각해?'
  ])('%s', (say) => {
    expect(shouldPause(say)).toBe(true)
  })
})

describe('지시라 그냥 가야 하는 말', () => {
  it.each([
    ['부탁 어미로 끝나는 물음표', '기준선 딱지 좀 고쳐줄래?'],
    ['평범한 지시', '저 로그 지워줘'],
    ['-해 로 끝나는 명령', '기준선 흔적 전부 정리해'],
    ['사정 설명 뒤 지시', '이거 왜 이래? 고쳐줘'],
    ['평서문', '기준선을 걷어냈으니 흔적도 없앤다'],
    ['슬래시 커맨드 호출', '<command-name>/steward:immunize</command-name> 무엇무엇 해줘']
  ])('%s', (_label, say) => {
    expect(shouldPause(say)).toBe(false)
  })

  it('빈 말에는 관여하지 않는다', () => {
    expect(shouldPause('')).toBe(false)
  })
})
