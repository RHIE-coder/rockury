// 스모크 스위트 — API Runner › Inbox — 로컬 웹훅 수신·기대 본문 대조·수신→기록·응답 코드
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 자기 명세를 새로 만든다 — 웹훅은 인터페이스 종류가 고정 속성이라 기존 명세에 얹을 수 없다.

import { createServer } from 'node:http'

export const meta = {
  name: '19-api-inbox',
  needsDb: false, // 수신 서버는 앱이 띄운다. 우리는 그 주소로 쏘기만 한다
  desc: 'API Runner › Inbox — 로컬 웹훅 수신 · 기대 본문 대조 · 수신→기록 · 응답 코드'
}

/** 앱이 연 수신 주소로 실제 HTTP 요청을 쏜다. 노드에서 직접 — 앱 밖에서 오는 것이라야 검증이 된다. */
async function post(url, body, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : body
  })
  return { status: res.status, text: await res.text() }
}

/** 앱이 고른 포트를 미리 점유해 충돌을 만든다(포트 충돌 안내 검증용). */
function occupy(port) {
  return new Promise((resolve, reject) => {
    const s = createServer((_q, r) => r.end('busy'))
    s.once('error', reject)
    s.listen(port, '127.0.0.1', () => resolve(s))
  })
}

/** 컨텍스트 바를 이 명세로 옮긴다 — 17·18 스위트와 같은 방식. */
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
  // 고정 포트를 쓰면 다른 실행과 부딪힌다(e2e 는 동시에 돌 수 있다) — 자리를 하나 잡아 비켜 쓴다.
  const probe = await occupy(0)
  const freePort = probe.address().port
  await new Promise((r) => probe.close(r))

  let squatter = null
  try {
    await click('[data-nav-service="api"]')
    await page.waitForTimeout(300)

    // ── 웹훅 명세: 기대 본문을 선언한 요청 + 선언 없는 요청 두 개 ──
    const specId = await page.evaluate(async () => {
      const spec = await window.rockury.apiSpecs.create({ name: 'e2e-webhook', kind: 'webhook' })
      await window.rockury.apiSpecs.patch(spec.id, [
        { op: 'add_request', name: 'onPaid' },
        {
          op: 'set_request_fields',
          request: 'onPaid',
          fields: {
            expectedBody: JSON.stringify([
              { name: 'id', type: 'string', requiredness: 'required' },
              { name: 'amount', type: 'number', requiredness: 'required' },
              { name: 'memo', type: 'string', requiredness: 'nullable' }
            ])
          }
        },
        // 선언을 일부러 비워 둔 요청 — '선언 없음' 이 맞음으로 안 뭉쳐지는지 본다.
        { op: 'add_request', name: 'onUnknown' }
      ])
      await window.rockury.apiOps.saveEnvironment({
        specId: spec.id,
        name: 'E2E-HOOK',
        baseUrl: 'http://127.0.0.1:1',
        production: false,
        values: [{ name: 'hookSecret', value: 'HOOK-SECRET-VALUE', secret: true }]
      })
      return spec.id
    })
    await switchSpec(page, click, specId)

    await click('[data-nav-module="environments"]')
    await page.waitForSelector('[data-api-env-card="E2E-HOOK"]', { timeout: 5_000 })
    await click('[data-api-env-card="E2E-HOOK"] button[data-api-env-select]')

    await click('[data-nav-module="runner"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="inbox"]')
    await page.waitForTimeout(400)

    // ── AC-4: 앱을 켜면 늘 꺼짐으로 시작한다 ──
    await click('[data-api-inbox-pick="onPaid"]')
    await page.waitForTimeout(300)
    check('대기는 꺼짐으로 시작한다 (AC-4)', (await page.locator('[data-api-inbox-state="off"]').count()) === 1)

    // ── AC-3: 로컬 전용임을 화면이 말한다 ──
    {
      const note = await page.locator('[data-api-inbox-local-note]').innerText()
      check('"이 컴퓨터 안에서만 닿습니다" 를 명시한다 (AC-3)', note.includes('이 컴퓨터 안에서만 닿습니다'))
      check('외부 터널이 아직 없다는 사실도 말한다', note.includes('터널'))
    }

    // 기대 본문 선언이 있으면 대조한다고 미리 알린다.
    check(
      '선언한 기대 본문 필드를 미리 보인다',
      (await page.locator('[data-api-inbox-expected]').innerText()).includes('amount')
    )

    // ── 대기 켜기 → 주소가 뜬다 (AC-1) ──
    await page.locator('input[data-api-inbox-port]').fill(String(freePort))
    await page.waitForTimeout(200)
    await click('button[data-api-inbox-start]')
    await page.waitForSelector('[data-api-inbox-state="on"]', { timeout: 5_000 })
    const url = await page.locator('[data-api-inbox-url]').innerText()
    check('대기를 켜면 수신 주소가 보인다 (AC-1)', url === `http://127.0.0.1:${freePort}/`)
    check('주소는 로컬 고정이다 — 외부 호스트를 만들 수 없다 (AC-3)', url.startsWith('http://127.0.0.1:'))

    // ── 선언과 맞는 본문 ──
    {
      const res = await post(url + 'hooks/paid', '{"id":"evt_1","amount":1200}')
      check('기본 응답 코드는 200 이다 (AC-5)', res.status === 200)
      await page.waitForSelector('[data-api-inbox-verdict="match"]', { timeout: 5_000 })
      check('받은 것이 목록에 뜬다 (received AC-1)', (await page.locator('[data-api-inbox-row]').count()) >= 1)
      check(
        '선언과 맞으면 맞음으로 표시된다 (AC-3)',
        (await page.locator('[data-api-inbox-verdict="match"]').count()) === 1
      )
      const row = await page.locator('[data-api-inbox-row="POST"]').first().innerText()
      check('메서드·경로·크기가 한 줄에 보인다', row.includes('POST') && row.includes('/hooks/paid'))
    }

    // ── 열면 헤더·본문 전문이 보인다 (AC-2) ──
    await click('[data-api-inbox-row="POST"] button')
    await page.waitForSelector('[data-api-inbox-detail]', { timeout: 5_000 })
    {
      const detail = await page.locator('[data-api-inbox-detail]').innerText()
      check('본문 전문이 보인다 (AC-2)', detail.includes('evt_1'))
      check('헤더 전문이 보인다 (AC-2)', detail.includes('content-type'))
    }

    // ── 선언과 어긋나는 본문 — 무엇이 어긋났는지 지목한다 ──
    {
      await post(url + 'hooks/paid', '{"amount":"천이백"}')
      await page.waitForSelector('[data-api-inbox-verdict="mismatch"]', { timeout: 5_000 })
      check(
        '선언과 어긋나면 어긋남으로 갈린다 (AC-3)',
        (await page.locator('[data-api-inbox-verdict="mismatch"]').count()) === 1
      )
      await click('[data-api-inbox-verdict="mismatch"]')
      await page.waitForSelector('[data-api-inbox-issues]', { timeout: 5_000 })
      const issues = await page.locator('[data-api-inbox-issues]').innerText()
      check('빠진 필수 필드를 지목한다', issues.includes('id'))
      check('타입이 다른 필드도 지목한다', issues.includes('amount'))
    }

    // ── JSON 이 아니면 **대조 불가** — 맞음이 아니다 ──
    {
      await fetch(url + 'hooks/xml', {
        method: 'POST',
        headers: { 'content-type': 'application/xml' },
        body: '<event/>'
      })
      await page.waitForSelector('[data-api-inbox-verdict="unparsable"]', { timeout: 5_000 })
      check(
        'JSON 이 아니면 대조 불가로 갈린다 — 맞음으로 안 뭉친다',
        (await page.locator('[data-api-inbox-verdict="unparsable"]').count()) === 1
      )
    }

    // ── AC-4(수신 → Run) · 기록에도 대조 결과가 남는다 ──
    {
      const runs = await page.evaluate(async (id) => {
        const rows = await window.rockury.apiOps.listRuns(id)
        const full = await window.rockury.apiOps.getRun(id, rows[0].id)
        return { rows, full }
      }, specId)
      check('수신마다 실행 기록이 남는다 (AC-4)', runs.rows.length === 3)
      check('기록의 상호작용 모양이 받는 쪽이다', runs.rows.every((r) => r.shape === 'inbound'))
      check('되돌려준 코드가 기록에 남는다', runs.rows[0].httpStatus === 200)
      check(
        '방향이 반대라 들어온 것이 요청 자리에 있다',
        runs.full.request.method === 'POST' && runs.full.request.url.includes('/hooks/')
      )
      const note = runs.full.messages.find((m) => m.event === 'match')?.data ?? ''
      check('대조 결과가 관측 내용에 남는다', note.length > 0)
    }

    // ── AC-5: 응답 코드를 바꾸면 그 코드로 답한다(재전송 유도) ──
    {
      await page.locator('input[data-api-inbox-code]').fill('500')
      await page.waitForTimeout(400)
      const res = await post(url + 'hooks/retry', '{"id":"evt_2","amount":1}')
      check('지정한 실패 코드로 응답한다 (AC-5)', res.status === 500)
      check('대기는 끊기지 않는다 — 코드만 바뀐다', (await page.locator('[data-api-inbox-state="on"]').count()) === 1)
      await page.locator('input[data-api-inbox-code]').fill('200')
      await page.waitForTimeout(300)
    }

    // ── 비밀은 가린 뒤 저장된다 ──
    {
      await fetch(url + 'hooks/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signature': 'HOOK-SECRET-VALUE' },
        body: '{"id":"evt_3","amount":2,"echo":"HOOK-SECRET-VALUE"}'
      })
      await page.waitForTimeout(700)
      check('받은 것에 담긴 비밀 실값이 화면에 안 뜬다', !(await body()).includes('HOOK-SECRET-VALUE'))
      const leaked = await page.evaluate(async (id) => {
        const rows = await window.rockury.apiOps.listRuns(id)
        const all = await Promise.all(rows.map((r) => window.rockury.apiOps.getRun(id, r.id)))
        return JSON.stringify(all).includes('HOOK-SECRET-VALUE')
      }, specId)
      check('기록 어디에도 비밀 실값이 없다 (가린 뒤 저장)', leaked === false)
    }

    // ── 대기 끄기 → 포트가 실제로 닫힌다 ──
    await click('button[data-api-inbox-stop]')
    await page.waitForSelector('[data-api-inbox-state="off"]', { timeout: 5_000 })
    {
      let reachable = true
      try {
        await post(url, '{}')
      } catch {
        reachable = false
      }
      check('대기를 끄면 그 주소가 더는 안 닿는다', reachable === false)
    }

    // ── AC-2: 포트 충돌은 이유를 알리고 다른 포트를 제안한다 ──
    {
      squatter = await occupy(freePort)
      await click('button[data-api-inbox-start]')
      await page.waitForSelector('[data-api-error]', { timeout: 5_000 })
      const err = await page.locator('[data-api-error]').innerText()
      check('쓰는 포트면 이유를 알린다 (AC-2)', err.includes('이미 다른 프로그램이'))
      check('다른 포트를 제안한다 (AC-2)', /\d{4,5}/.test(err) && err.includes('은 어떨까요'))
      check(
        '몰래 다른 포트로 옮겨 붙지 않는다 — 대기는 여전히 꺼짐이다',
        (await page.locator('[data-api-inbox-state="off"]').count()) === 1
      )
      await new Promise((r) => squatter.close(r))
      squatter = null
    }

    // ── 선언 없는 요청은 '선언 없음' 이고 맞음이 아니다 ──
    {
      await click('[data-api-inbox-pick="onUnknown"]')
      await page.waitForTimeout(300)
      check(
        '선언이 없으면 그 사실을 미리 알린다',
        (await page.locator('[data-api-inbox-expected]').innerText()).includes('선언 없음')
      )
      await click('button[data-api-inbox-start]')
      await page.waitForSelector('[data-api-inbox-state="on"]', { timeout: 5_000 })
      const url2 = await page.locator('[data-api-inbox-url]').innerText()
      await post(url2 + 'anything', '{"whatever":1}')
      await page.waitForSelector('[data-api-inbox-verdict="undeclared"]', { timeout: 5_000 })
      check(
        '**선언이 없으면 맞음이 아니라 선언 없음이다**',
        (await page.locator('[data-api-inbox-verdict="undeclared"]').count()) === 1 &&
          (await page.locator('[data-api-inbox-verdict="match"]').count()) === 0
      )
      await click('button[data-api-inbox-stop]')
      await page.waitForSelector('[data-api-inbox-state="off"]', { timeout: 5_000 })
    }

    // ── 판정: 웹훅 관측도 "판정 규칙 없음" 으로 따로 센다 ──
    {
      const cov = await page.evaluate(async (id) => {
        const envs = await window.rockury.apiOps.listEnvironments(id)
        const d = await window.rockury.apiContract.runDrift(id, envs[0].id)
        return { ...d.coverage, findings: d.findings, unrouted: d.unroutedMessages }
      }, specId)
      check('웹훅 수신 관측은 미관측으로 세지 않는다', !cov.unobserved.includes('onPaid'))
      // 기대 본문을 선언해 뒀으므로 **실제로 대조된다** — 어긋난 수신이 있었으니 잡힌다.
      check('기대 본문 선언이 있으면 관측으로 세고 대조한다', cov.observed >= 1)
      // onUnknown 은 선언이 없어 어느 것과도 못 맞춘다 — 통과가 아니다.
      check('**선언이 없으면 통과가 아니라 "맞출 선언 없음" 이다**', cov.unjudged.includes('onUnknown'))
    }

    // ── 보내는 요청에는 수신 대기를 걸 수 없다 (모양이 곧 방향이다) ──
    {
      const err = await page.evaluate(async () => {
        const spec = await window.rockury.apiSpecs.create({ name: 'e2e-hook-wrong', kind: 'rest' })
        await window.rockury.apiSpecs.patch(spec.id, [{ op: 'add_request', name: 'getThing' }])
        const env = await window.rockury.apiOps.saveEnvironment({
          specId: spec.id,
          name: 'E2E-WRONG',
          baseUrl: 'http://127.0.0.1:1',
          production: false,
          values: []
        })
        try {
          await window.rockury.apiInbox.start({
            specId: spec.id,
            requestName: 'getThing',
            environmentId: env.id
          })
          return null
        } catch (e) {
          return String(e.message ?? e)
        }
      })
      check('보내는 요청에 수신 대기를 걸면 거부한다', err !== null && err.includes('받는 모양이 아닙니다'))
    }
  } finally {
    if (squatter) await new Promise((r) => squatter.close(r))
    // 스위트가 끝났는데 앱이 포트를 들고 있으면 다음 스위트가 헷갈린다.
    await page.evaluate(() => window.rockury.apiInbox.stop()).catch(() => {})
  }
}
