import { describe, expect, it } from 'vitest'
import { backupVersionNote, backupVersionNumber, isBackupVersion } from './restorePlan'

describe('backupVersionNumber — 되돌리기 전 자동 보관', () => {
  it('최신 뒤의 patch 자리를 쓴다', () => {
    expect(backupVersionNumber(['v0.1.0', 'v0.1.1'])).toBe('v0.1.2')
  })

  it('목록 순서가 뒤죽박죽이어도 진짜 최신을 찾는다', () => {
    expect(backupVersionNumber(['v0.2.0', 'v0.10.0', 'v0.3.0'])).toBe('v0.10.1')
  })

  it('버전이 하나도 없으면 첫 번호', () => {
    expect(backupVersionNumber([])).toBe('v0.0.1')
  })
})

describe('backupVersionNote', () => {
  it('어디로 되돌리다 남긴 것인지 적는다 — 사람이 컷한 버전과 섞이면 계보가 헷갈린다', () => {
    expect(backupVersionNote('v0.1.0')).toBe('되돌리기 전 자동 보관 (→ v0.1.0)')
  })

  it('자기가 쓴 메모를 자기가 알아본다', () => {
    expect(isBackupVersion(backupVersionNote('v0.1.0'))).toBe(true)
    expect(isBackupVersion('운영에서 직접 추가된 변경 흡수')).toBe(false)
    expect(isBackupVersion('')).toBe(false)
  })
})
