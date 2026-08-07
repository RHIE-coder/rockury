import { describe, expect, it } from 'vitest'
import { peerTargets } from './peers'

/** 창 하나를 흉내낸다 — `peerTargets` 가 보는 것은 이 두 값뿐이다. */
function win(webContentsId: number, destroyed = false): { destroyed: boolean; webContentsId: number } {
  return { destroyed, webContentsId }
}

describe('peerTargets — 화면발 쓰기를 받을 창 고르기', () => {
  it('쓴 창은 뺀다 — 제 쓰기를 되받으면 낙관 반영을 한 번 더 되씹는다', () => {
    const targets = peerTargets([win(1), win(2), win(3)], 2)
    expect(targets.map((w) => w.webContentsId)).toEqual([1, 3])
  })

  it('창이 하나뿐이면 보낼 곳이 없다', () => {
    expect(peerTargets([win(1)], 1)).toEqual([])
  })

  it('닫힌 창은 뺀다 — 파괴된 webContents 에 보내면 던진다', () => {
    const targets = peerTargets([win(1), win(2, true), win(3)], 1)
    expect(targets.map((w) => w.webContentsId)).toEqual([3])
  })

  it('보낸 창을 못 찾아도(창 밖에서 온 쓰기) 나머지 전부에 간다', () => {
    const targets = peerTargets([win(1), win(2)], -1)
    expect(targets.map((w) => w.webContentsId)).toEqual([1, 2])
  })
})
