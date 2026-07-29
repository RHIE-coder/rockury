// 스모크 스위트 — API gRPC — 서버에게 정의 받기(reflection) · 완전 판정 · 스트리밍 전송
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 자기 명세를 새로 만든다 — 인터페이스 종류는 생성 시 고정이라 기존 명세에 얹을 수 없다.

import { startGrpcServer } from '../lib/api/grpcServer.mjs'

export const meta = {
  name: '39-api-grpc',
  needsDb: false, // 도커 test-db 대신 스위트가 자기 gRPC 서버를 띄운다
  desc: 'API gRPC — reflection 으로 정의 받기 · 완전 판정 · 스트리밍 전송'
}

/** 컨텍스트 바를 이 명세로 옮긴다 — 35번 스위트와 같은 방식(nav 저장소 + 새로고침). */
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
  // 정의를 주는 서버 / 안 주는 서버 둘을 띄운다 — 두 번째가 "관측으로 안 내려간다"의 증거다.
  const live = await startGrpcServer()
  const mute = await startGrpcServer({ reflection: false })
  // 상한에 닿는 서버 · 이름이 위험한 서버 · 붙자마자 끊는 서버 — 여태 안 밟은 자리들.
  const flood = await startGrpcServer({ floodServices: 600 })
  const poison = await startGrpcServer({ poisonName: true })
  const flappy = await startGrpcServer({ dropAfterFirst: true })

  try {
    await click('[data-nav-service="api"]')
    await page.waitForTimeout(300)

    // ── 명세: 계속 받기만 함(Watch) · 서로 주고받음(Chat) ──────────────────
    const specId = await page.evaluate(
      async ({ url, muteUrl, floodUrl, poisonUrl, flappyUrl }) => {
        const spec = await window.rockury.apiSpecs.create({ name: 'e2e-grpc', kind: 'grpc' })
        await window.rockury.apiSpecs.patch(spec.id, [
          { op: 'add_request', name: 'watch', shape: 'server-stream' },
          {
            op: 'set_request_fields',
            request: 'watch',
            fields: {
              grpcMethod: 'Ticker/Watch',
              body: '{"count":2}',
              headers: { authorization: 'Bearer {{token}}' }
            }
          },
          // 선언을 일부러 **틀리게** 둔다 — 서버 정의와 대조해 어긋남이 잡히는지 본다.
          {
            op: 'set_response_schema',
            request: 'watch',
            status: 'OK',
            fields: [{ name: 'n', type: 'string', requiredness: 'required' }]
          },
          { op: 'add_request', name: 'chat', shape: 'duplex' },
          { op: 'set_request_fields', request: 'chat', fields: { grpcMethod: 'Ticker/Chat' } }
        ])
        await window.rockury.apiOps.saveEnvironment({
          specId: spec.id,
          name: 'E2E-GRPC',
          baseUrl: url,
          production: false,
          values: [{ name: 'token', value: 'GRPC-SECRET', secret: true }]
        })
        await window.rockury.apiOps.saveEnvironment({
          specId: spec.id,
          name: 'E2E-GRPC-MUTE',
          baseUrl: muteUrl,
          production: false,
          // 같은 요청을 쓰므로 `{{token}}` 값이 여기에도 있어야 한다 — 없으면 앱이
          // (맞게도) 보내기를 막아서, 검사하려던 "정의를 못 받으면 안 붙는다" 에 닿지 못한다.
          values: [{ name: 'token', value: 'GRPC-SECRET', secret: true }]
        })
        for (const [name, baseUrl] of [
          ['E2E-GRPC-FLOOD', floodUrl],
          ['E2E-GRPC-POISON', poisonUrl],
          ['E2E-GRPC-FLAPPY', flappyUrl]
        ]) {
          await window.rockury.apiOps.saveEnvironment({
            specId: spec.id,
            name,
            baseUrl,
            production: false,
            values: [{ name: 'token', value: 'GRPC-SECRET', secret: true }]
          })
        }
        return spec.id
      },
      { url: live.url, muteUrl: mute.url, floodUrl: flood.url, poisonUrl: poison.url, flappyUrl: flappy.url }
    )
    await switchSpec(page, click, specId)

    await click('[data-nav-module="environments"]')
    await page.waitForSelector('[data-api-env-card="E2E-GRPC"]', { timeout: 5_000 })
    await click('[data-api-env-card="E2E-GRPC"] button[data-api-env-select]')

    // ── 완전 판정: 서버가 자기 정의를 뱉는다 ───────────────────────────────
    {
      const d = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-grpc')
        const envs = await window.rockury.apiOps.listEnvironments(target.id)
        const env = envs.find((e) => e.name === 'E2E-GRPC')
        const r = await window.rockury.apiContract.runDrift(target.id, env.id)
        return { grade: r.grade, unavailable: r.unavailable, coverage: r.coverage, findings: r.findings }
      })
      check('gRPC 는 완전 판정 등급이다 — 서버가 자기 정의를 뱉는다', d.grade === 'complete')
      check('정의를 받았으므로 사유가 비어 있다', d.unavailable === null)
      // reflection 은 스트리밍 메서드의 응답 메시지도 설명한다 — 그래서 대조 대상이다.
      check('스트리밍 메서드도 대조한다 (미관측으로 밀지 않는다)', d.coverage.observed === 2)
      check(
        '선언한 타입이 서버 정의와 다르면 잡는다',
        d.findings.some((f) => f.path === 'watch./e2e.v1.Ticker/Watch.n' && f.kind === 'different')
      )
      check(
        '서버에만 있는 필드도 잡는다',
        d.findings.some((f) => f.path.endsWith('.label') && f.kind === 'server-only')
      )
    }

    // ── 정의를 안 주는 서버: **관측으로 내려가지 않는다** ──────────────────
    {
      const d = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-grpc')
        const envs = await window.rockury.apiOps.listEnvironments(target.id)
        const env = envs.find((e) => e.name === 'E2E-GRPC-MUTE')
        const r = await window.rockury.apiContract.runDrift(target.id, env.id)
        return { grade: r.grade, unavailable: r.unavailable, findings: r.findings }
      })
      check('정의를 못 받으면 등급을 낮추지 않는다', d.grade === 'complete')
      check('대신 사유가 달린 빈 결과를 준다', d.unavailable !== null && d.findings.length === 0)
      check(
        '사유가 "reflection 을 안 켰다" 로 갈린다 — 봐야 할 곳을 알려 준다',
        d.unavailable.reason === 'feature-off' && d.unavailable.message.includes('reflection')
      )
    }

    // ── 전송: 계속 받기만 하는 메서드 ─────────────────────────────────────
    await click('[data-nav-module="runner"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="stream"]')
    await page.waitForTimeout(400)
    await click('[data-api-stream-pick="watch"]')
    await page.waitForTimeout(300)

    check(
      'gRPC 서버 스트리밍에는 보내기 패널이 없다',
      (await page.locator('[data-api-stream-sendpanel]').count()) === 0
    )
    check(
      '전송 이름이 gRPC 로 뜬다 — SSE 라고 적히지 않는다',
      (await page.locator('[data-api-stream-transport]').innerText()).includes('gRPC')
    )

    await click('button[data-api-stream-open]')
    await page.waitForSelector('[data-api-stream-msg="in"]', { timeout: 15_000 })
    await page.waitForTimeout(800)
    {
      const timeline = await page.locator('[data-api-stream-timeline]').innerText()
      check('서버가 보낸 메시지가 타임라인에 쌓인다', timeline.includes('tick-1'))
      check('선언에 없던 필드도 원문 그대로 보인다', timeline.includes('label'))
      check('열거형 값이 이름으로 온다', timeline.includes('LOUD'))
      check('접속 기록도 타임라인 항목이다', timeline.includes('연결됨'))
    }
    check('요청 헤더의 비밀 실값이 화면에 안 뜬다', !(await body()).includes('GRPC-SECRET'))
    {
      const timeline = await page.locator('[data-api-stream-timeline]').innerText()
      // 서버가 준 값을 원값 그대로 읽는지 — 셋 다 기본값을 쓰면 조용히 틀린다.
      check('64비트 정수가 자릿수를 잃지 않는다', timeline.includes('9007199254740993'))
      check('바이트 칸은 글자로 지어내지 않고 크기만 적는다', timeline.includes('(바이너리 5 바이트)'))
      check('서버가 안 보낸 칸을 기본값으로 채우지 않는다', !timeline.includes('never'))
    }

    await page.waitForSelector('[data-api-stream-saved]', { timeout: 15_000 })
    {
      const run = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-grpc')
        const runs = await window.rockury.apiOps.listRuns(target.id)
        return runs[0] ? window.rockury.apiOps.getRun(target.id, runs[0].id) : null
      })
      check('gRPC 세션도 실행 기록 하나로 남는다', run !== null && run.requestName === 'watch')
      check('기록의 요청 전문에 gRPC 라고 남는다', run.request.method === 'GRPC')
      check('기록 어디에도 비밀 실값이 없다', !JSON.stringify(run).includes('GRPC-SECRET'))
    }

    // ── 전송: 서로 주고받는 메서드 ────────────────────────────────────────
    await click('[data-api-stream-pick="chat"]')
    await page.waitForTimeout(300)
    check(
      'gRPC 양방향에는 보내기 패널이 있다',
      (await page.locator('[data-api-stream-sendpanel]').count()) === 1
    )
    await click('button[data-api-stream-open]')
    await page.waitForSelector('[data-api-stream-state="open"]', { timeout: 15_000 })

    await page.locator('input[data-api-stream-draft]').fill('{"count":9,"text":"안녕"}')
    await click('button[data-api-stream-send]')
    await page.waitForTimeout(1_000)
    {
      const timeline = await page.locator('[data-api-stream-timeline]').innerText()
      check('보낸 것이 서버를 거쳐 되돌아온다', timeline.includes('echo:안녕'))
      check(
        '보낸 것과 받은 것이 방향으로 갈린다',
        (await page.locator('[data-api-stream-msg="out"]').count()) >= 1 &&
          (await page.locator('[data-api-stream-msg="in"]').count()) >= 1
      )
    }
    await click('button[data-api-stream-close]')
    await page.waitForSelector('[data-api-stream-saved]', { timeout: 15_000 })

    // ── 남의 서버가 주는 데이터에 상한이 있다 ─────────────────────────────
    {
      const d = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-grpc')
        const envs = await window.rockury.apiOps.listEnvironments(target.id)
        const env = envs.find((e) => e.name === 'E2E-GRPC-FLOOD')
        const r = await window.rockury.apiContract.runDrift(target.id, env.id)
        return r.unavailable
      })
      // 상한에 닿으면 정의를 다 못 읽은 것이므로 **판정하지 않고** 그 사실을 말한다.
      check('서비스 수 상한에 닿으면 판정하지 않고 사유를 준다', (d?.message ?? '').includes('상한'))
    }

    // ── 서버가 준 이름을 그대로 열쇠로 쓰지 않는다 ─────────────────────────
    {
      const d = await page.evaluate(async () => {
        const specs = await window.rockury.apiSpecs.list()
        const target = specs.find((s) => s.name === 'e2e-grpc')
        const envs = await window.rockury.apiOps.listEnvironments(target.id)
        const env = envs.find((e) => e.name === 'E2E-GRPC-POISON')
        const r = await window.rockury.apiContract.runDrift(target.id, env.id)
        return { grade: r.grade, coverage: r.coverage, unavailable: r.unavailable }
      })
      // `__proto__` 를 열쇠로 쓰면 프로토타입이 갈아치워져 정상 메시지까지 잘못 분류된다.
      check('위험한 이름이 섞여도 판정이 죽지 않는다', d.grade === 'complete')
      check('그 서버의 나머지 정의는 그대로 읽는다', d.unavailable === null && d.coverage.observed === 2)
    }

    // ── 붙자마자 끊는 서버에서 자동 재접속이 실제로 돈다 ───────────────────
    await click('[data-nav-module="environments"]')
    await page.waitForSelector('[data-api-env-card="E2E-GRPC-FLAPPY"]', { timeout: 5_000 })
    await click('[data-api-env-card="E2E-GRPC-FLAPPY"] button[data-api-env-select]')
    await click('[data-nav-module="runner"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="stream"]')
    await page.waitForTimeout(400)
    await click('[data-api-stream-pick="watch"]')
    await page.waitForTimeout(300)
    await page.locator('input[data-api-stream-autoreconnect]').check()
    await page.waitForTimeout(200)
    await click('button[data-api-stream-open]')
    // 서버가 30ms 뒤 끊는다 → 1초 뒤 재접속. 그 왕복에는 **정의 받기가 다시 붙는다.**
    await page.waitForSelector('[data-api-stream-msg="system"]', { timeout: 20_000 })
    await page.waitForTimeout(3_000)
    {
      const timeline = await page.locator('[data-api-stream-timeline]').innerText()
      check('gRPC 도 자동 재접속이 돈다 — 정의를 다시 받아 오는 왕복이 붙는다', timeline.includes('재접속'))
      check('몇 번째 시도인지 적힌다', /\d번째 재접속/.test(timeline))
    }
    await click('button[data-api-stream-close]')
    await page.waitForTimeout(500)
    await page.locator('input[data-api-stream-autoreconnect]').uncheck()
    await page.waitForTimeout(200)

    // ── 정의를 못 받으면 **붙지 않는다** ──────────────────────────────────
    // "연결됨인데 아무것도 안 옴" 을 만들면 사용자는 서버를 의심한다.
    await click('[data-nav-module="environments"]')
    await page.waitForSelector('[data-api-env-card="E2E-GRPC-MUTE"]', { timeout: 5_000 })
    await click('[data-api-env-card="E2E-GRPC-MUTE"] button[data-api-env-select]')
    await click('[data-nav-module="runner"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="stream"]')
    await page.waitForTimeout(400)
    await click('[data-api-stream-pick="watch"]')
    await page.waitForTimeout(300)
    await click('button[data-api-stream-open]')
    await page.waitForSelector('[data-api-stream-reason]', { timeout: 20_000 })
    {
      const reason = await page.locator('[data-api-stream-reason]').innerText()
      check('정의를 못 받으면 붙지 않고 이유를 말한다', reason.includes('붙지 않습니다'))
      check(
        '연결됨 상태로 가지 않는다',
        (await page.locator('[data-api-stream-state="open"]').count()) === 0
      )
    }
  } finally {
    await live.stop()
    await mute.stop()
    await flood.stop()
    await poison.stop()
    await flappy.stop()
  }
}
