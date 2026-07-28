import { describe, it, expect } from 'vitest'
import { MW_KINDS, defaultPortOf, parseCommandLine, quickCommandsOf } from './console'

describe('parseCommandLine — 콘솔에 친 줄을 인자 배열로', () => {
  it('CASE-imw-020 공백으로 가른다', () => {
    expect(parseCommandLine('GET mykey')).toEqual(['GET', 'mykey'])
  })

  it('CASE-imw-020 따옴표로 묶은 덩어리는 한 인자다 — 공백이 든 값을 넣을 수 있어야 한다', () => {
    expect(parseCommandLine('SET k "a b c"')).toEqual(['SET', 'k', 'a b c'])
    expect(parseCommandLine("SET k 'a b'")).toEqual(['SET', 'k', 'a b'])
  })

  it('CASE-imw-020 빈 줄·공백만 있는 줄은 빈 배열 — 빈 명령을 보내지 않는다', () => {
    expect(parseCommandLine('')).toEqual([])
    expect(parseCommandLine('   ')).toEqual([])
  })

  it('여러 공백·탭도 하나로 본다', () => {
    expect(parseCommandLine('GET\t \t k')).toEqual(['GET', 'k'])
  })

  it('빈 따옴표는 빈 문자열 인자로 살린다 — 값이 빈 문자열인 경우', () => {
    expect(parseCommandLine('SET k ""')).toEqual(['SET', 'k', ''])
  })
})

describe('defaultPortOf — 종류마다 기본 포트', () => {
  it('CASE-imw-021 아는 종류는 기본 포트를 준다 — 사용자가 6379 를 외우지 않아도 된다', () => {
    expect(defaultPortOf('redis')).toBe(6379)
    expect(defaultPortOf('rabbitmq')).toBe(5672)
    expect(defaultPortOf('kafka')).toBe(9092)
    expect(defaultPortOf('mqtt')).toBe(1883)
  })

  it('모르는 종류는 0 — 지어내지 않는다', () => {
    expect(defaultPortOf('없는것')).toBe(0)
  })
})

describe('quickCommandsOf — 처음 붙은 사람이 누를 것', () => {
  it('CASE-imw-022 Redis 는 살았는지·몇 개인지·어떤 서버인지를 한 번에 볼 수 있게 준다', () => {
    const q = quickCommandsOf('redis').map((c) => c.line)
    expect(q).toContain('PING')
    expect(q).toContain('INFO server')
    expect(q).toContain('DBSIZE')
  })

  it('빠른 명령은 전부 읽기다 — 콘솔을 열자마자 데이터가 바뀌면 안 된다', () => {
    const WRITES = ['SET', 'DEL', 'FLUSHALL', 'FLUSHDB', 'RENAME', 'EXPIRE']
    for (const kind of MW_KINDS) {
      for (const c of quickCommandsOf(kind.id)) {
        const verb = parseCommandLine(c.line)[0]?.toUpperCase() ?? ''
        expect(WRITES, `${kind.id}: ${c.line}`).not.toContain(verb)
      }
    }
  })

  it('아직 안 만든 종류는 빈 목록 — 있는 척하지 않는다', () => {
    expect(quickCommandsOf('kafka')).toEqual([])
  })
})

describe('MW_KINDS — 목록에 담긴 사실', () => {
  it('CASE-imw-023 명세가 정한 순서(Redis → RabbitMQ → Kafka → MQTT)를 지킨다', () => {
    expect(MW_KINDS.map((k) => k.id)).toEqual(['redis', 'rabbitmq', 'kafka', 'mqtt'])
  })

  it('CASE-imw-023 아직 못 붙는 종류는 **못 붙는다고 표시**한다 — 눌러도 안 되는 것을 숨기지 않는다', () => {
    const ready = MW_KINDS.filter((k) => k.ready).map((k) => k.id)
    expect(ready).toEqual(['redis'])
    for (const k of MW_KINDS) {
      if (!k.ready) expect(k.note, k.id).toBeTruthy()
    }
  })
})
