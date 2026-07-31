// 스모크 스위트 — API 운영부 — 환경·오조작 방지·조립 미리보기·실제 전송·기록
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 30-api-studio 가 만든 명세 `e2e-billing` 을 이어 쓴다(파일 이름 번호 = 상태 의존 순서).

import { createServer } from 'node:http'

export const meta = {
  name: '31-api-runner',
  needsDb: false, // 도커 test-db 대신 스위트가 자기 HTTP 서버를 띄운다
  desc: 'API 운영부 — 환경·오조작 방지·조립 미리보기·실제 전송·기록'
}

/** 받은 요청을 그대로 돌려주는 작은 서버 — 무엇이 실제로 나갔는지 검사한다. */
function startEchoServer() {
  return new Promise((resolve) => {
    const received = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        received.push({ url: req.url, method: req.method, headers: req.headers, body })
        if (req.url.startsWith('/boom')) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end('{"error":"terrible"}')
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, url: req.url, seen: req.headers.authorization ?? null, memo: null }))
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port }))
  })
}

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page
  const { server, received, port } = await startEchoServer()
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    // ── 명세를 고르고 요청 하나를 준비한다(에코 서버로 보낼 REST 요청) ──
    await click('[data-nav-service="api"]')
    await page.waitForTimeout(300)
    await page.evaluate(
      async ({ baseUrl }) => {
        await window.rockury.apiSpecs.patch('e2e-billing', [
          { op: 'add_request', name: 'echo' },
          {
            op: 'add_param',
            request: 'echo',
            param: { name: 'userId', type: 'string', required: true }
          },
          {
            op: 'set_request_fields',
            request: 'echo',
            fields: {
              method: 'GET',
              path: '/users/{{userId}}',
              headers: { Authorization: 'Bearer {{apiKey}}' }
            }
          }
        ])
        await window.rockury.apiOps.saveEnvironment({
          specId: 'e2e-billing',
          name: 'E2E-DEV',
          baseUrl,
          production: false,
          values: [{ name: 'apiKey', value: 'REAL-SECRET', secret: true }]
        })
      },
      { baseUrl }
    )

    // ── Environments 화면: 카드가 뜨고 값이 보인다 ──
    await click('[data-nav-module="environments"]')
    await page.waitForSelector('[data-api-env-card="E2E-DEV"]', { timeout: 5_000 })
    check('환경 카드가 렌더된다', (await page.locator('[data-api-env-card]').count()) >= 1)
    check(
      '비밀 표식 값은 화면에서 가려진다',
      (await page.locator('[data-api-env-value="apiKey"] input[type="password"]').count()) === 1
    )

    // ── 오조작 방지: 환경을 고르기 전에는 못 보낸다 (guard AC-1) ──
    await click('[data-nav-module="runner"]')
    // 모듈은 마지막에 보던 뷰로 돌아온다(2026-07-30) — 원하는 뷰는 명시해서 들어간다.
    await click('[data-nav-view="send"]')
    await page.waitForTimeout(400)
    await click('[data-api-send-pick="echo"]')
    await page.waitForTimeout(300)
    check('환경을 고르기 전에는 보내기가 막혀 있다', await page.locator('button[data-api-send]').isDisabled())
    check('왜 못 보내는지 이유가 보인다', (await page.locator('[data-api-blocking]').count()) === 1)

    // ── 환경을 고르면 열린다 ──
    await click('[data-nav-module="environments"]')
    await page.waitForTimeout(300)
    await click('[data-api-env-card="E2E-DEV"] button[data-api-env-select]')
    await click('[data-nav-module="runner"]')
    // 모듈은 마지막에 보던 뷰로 돌아온다(2026-07-30) — 원하는 뷰는 명시해서 들어간다.
    await click('[data-nav-view="send"]')
    await page.waitForTimeout(400)
    check('환경을 고른 뒤에도 필수 파라미터가 비면 여전히 막힌다', await page.locator('button[data-api-send]').isDisabled())

    await page.locator('input[data-api-call-param="userId"]').fill('u_1')
    await page.waitForTimeout(300)
    check('필수 값을 채우면 보낼 수 있다', !(await page.locator('button[data-api-send]').isDisabled()))

    // ── 조립 미리보기: 최종 주소 + 값 출처 + 마스킹 ──
    {
      const url = await page.locator('[data-api-preview-url]').innerText()
      check('최종 주소가 치환되어 보인다', url.includes(`${baseUrl}/users/u_1`))

      const origins = await page.$$eval('[data-api-origin]', (els) =>
        els.map((e) => e.getAttribute('data-api-origin'))
      )
      check('값마다 출처가 보인다 (환경 · 호출)', origins.includes('environment') && origins.includes('call'))
      check('미리보기에 비밀 실값이 안 보인다', !(await body()).includes('REAL-SECRET'))
    }

    // ── 실제로 보낸다 ──
    await click('button[data-api-send]')
    await page.waitForSelector('[data-api-run-status="ok"]', { timeout: 15_000 })
    check('응답이 성공으로 표시된다', (await page.locator('[data-api-run-status="ok"]').count()) >= 1)
    check('응답 본문이 보인다', (await page.locator('[data-api-response-body]').innerText()).includes('"ok"'))

    // ── 실제로 나간 요청에는 진짜 값이 실렸다 (가림은 기록 쪽이지 전송이 아니다) ──
    {
      const last = received[received.length - 1]
      check('서버가 받은 경로가 치환된 값이다', last.url === '/users/u_1')
      check('서버가 받은 헤더에는 진짜 비밀이 실렸다', last.headers.authorization === 'Bearer REAL-SECRET')
    }

    // ── 그런데 기록에는 실값이 없다 (가린 뒤 저장) ──
    {
      const leaked = await page.evaluate(async () => {
        const runs = await window.rockury.apiOps.listRuns('e2e-billing')
        return JSON.stringify(runs).includes('REAL-SECRET')
      })
      check('실행 기록 어디에도 비밀 실값이 없다 (가린 뒤 저장)', leaked === false)
    }

    // ── curl 복사에도 실값이 아니라 변수 이름이 나간다 ──
    {
      const curl = await page.evaluate(async () => {
        await navigator.clipboard.writeText('')
        document.querySelector('button[data-api-copy-curl]').click()
        await new Promise((r) => setTimeout(r, 200))
        return navigator.clipboard.readText()
      })
      check('curl 에 비밀 실값이 없다', !curl.includes('REAL-SECRET'))
      check('curl 에 변수 이름이 남는다', curl.includes('$apiKey'))
    }

    // ── History: 기록이 쌓이고 펼쳐 볼 수 있다 ──
    await click('[data-nav-view="history"]')
    await page.waitForSelector('[data-api-run-row="echo"]', { timeout: 5_000 })
    check('기록 목록에 방금 실행이 있다', (await page.locator('[data-api-run-row="echo"]').count()) >= 1)
    await click('[data-api-run-row="echo"] button')
    await page.waitForSelector('[data-api-run-detail]', { timeout: 5_000 })
    check('기록 상세에 기준 버전이 적힌다', (await page.locator('[data-api-run-detail]').innerText()).includes('기준 버전'))

    // ── 오류 갈래: 못 붙는 주소는 "연결 실패" 로 따로 센다 ──
    {
      const status = await page.evaluate(async () => {
        await window.rockury.apiOps.saveEnvironment({
          specId: 'e2e-billing',
          name: 'E2E-DEAD',
          baseUrl: 'http://127.0.0.1:1',
          production: false,
          values: [{ name: 'apiKey', value: 'x', secret: true }]
        })
        const envs = await window.rockury.apiOps.listEnvironments('e2e-billing')
        const dead = envs.find((e) => e.name === 'E2E-DEAD')
        const res = await window.rockury.apiOps.send({
          specId: 'e2e-billing',
          requestName: 'echo',
          environmentId: dead.id,
          call: { userId: 'u_1' }
        })
        return res.run.status
      })
      check('못 붙으면 http 오류가 아니라 연결 실패로 갈린다', status === 'connect-failed')
    }

    // ── 붙었는데 500 인 것은 "오류 응답" 이지 연결 실패가 아니다 ──
    {
      const status = await page.evaluate(async () => {
        await window.rockury.apiSpecs.patch('e2e-billing', [
          { op: 'add_request', name: 'boom' },
          { op: 'set_request_fields', request: 'boom', fields: { method: 'GET', path: '/boom' } }
        ])
        const envs = await window.rockury.apiOps.listEnvironments('e2e-billing')
        const dev = envs.find((e) => e.name === 'E2E-DEV')
        const res = await window.rockury.apiOps.send({
          specId: 'e2e-billing',
          requestName: 'boom',
          environmentId: dev.id,
          call: {}
        })
        return { status: res.run.status, http: res.run.httpStatus }
      })
      check('4xx·5xx 는 오류 응답으로 갈린다(연결은 됐다)', status.status === 'http-error' && status.http === 500)
    }

    // ── 기록이 붙은 환경은 안 지워진다 ──
    {
      const res = await page.evaluate(async () => {
        const envs = await window.rockury.apiOps.listEnvironments('e2e-billing')
        const dev = envs.find((e) => e.name === 'E2E-DEV')
        return window.rockury.apiOps.deleteEnvironment(dev.id)
      })
      check('실행 기록이 있는 환경은 삭제되지 않고 건수를 알린다', res.deleted === false && res.runCount > 0)
    }

    // ── 복제는 구조만 가져온다 ──
    {
      const copy = await page.evaluate(async () => {
        const envs = await window.rockury.apiOps.listEnvironments('e2e-billing')
        const dev = envs.find((e) => e.name === 'E2E-DEV')
        return window.rockury.apiOps.duplicateEnvironment(dev.id, 'E2E-COPY')
      })
      check('복제본에 원본 값·주소가 안 따라온다', copy.baseUrl === '' && copy.values.every((v) => v.value === ''))
      check('복제본도 비밀 표식은 유지한다', copy.values.some((v) => v.secret))
    }

    // ── 운영 표식: 상시 경고 띠 + 실행 확인 게이트 ──
    {
      await page.evaluate(async () => {
        const envs = await window.rockury.apiOps.listEnvironments('e2e-billing')
        const dev = envs.find((e) => e.name === 'E2E-DEV')
        await window.rockury.apiOps.saveEnvironment({ ...dev, production: true })
      })
      await click('[data-nav-module="environments"]')
      await page.waitForTimeout(400)
      await click('[data-api-env-card="E2E-DEV"] button[data-api-env-select]')
      await page.waitForSelector('[data-api-prod-band]', { timeout: 5_000 })
      check('운영 환경을 고르면 상시 경고 띠가 뜬다', (await page.locator('[data-api-prod-band]').count()) === 1)

      await click('[data-nav-module="runner"]')
      // 모듈은 마지막에 보던 뷰로 돌아온다(2026-07-30) — 원하는 뷰는 명시해서 들어간다.
      await click('[data-nav-view="send"]')
      await page.waitForTimeout(400)
      await click('[data-api-send-pick="echo"]')
      await page.locator('input[data-api-call-param="userId"]').fill('u_2')
      await page.waitForTimeout(300)
      await click('button[data-api-send]')
      await page.waitForSelector('[data-api-confirm-gate]', { timeout: 5_000 })
      const gate = await page.locator('[data-api-confirm-gate]').innerText()
      check('운영 환경 실행은 확인 게이트를 거친다', (await page.locator('[data-api-confirm-gate]').count()) === 1)
      check('확인 문구에 무엇을 어디로 보내는지가 적힌다', gate.includes('E2E-DEV') && gate.includes('echo'))

      const before = received.length
      await click('button[data-api-confirm-send]')
      await page.waitForTimeout(1_500)
      check('확인하면 실제로 나간다', received.length > before)
    }
  } finally {
    server.close()
  }
}
