// 스모크 스위트 — API Studio › Mocking — 선언한 모양으로만 답하는 가짜 서버
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

import { createServer } from 'node:http'

export const meta = {
  name: '38-api-mocking',
  needsDb: false, // 서버는 앱이 띄운다. 우리는 그 주소로 쏘기만 한다
  desc: 'API Studio › Mocking — 선언한 응답 모양으로만 답하는 로컬 가짜 서버'
}

/** 앱 밖(노드)에서 쏜다 — 앱 밖에서 오는 것이라야 "프론트가 쓴다"의 검증이 된다. */
async function hit(url) {
  const res = await fetch(url)
  return {
    status: res.status,
    mock: res.headers.get('x-rockury-mock'),
    guessed: res.headers.get('x-rockury-mock-guessed'),
    body: await res.text()
  }
}

/** 포트 하나를 잡았다 놓아 빈 자리를 고른다(고정 포트는 다른 실행과 부딪힌다). */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

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
  const { check, click } = ctx
  const page = ctx.page
  const port = await freePort()

  try {
    await click('[data-nav-service="api"]')
    await page.waitForTimeout(300)

    const specId = await page.evaluate(async () => {
      const spec = await window.rockury.apiSpecs.create({ name: 'e2e-mock', kind: 'rest' })
      await window.rockury.apiSpecs.patch(spec.id, [
        { op: 'add_request', name: 'getUser' },
        { op: 'set_request_fields', request: 'getUser', fields: { method: 'GET', path: '/users/{{id}}' } },
        {
          op: 'set_response_schema',
          request: 'getUser',
          status: '200',
          fields: [
            { name: 'id', type: 'string', requiredness: 'required' },
            { name: 'age', type: 'number', requiredness: 'required' },
            { name: 'memo', type: 'string', requiredness: 'nullable' },
            { name: 'maybe', type: 'string', requiredness: 'unknown' },
            {
              name: 'role',
              type: 'string',
              requiredness: 'required',
              enumValues: ['admin', 'member']
            }
          ]
        },
        { op: 'set_response_schema', request: 'getUser', status: '404', fields: [{ name: 'error', type: 'string', requiredness: 'required' }] },
        // 선언이 하나도 없는 요청 — 지어내지 않는지 본다.
        { op: 'add_request', name: 'undeclared' },
        { op: 'set_request_fields', request: 'undeclared', fields: { method: 'GET', path: '/nothing' } }
      ])
      return spec.id
    })
    await switchSpec(page, click, specId)

    await click('[data-nav-module="studio"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="mocking"]')
    await page.waitForTimeout(500)

    // ── 꺼짐으로 시작 · 무엇을 흉내 내는지 · 무엇을 못 하는지 ──
    check('가짜 서버는 꺼짐으로 시작한다', (await page.locator('[data-api-mock-state="off"]').count()) === 1)
    check('흉내 낼 요청이 목록에 뜬다', (await page.locator('[data-api-mock-route="getUser"]').count()) === 1)
    check(
      '**선언이 없어 못 흉내 내는 요청을 감추지 않는다** — 감추면 "왜 404 지" 를 한참 찾는다',
      (await page.locator('[data-api-mock-unready]').innerText()).includes('undeclared')
    )
    {
      const note = await page.locator('[data-api-mock-note]').innerText()
      check('로컬 전용임을 말한다', note.includes('이 컴퓨터 안에서만 닿습니다'))
      check('선언한 모양에서만 나온다고 말한다', note.includes('선언한 응답 모양'))
      check('**가짜 응답이 관측 기록으로 안 남는다고 말한다**', note.includes('관측 기록으로 안 남습니다'))
    }

    // ── 켜기 ──
    await page.locator('input[data-api-mock-port]').fill(String(port))
    await page.waitForTimeout(200)
    await click('button[data-api-mock-start]')
    await page.waitForSelector('[data-api-mock-state="on"]', { timeout: 5_000 })
    const url = await page.locator('[data-api-mock-url]').innerText()
    check('켜면 주소가 보인다', url === `http://127.0.0.1:${port}/`)
    check('로컬 고정 주소다', url.startsWith('http://127.0.0.1:'))

    // ── 선언한 모양대로 답한다 ──
    {
      const res = await hit(`${url}users/42`)
      const body = JSON.parse(res.body)
      check('선언한 상태로 답한다(가장 낮은 2xx)', res.status === 200)
      check('가짜임을 헤더로 밝힌다', res.mock === 'true')
      check('**값이 일부러 가짜처럼 보인다** — 진짜 같으면 "이미 되는 것" 으로 돈다', body.id === '(mock:id)')
      check('타입대로 만든다', body.age === 0)
      check(
        '**없을 수 있음은 null 로 낸다** — 값을 지어내면 프론트가 null 경로를 안 짠다',
        body.memo === null
      )
      check('허용 값이 있으면 그 값을 쓴다 — 그건 우리가 아는 값이다', body.role === 'admin')
      check('`모름` 은 내되 **짐작 건수를 헤더에 싣는다**', res.guessed === '1')
      check('치환 자리는 아무 값이나 받는다', (await hit(`${url}users/anything`)).status === 200)
    }

    // ── 화면이 오간 것을 보인다 ──
    await page.waitForSelector('[data-api-mock-hit="ok"]', { timeout: 5_000 })
    check('오간 것이 화면에 쌓인다', (await page.locator('[data-api-mock-hit="ok"]').count()) >= 1)
    check(
      '짐작한 필드 수가 화면에도 보인다',
      (await page.locator('[data-api-mock-guessed]').count()) >= 1
    )

    // ── 상태를 골라 오류 경로를 짠다 (서버는 안 끊긴다) ──
    await page.locator('select[data-api-mock-status="getUser"]').selectOption('404')
    await page.waitForTimeout(500)
    {
      const res = await hit(`${url}users/42`)
      check('골라 둔 상태로 답한다 — 오류 경로를 짜 볼 수 있다', res.status === 404)
      check('대기는 안 끊긴다 — 상태만 바뀐다', (await page.locator('[data-api-mock-state="on"]').count()) === 1)
    }
    await page.locator('select[data-api-mock-status="getUser"]').selectOption('')
    await page.waitForTimeout(400)

    // ── **선언이 없으면 지어내지 않는다** ──
    {
      const res = await hit(`${url}nothing`)
      check(
        '선언 없는 요청은 501 이다 — 404 면 "그런 길이 없다" 로 읽혀 경로를 의심하게 된다',
        res.status === 501
      )
      check('사유가 본문에 실린다', res.body.includes('응답 모양 선언이 없어'))
      check('어디서 고치면 되는지도 말한다', res.body.includes('Studio'))
      check('**그럴듯한 가짜 본문을 지어내지 않는다**', !res.body.includes('(mock:'))
    }

    // ── 맞는 선언이 없으면 아무거나 답하지 않는다 ──
    {
      const res = await hit(`${url}totally/unknown/path`)
      check('맞는 선언이 없으면 404 다', res.status === 404)
      check('흉내 낼 근거가 없다고 말한다', res.body.includes('흉내 낼 근거가 없어'))
    }

    // ── **가짜 응답은 관측 기록이 안 된다** ──
    {
      const runs = await page.evaluate((id) => window.rockury.apiOps.listRuns(id), specId)
      check(
        '가짜 응답이 실행 기록으로 안 남는다 — 남으면 판정이 "선언 대 선언" 이 되어 늘 이상 없음이 된다',
        runs.length === 0
      )
    }

    // ── 끄면 주소가 닫힌다 ──
    await click('button[data-api-mock-stop]')
    await page.waitForSelector('[data-api-mock-state="off"]', { timeout: 5_000 })
    {
      let reachable = true
      try {
        await hit(`${url}users/1`)
      } catch {
        reachable = false
      }
      check('끄면 그 주소가 더는 안 닿는다', reachable === false)
    }

    // ── REST 가 아니면 흉내 내는 척하지 않는다 ──
    {
      const gqlId = await page.evaluate(async () => {
        const spec = await window.rockury.apiSpecs.create({ name: 'e2e-mock-gql', kind: 'graphql' })
        return spec.id
      })
      await switchSpec(page, click, gqlId)
      await click('[data-nav-module="studio"]')
      await page.waitForTimeout(300)
      await click('[data-nav-view="mocking"]')
      await page.waitForTimeout(500)
      const text = await page.evaluate(() => document.body.innerText)
      check('GraphQL 명세는 흉내 낼 수 없다고 사유를 준다', text.includes('아직 흉내 내지 않습니다'))
      check('왜 못 하는지도 말한다', text.includes('경로+메서드로 갈리지 않아서'))
      const err = await page.evaluate(async (id) => {
        try {
          await window.rockury.apiMock.start({ specId: id })
          return null
        } catch (e) {
          return String(e.message ?? e)
        }
      }, gqlId)
      check('창구에서도 막는다 — 화면만 막으면 다른 경로가 우회한다', err !== null && err.includes('흉내'))
    }
  } finally {
    await page.evaluate(() => window.rockury.apiMock.stop()).catch(() => {})
  }
}
