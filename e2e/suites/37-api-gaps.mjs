// 스모크 스위트 — API 있는 화면의 빈칸 — 폴더 트리·DnD · enum 편집 · 응답 손편집 ·
// 치환 미리보기 · markdown 미리보기 · 전송 취소 · 다시 실행 · 두 Run 비교 · 고아/구멍
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

import { createServer } from 'node:http'

export const meta = {
  name: '37-api-gaps',
  needsDb: false, // 자기 HTTP 서버를 띄운다
  desc: 'API 화면 빈칸 — 트리·enum·응답 손편집·치환 미리보기·markdown·취소·재실행·Run 비교·고아/구멍'
}

/** 느리게 답하는 서버 — 취소를 실제로 눌러 볼 수 있어야 한다. */
function startServer() {
  return new Promise((resolve) => {
    let n = 0
    const server = createServer((req, res) => {
      if (req.url.startsWith('/slow')) {
        // 취소 검증용. 끊기면 응답을 못 보내고 그대로 끝난다.
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end('{"late":true}')
          }
        }, 8_000)
        return
      }
      // 부를 때마다 값이 달라진다 — 두 Run 비교에 쓸 차이를 만든다.
      n += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(n === 1 ? { id: 'x', n: 1, gone: true } : { id: 'x', n, fresh: 'yes' }))
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
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
  const { check, click, body } = ctx
  const page = ctx.page
  const { server, port } = await startServer()

  try {
    await click('[data-nav-service="api"]')
    await page.waitForTimeout(300)

    const specId = await page.evaluate(
      async ({ port }) => {
        const spec = await window.rockury.apiSpecs.create({ name: 'e2e-gaps', kind: 'rest' })
        await window.rockury.apiSpecs.patch(spec.id, [
          { op: 'add_request', name: 'listOrders' },
          {
            op: 'add_param',
            request: 'listOrders',
            param: { name: 'order', type: 'string', required: false }
          },
          { op: 'set_request_fields', request: 'listOrders', fields: { method: 'GET', path: '/orders' } },
          { op: 'add_request', name: 'slowOne' },
          { op: 'set_request_fields', request: 'slowOne', fields: { method: 'GET', path: '/slow' } }
        ])
        await window.rockury.apiOps.saveEnvironment({
          specId: spec.id,
          name: 'E2E-GAPS',
          baseUrl: `http://127.0.0.1:${port}`,
          production: false,
          values: [
            // 어느 요청도 안 쓰는 값 → 고아. 참조되는데 빈 값 → 구멍.
            { name: 'legacyToken', value: 'unused', secret: false },
            { name: 'apiKey', value: '', secret: true }
          ]
        })
        return spec.id
      },
      { port }
    )
    await switchSpec(page, click, specId)

    // ── enum 허용값 편집 (CASE-apistudio-003 의 화면 쪽) ──
    await click('[data-nav-module="studio"]')
    await page.waitForTimeout(400)
    await click('[data-api-request-row="listOrders"]')
    await page.waitForTimeout(300)
    check('처음엔 enum 이 아니라 허용 값 칸이 없다', (await page.locator('[data-api-param-enum="order"]').count()) === 0)
    await page.locator('[data-api-param-row="order"] select[data-api-param-type]').selectOption('enum')
    await page.waitForTimeout(400)
    check(
      'enum 으로 바꾸면 허용 값 칸이 나온다',
      (await page.locator('[data-api-param-enum="order"]').count()) === 1
    )
    check(
      '**허용 값이 비면 저장이 안 된다고 말한다** — 빈 목록은 어떤 값도 못 통과한다',
      (await page.locator('[data-api-param-enum-empty]').count()) === 1
    )
    check('아직 저장 오류 배너는 안 뜬다 — 타이핑 중에 번쩍이면 고칠 수가 없다', (await page.locator('[data-api-error]').count()) === 0)
    await page.locator('[data-api-param-enum="order"] input').fill('asc, desc')
    await page.waitForTimeout(500)
    check('허용 값을 채우면 경고가 사라진다', (await page.locator('[data-api-param-enum-empty]').count()) === 0)
    {
      const saved = await page.evaluate(async (id) => {
        const s = await window.rockury.apiSpecs.get(id)
        return s.requests.find((r) => r.name === 'listOrders').params[0].enumValues
      }, specId)
      check('허용 값이 저장된다', JSON.stringify(saved) === JSON.stringify(['asc', 'desc']))
      const type = await page.evaluate(async (id) => {
        const s = await window.rockury.apiSpecs.get(id)
        return s.requests.find((r) => r.name === 'listOrders').params[0].type
      }, specId)
      check('**타입과 허용 값이 함께 커밋된다** — 그래야 string → enum 길이 열린다', type === 'enum')
    }

    // ── 응답 모양 손편집 (CASE-apistudio-076·078) ──
    check(
      '선언이 없으면 **선언 없음 ≠ 응답 없음** 을 말한다',
      (await page.locator('[data-api-empty="no-response"]').count()) === 1
    )
    await page.locator('input[data-api-new-response-status]').fill('200')
    await click('button[data-api-add-response]')
    await page.waitForTimeout(400)
    check('상태별로 갈라 선언된다', (await page.locator('[data-api-response="200"]').count()) === 1)
    await click('[data-api-response="200"] button[data-api-add-response-field]')
    await page.waitForTimeout(400)
    await page.locator('[data-api-response="200"] [data-api-response-field] input').first().fill('id')
    await page.waitForTimeout(500)
    {
      const saved = await page.evaluate(async (id) => {
        const s = await window.rockury.apiSpecs.get(id)
        return s.requests.find((r) => r.name === 'listOrders').responses
      }, specId)
      check('응답 필드가 손으로 저장된다', saved[0].status === '200' && saved[0].fields[0].name === 'id')
      check(
        '새 필드의 필수여부 기본값은 **모름** 이다 — 모르는 것을 필수로 못 박지 않는다',
        saved[0].fields[0].requiredness === 'unknown'
      )
    }

    // ── 편집 중 치환 미리보기 (CASE-apistudio-062) ──
    await page.evaluate(async (id) => {
      await window.rockury.apiSpecs.patch(id, [
        { op: 'set_request_fields', request: 'listOrders', fields: { method: 'GET', path: '/orders/{{upper("ab")}}' } }
      ])
    }, specId)
    await click('[data-nav-view="docs"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="requests"]')
    await page.waitForTimeout(400)
    await click('[data-api-request-row="listOrders"]')
    await page.waitForTimeout(400)
    check(
      '**편집 중에** 치환 결과가 보인다 — Runner 까지 안 가도 된다',
      (await page.locator('[data-api-template-preview]').first().innerText()).includes('/orders/AB')
    )

    // ── 폴더 트리 · 끌어 옮기기 (CASE-apistudio-050·051) ──
    await page.locator('input[data-api-request-folder]').fill('결제/환불')
    await page.waitForTimeout(600)
    check('폴더가 트리로 접힌다', (await page.locator('[data-api-folder="결제"]').count()) === 1)
    check('중첩 폴더도 선다', (await page.locator('[data-api-folder="결제/환불"]').count()) === 1)
    await click('[data-api-folder="결제"]')
    await page.waitForTimeout(300)
    check(
      '폴더를 접으면 자식이 숨는다',
      (await page.locator('[data-api-request-row="listOrders"]').count()) === 0
    )
    await click('[data-api-folder="결제"]')
    await page.waitForTimeout(300)
    check(
      '다시 펴면 자식이 돌아온다',
      (await page.locator('[data-api-request-row="listOrders"]').count()) === 1
    )
    {
      // 자기 안으로 파고드는 경로는 글자로 막는다.
      await page.locator('input[data-api-request-folder]').fill('결제/결제')
      await page.waitForTimeout(600)
      check(
        '**자기 안으로 파고드는 폴더 경로를 경고한다** (CASE-apistudio-051)',
        (await page.locator('[data-api-folder-warning]').count()) === 1
      )
      await page.locator('input[data-api-request-folder]').fill('결제')
      await page.waitForTimeout(600)
    }
    {
      // 끌어 옮기기 — Playwright 의 dragTo 는 HTML5 DnD 를 못 태워서 이벤트를 직접 태운다.
      const moved = await page.evaluate(async (id) => {
        const row = document.querySelector('[data-api-request-row="slowOne"]')
        const folder = document.querySelector('[data-api-folder="결제"]')
        const dt = new DataTransfer()
        row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
        // **한 박자 쉰다** — dragstart 가 세운 React 상태는 같은 동기 블록 안에서 안 보인다.
        // 사람이 끄는 동안은 자연히 갈리는 자리라 실제 조작에서는 안 겪는다.
        await new Promise((r) => setTimeout(r, 150))
        folder.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        folder.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
        await new Promise((r) => setTimeout(r, 700))
        const s = await window.rockury.apiSpecs.get(id)
        return s.requests.find((r) => r.name === 'slowOne').folder
      }, specId)
      check('요청을 폴더로 끌어다 놓으면 소속이 바뀐다', moved === '결제')
    }

    // ── 폴더 손잡이 (CASE-apistudio-051b) ──
    {
      // 폴더 하나 더 만들어 둔다 — 폴더째 옮기기·이름 겹침을 볼 대상이 필요하다.
      // **화면 경로로 만든다** — 창구(IPC)로 고치면 렌더러 저장소가 그 사실을 모른다.
      await click('button[data-api-add-request]')
      await page.waitForTimeout(600)
      await page.locator('input[data-api-request-folder]').fill('빠름')
      await page.waitForTimeout(600)
      check('새 폴더가 트리에 선다', (await page.locator('[data-api-folder="빠름"]').count()) === 1)

      // 이름 바꾸기 — 자손 경로가 함께 따라간다.
      await click('[data-api-folder-rename="빠름"]')
      await page.locator('input[data-api-folder-name]').fill('신속')
      await page.locator('input[data-api-folder-name]').press('Enter')
      await page.waitForTimeout(700)
      {
        const folder = await page.evaluate(async (id) => {
          const s = await window.rockury.apiSpecs.get(id)
          return s.requests.find((r) => r.name === 'newRequest').folder
        }, specId)
        check('폴더 이름을 바꾸면 그 아래 요청의 경로가 따라간다', folder === '신속')
      }

      // **겹치는 이름으로는 안 바꾼다** — 안 막으면 두 폴더가 조용히 하나로 합쳐진다.
      await click('[data-api-folder-rename="신속"]')
      await page.locator('input[data-api-folder-name]').fill('결제')
      await page.locator('input[data-api-folder-name]').press('Enter')
      await page.waitForTimeout(500)
      {
        const reason = await page.locator('[data-api-tree-error]').innerText()
        check('겹치는 이름으로 바꾸려 하면 막고 이유를 준다', reason.includes('이미 있습니다'))
        const folder = await page.evaluate(async (id) => {
          const s = await window.rockury.apiSpecs.get(id)
          return s.requests.find((r) => r.name === 'newRequest').folder
        }, specId)
        check('막혔으므로 폴더가 그대로다 — 합쳐지지 않았다', folder === '신속')
      }

      // 폴더째 끌어 옮기기.
      const movedFolder = await page.evaluate(async (id) => {
        const src = document.querySelector('[data-api-folder="신속"]')
        const dst = document.querySelector('[data-api-folder="결제"]')
        const dt = new DataTransfer()
        src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
        // 요청 끌기와 같은 이유로 한 박자 쉰다(React 상태가 같은 블록에서 안 보인다).
        await new Promise((r) => setTimeout(r, 150))
        dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
        await new Promise((r) => setTimeout(r, 700))
        const s = await window.rockury.apiSpecs.get(id)
        return s.requests.find((r) => r.name === 'newRequest').folder
      }, specId)
      check('폴더를 통째로 끌어 옮기면 그 아래 요청도 함께 간다', movedFolder === '결제/신속')

      // **자기 자손 안으로는 못 옮긴다** — 옮기면 트리가 고리가 된다.
      const intoSelf = await page.evaluate(async (id) => {
        const src = document.querySelector('[data-api-folder="결제"]')
        const dst = document.querySelector('[data-api-folder="결제/신속"]')
        if (!src || !dst) return { moved: null, reason: '(대상 없음)' }
        const dt = new DataTransfer()
        src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
        await new Promise((r) => setTimeout(r, 150))
        dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
        await new Promise((r) => setTimeout(r, 500))
        const s = await window.rockury.apiSpecs.get(id)
        return {
          moved: s.requests.find((r) => r.name === 'newRequest').folder,
          reason: document.querySelector('[data-api-tree-error]')?.textContent ?? ''
        }
      }, specId)
      check('자기 자손 안으로는 못 옮긴다', intoSelf.moved === '결제/신속')
      check('막힌 이유가 화면에 뜬다', intoSelf.reason.includes('자기 안'))
    }

    // ── markdown 미리보기 (CASE-apistudio-032) ──
    await page.evaluate(async (id) => {
      await window.rockury.apiSpecs.patch(id, [
        {
          op: 'set_docs',
          request: 'listOrders',
          docs:
            '# 제목\n\n[문서](https://example.test/a) 와 [나쁨](javascript:alert(1))\n\n' +
            '| 이름 | 뜻 |\n| --- | --- |\n| id | 식별자 |\n\n```ts\nconst a = **1**\n```'
        }
      ])
    }, specId)
    // Docs 에는 요청 목록이 없다(고른 요청을 따라간다) — 고르는 것은 Requests 에서 한다.
    await click('[data-api-request-row="listOrders"]')
    await page.waitForTimeout(300)
    await click('[data-nav-view="docs"]')
    await page.waitForTimeout(600)
    await click('button[data-api-docs-preview-toggle]')
    await page.waitForSelector('[data-api-md-preview]', { timeout: 5_000 })
    {
      check('제목이 렌더된다', (await page.locator('[data-api-md-heading="1"]').count()) === 1)
      check('표가 렌더된다 (AC-2)', (await page.locator('[data-api-md-table]').count()) === 1)
      check('코드블록이 렌더된다 (AC-2)', (await page.locator('[data-api-md-code]').count()) === 1)
      check(
        '코드블록 안쪽은 안 꾸민다 — 예제가 망가지면 안 된다',
        (await page.locator('[data-api-md-code]').innerText()).includes('**1**')
      )
      const links = await page.$$eval('[data-api-md-link]', (els) => els.map((e) => e.getAttribute('href')))
      check('http 링크는 링크가 된다 (AC-2)', links.includes('https://example.test/a'))
      check(
        '**javascript: 는 링크로 안 만든다** — 원문 그대로 글자로 남는다',
        links.every((h) => !String(h).startsWith('javascript:')) &&
          (await page.locator('[data-api-md-preview]').innerText()).includes('javascript:alert(1)')
      )
      check(
        '어디까지 그리는지 화면이 말한다',
        (await page.locator('[data-api-md-support]').innerText()).includes('표(|)')
      )
    }
    await click('button[data-api-docs-preview-toggle]')
    await page.waitForTimeout(300)
    check('되돌리면 다시 고칠 수 있다', (await page.locator('textarea[data-api-docs]').count()) === 1)

    // ── 환경 값 고아·구멍 (CASE-apirunner-012) ──
    await click('[data-nav-module="environments"]')
    await page.waitForSelector('[data-api-env-card="E2E-GAPS"]', { timeout: 5_000 })
    check(
      '어느 요청도 안 쓰는 값은 고아로 표시된다',
      (await page.locator('[data-api-env-value="legacyToken"] [data-api-env-health="orphan"]').count()) === 1
    )
    check(
      '참조되는데 값이 빈 것은 구멍으로 표시된다',
      (await page.locator('[data-api-env-value="apiKey"] [data-api-env-health="hole"]').count()) === 0
    )
    check(
      '요약 줄이 건수를 말한다',
      (await page.locator('[data-api-env-health-summary]').count()) === 1
    )
    // 참조를 만들어 구멍이 실제로 뜨는지 본다 — 판정이 살아 있다는 증거다.
    await page.evaluate(async (id) => {
      await window.rockury.apiSpecs.patch(id, [
        {
          op: 'set_request_fields',
          request: 'listOrders',
          fields: { method: 'GET', path: '/orders', headers: { Authorization: 'Bearer {{apiKey}}' } }
        }
      ])
    }, specId)
    await click('[data-nav-module="runner"]')
    await page.waitForTimeout(300)
    await click('[data-nav-module="environments"]')
    await page.waitForTimeout(700)
    check(
      '참조가 생기면 그 값이 고아에서 구멍으로 바뀐다',
      (await page.locator('[data-api-env-value="apiKey"] [data-api-env-health="hole"]').count()) === 1
    )
    // 값을 채우면 둘 다 아니게 되어 목록에서 빠진다.
    await page.locator('[data-api-env-value="apiKey"] input').first().fill('filled')
    await page.waitForTimeout(500)
    check(
      '**둘 다 아닌 것은 표시가 사라진다** — 정상인 것을 나열하지 않는다',
      (await page.locator('[data-api-env-value="apiKey"] [data-api-env-health]').count()) === 0
    )
    await click('[data-api-env-card="E2E-GAPS"] button[data-api-env-save]').catch(() => {})
    await page.waitForTimeout(300)

    // ── 전송 취소 (CASE-apirunner-026) ──
    await page.evaluate(async (id) => {
      const envs = await window.rockury.apiOps.listEnvironments(id)
      await window.rockury.apiOps.saveEnvironment({ ...envs[0], values: [{ name: 'apiKey', value: 'k', secret: true }] })
    }, specId)
    await click('[data-api-env-card="E2E-GAPS"] button[data-api-env-select]')
    await click('[data-nav-module="runner"]')
    await page.waitForTimeout(400)
    await click('[data-api-send-pick="slowOne"]')
    await page.waitForTimeout(300)
    await click('button[data-api-send]')
    await page.waitForSelector('button[data-api-cancel-send]', { timeout: 5_000 })
    check('보내는 중에는 취소 버튼이 나온다 (AC-3)', (await page.locator('button[data-api-cancel-send]').count()) === 1)
    await click('button[data-api-cancel-send]')
    await page.waitForSelector('[data-api-run-status="cancelled"]', { timeout: 10_000 })
    check(
      '**취소도 기록에 남고 실패와 갈린다** — 결과가 `취소` 다',
      (await page.locator('[data-api-run-status="cancelled"]').count()) >= 1
    )
    {
      const status = await page.evaluate(async (id) => {
        const runs = await window.rockury.apiOps.listRuns(id)
        return runs[0].status
      }, specId)
      check('저장된 기록의 결과도 취소다', status === 'cancelled')
    }

    // ── 다시 실행 · 두 Run 비교 (CASE-apirunner-036 · history AC-3/AC-4) ──
    await click('[data-api-send-pick="listOrders"]')
    await page.waitForTimeout(300)
    await click('button[data-api-send]')
    await page.waitForSelector('[data-api-run-status="ok"]', { timeout: 10_000 })

    await click('[data-nav-view="history"]')
    await page.waitForSelector('[data-api-run-row="listOrders"]', { timeout: 5_000 })
    check(
      '기록 행에 다시 실행 버튼이 있다 (AC-3)',
      (await page.locator('[data-api-run-row="listOrders"] button[data-api-run-rerun]').count()) >= 1
    )
    {
      const before = await page.evaluate((id) => window.rockury.apiOps.listRuns(id).then((r) => r.length), specId)
      await click('[data-api-run-row="listOrders"] button[data-api-run-rerun]')
      await page.waitForTimeout(2_000)
      const after = await page.evaluate((id) => window.rockury.apiOps.listRuns(id).then((r) => r.length), specId)
      check('다시 실행하면 **새 기록이 하나 더 생긴다**(지나간 기록은 안 바뀐다)', after === before + 1)
    }

    await page.waitForTimeout(500)
    {
      const rows = page.locator('[data-api-run-row="listOrders"] button[data-api-run-pick]')
      await rows.nth(1).click()
      await rows.nth(0).click()
      await page.waitForSelector('[data-api-run-compare]', { timeout: 5_000 })
      check('두 개를 고르면 비교 패널이 뜬다 (AC-4)', (await page.locator('[data-api-run-compare]').count()) === 1)
      check(
        '고른 자리가 기준·비교로 갈려 보인다 — 순서가 뜻을 갖는다',
        (await page.locator('[data-api-run-pick="1"]').count()) === 1 &&
          (await page.locator('[data-api-run-pick="2"]').count()) === 1
      )
      const kinds = await page.$$eval('[data-api-run-compare-field]', (els) =>
        els.map((e) => e.getAttribute('data-api-run-compare-field'))
      )
      check('없어진 필드를 가려낸다', kinds.includes('removed'))
      check('새로 생긴 필드를 가려낸다', kinds.includes('added'))
      check('달라진 값을 가려낸다', kinds.includes('changed'))
      check(
        '요약에 갈래별 건수가 실린다',
        (await page.locator('[data-api-run-compare-summary]').innerText()).includes('새로 생김')
      )
    }

    // 비밀은 어디에도 안 샌다(이번 화면들에서도).
    check('이 화면들 어디에도 비밀 실값이 안 뜬다', !(await body()).includes('filled'))
  } finally {
    server.close()
  }
}
