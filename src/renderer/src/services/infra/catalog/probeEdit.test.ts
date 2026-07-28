import { describe, it, expect } from 'vitest'
import { relativeExpr, splitArgs } from './ProbeView'

describe('splitArgs — 인자 문자열을 배열로', () => {
  it('공백으로 가른다', () => {
    expect(splitArgs('ec2 describe-instances --output json')).toEqual([
      'ec2',
      'describe-instances',
      '--output',
      'json'
    ])
  })

  it('따옴표로 묶은 덩어리는 한 칸으로 둔다 — 셸이 아니라 여기서 가른다', () => {
    expect(splitArgs('version --format "{{json .}}"')).toEqual(['version', '--format', '{{json .}}'])
    expect(splitArgs(`run --name 'my app'`)).toEqual(['run', '--name', 'my app'])
  })

  it('빈 문자열·공백만이면 빈 배열', () => {
    expect(splitArgs('')).toEqual([])
    expect(splitArgs('   ')).toEqual([])
  })

  it('연속 공백을 빈 인자로 만들지 않는다', () => {
    expect(splitArgs('a    b')).toEqual(['a', 'b'])
  })
})

describe('relativeExpr — 목록 아래 경로를 항목 기준으로', () => {
  it('CASE-icat-074 두 겹 목록에서 항목 기준 경로를 만든다 (AWS EC2 실제 응답 모양)', () => {
    // 목록으로 집은 자리: Reservations[].Instances[]
    const listPath = ['Reservations', 0, 'Instances']
    expect(relativeExpr(['Reservations', 0, 'Instances', 0, 'InstanceId'], listPath)).toBe('InstanceId')
    expect(relativeExpr(['Reservations', 0, 'Instances', 0, 'State', 'Name'], listPath)).toBe('State.Name')
  })

  it('CASE-icat-074 다른 인덱스에서 집어도 같은 상대 경로가 나온다', () => {
    const listPath = ['Reservations', 0, 'Instances']
    expect(relativeExpr(['Reservations', 3, 'Instances', 7, 'InstanceId'], listPath)).toBe('InstanceId')
  })

  it('CASE-icat-074 한 겹 목록에서도 된다', () => {
    expect(relativeExpr(['Vpcs', 0, 'VpcId'], ['Vpcs'])).toBe('VpcId')
  })

  it('CASE-icat-074 따옴표가 필요한 키는 감싼 채로 나온다', () => {
    expect(relativeExpr(['서버목록', 0, '이름'], ['서버목록'])).toBe('"이름"')
  })

  it('목록이 아직 안 정해졌으면 루트 기준 경로를 그대로 준다', () => {
    expect(relativeExpr(['a', 'b', 'c'], null)).toBe('a.b.c')
  })

  it('목록 밖의 경로를 집으면 손대지 않는다 — 잘못 집은 것을 조용히 왜곡하지 않는다', () => {
    expect(relativeExpr(['Other', 'Thing'], ['Vpcs'])).toBe('Other.Thing')
  })

  it('목록 자체(또는 그 항목)를 집으면 원래 경로를 남긴다', () => {
    expect(relativeExpr(['Vpcs', 0], ['Vpcs'])).toBe('Vpcs[0]')
  })
})
