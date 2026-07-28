// 스모크 스위트 — API 가져오기·내보내기 — OpenAPI/proto/GraphQL · 덮지 않음 · 미해석 보고 · 값 미포함
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '16-api-transfer',
  needsDb: false,
  desc: 'API 가져오기·내보내기 — 세 형식 · 덮지 않음 · 미해석 보고 · 내보낸 파일에 값 없음'
}

const OPENAPI = `openapi: 3.0.3
info:
  title: E2E Imported
  version: "1.0"
paths:
  /users/{id}:
    get:
      operationId: importedGetUser
      summary: 가져온 요청
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [id]
                properties:
                  id:
                    type: string
                  memo:
                    type: string
                    nullable: true
  /legacy:
    get:
      operationId: legacyThing
      parameters:
        - name: sid
          in: cookie
          schema:
            type: string
      responses:
        '200':
          description: OK`

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page

  await click('[data-nav-service="api"]')
  await page.waitForTimeout(300)
  await click('[data-nav-module="studio"]')
  await page.waitForTimeout(300)

  // ── 가져오기 모달 열기 (Studio 사이드바의 눈에 보이는 버튼) ──
  await click('button[data-api-open-transfer]')
  await page.waitForSelector('textarea[data-api-import-source]', { timeout: 5_000 })
  check('가져오기·내보내기 모달이 열린다', (await page.locator('[data-api-import-kind="openapi"]').count()) === 1)

  // ── OpenAPI 미리보기: 추가 목록 + 미해석 보고 ──
  await page.locator('textarea[data-api-import-source]').fill(OPENAPI)
  await click('button[data-api-import-preview]')
  await page.waitForSelector('[data-api-import-preview-panel]', { timeout: 5_000 })
  {
    const panel = await page.locator('[data-api-import-preview-panel]').innerText()
    check('추가될 요청을 미리 보인다', panel.includes('importedGetUser') && panel.includes('legacyThing'))
    check(
      '못 옮긴 것을 버리지 않고 보고한다 (cookie 파라미터)',
      (await page.locator('[data-api-import-unsupported]').innerText()).includes('cookie')
    )
  }

  // ── 미리보기만으로는 아무것도 안 바뀐다 ──
  {
    const before = await page.evaluate(() => window.rockury.apiSpecs.list())
    check('미리보기는 명세를 만들지 않는다', !before.some((s) => s.name === 'E2E Imported'))
  }

  // ── 가져오기 실행 → 새 명세가 생기고 자동으로 골라진다 ──
  await click('button[data-api-import-run]')
  await page.waitForTimeout(1_200)
  {
    const spec = await page.evaluate(async () => {
      const list = await window.rockury.apiSpecs.list()
      const found = list.find((s) => s.name === 'E2E Imported')
      return found ? window.rockury.apiSpecs.get(found.id) : null
    })
    check('새 명세가 만들어진다', spec !== null && spec.kind === 'rest')
    check('요청이 두 개 들어온다', spec.requests.map((r) => r.name).sort().join(',') === 'importedGetUser,legacyThing')

    const got = spec.requests.find((r) => r.name === 'importedGetUser')
    check('메서드·경로가 옮겨진다', got.request.method === 'GET' && got.request.path === '/users/{id}')
    check('경로 파라미터가 필수로 옮겨진다', got.params[0].name === 'id' && got.params[0].required === true)
    check('summary 가 사람 문서로 옮겨진다', got.docs.includes('가져온 요청'))
    check(
      'required·nullable 이 필수여부로 정확히 옮겨진다',
      got.responses[0].fields.find((f) => f.name === 'id').requiredness === 'required' &&
        got.responses[0].fields.find((f) => f.name === 'memo').requiredness === 'nullable'
    )
  }
  check('가져온 명세가 화면에 열린다', (await body()).includes('importedGetUser'))

  // ── 같은 문서를 다시, 이번엔 기존 명세에 합치기 → 덮지 않는다 ──
  {
    const result = await page.evaluate(async (src) => {
      const list = await window.rockury.apiSpecs.list()
      const target = list.find((s) => s.name === 'E2E Imported')
      // 사람이 손본 흔적을 남겨 둔다 — 가져오기가 이걸 덮으면 안 된다.
      await window.rockury.apiSpecs.patch(target.id, [
        { op: 'set_docs', request: 'importedGetUser', docs: '사람이 쓴 메모' }
      ])
      const preview = await window.rockury.apiTransfer.preview('openapi', src, target.id)
      const run = await window.rockury.apiTransfer.run('openapi', src, target.id)
      const after = await window.rockury.apiSpecs.get(target.id)
      return { preview, run, docs: after.requests.find((r) => r.name === 'importedGetUser').docs, count: after.requests.length }
    }, OPENAPI)

    check('합칠 때 이름 충돌을 미리 알린다', result.preview.conflicts.length === 2)
    check('겹치는 이름은 추가하지 않는다', result.run.added === 0)
    check('사람이 손본 정의를 덮지 않는다', result.docs === '사람이 쓴 메모')
    check('요청이 중복으로 늘지 않는다', result.count === 2)
  }

  // ── proto·GraphQL 가져오기 ──
  {
    const out = await page.evaluate(async () => {
      const proto = `syntax = "proto3";
package e2e.grpc;
service Echo {
  rpc Say (SayRequest) returns (SayReply);
  rpc Watch (SayRequest) returns (stream SayReply);
}
message SayRequest { string text = 1; }
message SayReply { string text = 1; int32 n = 2; }`
      const sdl = `type Query { ping(n: Int!): Pong }
type Pong { at: String! }`
      const p = await window.rockury.apiTransfer.run('proto', proto)
      const g = await window.rockury.apiTransfer.run('graphql', sdl)
      return {
        proto: await window.rockury.apiSpecs.get(p.specId),
        gql: await window.rockury.apiSpecs.get(g.specId)
      }
    })
    check('proto 를 gRPC 명세로 가져온다', out.proto.kind === 'grpc' && out.proto.requests.length === 2)
    check(
      '스트리밍 종류가 proto 정의에서 자동으로 정해진다',
      out.proto.requests.find((r) => r.name === 'Echo.Watch').shape === 'server-stream'
    )
    check('SDL 을 GraphQL 명세로 가져온다', out.gql.kind === 'graphql' && out.gql.requests[0].name === 'ping')
    check(
      'SDL 의 ! 가 필수여부로 옮겨진다',
      out.gql.requests[0].params[0].required === true &&
        out.gql.requests[0].responses[0].fields[0].requiredness === 'required'
    )
  }

  // ── 읽을 수 없는 문서는 조용히 넘어가지 않는다 ──
  {
    const err = await page.evaluate(async () => {
      try {
        await window.rockury.apiTransfer.preview('openapi', 'swagger: "2.0"\ninfo: {title: X}')
        return null
      } catch (e) {
        return String(e.message ?? e)
      }
    })
    check('Swagger 2.0 은 아직이라고 분명히 말한다', !!err && err.includes('Swagger 2.0'))
  }

  // ── 내보내기: 값이 안 실린다 ──
  {
    const out = await page.evaluate(async () => {
      const list = await window.rockury.apiSpecs.list()
      const billing = list.find((s) => s.id === 'e2e-billing')
      return window.rockury.apiTransfer.export(billing.id, 'openapi')
    })
    check('OpenAPI 로 내보내진다', out.content.includes('"openapi": "3.0.3"'))
    check('내보낸 파일에 환경 값 실값이 없다', !out.content.includes('REAL-SECRET'))
    check('헤더는 이름만 나가고 값 템플릿은 안 나간다', !out.content.includes('{{apiKey}}'))
    check('파일 이름이 형식에 맞는다', out.filename === 'e2e-billing.openapi.json')
  }

  // ── 종류가 안 맞는 형식은 거부한다 ──
  {
    const err = await page.evaluate(async () => {
      const list = await window.rockury.apiSpecs.list()
      const billing = list.find((s) => s.id === 'e2e-billing')
      try {
        await window.rockury.apiTransfer.export(billing.id, 'proto')
        return null
      } catch (e) {
        return String(e.message ?? e)
      }
    })
    check('REST 명세를 proto 로 내보내려 하면 거부하고 가능한 형식을 알린다', !!err && err.includes('openapi'))
  }
}
