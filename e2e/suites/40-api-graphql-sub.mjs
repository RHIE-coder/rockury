// 스모크 스위트 — API GraphQL 구독 — graphql-transport-ws 손잡기 · 구독 세션 · 세션→기록
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 자기 명세를 새로 만든다 — 인터페이스 종류는 생성 시 고정이라 기존 명세에 얹을 수 없다.

import { startGraphqlWsServer } from '../lib/api/graphqlWsServer.mjs'

export const meta = {
  name: '40-api-graphql-sub',
  needsDb: false, // 도커 test-db 대신 스위트가 자기 구독 서버를 띄운다
  desc: 'API GraphQL 구독 — 규약 손잡기 · 구독 세션 · 세션→실행 기록'
}

/** 컨텍스트 바를 이 명세로 옮긴다 — 지금 보는 탭에 바로 세운다. */
async function switchSpec(page, click, specId) {
  // 대상 선택은 탭에 딸린다 — 저장소에 써 놓고 새로고침하는 옛 길은 안 먹는다(하네스 주석).
  // 세운 **뒤에** 새로 그린다: 명세를 화면 밖(IPC)에서 만들어 이 창의 목록이 아직 낡았기 때문이다.
  // 대상은 메인이 들고 있어 새로고침을 견딘다.
  await page.evaluate((id) => window.__rockuryNav.setContextValue('spec', id), specId)
  await page.reload()
  await page.waitForTimeout(1_200)
  await click('[data-nav-service="api"]')
  await page.waitForTimeout(400)
}

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page
  // 규약대로 답하는 서버 / 옛 판만 아는 서버 둘 — 두 번째가 "손잡기가 알맹이"라는 증거다.
  const live = await startGraphqlWsServer({ requireToken: 'Bearer GQL-SECRET', ping: true })
  const legacy = await startGraphqlWsServer({ protocol: 'graphql-ws-legacy' })
  // 사용자가 끊어야 끝나는 구독 — 규약이 정한 끊기 순서(구독 접기 → 소켓 닫기)를 밟는다.
  const endless = await startGraphqlWsServer({ endless: true, ping: true })
  // 구독을 거절하는 서버 — 서버가 준 사유가 화면에 닿는지 본다.
  const rejecting = await startGraphqlWsServer({ rejectSubscribe: 'Cannot query field "nope"' })
  // 여태 단위 테스트로만 덮였던 것들 — 실제 소켓 위에서 밟는다.
  const flappy = await startGraphqlWsServer({ dropAfterAck: true })
  const foreign = await startGraphqlWsServer({ foreignId: true })
  const noisy = await startGraphqlWsServer({ preAckNoise: 25 })

  try {
    await click('[data-nav-service="api"]')
    await page.waitForTimeout(300)

    const specId = await page.evaluate(
      async ({ url, legacyUrl, endlessUrl, rejectUrl, flappyUrl, foreignUrl, noisyUrl }) => {
        const spec = await window.rockury.apiSpecs.create({ name: 'e2e-gql-sub', kind: 'graphql' })
        await window.rockury.apiSpecs.patch(spec.id, [
          { op: 'add_request', name: 'messages', shape: 'server-stream' },
          {
            op: 'set_request_fields',
            request: 'messages',
            fields: {
              graphqlQuery: 'subscription { messageAdded { id text } }',
              // **치환을 실제로 검사한다** — 리터럴로 두면 이 경로가 안 밟힌다.
              graphqlVariables: '{"room":"{{room}}"}',
              // 이 값은 헤더로 못 나간다 — 규약이 정한 `connection_init` 자리로 간다.
              headers: { authorization: 'Bearer {{token}}' }
            }
          }
        ])
        await window.rockury.apiOps.saveEnvironment({
          specId: spec.id,
          name: 'E2E-GQL',
          baseUrl: url,
          production: false,
          values: [
            { name: 'token', value: 'GQL-SECRET', secret: true },
            { name: 'room', value: '공지' }
          ]
        })
        await window.rockury.apiOps.saveEnvironment({
          specId: spec.id,
          name: 'E2E-GQL-ENDLESS',
          baseUrl: endlessUrl,
          production: false,
          values: [
            { name: 'token', value: 'GQL-SECRET', secret: true },
            { name: 'room', value: '공지' }
          ]
        })
        await window.rockury.apiOps.saveEnvironment({
          specId: spec.id,
          name: 'E2E-GQL-REJECT',
          baseUrl: rejectUrl,
          production: false,
          values: [
            { name: 'token', value: 'GQL-SECRET', secret: true },
            { name: 'room', value: '공지' }
          ]
        })
        for (const [name, baseUrl] of [
          ['E2E-GQL-FLAPPY', flappyUrl],
          ['E2E-GQL-FOREIGN', foreignUrl],
          ['E2E-GQL-NOISY', noisyUrl]
        ]) {
          await window.rockury.apiOps.saveEnvironment({
            specId: spec.id,
            name,
            baseUrl,
            production: false,
            values: [
              { name: 'token', value: 'GQL-SECRET', secret: true },
              { name: 'room', value: '공지' }
            ]
          })
        }
        await window.rockury.apiOps.saveEnvironment({
          specId: spec.id,
          name: 'E2E-GQL-LEGACY',
          baseUrl: legacyUrl,
          production: false,
          values: [
            { name: 'token', value: 'GQL-SECRET', secret: true },
            { name: 'room', value: '공지' }
          ]
        })
        return spec.id
      },
      {
        url: live.url,
        legacyUrl: legacy.url,
        endlessUrl: endless.url,
        rejectUrl: rejecting.url,
        flappyUrl: flappy.url,
        foreignUrl: foreign.url,
        noisyUrl: noisy.url
      }
    )
    await switchSpec(page, click, specId)

    await click('[data-nav-module="environments"]')
    await page.waitForSelector('[data-api-env-card="E2E-GQL"]', { timeout: 5_000 })
    await click('[data-api-env-card="E2E-GQL"] button[data-api-env-select]')

    await click('[data-nav-module="runner"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="stream"]')
    await page.waitForTimeout(400)
    await click('[data-api-stream-pick="messages"]')
    await page.waitForTimeout(300)

    check(
      '구독은 계속 받기만 하므로 보내기 패널이 없다',
      (await page.locator('[data-api-stream-sendpanel]').count()) === 0
    )
    check(
      '전송 이름이 GraphQL 구독으로 뜬다',
      (await page.locator('[data-api-stream-transport]').innerText()).includes('GraphQL 구독')
    )

    // ── 붙어서 규약 손잡기를 거친다 ────────────────────────────────────────
    await click('button[data-api-stream-open]')
    await page.waitForSelector('[data-api-stream-msg="in"]', { timeout: 15_000 })
    await page.waitForTimeout(800)

    {
      const timeline = await page.locator('[data-api-stream-timeline]').innerText()
      check('구독 결과가 타임라인에 쌓인다', timeline.includes('안녕-공지-1'))
      // 서버가 `공지` 로 답했다는 것 자체가 `{{room}}` 이 치환돼 나갔다는 증거다.
      check('**질의 변수의 {{변수}} 가 치환돼 나간다**', timeline.includes('안녕-공지'))
      check('이벤트 이름이 구독 루트로 붙는다', timeline.includes('messageAdded'))
      // 다른 전송과 **같은 말**을 쓴다 — 타임라인 검색이 전송마다 갈리면 안 된다.
      check('손잡기가 끝난 뒤에야 연결됨이라고 적는다', timeline.includes('연결됨'))
      check(
        '인증 값이 어디로 갔는지 적는다 — 헤더가 아니라 connection_init 이다',
        timeline.includes('connection_init')
      )
      // 주고받는 하트비트(ping/pong)는 타임라인을 어지럽히지 않는다.
      check('하트비트는 메시지로 세지 않는다', !timeline.includes('"ping"'))
    }

    // 규약 순서를 실제로 지켰는가 — 서버가 받은 것으로 확인한다.
    {
      const types = live.received.filter((m) => m.type).map((m) => m.type)
      check('첫 메시지는 손잡기다 — 구독을 먼저 보내면 서버가 끊는다', types[0] === 'connection_init')
      check('손잡기 뒤에 구독을 보낸다', types.indexOf('subscribe') > types.indexOf('connection_init'))
      check(
        '하위 프로토콜 이름으로 합의한다 — 안 주면 서버가 규약을 안 켠다',
        live.received.some(
          (m) => m.kind === 'upgrade' && m.protocols.includes('graphql-transport-ws')
        )
      )
      const init = live.received.find((m) => m.type === 'connection_init')
      check('서버는 진짜 토큰을 받았다', init?.payload?.authorization === 'Bearer GQL-SECRET')
      const sub = live.received.find((m) => m.type === 'subscribe')
      check(
        '서버가 받은 변수도 치환된 값이다 — 글자 그대로 나가면 안 된다',
        sub?.payload?.variables?.room === '공지'
      )

    }

    check('그런데 화면에는 실값이 안 뜬다', !(await body()).includes('GQL-SECRET'))

    // ── 세션이 기록으로 남는다 ────────────────────────────────────────────
    await page.waitForSelector('[data-api-stream-saved]', { timeout: 15_000 })
    {
      const run = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-gql-sub')
        const runs = await window.rockury.apiOps.listRuns(target.id)
        return runs[0] ? window.rockury.apiOps.getRun(target.id, runs[0].id) : null
      })
      check('구독 세션도 실행 기록 하나로 남는다', run !== null && run.requestName === 'messages')
      check('기록의 요청 전문에 GQL-WS 라고 남는다', run.request.method === 'GQL-WS')
      check('접속 주소가 소켓 주소로 남는다', (run.request.url ?? '').startsWith('ws://'))
      check('기록 어디에도 비밀 실값이 없다', !JSON.stringify(run).includes('GQL-SECRET'))
    }

    // ── 판정: 구독 세션이 쌓였다고 판정이 되살아나지 않는다 ─────────────────
    {
      const d = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-gql-sub')
        const envs = await window.rockury.apiOps.listEnvironments(target.id)
        const env = envs.find((e) => e.name === 'E2E-GQL')
        const r = await window.rockury.apiContract.runDrift(target.id, env.id)
        return { grade: r.grade, unavailable: r.unavailable, findings: r.findings }
      })
      // 이 서버는 구독만 하고 HTTP GraphQL 은 안 준다 — 스키마를 못 읽으니 완전 판정이 안 된다.
      // **세션을 쌓았다고 그 자리가 메워지지 않는다.** 관측으로 내려가지도 않는다.
      check('스키마를 못 읽으면 등급을 낮추지 않는다', d.grade === 'complete')
      check('사유가 달린 빈 결과를 준다', d.unavailable !== null && d.findings.length === 0)
      check(
        '구독 세션이 쌓였다고 판정이 되살아나지 않는다',
        !JSON.stringify(d.findings).includes('messageAdded')
      )
    }

    // ── 사용자가 끊으면 구독을 접고 닫는다 (규약이 정한 순서) ──────────────
    await click('[data-nav-module="environments"]')
    await page.waitForSelector('[data-api-env-card="E2E-GQL-ENDLESS"]', { timeout: 5_000 })
    await click('[data-api-env-card="E2E-GQL-ENDLESS"] button[data-api-env-select]')
    await click('[data-nav-module="runner"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="stream"]')
    await page.waitForTimeout(400)
    await click('[data-api-stream-pick="messages"]')
    await page.waitForTimeout(300)
    await click('button[data-api-stream-open]')
    await page.waitForSelector('[data-api-stream-state="open"]', { timeout: 15_000 })
    await page.waitForTimeout(500)
    await click('button[data-api-stream-close]')
    await page.waitForSelector('[data-api-stream-saved]', { timeout: 15_000 })
    {
      // 안 접고 소켓만 닫으면 서버에 구독이 남는다 — 규약이 순서를 정해 둔 이유다.
      check(
        '끊을 때 소켓을 닫기 전에 구독을 접는다',
        endless.received.some((m) => m.type === 'complete')
      )
      // 안 답하면 서버가 끊는다 — 오래 붙어 있는 구독에서만 밟히는 자리다.
      check('하트비트에 답한다', endless.received.some((m) => m.type === 'pong'))
      const run = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-gql-sub')
        const runs = await window.rockury.apiOps.listRuns(target.id)
        return runs[0] ? window.rockury.apiOps.getRun(target.id, runs[0].id) : null
      })
      check('사용자가 끊은 구독도 기록으로 남는다', (run?.error ?? '').includes('사용자가 끊었습니다'))
    }

    // ── 서버가 구독을 거절하면 그 사유가 화면에 닿는다 ─────────────────────
    await click('[data-nav-module="environments"]')
    await page.waitForSelector('[data-api-env-card="E2E-GQL-REJECT"]', { timeout: 5_000 })
    await click('[data-api-env-card="E2E-GQL-REJECT"] button[data-api-env-select]')
    await click('[data-nav-module="runner"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="stream"]')
    await page.waitForTimeout(400)
    await click('[data-api-stream-pick="messages"]')
    await page.waitForTimeout(300)
    await click('button[data-api-stream-open]')
    await page.waitForSelector('[data-api-stream-reason]', { timeout: 15_000 })
    check(
      '서버가 준 거절 사유가 그대로 보인다',
      (await page.locator('[data-api-stream-reason]').innerText()).includes('Cannot query field')
    )

    /** 환경을 바꿔 다시 붙는다 — 뒤의 검사들이 같은 걸음을 반복한다. */
    const openWith = async (envName, opts = {}) => {
      await click('[data-nav-module="environments"]')
      await page.waitForSelector(`[data-api-env-card="${envName}"]`, { timeout: 5_000 })
      await click(`[data-api-env-card="${envName}"] button[data-api-env-select]`)
      await click('[data-nav-module="runner"]')
      await page.waitForTimeout(300)
      await click('[data-nav-view="stream"]')
      await page.waitForTimeout(400)
      await click('[data-api-stream-pick="messages"]')
      await page.waitForTimeout(300)
      if (opts.autoReconnect) {
        await page.locator('input[data-api-stream-autoreconnect]').check()
        await page.waitForTimeout(200)
      }
      await click('button[data-api-stream-open]')
    }

    // ── 손잡기 뒤 끊는 서버에서 자동 재접속이 실제로 돈다 ───────────────────
    await openWith('E2E-GQL-FLAPPY', { autoReconnect: true })
    await page.waitForSelector('[data-api-stream-msg="system"]', { timeout: 20_000 })
    await page.waitForTimeout(3_000)
    {
      const timeline = await page.locator('[data-api-stream-timeline]').innerText()
      // 재접속 왕복에는 **손잡기가 다시 붙는다** — 그게 다른 전송과 다른 자리다.
      check('구독도 자동 재접속이 돈다 — 손잡기를 다시 한다', timeline.includes('재접속'))
      check('몇 번째 시도인지 적힌다', /\d번째 재접속/.test(timeline))
    }
    await click('button[data-api-stream-close]')
    await page.waitForTimeout(500)
    await page.locator('input[data-api-stream-autoreconnect]').uncheck()
    await page.waitForTimeout(200)

    // ── 우리가 연 구독이 아닌 것은 우리 관측이 아니다 ──────────────────────
    await openWith('E2E-GQL-FOREIGN')
    await page.waitForSelector('[data-api-stream-saved]', { timeout: 15_000 })
    {
      const timeline = await page.locator('[data-api-stream-timeline]').innerText()
      check('남의 구독 결과를 우리 관측으로 세지 않는다', !timeline.includes('남의것'))
      check('세지 않았다는 사실을 적는다', timeline.includes('우리가 연 구독이 아닌'))
      check('우리 구독 결과는 그대로 온다', timeline.includes('안녕-공지-1'))
    }

    // ── 규약에 없는 글자를 흘리는 서버는 그 사실로 결론 낸다 ────────────────
    await openWith('E2E-GQL-NOISY')
    await page.waitForSelector('[data-api-stream-reason]', { timeout: 20_000 })
    {
      const reason = await page.locator('[data-api-stream-reason]').innerText()
      // 안 두면 제한시간(30초)까지 프레임마다 타임라인 행 + IPC 가 나간다.
      check('손잡기 전 소음이 상한에 닿으면 규약을 안 쓰는 서버로 보고 멈춘다', reason.includes('규약을 쓰지 않는'))
      check(
        '연결됨으로 가지 않는다',
        (await page.locator('[data-api-stream-state="open"]').count()) === 0
      )
    }

    // ── 손잡기가 안 맞는 서버: 붙긴 해도 **연결됨이 아니다** ───────────────
    await click('[data-nav-module="environments"]')
    await page.waitForSelector('[data-api-env-card="E2E-GQL-LEGACY"]', { timeout: 5_000 })
    await click('[data-api-env-card="E2E-GQL-LEGACY"] button[data-api-env-select]')
    await click('[data-nav-module="runner"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="stream"]')
    await page.waitForTimeout(400)
    await click('[data-api-stream-pick="messages"]')
    await page.waitForTimeout(300)
    await click('button[data-api-stream-open]')
    await page.waitForSelector('[data-api-stream-reason]', { timeout: 20_000 })
    {
      const reason = await page.locator('[data-api-stream-reason]').innerText()
      // 소켓은 열렸지만 서버가 규약을 안 켰다 — 그걸 '연결됨' 이라고 하면 사용자는 붙은 줄 안다.
      check('손잡기 전에 끊기면 규약 이름을 확인하라고 말한다', reason.includes('graphql-transport-ws'))
      check(
        '소켓만 열린 것을 연결됨이라고 하지 않는다',
        (await page.locator('[data-api-stream-state="open"]').count()) === 0
      )
    }
  } finally {
    await live.stop()
    await legacy.stop()
    await endless.stop()
    await rejecting.stop()
    await flappy.stop()
    await foreign.stop()
    await noisy.stop()
  }
}
