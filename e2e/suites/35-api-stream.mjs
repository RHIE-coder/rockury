// 스모크 스위트 — API Runner › Stream — SSE 서버 스트리밍 · WebSocket 양방향 · 세션→기록
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 13~17 이 만든 상태를 이어 쓰지 않고 자기 명세를 새로 만든다 — 스트림은 인터페이스 종류가
// REST 가 아니라서(kind 는 생성 시 고정) 기존 `e2e-billing` 에 얹을 수 없다.

import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

export const meta = {
  name: '35-api-stream',
  needsDb: false, // 도커 test-db 대신 스위트가 자기 SSE·WebSocket 서버를 띄운다
  desc: 'API Runner › Stream — SSE 서버 스트리밍 · WebSocket 양방향 · 세션→실행 기록'
}

/** 붙으면 이벤트 세 개를 흘려보내고 닫는 SSE 서버. */
function startSseServer() {
  return new Promise((resolve) => {
    const seen = []
    const server = createServer((req, res) => {
      seen.push({ url: req.url, headers: req.headers })
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      // 주석(하트비트)은 메시지로 세면 안 된다 — 파서가 버리는지 여기서 실측한다.
      res.write(': keep-alive\n\n')
      res.write('event: tick\nid: 1\ndata: {"n":1}\n\n')
      res.write('event: tick\nid: 2\ndata: {"n":2}\n\n')
      // 서버가 되돌려주는 비밀 — 요청만 가리면 여기서 샌다.
      res.write(`data: {"echo":"${req.headers['x-api-key'] ?? ''}"}\n\n`)
      setTimeout(() => res.end(), 150)
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port }))
  })
}

/**
 * 최소 WebSocket 에코 서버(RFC 6455). 라이브러리를 안 쓰는 이유: **의존성 추가 금지**
 * (`AGENTS.md` — package.json 은 main 에서 한 명만 건드린다). 텍스트 프레임만 다루면
 * 손잡기 + 프레임 해석이 이 정도로 끝난다.
 */
function startWsServer() {
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
  return new Promise((resolve) => {
    const received = []
    const server = createServer((_req, res) => {
      res.writeHead(426)
      res.end('upgrade required')
    })

    server.on('upgrade', (req, socket) => {
      const key = req.headers['sec-websocket-key']
      const accept = createHash('sha1').update(key + GUID).digest('base64')
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      )

      // 붙자마자 인사 한 줄 — 받는 방향이 타임라인에 뜨는지 본다.
      socket.write(encodeFrame('{"hello":"world"}'))

      let buf = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        for (;;) {
          const frame = decodeFrame(buf)
          if (!frame) break
          buf = buf.subarray(frame.size)
          if (frame.opcode === 0x8) {
            socket.end()
            return
          }
          if (frame.opcode !== 0x1) continue
          received.push(frame.text)
          socket.write(encodeFrame(`echo:${frame.text}`))
        }
      })
      socket.on('error', () => {})
    })

    server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port }))
  })
}

/** 서버→클라이언트 텍스트 프레임(마스크 없음). 짧은 본문만 쓰므로 126 미만 길이만 다룬다. */
function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8')
  if (payload.length > 125) throw new Error('테스트 프레임이 너무 깁니다')
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
}

/** 클라이언트→서버 프레임 해석. 클라이언트 프레임은 규약상 **항상 마스크**돼 있다. */
function decodeFrame(buf) {
  if (buf.length < 2) return null
  const opcode = buf[0] & 0x0f
  const masked = (buf[1] & 0x80) !== 0
  let len = buf[1] & 0x7f
  let offset = 2
  if (len === 126) {
    if (buf.length < 4) return null
    len = buf.readUInt16BE(2)
    offset = 4
  } else if (len === 127) {
    if (buf.length < 10) return null
    len = Number(buf.readBigUInt64BE(2))
    offset = 10
  }
  const maskKey = masked ? buf.subarray(offset, offset + 4) : null
  if (masked) offset += 4
  if (buf.length < offset + len) return null
  const payload = Buffer.from(buf.subarray(offset, offset + len))
  if (maskKey) for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i % 4]
  return { opcode, text: payload.toString('utf8'), size: offset + len }
}

