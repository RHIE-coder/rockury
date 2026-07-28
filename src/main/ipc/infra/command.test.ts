import { describe, it, expect } from 'vitest'
import { prepareCommand, runCli } from './command'

const call = (args: string[]): { type: 'cli'; cmd: string; args: string[] } => ({
  type: 'cli',
  cmd: 'demo',
  args
})

describe('prepareCommand — 치환', () => {
  it('CASE-icat-040 치환은 인자 배열의 한 칸 안에서만 일어난다', () => {
    const r = prepareCommand(call(['ec2', 'describe', '--profile', '{{cred.profile}}']), {
      cred: { profile: 'prod' }
    })
    expect(r.args).toEqual(['ec2', 'describe', '--profile', 'prod'])
    expect(r.args).toHaveLength(4)
  })

  it('CASE-icat-040 한 칸 안에 여러 자리표시자가 있어도 칸 수는 안 늘어난다', () => {
    const r = prepareCommand(call(['{{cred.a}}-{{node.b}}']), {
      cred: { a: 'x' },
      node: { b: 'y' }
    })
    expect(r.args).toEqual(['x-y'])
  })

  it('CASE-icat-041 공백·따옴표·세미콜론·&& 가 들어와도 인자가 쪼개지지 않는다', () => {
    const nasty = `a b; rm -rf / && echo "pwned" 'x'`
    const r = prepareCommand(call(['--name', '{{cred.n}}']), { cred: { n: nasty } })
    expect(r.args).toHaveLength(2)
    expect(r.args[1]).toBe(nasty)
  })

  it('CASE-icat-042 정의되지 않은 자리표시자는 빈 문자열로 밀지 않고 오류로 세운다', () => {
    expect(() => prepareCommand(call(['--profile', '{{cred.missing}}']), { cred: {} })).toThrow(
      /missing/
    )
    expect(() => prepareCommand(call(['{{node.nope}}']), {})).toThrow(/nope/)
  })

  it('CASE-icat-042 우리 것이 아닌 괄호는 손대지 않고 흘려보낸다 — 도커 출력 서식이 그렇다', () => {
    // 도커·kubectl 은 `--format {{json .Names}}` 처럼 같은 괄호를 쓴다.
    // 이걸 우리 자리표시자로 보고 던지면 정상 명령을 카탈로그에 적을 수 없다.
    const r = prepareCommand(call(['ps', '--format', '{{json .}}', '--filter', '{{json .Names}}']), {})
    expect(r.args).toEqual(['ps', '--format', '{{json .}}', '--filter', '{{json .Names}}'])
    expect(r.display).toEqual(r.args)
  })

  it('CASE-icat-042 우리 이름공간이면 값이 없을 때 반드시 던진다 — 조용한 통과 없음', () => {
    expect(() => prepareCommand(call(['{{cred.nope}}']), { cred: {} })).toThrow(/nope/)
    expect(() => prepareCommand(call(['{{arg.nope}}']), {})).toThrow(/nope/)
  })

  it('도커 서식과 우리 자리표시자가 한 명령에 섞여도 각각 제대로 다뤄진다', () => {
    const r = prepareCommand(call(['ps', '--format', '{{json .}}', '--filter', 'name={{arg.q}}']), {
      arg: { q: 'rockury' }
    })
    expect(r.args).toEqual(['ps', '--format', '{{json .}}', '--filter', 'name=rockury'])
  })

  it('CASE-icat-043 이력용 문자열에는 자격증명이 채워지지 않고 참조가 남는다', () => {
    const r = prepareCommand(call(['--profile', '{{cred.profile}}', '--id', '{{node.id}}']), {
      cred: { profile: 'super-secret' },
      node: { id: 'i-123' }
    })
    expect(r.args).toEqual(['--profile', 'super-secret', '--id', 'i-123'])
    // 이력·화면에는 비밀이 안 남고, 비밀이 아닌 노드 값은 보인다.
    expect(r.display).toEqual(['--profile', '{{cred.profile}}', '--id', 'i-123'])
    expect(r.display.join(' ')).not.toContain('super-secret')
  })

  it('자리표시자가 없으면 그대로 통과한다', () => {
    const r = prepareCommand(call(['ps', '-a']), {})
    expect(r.args).toEqual(['ps', '-a'])
    expect(r.display).toEqual(['ps', '-a'])
  })
})

describe('runCli — 실행', () => {
  // node 는 이 저장소에서 항상 있다. 셸을 안 거친다는 것을 실제 실행으로 못 박는다.
  const nodeEcho = (arg: string): Promise<Awaited<ReturnType<typeof runCli>>> =>
    runCli({ cmd: process.execPath, args: ['-e', 'process.stdout.write(process.argv[1])', arg] })

  it('CASE-icat-041 셸 메타문자가 든 인자는 값으로만 전달된다(추가 명령이 실행되지 않는다)', async () => {
    const nasty = 'a b; echo INJECTED && echo MORE'
    const r = await nodeEcho(nasty)
    expect(r.ok).toBe(true)
    expect(r.stdout).toBe(nasty)
    expect(r.stdout).not.toContain('INJECTED\n')
  })

  it('없는 명령은 종료 코드·표준 오류를 그대로 낸다 — 삼키지 않는다', async () => {
    const r = await runCli({ cmd: '이런명령은없다', args: [] })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('시간 제한을 넘기면 중단하고 시간 초과로 표시한다(성공으로 넘어가지 않는다)', async () => {
    const r = await runCli(
      { cmd: process.execPath, args: ['-e', 'setTimeout(()=>{}, 5000)'] },
      { timeoutMs: 200 }
    )
    expect(r.ok).toBe(false)
    expect(r.timedOut).toBe(true)
  })

  it('소요 시간과 종료 코드를 함께 낸다(이력에 남길 값)', async () => {
    const r = await runCli({ cmd: process.execPath, args: ['-e', 'process.exit(3)'] })
    expect(r.exitCode).toBe(3)
    expect(r.ok).toBe(false)
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
  })
})
