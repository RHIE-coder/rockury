// 스모크 스위트 — Migration › Drift/Seed — 기준선·운영→설계 가져오기·시드 반영/되먹임
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '10-migration',
  needsDb: true,
  desc: 'Migration › Drift/Seed — 기준선·운영→설계 가져오기·시드 반영/되먹임'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page
  // Migration › Drift — 기준선 캡처 → 드리프트 없음(Phase 3a/3b · diff② 재사용)
  await click('button:has-text("Migration")')
  await click('button:has-text("Drift")')
  await page.waitForSelector('text=기준선이 없습니다', { timeout: 15_000 })
  await click('button:has-text("기준선으로 캡처")')
  await page.waitForSelector('text=드리프트 없음', { timeout: 15_000 })
  check('Migration › Drift: 기준선 캡처 후 드리프트 없음', (await body()).includes('드리프트 없음'))

  // ⭐ 운영→설계: 실 DB 를 설계 새 버전으로 가져오기(version-up) — 드리프트 뷰 진입점(운영→설계 관문).
  const countVersions = () => page.evaluate(async () => {
    const ds = await window.rockury.designs.list()
    let n = 0
    for (const d of ds) n += (await window.rockury.versions.list(d.id)).length
    return n
  })
  const vBefore = await countVersions()
  await click('button:has-text("설계로 가져오기")')
  await page.waitForSelector('text=실 DB 에서', { timeout: 15_000 })
  check('운영→설계: 가져오기 다이얼로그 역설계 미리보기', (await body()).includes('실 DB 에서'))
  await click('button:has-text("새 버전으로 가져오기")')
  await page.waitForTimeout(1500)
  check('운영→설계: 운영 DB 가져와 설계 새 버전 컷', (await countVersions()) === vBefore + 1)

  // ⭐ 운영→설계(새 설계 부트스트랩): 대상 토글 "새 설계로" → 설계+Draft+버전 생성 + 활성 전환.
  //    (사용자 회귀: 설계가 이미 선택돼 있으면 "새 설계로" 갈 길이 없어 늘 버전업으로 샜다.)
  await click('button:has-text("설계로 가져오기")')
  await page.waitForSelector('text=실 DB 에서', { timeout: 15_000 })
  await click('button:has-text("새 설계 만들기")')
  await page.waitForTimeout(200)
  await page.locator('input[placeholder="예: commerce-core"]').fill('e2e-imported')
  await click('button:has-text("설계 만들고 가져오기")')
  await page.waitForTimeout(1800)
  const nd = await page.evaluate(async () => {
    const d = (await window.rockury.designs.list()).find((x) => x.name === 'e2e-imported')
    if (!d) return { ok: false, tables: 0, versions: 0 }
    const tables = (await window.rockury.tables.list()).filter((t) => t.designId === d.id).length
    const versions = (await window.rockury.versions.list(d.id)).length
    return { ok: true, tables, versions }
  })
  check('운영→설계: 새 설계 부트스트랩(설계 생성)', nd.ok)
  check('운영→설계: 새 설계 Draft 채워짐(Design 에서 보임)', nd.tables > 0)
  check('운영→설계: 새 설계 첫 버전 컷', nd.versions === 1)
  check('운영→설계: 새 설계가 활성으로 전환됨(드롭다운·헤더 반영)', (await body()).includes('e2e-imported'))

  // ⭐⭐ 시드 반영(설계→운영) + 되먹임(운영→설계) — 실 MySQL 에 트랜잭션 게이트로 쓴다.
  //    대상은 방금 역설계로 들여온 설계(e2e-imported)라 컬럼이 실 DB 와 정확히 맞는다.
  //    CASE-design-090~094 (docs/qa/db-design.md). 끝에서 심은 행을 지워 DB 를 원상복구한다.
  {
    const ROLE = 'e2e-seed-role'
    // 검증·정리용 직접 조회는 이 연결로 한다(화면은 활성 연결을 쓰고, 둘은 같은 테스트 DB 다).
    const connId = await page.evaluate(
      async () => (await window.rockury.connections.list()).find((c) => c.name === 'E2E-mysql')?.id
    )
    const countRole = async (name) =>
      Number(
        (
          await page.evaluate(
            async ([cid, n]) =>
              window.rockury.query.runParams(cid, 'SELECT COUNT(*) AS c FROM roles WHERE name = ?', [n]),
            [connId, name]
          )
        ).rows[0].c
      )

    // ── 설계에 시드 세트 저작 ──
    await click('button:has-text("Design")')
    await click('button:has-text("Seed")')
    await page.waitForTimeout(500)
    await click('button:has-text("테이블에서 시드 세트 만들기")')
    await page.waitForSelector('[data-seed-candidate="roles"]', { timeout: 8_000 })
    await click('[data-seed-candidate="roles"]')
    await page.waitForSelector('[data-seed-set-row="roles"]', { timeout: 8_000 })

    const cycleTo2 = async (column, role) => {
      for (let i = 0; i < 4; i++) {
        if ((await page.locator(`[data-seed-role-toggle="${column}"][data-seed-col-role="${role}"]`).count()) === 1) return
        await click(`[data-seed-role-toggle="${column}"]`)
        await page.waitForTimeout(150)
      }
    }
    await cycleTo2('name', 'key')
    check('시드 반영: 짝짓기 기준(name) 지정', (await page.locator('[data-seed-needs-key]').count()) === 0)
    check(
      '시드 반영: UNIQUE 뒷받침되는 기준이라 안내 없음',
      (await page.locator('[data-seed-key-unbacked]').count()) === 0
    )
    // created_at/updated_at 은 DB 기본값이 있어 필수가 아니다 → 값 없이도 반영된다.
    const fill2 = async (rowIdx, column, value) => {
      await page.locator('[data-seed-row]').nth(rowIdx).locator(`[data-seed-cell="${column}"]`).click()
      await page.waitForTimeout(150)
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type(value)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)
    }
    await click('button:has-text("행 추가")')
    await page.waitForSelector('[data-seed-row]', { timeout: 5_000 })
    await fill2(0, 'name', ROLE)
    await fill2(0, 'description', '시드 반영 테스트')
    await page.waitForTimeout(600) // 설계 스코프 저장 디바운스

    // 규칙 목록의 타입 필터링을 **반대쪽**에서도 확인 — roles.id 는 char(36) 이라 {uuid} 가 나와야
    // 한다(orders 의 BIGINT 에서는 안 나왔다). 고르면 미리보기가 실제 UUID 를 보인다.
    {
      await click('[data-seed-pk-strategy="seed"]')
      await page.waitForSelector('[data-seed-pk-rule]', { timeout: 5_000 })
      await click('[data-seed-pk-rule]')
      await page.waitForSelector('[data-seed-pk-rule-option]', { timeout: 5_000 })
      check(
        '시드 반영: char(36) PK 는 {uuid} 를 고를 수 있다',
        (await page.locator('[data-seed-pk-rule-option="{uuid}"]').count()) === 1
      )
      await click('[data-seed-pk-rule-option="{uuid}"]')
      await page.waitForTimeout(300)
      const previewed = await page.locator('[data-seed-pk-preview]').first().getAttribute('data-seed-pk-preview')
      check(
        '시드 반영: {uuid} 미리보기가 UUID 모양이고 타입 경고 없음',
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(previewed ?? '') &&
          (await page.locator('[data-seed-pk-type-issue]').count()) === 0
      )
      // 원복 — 이 흐름의 반영·되먹임 검증은 DB 가 PK 를 만드는 것을 전제로 한다.
      await click('[data-seed-pk-strategy="db"]')
      await page.waitForTimeout(400)
    }

    // ── Migration › Seed: 계획 → 적용 → 커밋 ──
    await click('button:has-text("Migration")')
    await click('[data-nav-view="seed"]')
    await page.waitForSelector('text=시드 반영', { timeout: 8_000 })
    await click('button:has-text("계획 만들기")')
    await page.waitForSelector('[data-seed-step]', { timeout: 15_000 })
    check('시드 반영: 계획에 넣기 문장 1개', (await page.locator('[data-seed-step="insert"]').count()) === 1)
    check('시드 반영: 막는 것 없음', (await page.locator('[data-seed-blockers]').count()) === 0)

    await click('button:has-text("적용")')
    await page.waitForSelector('[data-seed-tx-gate]', { timeout: 15_000 })
    check('시드 반영: 트랜잭션 게이트(커밋 대기)', (await body()).includes('아직 커밋되지'))
    check('시드 반영: 커밋 전에는 실 DB 에 없다', (await countRole(ROLE)) === 0)

    await click('button:has-text("커밋")')
    await page.waitForTimeout(1200)
    check('시드 반영: 커밋 후 실 DB 에 심어짐', (await countRole(ROLE)) === 1)
    check('시드 반영: 재계획 시 할 일 없음(멱등)', (await body()).includes('할 일이 없습니다'))

    // ── 되먹임: 실 DB 에서 값을 바꾼 뒤 가져오기 → 채택 → 설계 반영 ──
    await page.evaluate(
      async ([cid, n]) =>
        window.rockury.query.runParams(cid, 'UPDATE roles SET description = ? WHERE name = ?', ['운영에서 고친 설명', n]),
      [connId, ROLE]
    )
    await click('[data-seed-ops-tab="import"]')
    await click('button:has-text("실 DB 읽기")')
    await page.waitForSelector('[data-seed-import-row]', { timeout: 15_000 })
    check(
      '시드 되먹임: 값이 다른 행을 후보로 잡는다',
      (await page.locator('[data-seed-import-row="changed"]').count()) >= 1
    )
    await page.locator('[data-seed-import-row="changed"] button[role="checkbox"]').first().click()
    await click('[data-seed-import-accept]')
    await page.waitForTimeout(800)
    const seededDesc = await page.evaluate(async () => {
      const list = await window.rockury.seedSets.list()
      const s = list.find((x) => x.tableName === 'roles')
      return s?.rows?.[0]?.values?.description ?? null
    })
    check('시드 되먹임: 채택한 값이 설계 시드에 담김', seededDesc === '운영에서 고친 설명')

    // ── DB 원상복구(심은 행 제거) ──
    await page.evaluate(
      async ([cid, n]) => window.rockury.query.runParams(cid, 'DELETE FROM roles WHERE name = ?', [n]),
      [connId, ROLE]
    )
    check('시드 반영: 정리 후 실 DB 원복', (await countRole(ROLE)) === 0)
  }

}
