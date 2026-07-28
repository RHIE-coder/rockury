import { describe, it, expect } from 'vitest'
import { describeTestFailure, pickTestProbe } from './connectionTest'
import type { Catalog, Discover, NodeTypeDef } from './types'

const cli = (cmd: string): Discover => ({
  call: { type: 'cli', cmd, args: ['ls'] },
  list: '[]',
  map: { externalId: 'id' }
})

const type = (over: Partial<NodeTypeDef> & { id: string }): NodeTypeDef => ({
  label: over.id,
  icon: 'phosphor:cube',
  ...over
})

const catalog = (nodeTypes: NodeTypeDef[]): Catalog => ({
  schemaVersion: 1,
  catalogVersion: '2026-07',
  provider: { id: 'p', label: '공급자' },
  nodeTypes
})

describe('pickTestProbe — 무엇으로 시험하나', () => {
  it('CASE-icat-100 첫 CLI 탐침을 고른다', () => {
    const c = catalog([type({ id: 'a', discover: cli('docker') }), type({ id: 'b', discover: cli('aws') })])
    expect(pickTestProbe(c)?.typeId).toBe('a')
  })

  it('탐침 없는 종류(프리셋)는 건너뛴다', () => {
    const c = catalog([type({ id: 'preset' }), type({ id: 'real', discover: cli('docker') })])
    expect(pickTestProbe(c)?.typeId).toBe('real')
  })

  it('아직 못 돌리는 호출 방식(http·builtin)은 고르지 않는다 — 눌러도 안 되는 버튼을 만들지 않는다', () => {
    const http: Discover = {
      call: { type: 'http', method: 'GET', url: 'https://x' },
      list: '[]',
      map: { externalId: 'id' }
    }
    const c = catalog([type({ id: 'h', discover: http }), type({ id: 'c', discover: cli('docker') })])
    expect(pickTestProbe(c)?.typeId).toBe('c')
  })

  it('시험할 것이 하나도 없으면 null — 화면은 버튼을 감춘다', () => {
    expect(pickTestProbe(catalog([type({ id: 'preset' })]))).toBeNull()
    expect(pickTestProbe(catalog([]))).toBeNull()
  })

  it('고른 종류의 표시 이름을 함께 준다 — "무엇으로 시험했는지"를 화면이 말해야 한다', () => {
    const c = catalog([type({ id: 'a', label: '컨테이너', discover: cli('docker') })])
    expect(pickTestProbe(c)).toMatchObject({ typeId: 'a', label: '컨테이너' })
  })
})

describe('describeTestFailure — 실패를 뭉개지 않는다', () => {
  it('CASE-icat-101 시간 초과는 시간 초과라고 말한다', () => {
    const m = describeTestFailure({ timedOut: true, exitCode: null, stderr: '', error: '' })
    expect(m).toBe('시간 초과')
  })

  it('종료 코드와 표준 오류를 그대로 보인다', () => {
    const m = describeTestFailure({
      timedOut: false,
      exitCode: 127,
      stderr: 'docker: command not found',
      error: ''
    })
    expect(m).toContain('127')
    expect(m).toContain('docker: command not found')
  })

  it('표준 오류가 비면 실행 자체의 오류를 쓴다', () => {
    const m = describeTestFailure({ timedOut: false, exitCode: null, stderr: '', error: 'spawn ENOENT' })
    expect(m).toContain('spawn ENOENT')
  })

  it('아무 단서도 없으면 지어내지 않고 "이유를 알 수 없습니다"라고 말한다', () => {
    expect(describeTestFailure({ timedOut: false, exitCode: null, stderr: '', error: '' })).toBe(
      '이유를 알 수 없습니다.'
    )
  })

  it('종료 코드 0 이어도 실패로 불렸으면 그 사실을 숨기지 않는다', () => {
    const m = describeTestFailure({ timedOut: false, exitCode: 0, stderr: '경고만 남음', error: '' })
    expect(m).toContain('경고만 남음')
  })
})
