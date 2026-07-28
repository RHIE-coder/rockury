// 스모크 스위트 — API 판정 — 등급·커버리지 정직·결과 3종·흡수·이력
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 13·14 가 만든 명세 `e2e-billing` 과 환경을 이어 쓴다(파일 이름 번호 = 상태 의존 순서).

import { createServer } from 'node:http'

export const meta = {
  name: '15-api-contract',
  needsDb: false,
  desc: 'API 판정 — 등급·커버리지 정직·결과 3종·흡수·이력'
}

/** REST 에코 + GraphQL introspection 을 함께 내주는 작은 서버. */
function startServer() {
  return new Promise((resolve) => {
    let introspectionOn = true
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (req.url === '/graphql') {
          res.writeHead(200, { 'content-type': 'application/json' })
          if (!introspectionOn) {
            res.end(JSON.stringify({ errors: [{ message: 'introspection is disabled' }] }))
            return
          }
          res.end(
            JSON.stringify({
              data: {
                __schema: {
                  queryType: { name: 'Query' },
                  mutationType: null,
                  types: [
                    {
                      name: 'Query',
                      kind: 'OBJECT',
                      fields: [{ name: 'user', type: { kind: 'OBJECT', name: 'User' } }]
                    },
                    {
                      name: 'User',
                      kind: 'OBJECT',
                      fields: [
                        { name: 'id', type: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'ID' } } },
                        { name: 'nickname', type: { kind: 'SCALAR', name: 'String' } }
                      ]
                    }
                  ]
                }
              }
            })
          )
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        // 선언에 없는 필드(newField)를 하나 섞어 둔다 — '서버에만 있음'을 만들기 위해.
        res.end(JSON.stringify({ ok: true, newField: 'surprise' }))
      })
    })
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: server.address().port, off: () => (introspectionOn = false) })
    )
  })
}

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page
  const { server, port, off } = await startServer()
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    await click('[data-nav-service="api"]')
    await page.waitForTimeout(300)

    // ── 준비: 관측 판정용 REST 요청 두 개(하나는 일부러 안 쏜다) ──
    await page.evaluate(
      async ({ baseUrl }) => {
        await window.rockury.apiSpecs.patch('e2e-billing', [
          { op: 'add_request', name: 'observed' },
          {
            op: 'set_request_fields',
            request: 'observed',
            fields: { method: 'GET', path: '/observed' }
          },
          {
            op: 'set_response_schema',
            request: 'observed',
            status: '200',
            fields: [
              { name: 'ok', type: 'boolean', requiredness: 'unknown' },
              { name: 'gone', type: 'string', requiredness: 'required' },
              { name: 'maybe', type: 'string', requiredness: 'nullable' },
              // 응답에 없고 필수여부도 모르는 필드 — 어긋남으로도 안전으로도 세면 안 되고,
              // '제외 N개' 로만 남아야 한다.
              { name: 'dunno', type: 'string', requiredness: 'unknown' }
            ]
          },
          { op: 'add_request', name: 'neverSent' },
          { op: 'set_request_fields', request: 'neverSent', fields: { method: 'GET', path: '/never' } }
        ])
        const envs = await window.rockury.apiOps.listEnvironments('e2e-billing')
        const dev = envs.find((e) => e.name === 'E2E-DEV')
        await window.rockury.apiOps.saveEnvironment({ ...dev, baseUrl, production: false })
        await window.rockury.apiOps.send({
          specId: 'e2e-billing',
          requestName: 'observed',
          environmentId: dev.id,
          call: {}
        })
      },
      { baseUrl }
    )

    // ── 판정 전: "이상 없음" 과 절대 섞이지 않는다 ──
    await click('[data-nav-module="contract"]')
    await page.waitForTimeout(500)
    check(
      '판정 전에는 "아직 안 돌렸다" 로 보인다 (이상 없음이 아니다)',
      (await page.locator('[data-api-drift-never-ran]').count()) === 1
    )
      // 판정 결과 자체가 아예 렌더되지 않아야 한다 — 요약 한 줄도 없다.
    // (안내 문구가 «"이상 없음"이 아닙니다» 라고 그 말을 인용하므로 본문 검색으로는 못 가른다.)
    check('안 돌렸을 때는 판정 결과가 아예 없다', (await page.locator('[data-api-drift-summary]').count()) === 0)

    // ── 환경을 고르고 판정 실행 ──
    await click('[data-nav-module="environments"]')
    await page.waitForTimeout(400)
    await click('[data-api-env-card="E2E-DEV"] button[data-api-env-select]')
    await click('[data-nav-module="contract"]')
    await page.waitForTimeout(400)
    await click('button[data-api-run-drift]')
    await page.waitForSelector('[data-api-drift-summary]', { timeout: 15_000 })

    // ── 등급과 커버리지 ──
    check('REST 는 관측 판정 등급이 붙는다', (await page.locator('[data-api-drift-grade="observed"]').count()) === 1)
    {
      const summary = await page.locator('[data-api-drift-summary]').innerText()
      check('요약에 커버리지가 함께 붙는다', /\d+\s*\/\s*\d+\s*관측/.test(summary))
      check('커버리지 없는 "이상 없음" 이 아니다', !/^이상 없음$/.test(summary.trim()))
    }
    check(
      '안 쏴 본 요청이 미관측 목록으로 보인다',
      (await page.locator('[data-api-drift-unobserved]').innerText()).includes('neverSent')
    )
    check(
      "필수여부 '모름' 제외 개수가 보인다",
      (await page.locator('[data-api-drift-skipped]').count()) === 1
    )

    // ── 결과 3종 ──
    {
      const kinds = await page.$$eval('[data-api-finding]', (els) =>
        els.map((e) => e.getAttribute('data-api-finding'))
      )
      check('서버에만 있음을 잡는다(newField)', kinds.includes('server-only'))
      check('명세에만 있음을 잡는다(gone)', kinds.includes('spec-only'))
      check(
        'nullable 로 선언한 필드가 없는 것은 어긋남이 아니다',
        !(await body()).includes('observed.200.maybe')
      )
      check('넷째 갈래를 만들지 않는다', kinds.every((k) => ['server-only', 'spec-only', 'different'].includes(k)))
    }

    // ── 흡수: 미리보기 → 수락 → Draft 반영 ──
    await click('[data-nav-view="accept"]')
    await page.waitForSelector('[data-api-absorb-candidates]', { timeout: 5_000 })
    check('흡수 후보에 요청이 뜬다', (await page.locator('[data-api-absorb-pick="observed"]').count()) === 1)
    check(
      '고칠 목록은 따로 있고 흡수 버튼이 없다',
      (await page.locator('[data-api-report-item]').count()) >= 1
    )

    await click('[data-api-absorb-pick="observed"]')
    await click('button[data-api-absorb-preview]')
    await page.waitForSelector('[data-api-absorb-preview-panel]', { timeout: 5_000 })
    check('미리보기가 뜬다', (await page.locator('[data-api-absorb-preview-panel]').count()) === 1)
    check(
      '흡수는 더하기만 하므로 깨지는 변경이 0이다',
      (await page.locator('[data-api-absorb-breaking="0"]').count()) === 1
    )

    {
      const before = await page.evaluate(async () => {
        const s = await window.rockury.apiSpecs.get('e2e-billing')
        return s.requests.find((r) => r.name === 'observed').responses[0].fields.map((f) => f.name)
      })
      check('수락 전에는 Draft 가 안 바뀐다', !before.includes('newField'))
    }

    await click('button[data-api-absorb-accept]')
    await page.waitForTimeout(1_000)
    {
      const after = await page.evaluate(async () => {
        const s = await window.rockury.apiSpecs.get('e2e-billing')
        return s.requests.find((r) => r.name === 'observed').responses[0].fields.map((f) => f.name)
      })
      check('수락하면 Draft 에 반영된다', after.includes('newField'))
      check('기존 선언은 그대로 남는다(더하기만)', after.includes('gone') && after.includes('maybe'))
    }
    {
      const versions = await page.evaluate(() => window.rockury.apiSpecs.listVersions('e2e-billing'))
      check('흡수가 버전을 만들지 않는다 (컷은 사람이 따로)', versions.every((v) => v.number !== 'v0.2.0'))
    }

    // ── 이력: 판정과 흡수가 한 타임라인에 ──
    await click('[data-nav-view="logs"]')
    await page.waitForTimeout(400)
    {
      const kinds = await page.$$eval('[data-api-log-kind]', (els) =>
        els.map((e) => e.getAttribute('data-api-log-kind'))
      )
      check('판정과 흡수가 같은 이력에 남는다', kinds.includes('drift') && kinds.includes('accept'))
    }

    // ── GraphQL 완전 판정 ──
    {
      const graded = await page.evaluate(
        async ({ baseUrl }) => {
          const spec = await window.rockury.apiSpecs.create({ name: 'e2e-gql', kind: 'graphql' })
          await window.rockury.apiSpecs.patch(spec.id, [
            { op: 'add_request', name: 'getUser' },
            {
              op: 'set_request_fields',
              request: 'getUser',
              fields: { path: '/graphql', graphqlQuery: '{ user { id } }' }
            },
            {
              op: 'set_response_schema',
              request: 'getUser',
              status: '200',
              fields: [{ name: 'id', type: 'string', requiredness: 'required' }]
            }
          ])
          const env = await window.rockury.apiOps.saveEnvironment({
            specId: spec.id,
            name: 'GQL',
            baseUrl,
            production: false,
            values: []
          })
          const d = await window.rockury.apiContract.runDrift(spec.id, env.id)
          return { specId: spec.id, envId: env.id, drift: d }
        },
        { baseUrl }
      )
      check('GraphQL 은 완전 판정 등급이다', graded.drift.grade === 'complete')
      check('완전 판정은 커버리지가 전량이다', graded.drift.coverage.observed === graded.drift.coverage.total)
      check(
        '서버 스키마에만 있는 필드를 잡는다(nickname)',
        graded.drift.findings.some((f) => f.kind === 'server-only' && f.path.includes('nickname'))
      )
      check(
        '서버가 표준으로 말해 준 스키마라 "모름" 제외가 없다',
        graded.drift.skippedUnknown === 0
      )

      // introspection 을 끄면 관측 판정으로 내려가지 않고 사유를 단다
      off()
      const blocked = await page.evaluate(
        ({ specId, envId }) => window.rockury.apiContract.runDrift(specId, envId),
        { specId: graded.specId, envId: graded.envId }
      )
      check('introspection 이 꺼지면 판정 불가로 표시된다', blocked.unavailable?.reason === 'feature-off')
      check('관측 판정으로 조용히 내려가지 않는다', blocked.grade === 'complete' && blocked.findings.length === 0)
    }
  } finally {
    server.close()
  }
}