/** 컨텍스트 바를 이 명세로 옮긴다 — 17번 스위트와 같은 방식(nav 저장소 + 새로고침). */
async function switchSpec(page, click, specId) {
  await page.evaluate((id) => {
    const nav = JSON.parse(localStorage.getItem('rockury.nav') ?? '{}')
    nav.state = nav.state ?? {}
    nav.state.contextValues = { ...(nav.state.contextValues ?? {}), spec: id }
    localStorage.setItem('rockury.nav', JSON.stringify(nav))
  }, specId)
  await page.reload()
  await page.waitForTimeout(1_200)
  await click('[data-nav-service="api"]')
  await page.waitForTimeout(400)
}

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page
  const sse = await startSseServer()
  const ws = await startWsServer()

  try {
    await click('[data-nav-service="api"]')
    await page.waitForTimeout(300)

    // ── SSE 명세: 서버 스트리밍 ────────────────────────────────────────────
    const sseSpecId = await page.evaluate(
      async ({ port }) => {
        const spec = await window.rockury.apiSpecs.create({ name: 'e2e-stream-sse', kind: 'sse' })
        await window.rockury.apiSpecs.patch(spec.id, [
          { op: 'add_request', name: 'ticker' },
          { op: 'set_request_fields', request: 'ticker', fields: { connectUrl: '/events', headers: { 'x-api-key': '{{apiKey}}' } } }
        ])
        await window.rockury.apiOps.saveEnvironment({
          specId: spec.id,
          name: 'E2E-SSE',
          baseUrl: `http://127.0.0.1:${port}`,
          production: false,
          values: [{ name: 'apiKey', value: 'STREAM-SECRET', secret: true }]
        })
        return spec.id
      },
      { port: sse.port }
    )
    await switchSpec(page, click, sseSpecId)

    await click('[data-nav-module="environments"]')
    await page.waitForSelector('[data-api-env-card="E2E-SSE"]', { timeout: 5_000 })
    await click('[data-api-env-card="E2E-SSE"] button[data-api-env-select]')

    await click('[data-nav-module="runner"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="stream"]')
    await page.waitForTimeout(400)
    await click('[data-api-stream-pick="ticker"]')
    await page.waitForTimeout(300)

    // AC-3 — 서버 스트리밍에는 보내기 패널이 **없다**(비활성이 아니라 없음).
    check(
      '서버 스트리밍에는 보내기 패널이 아예 없다 (AC-3)',
      (await page.locator('[data-api-stream-sendpanel]').count()) === 0
    )
    check('붙기 전 상태는 대기다', (await page.locator('[data-api-stream-state="idle"]').count()) === 1)

    // ── 붙어서 이벤트를 받는다 ─────────────────────────────────────────────
    await click('button[data-api-stream-open]')
    await page.waitForSelector('[data-api-stream-msg="in"]', { timeout: 10_000 })
    await page.waitForTimeout(800) // 서버가 세 줄을 다 흘리고 닫을 때까지

    {
      const timeline = await page.locator('[data-api-stream-timeline]').innerText()
      check('받은 이벤트가 타임라인에 쌓인다 (AC-2)', timeline.includes('{"n":1}') && timeline.includes('{"n":2}'))
      check('이벤트 이름이 함께 보인다', timeline.includes('tick'))
      check('접속 기록도 타임라인 항목이다 (AC-1)', timeline.includes('연결됨'))
      check(
        '하트비트 주석은 메시지로 세지 않는다',
        !timeline.includes('keep-alive')
      )
    }

    // 서버가 실제로는 진짜 키를 받았다 — 가림은 기록 쪽이지 전송이 아니다.
    check(
      '서버가 받은 헤더에는 진짜 비밀이 실렸다',
      sse.seen.some((r) => r.headers['x-api-key'] === 'STREAM-SECRET')
    )
    // 그런데 서버가 되돌려준 값은 화면에서 지워져 있다(응답 경로 가림).
    check('서버가 되돌려준 비밀이 화면에 안 뜬다', !(await body()).includes('STREAM-SECRET'))

    // 서버가 스스로 닫았으므로 끊긴 이유가 보인다 (AC-1).
    await page.waitForSelector('[data-api-stream-reason]', { timeout: 10_000 })
    check('끊긴 이유가 표시된다 (AC-1)', (await page.locator('[data-api-stream-reason]').count()) === 1)

    // ── AC-6 세션 하나가 Run 하나로 남는다 ─────────────────────────────────
    await page.waitForSelector('[data-api-stream-saved]', { timeout: 10_000 })
    {
      const { row, full } = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-stream-sse')
        const runs = await window.rockury.apiOps.listRuns(target.id)
        const row = runs[0] ?? null
        // 목록은 메시지 본문을 **안 싣는다**(5,000건을 매번 파싱하면 메인이 멈춘다).
        // 본문은 상세 조회로 하나만 읽는다.
        return { row, full: row ? await window.rockury.apiOps.getRun(target.id, row.id) : null }
      })
      const run = full
      check('세션이 실행 기록 하나로 남는다 (AC-6)', row !== null && row.requestName === 'ticker')
      check('목록 조회는 메시지 본문을 안 싣는다 — 건수만 준다', row.messages === null && row.messageCount >= 3)
      check('그 기록의 관측 내용이 메시지 목록이다', Array.isArray(run.messages) && run.messages.length >= 3)
      check('기록에 상호작용 모양이 실린다', run.shape === 'server-stream')
      check('스트림 기록의 응답 본문 자리는 비어 있다', run.response === null)
      check(
        '기록 어디에도 비밀 실값이 없다 (가린 뒤 저장)',
        !JSON.stringify(run).includes('STREAM-SECRET')
      )
    }

    // ── 타임라인 도구: 검색 · 방향 필터 (AC-5) ─────────────────────────────
    await page.locator('input[data-api-stream-search]').fill('n":2')
    await page.waitForTimeout(300)
    check(
      '검색이 타임라인에 걸린다 (AC-5)',
      (await page.locator('[data-api-stream-timeline]').innerText()).includes('{"n":2}') &&
        !(await page.locator('[data-api-stream-timeline]').innerText()).includes('{"n":1}')
    )
    await page.locator('input[data-api-stream-search]').fill('')
    await page.waitForTimeout(200)

    // ── 판정: 스트림 관측은 통과도 미관측도 아니다 ─────────────────────────
    {
      const d0 = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-stream-sse')
        const envs = await window.rockury.apiOps.listEnvironments(target.id)
        const d = await window.rockury.apiContract.runDrift(target.id, envs[0].id)
        return { coverage: d.coverage, findings: d.findings }
      })
      check('스트림 관측은 미관측으로 세지 않는다', !d0.coverage.unobserved.includes('ticker'))
      // 이벤트 이름은 있는데 선언이 없다 → **조용한 통과가 아니라 어긋남**이다
      // (단발의 "상태 X 를 받았는데 선언이 없다" 와 같은 자리).
      check(
        '선언 없는 이벤트를 받으면 통과가 아니라 어긋남으로 잡는다',
        d0.findings.some((f) => f.path === 'ticker.tick' && f.kind === 'server-only')
      )
    }

    // ── 이벤트 이름으로 선언을 찾아 **실제로 대조한다** ──
    {
      const after = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-stream-sse')
        // 이벤트 이름 `tick` 을 상태 자리에 선언한다 — 스트림에서 status 는 이벤트 종류다.
        await window.rockury.apiSpecs.patch(target.id, [
          {
            op: 'set_response_schema',
            request: 'ticker',
            status: 'tick',
            fields: [{ name: 'n', type: 'string', requiredness: 'required' }]
          }
        ])
        const envs = await window.rockury.apiOps.listEnvironments(target.id)
        const d = await window.rockury.apiContract.runDrift(target.id, envs[0].id)
        return { coverage: d.coverage, findings: d.findings, unrouted: d.unroutedMessages }
      })
      check('이벤트 이름으로 선언을 찾아 관측으로 센다', after.coverage.observed === 1)
      check(
        '선언과 어긋난 필드를 이벤트 경로와 함께 잡는다',
        after.findings.some((f) => f.path === 'ticker.tick.n' && f.kind === 'different')
      )
      check('선언한 이벤트는 더는 "맞출 선언 없음" 이 아니다', !after.coverage.unjudged.includes('ticker'))
    }

    // ── WebSocket 명세: 양방향 ─────────────────────────────────────────────
    const wsSpecId = await page.evaluate(
      async ({ port }) => {
        const spec = await window.rockury.apiSpecs.create({ name: 'e2e-stream-ws', kind: 'websocket' })
        await window.rockury.apiSpecs.patch(spec.id, [
          { op: 'add_request', name: 'chat' },
          // 접속 주소 쿼리에 비밀을 넣는다 — WebSocket 손잡기에 헤더를 못 싣기 때문에
          // 우리가 안내하는 바로 그 방법이고, **URL 인코딩을 거치는 자리**다.
          { op: 'set_request_fields', request: 'chat', fields: { connectUrl: '/socket?t={{urlToken}}' } }
        ])
        await window.rockury.apiOps.saveEnvironment({
          specId: spec.id,
          name: 'E2E-WS',
          baseUrl: `ws://127.0.0.1:${port}`,
          production: false,
          values: [
            { name: 'token', value: 'WS-SECRET-VALUE', secret: true },
            // `+ / =` 는 인코딩되면 글자가 바뀐다 — 글자 그대로 지우는 방식으로는 안 지워진다.
            { name: 'urlToken', value: 'AB+cd/ef=ghij', secret: true }
          ]
        })
        return spec.id
      },
      { port: ws.port }
    )
    await switchSpec(page, click, wsSpecId)
    await click('[data-nav-module="environments"]')
    await page.waitForSelector('[data-api-env-card="E2E-WS"]', { timeout: 5_000 })
    await click('[data-api-env-card="E2E-WS"] button[data-api-env-select]')

    await click('[data-nav-module="runner"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="stream"]')
    await page.waitForTimeout(400)
    await click('[data-api-stream-pick="chat"]')
    await page.waitForTimeout(300)

    // AC-3 — 양방향에는 보내기 패널이 있다.
    check(
      '양방향에는 보내기 패널이 있다 (AC-3)',
      (await page.locator('[data-api-stream-sendpanel]').count()) === 1
    )

    await click('button[data-api-stream-open]')
    await page.waitForSelector('[data-api-stream-state="open"]', { timeout: 10_000 })
    check('붙으면 상태가 연결됨이 된다 (AC-1)', (await page.locator('[data-api-stream-state="open"]').count()) === 1)
    {
      // 접속 주소에 박힌 비밀은 URL 인코딩을 거친다. 글자 그대로 지우는 방식만 믿으면
      // 인코딩된 형태가 화면·기록에 그대로 남는다(가려진 주소 배지 때문에 안 샌 것처럼 보인다).
      const seen = await body()
      check('접속 주소의 비밀 실값이 화면에 안 뜬다', !seen.includes('AB+cd/ef=ghij'))
      check(
        '인코딩된 형태로도 안 뜬다 — 가림은 글자 일치가 아니라 조립 단계에서 걸어야 한다',
        !seen.includes('AB%2Bcd%2Fef%3Dghij')
      )
    }
    await page.waitForTimeout(400)
    check(
      '서버가 먼저 보낸 것도 받은 방향으로 쌓인다',
      (await page.locator('[data-api-stream-timeline]').innerText()).includes('{"hello":"world"}')
    )

    // 보낸 메시지의 {{변수}} 는 실값으로 나가고, 타임라인에는 가려진 채 남는다.
    await page.locator('input[data-api-stream-draft]').fill('열어라 {{token}}')
    await click('button[data-api-stream-send]')
    await page.waitForTimeout(600)
    check('서버가 치환된 실값을 받았다', ws.received.some((t) => t.includes('WS-SECRET-VALUE')))
    check('그런데 화면에는 실값이 안 보인다', !(await body()).includes('WS-SECRET-VALUE'))

    // 내장 함수로 **가공된** 비밀. 글자 그대로 일치가 아니라서 지우는 그물에 안 걸린다 —
    // 조립 단계에서 조각 통째로 가리지 않으면 디코드하면 원 키가 나온다.
    {
      const encoded = Buffer.from('WS-SECRET-VALUE').toString('base64')
      await page.locator('input[data-api-stream-draft]').fill('auth {{base64(token)}}')
      await click('button[data-api-stream-send]')
      await page.waitForTimeout(600)
      check('서버는 가공된 실값을 받았다', ws.received.some((t) => t.includes(encoded)))
      check('가공된 비밀도 화면에 안 남는다', !(await body()).includes(encoded))
    }
    check(
      '보낸 것과 받은 것이 방향으로 갈린다 (AC-2)',
      (await page.locator('[data-api-stream-msg="out"]').count()) >= 1 &&
        (await page.locator('[data-api-stream-msg="in"]').count()) >= 2
    )

    // ── 끊기 → 그 세션도 기록으로 ──────────────────────────────────────────
    await click('button[data-api-stream-close]')
    await page.waitForSelector('[data-api-stream-saved]', { timeout: 10_000 })
    {
      const run = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-stream-ws')
        const runs = await window.rockury.apiOps.listRuns(target.id)
        return runs[0] ? window.rockury.apiOps.getRun(target.id, runs[0].id) : null
      })
      check('사용자가 끊은 세션도 기록으로 남는다 (AC-6)', run !== null && run.status === 'ok')
      check('끊긴 이유가 기록에 남는다 (AC-1)', (run.error ?? '').includes('사용자가 끊었습니다'))
      check('양방향 세션 기록에 보낸 것과 받은 것이 함께 있다', run.messages.some((m) => m.direction === 'out') && run.messages.some((m) => m.direction === 'in'))
      check('WebSocket 기록에도 비밀 실값이 없다', !JSON.stringify(run).includes('WS-SECRET-VALUE'))
    }

    // ── 세션의 관측 내용을 History 에서 다시 본다 (AC-6 은 저장만이 아니다) ──
    await click('[data-nav-view="history"]')
    await page.waitForSelector('[data-api-run-row="chat"]', { timeout: 5_000 })
    await click('[data-api-run-row="chat"] button')
    await page.waitForSelector('[data-api-run-messages]', { timeout: 5_000 })
    await page.waitForTimeout(500)
    {
      const detail = await page.locator('[data-api-run-detail]').innerText()
      check('기록 상세에서 세션 메시지를 다시 볼 수 있다 (AC-6)', detail.includes('{"hello":"world"}'))
      check(
        '보낸 것과 받은 것이 상세에서도 방향으로 갈린다',
        (await page.locator('[data-api-run-msg="out"]').count()) >= 1 &&
          (await page.locator('[data-api-run-msg="in"]').count()) >= 1
      )
    }
    await click('[data-nav-view="stream"]')
    await page.waitForTimeout(400)

    // ── 붙자마자 동기로 실패해도 화면이 '접속 중' 에 갇히지 않는다 ──
    // 세션 id 를 메인이 만들어 응답으로 주면, 오류·종료 이벤트가 응답보다 먼저 도착해
    // 화면이 자기 것으로 못 알아보고 버렸다 — 그러면 끊기 버튼도 죽어 앱 재시작뿐이었다.
    {
      await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-stream-ws')
        // 스킴이 ws:// 가 아니면 `new WebSocket()` 이 **동기로** 던진다.
        await window.rockury.apiOps.saveEnvironment({
          specId: target.id,
          name: 'E2E-WS-BAD',
          baseUrl: 'http://127.0.0.1:1',
          production: false,
          values: [
            { name: 'token', value: 'x', secret: true },
            { name: 'urlToken', value: 'y', secret: true }
          ]
        })
      })
      await click('[data-nav-module="environments"]')
      await page.waitForSelector('[data-api-env-card="E2E-WS-BAD"]', { timeout: 5_000 })
      await click('[data-api-env-card="E2E-WS-BAD"] button[data-api-env-select]')
      await click('[data-nav-module="runner"]')
      await page.waitForTimeout(300)
      await click('[data-nav-view="stream"]')
      await page.waitForTimeout(400)
      await click('[data-api-stream-pick="chat"]')
      await page.waitForTimeout(300)
      await click('button[data-api-stream-open]')
      await page.waitForTimeout(1_500)

      const stuck = (await page.locator('[data-api-stream-state="connecting"]').count()) > 0
      check('동기 실패가 화면에 도달한다 — 접속 중에 안 갇힌다', !stuck)
      check(
        '실패 이유가 보인다',
        (await page.locator('[data-api-stream-reason]').count()) === 1 ||
          (await page.locator('[data-api-error]').count()) === 1
      )
      check(
        '다시 접속을 시도할 수 있다 — 끊기 버튼만 남지 않는다',
        (await page.locator('button[data-api-stream-open]').count()) === 1
      )
    }

    // ── **이름 없는 메시지는 하나뿐인 선언에 갖다 붙이지 않는다** ──
    // WebSocket 프레임에는 이벤트 이름이 없다. 한 소켓에 여러 종류가 흐르는 것이 보통이라
    // 하나뿐인 선언에 맞춰 버리면 조용히 틀린 판정이 나온다.
    {
      const judged = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-stream-ws')
        await window.rockury.apiSpecs.patch(target.id, [
          {
            op: 'set_response_schema',
            request: 'chat',
            status: 'hello',
            fields: [{ name: 'hello', type: 'string', requiredness: 'required' }]
          }
        ])
        const envs = await window.rockury.apiOps.listEnvironments(target.id)
        const env = envs.find((e) => e.name === 'E2E-WS')
        const d = await window.rockury.apiContract.runDrift(target.id, env.id)
        return { coverage: d.coverage, unrouted: d.unroutedMessages, findings: d.findings }
      })
      check('이름 없는 메시지를 못 맞춘 건수로 센다', judged.unrouted >= 1)
      check(
        '하나뿐인 선언에 갖다 붙이지 않는다 — 없는 어긋남을 만들지 않는다',
        judged.findings.every((f) => !f.path.startsWith('chat.hello.'))
      )
      check(
        '하나도 못 맞췄으면 "맞출 선언 없음" 이다 — 통과가 아니다',
        judged.coverage.unjudged.includes('chat')
      )
    }

    // ── **자동 재접속이 실제로 돈다** (AC-4) ──
    // 서버가 스스로 끊는 SSE 에 자동 재접속을 켜면 재접속 시도가 타임라인에 남아야 한다.
    {
      await switchSpec(page, click, sseSpecId)
      await click('[data-nav-module="environments"]')
      await page.waitForSelector('[data-api-env-card="E2E-SSE"]', { timeout: 5_000 })
      await click('[data-api-env-card="E2E-SSE"] button[data-api-env-select]')
      await click('[data-nav-module="runner"]')
      await page.waitForTimeout(300)
      await click('[data-nav-view="stream"]')
      await page.waitForTimeout(400)
      await click('[data-api-stream-pick="ticker"]')
      await page.waitForTimeout(300)
      await page.locator('input[data-api-stream-autoreconnect]').check()
      await page.waitForTimeout(200)
      await click('button[data-api-stream-open]')
      // 서버가 150ms 뒤 스스로 닫는다 → 1초 뒤 재접속 시도가 타임라인에 뜬다.
      await page.waitForSelector('[data-api-stream-msg="system"]', { timeout: 10_000 })
      await page.waitForTimeout(2_500)
      const timeline = await page.locator('[data-api-stream-timeline]').innerText()
      check('**재접속 시도가 타임라인에 남는다** (AC-4)', timeline.includes('재접속'))
      check('몇 번째 시도인지 적힌다', /\d번째 재접속/.test(timeline))
      await click('button[data-api-stream-close]')
      await page.waitForTimeout(500)
      await page.locator('input[data-api-stream-autoreconnect]').uncheck()
      await page.waitForTimeout(200)
    }

    // ── 못 여는 인터페이스는 사유를 준다 — 조용히 다른 전송으로 안 내려간다 ──
    {
      const err = await page.evaluate(async () => {
        const spec = await window.rockury.apiSpecs.create({ name: 'e2e-stream-grpc', kind: 'grpc' })
        await window.rockury.apiSpecs.patch(spec.id, [
          { op: 'add_request', name: 'feed', shape: 'server-stream' }
        ])
        const envs = await window.rockury.apiOps.saveEnvironment({
          specId: spec.id,
          name: 'E2E-GRPC',
          baseUrl: 'http://127.0.0.1:1',
          production: false,
          values: []
        })
        try {
          await window.rockury.apiStream.open({
            specId: spec.id,
            requestName: 'feed',
            environmentId: envs.id,
            call: {},
            autoReconnect: false
          })
          return null
        } catch (e) {
          return String(e.message ?? e)
        }
      })
      check('gRPC 스트리밍은 열리지 않고 사유가 온다', err !== null && err.includes('gRPC'))
      check('사유에 왜 못 하는지가 적힌다', err.includes('HTTP/2'))
    }
  } finally {
    sse.server.close()
    ws.server.close()
  }
}
