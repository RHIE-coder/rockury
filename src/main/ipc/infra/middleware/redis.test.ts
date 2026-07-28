import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:net'
import { redisRun } from './redis'

/**
 * 가짜 RESP 서버로 검증한다 — 실제 Redis 없이도 **어려운 부분**(조각 걸침·조기 종료·인증 실패)을
 * 결정적으로 재현할 수 있다. 실제 Redis 왕복은 e2e 스위트가 도커로 덮는다.
 */

let server: Server | null = null

const listen = (onData: (chunk: Buffer, reply: (s: string | Buffer) => void) => void): Promise<number> =>
  new Promise((resolve) => {
    server = createServer((socket) => {
      socket.on('data', (chunk: Buffer) => onData(chunk, (s) => socket.write(s)))
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server?.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
  server = null
})

describe('redisRun — 붙어서 돌리고 끊는다', () => {
  it('CASE-imw-010 명령을 보내고 응답을 순서대로 받는다', async () => {
    const port = await listen((_c, reply) => reply('+PONG\r\n:3\r\n'))
    const r = await redisRun({ host: '127.0.0.1', port }, [['PING'], ['DBSIZE']])
    expect(r.ok).toBe(true)
    expect(r.replies).toEqual(['PONG', 3])
  })

  it('CASE-imw-010 보낸 것이 RESP 배열로 나간다 — 서버가 받은 바이트로 확인', async () => {
    let got = ''
    const port = await listen((chunk, reply) => {
      got += chunk.toString()
      reply('+OK\r\n')
    })
    await redisRun({ host: '127.0.0.1', port }, [['SET', 'k', 'v']])
    expect(got).toBe('*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$1\r\nv\r\n')
  })

  it('CASE-imw-011 응답이 조각으로 나뉘어 와도 이어 붙여 읽는다', async () => {
    const port = await listen((_c, reply) => {
      reply('$5\r\nhel')
      setTimeout(() => reply('lo\r\n'), 10)
    })
    const r = await redisRun({ host: '127.0.0.1', port }, [['GET', 'k']])
    expect(r.ok).toBe(true)
    expect(r.replies).toEqual(['hello'])
  })

  it('CASE-imw-012 서버가 거절한 것과 못 붙은 것을 구분한다', async () => {
    const port = await listen((_c, reply) => reply('-ERR unknown command\r\n'))
    const r = await redisRun({ host: '127.0.0.1', port }, [['NOPE']])
    // 붙는 데는 성공했다 → error 는 비고, 응답 안에 RESP 오류가 담긴다.
    expect(r.error).toBeUndefined()
    expect(r.replies).toEqual([{ error: 'ERR unknown command' }])
  })

  it('CASE-imw-012 못 붙으면 사유를 남긴다(성공으로 넘기지 않는다)', async () => {
    // 아무도 듣지 않는 포트 — 접속 거부.
    const r = await redisRun({ host: '127.0.0.1', port: 1, timeoutMs: 2_000 }, [['PING']])
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
    expect(r.replies).toEqual([])
  })

  it('CASE-imw-013 응답을 다 받기 전에 끊기면 실패로 남는다', async () => {
    const port = await listen((_c, reply) => reply('+ONLY-ONE\r\n'))
    const r = await redisRun({ host: '127.0.0.1', port, timeoutMs: 800 }, [['PING'], ['PING']])
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('CASE-imw-013 서버가 조용하면 시간 초과로 끝난다 — 매달려 있지 않는다', async () => {
    const port = await listen(() => {
      /* 아무 응답도 하지 않는다 */
    })
    const r = await redisRun({ host: '127.0.0.1', port, timeoutMs: 300 }, [['PING']])
    expect(r.ok).toBe(false)
    expect(r.error).toBe('시간 초과')
  })

  it('CASE-imw-014 비밀번호가 있으면 AUTH 를 먼저 보내고, 그 응답은 사용자에게 안 보인다', async () => {
    let got = ''
    const port = await listen((chunk, reply) => {
      got += chunk.toString()
      reply('+OK\r\n+PONG\r\n')
    })
    const r = await redisRun({ host: '127.0.0.1', port, password: 's3cret' }, [['PING']])
    expect(got).toContain('AUTH')
    expect(got).toContain('s3cret')
    // 사용자가 시킨 것만 돌아온다 — AUTH 의 +OK 가 섞이면 응답이 한 칸 밀린다.
    expect(r.replies).toEqual(['PONG'])
  })

  it('CASE-imw-014 사용자 이름이 있으면 AUTH 에 함께 보낸다(Redis 6 ACL)', async () => {
    let got = ''
    const port = await listen((chunk, reply) => {
      got += chunk.toString()
      reply('+OK\r\n+PONG\r\n')
    })
    await redisRun({ host: '127.0.0.1', port, username: 'app', password: 'p' }, [['PING']])
    expect(got).toContain('$3\r\napp\r\n')
  })

  it('CASE-imw-014 인증이 거절되면 그 사유가 위로 올라온다 — 명령 응답에 묻히지 않는다', async () => {
    const port = await listen((_c, reply) => reply('-WRONGPASS invalid password\r\n-NOAUTH\r\n'))
    const r = await redisRun({ host: '127.0.0.1', port, password: 'bad' }, [['PING']])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('WRONGPASS')
  })

  it('CASE-imw-015 db 번호를 주면 SELECT 를 먼저 보낸다', async () => {
    let got = ''
    const port = await listen((chunk, reply) => {
      got += chunk.toString()
      reply('+OK\r\n+PONG\r\n')
    })
    await redisRun({ host: '127.0.0.1', port, db: 2 }, [['PING']])
    expect(got).toContain('SELECT')
    expect(got).toContain('$1\r\n2\r\n')
  })

  it('CASE-imw-015 db 0 은 기본이라 SELECT 를 보내지 않는다(쓸데없는 왕복 없음)', async () => {
    let got = ''
    const port = await listen((chunk, reply) => {
      got += chunk.toString()
      reply('+PONG\r\n')
    })
    await redisRun({ host: '127.0.0.1', port, db: 0 }, [['PING']])
    expect(got).not.toContain('SELECT')
  })
})
