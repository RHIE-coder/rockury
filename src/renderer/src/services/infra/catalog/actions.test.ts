import { describe, it, expect } from 'vitest'
import { actionBlockReason, actionVars, checkArgs, describeAction } from './actions'
import type { ActionDef } from './types'

const act = (over: Partial<ActionDef> & { id: string }): ActionDef => ({
  label: over.id,
  call: { type: 'cli', cmd: 'docker', args: ['restart', '{{node.externalId}}'] },
  ...over
})

describe('checkArgs — 인자 폼이 스키마에서 나온다', () => {
  const withArgs = act({
    id: 'logs',
    args: [
      { id: 'tail', label: '줄 수', required: true },
      { id: 'since', label: '언제부터' }
    ]
  })

  it('CASE-icat-130 필수 인자가 비면 무엇이 빠졌는지 알린다', () => {
    expect(checkArgs(withArgs, { since: '1h' })).toEqual({ ok: false, missing: ['줄 수'] })
  })

  it('CASE-icat-130 공백만 넣은 것도 안 넣은 것으로 본다', () => {
    expect(checkArgs(withArgs, { tail: '   ' })).toEqual({ ok: false, missing: ['줄 수'] })
  })

  it('필수가 다 차면 값을 다듬어 통과시킨다', () => {
    expect(checkArgs(withArgs, { tail: ' 50 ', since: '1h' })).toEqual({
      ok: true,
      values: { tail: '50', since: '1h' }
    })
  })

  it('선택 인자는 비어도 통과하고, 빈 값은 빈 문자열로 채운다 — 자리표시자가 값 없이 던지지 않게', () => {
    expect(checkArgs(withArgs, { tail: '50' })).toEqual({ ok: true, values: { tail: '50', since: '' } })
  })

  it('인자 스키마가 없으면 언제나 통과한다(폼이 없는 버튼)', () => {
    expect(checkArgs(act({ id: 'restart' }), {})).toEqual({ ok: true, values: {} })
  })

  it('스키마에 없는 값은 버린다 — 카탈로그가 선언한 것만 명령에 들어간다', () => {
    const r = checkArgs(withArgs, { tail: '1', 몰래: '넣은값' })
    expect(r).toEqual({ ok: true, values: { tail: '1', since: '' } })
  })
})

describe('actionBlockReason — 위험한 액션을 어디서 막나', () => {
  const danger = act({ id: 'stop', danger: true })
  const safe = act({ id: 'logs' })

  it('CASE-icat-131 읽기 전용 연결에서는 위험 액션이 잠긴다', () => {
    expect(actionBlockReason(danger, { readOnly: true })).toContain('읽기 전용')
  })

  it('CASE-icat-131 읽기 전용이어도 위험하지 않은 액션은 열려 있다', () => {
    expect(actionBlockReason(safe, { readOnly: true })).toBeNull()
  })

  it('읽기 전용이 아니면 위험 액션도 열려 있다(확인은 화면이 받는다)', () => {
    expect(actionBlockReason(danger, { readOnly: false })).toBeNull()
  })

  it('연결이 없으면 아무것도 못 돌린다 — 어디에 대고 돌릴지가 없다', () => {
    expect(actionBlockReason(safe, null)).toContain('연결')
  })
})

describe('actionVars — 무엇이 명령에 채워지나', () => {
  it('CASE-icat-132 실물의 식별자·이름이 node 이름공간으로 들어간다', () => {
    const v = actionVars({ externalId: 'i-001', name: 'payment-api', typeId: 'aws.ec2' }, {})
    expect(v.node).toEqual({ externalId: 'i-001', name: 'payment-api', typeId: 'aws.ec2' })
  })

  it('CASE-icat-132 폼에 채운 값은 arg 이름공간으로 들어간다 — node 와 섞이지 않는다', () => {
    const v = actionVars({ externalId: 'i-001', name: 'x', typeId: 't' }, { tail: '50' })
    expect(v.arg).toEqual({ tail: '50' })
    expect(v.node.tail).toBeUndefined()
  })

  it('두 이름공간이 겹치는 이름을 써도 서로 덮지 않는다', () => {
    const v = actionVars({ externalId: 'i-001', name: '실물이름', typeId: 't' }, { name: '폼값' })
    expect(v.node.name).toBe('실물이름')
    expect(v.arg.name).toBe('폼값')
  })
})

describe('describeAction — 무엇이 돌아갈지 먼저 보인다', () => {
  it('CASE-icat-133 실행 전에 사람이 읽을 수 있는 명령 한 줄을 만든다', () => {
    expect(describeAction(act({ id: 'restart' }))).toBe('docker restart {{node.externalId}}')
  })

  it('cli 가 아닌 호출도 뭉개지 않고 무엇인지 말한다', () => {
    const http = act({ id: 'x', call: { type: 'http', method: 'POST', url: 'https://api/x' } })
    expect(describeAction(http)).toBe('POST https://api/x')
  })
})
