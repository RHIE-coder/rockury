// 스모크 스위트 — API Versions — 컷·불변 스냅샷·잠금·깨지는 변경 승인 게이트·Diff 비대칭
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 13~16 이 만든 명세를 이어 쓴다(파일 이름 번호 = 상태 의존 순서).

export const meta = {
  name: '34-api-versions',
  needsDb: false,
  desc: 'API Versions — 컷·불변 스냅샷·관측 잠금·깨지는 변경 승인 게이트·Diff 비대칭'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page

  // ── 깨끗한 명세 하나를 만들어 버전 이야기를 처음부터 본다 ──
  await click('[data-nav-service="api"]')
  await page.waitForTimeout(300)
  const specId = await page.evaluate(async () => {
    const spec = await window.rockury.apiSpecs.create({ name: 'e2e-versions', kind: 'rest' })
    await window.rockury.apiSpecs.patch(spec.id, [
      { op: 'add_request', name: 'getThing' },
      { op: 'add_param', request: 'getThing', param: { name: 'id', type: 'string', required: true } },
      { op: 'set_request_fields', request: 'getThing', fields: { method: 'GET', path: '/thing/{{id}}' } },
      {
        op: 'set_response_schema',
        request: 'getThing',
        status: '200',
        fields: [
          { name: 'id', type: 'string', requiredness: 'required' },
          { name: 'label', type: 'string', requiredness: 'required' }
        ]
      }
    ])
    return spec.id
  })
  await page.evaluate((id) => window.rockury.apiSpecs.get(id), specId)

  // 컨텍스트 바를 이 명세로 옮긴다(화면이 따라오도록 모듈 재진입).
  // 대상 선택은 탭에 딸린다 — 저장소에 써 놓고 새로고침하는 옛 길은 안 먹는다(하네스 주석).
  // 세운 **뒤에** 새로 그린다: 명세를 화면 밖(IPC)에서 만들어 이 창의 목록이 아직 낡았기 때문이다.
  // 대상은 메인이 들고 있어 새로고침을 견딘다.
  await page.evaluate((id) => window.__rockuryNav.setContextValue('spec', id), specId)
  await page.reload()
  await page.waitForTimeout(1_200)
  await click('[data-nav-service="api"]')
  await page.waitForTimeout(400)

  // ── 버전 없는 상태 ──
  await click('[data-nav-module="versions"]')
  await page.waitForTimeout(500)
  check('컷 전에는 빈 상태 안내가 뜬다', (await page.locator('[data-api-empty="no-version"]').count()) === 1)
  check('Draft 기준으로 남는다는 사실을 말해 준다', (await body()).includes('Draft'))

  // ── 첫 컷: 기준이 없으니 승인 게이트가 없다 ──
  await click('button[data-api-open-cut]')
  await page.waitForSelector('input[data-api-cut-number]', { timeout: 5_000 })
  {
    const suggested = await page.locator('input[data-api-cut-number]').inputValue()
    check('첫 버전 번호를 제안한다', suggested === 'v0.1.0')
    check('비교 기준이 없으면 영향 요약이 없다', (await page.locator('[data-api-cut-impact]').count()) === 0)
  }
  await click('button[data-api-cut-submit]')
  await page.waitForSelector('[data-api-version="v0.1.0"]', { timeout: 5_000 })
  check('버전이 타임라인에 뜬다', (await page.locator('[data-api-version="v0.1.0"]').count()) === 1)
  check('아직 관측이 없으니 잠기지 않았다', (await page.locator('[data-api-version-locked]').count()) === 0)

  // ── 스냅샷 불변: Draft 를 고쳐도 컷한 것은 안 흔들린다 ──
  await page.evaluate((id) =>
    window.rockury.apiSpecs.patch(id, [
      // 응답 필드를 지운다 = 응답 쪽 깨지는 변경
      {
        op: 'set_response_schema',
        request: 'getThing',
        status: '200',
        fields: [{ name: 'id', type: 'string', requiredness: 'required' }]
      },
      // 선택 파라미터 추가 = 안전한 변경
      { op: 'add_param', request: 'getThing', param: { name: 'page', type: 'number', required: false } }
    ]), specId)
  {
    const snap = await page.evaluate(async (id) => {
      const versions = await window.rockury.apiSpecs.listVersions(id)
      const draft = await window.rockury.apiSpecs.get(id)
      return {
        cut: versions[0].snapshot.requests[0].responses[0].fields.map((f) => f.name),
        draft: draft.requests[0].responses[0].fields.map((f) => f.name)
      }
    }, specId)
    check('컷한 스냅샷은 Draft 변경에 안 흔들린다', snap.cut.join(',') === 'id,label')
    check('Draft 는 바뀌어 있다', snap.draft.join(',') === 'id')
  }

  // ── Diff: 비대칭이 화면에 보인다 ──
  await click('[data-nav-view="diff"]')
  await page.waitForTimeout(600)
  check('비대칭 안내가 화면에 있다', (await body()).includes('덜 주면'))
  check('깨지는 변경 건수가 배지로 보인다', (await page.locator('[data-api-diff-breaking="1"]').count()) === 1)
  {
    const kinds = await page.$$eval('[data-api-change]', (els) => els.map((e) => e.getAttribute('data-api-change')))
    check('깨짐과 안전이 함께 보인다', kinds.includes('breaking') && kinds.includes('safe'))
  }
  check(
    '응답 필드 제거가 깨짐으로 잡힌다',
    (await page.locator('[data-api-change="breaking"]').innerText()).includes('label')
  )

  // ── 두 번째 컷: 깨지는 변경이 있으니 승인 게이트를 지난다 ──
  await click('[data-nav-view="timeline"]')
  await page.waitForTimeout(400)
  await click('button[data-api-open-cut]')
  await page.waitForSelector('[data-api-cut-impact="1"]', { timeout: 5_000 })
  check('컷 직전에 깨지는 변경을 보인다', (await page.locator('[data-api-breaking-item]').count()) === 1)
  check('승인 전에는 컷 버튼이 막혀 있다', await page.locator('button[data-api-cut-submit]').isDisabled())
  await click('input[data-api-cut-approve]')
  check('승인하면 컷할 수 있다', !(await page.locator('button[data-api-cut-submit]').isDisabled()))
  {
    const suggested = await page.locator('input[data-api-cut-number]').inputValue()
    check('다음 번호를 제안한다', suggested === 'v0.1.1')
  }
  await click('button[data-api-cut-submit]')
  await page.waitForSelector('[data-api-version="v0.1.1"]', { timeout: 5_000 })
  check('두 번째 버전이 생긴다', (await page.locator('[data-api-version]').count()) === 2)

  // ── 같은 번호는 다시 못 쓴다 ──
  {
    const err = await page.evaluate(async (id) => {
      try {
        await window.rockury.apiSpecs.createVersion(id, 'v0.1.1', '중복')
        return null
      } catch (e) {
        return String(e.message ?? e)
      }
    }, specId)
    check('같은 번호를 다시 쓰면 거부한다', !!err && err.includes('이미 있습니다'))
  }

  // ── 관측이 붙으면 그 버전이 잠긴다 ──
  {
    const locked = await page.evaluate(async (id) => {
      const env = await window.rockury.apiOps.saveEnvironment({
        specId: id,
        name: 'V-ENV',
        baseUrl: 'http://127.0.0.1:1',
        production: false,
        values: []
      })
      // 못 붙어도 실행 기록은 남고, 기준 버전은 Draft 와 똑같은 v0.1.1 로 잡힌다.
      await window.rockury.apiOps.send({
        specId: id,
        requestName: 'getThing',
        environmentId: env.id,
        call: { id: 'x' }
      })
      const runs = await window.rockury.apiOps.listRuns(id)
      const versions = await window.rockury.apiSpecs.listVersions(id)
      return { baseVersion: runs[0].baseVersion, versions: versions.map((v) => [v.number, v.locked, v.runCount]) }
    }, specId)
    check('기준 버전이 Draft 와 똑같은 버전으로 잡힌다', locked.baseVersion === 'v0.1.1')
    check('관측이 붙은 버전만 잠긴다', JSON.stringify(locked.versions) === JSON.stringify([['v0.1.1', true, 1], ['v0.1.0', false, 0]]))
  }

  // 실행은 Runner 에서 일어나므로 사용자는 화면을 옮겼다 돌아온다 — 그때 갱신된다.
  await click('[data-nav-view="diff"]')
  await page.waitForTimeout(300)
  await click('[data-nav-view="timeline"]')
  await page.waitForTimeout(600)
  check('잠긴 버전이 화면에 표시된다', (await page.locator('[data-api-version-locked]').count()) === 1)

  // ── Draft 가 어느 버전과도 다르면 기준은 Draft(null) 다 ──
  {
    const base = await page.evaluate(async (id) => {
      await window.rockury.apiSpecs.patch(id, [{ op: 'add_request', name: 'afterCut' }])
      const envs = await window.rockury.apiOps.listEnvironments(id)
      await window.rockury.apiOps.send({
        specId: id,
        requestName: 'getThing',
        environmentId: envs[0].id,
        call: { id: 'y' }
      })
      return (await window.rockury.apiOps.listRuns(id))[0].baseVersion
    }, specId)
    check('컷 이후 고친 Draft 의 관측은 버전 것으로 둔갑하지 않는다', base === null)
  }
}
