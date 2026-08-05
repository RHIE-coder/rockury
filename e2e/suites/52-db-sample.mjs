// 스모크 스위트 — 샘플 DB — 준비물 없이 만들기 · 두 번 눌러도 안 늘어남 · 다시 만들기
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '52-db-sample',
  // 도커를 안 쓴다 — 이 스위트가 test-db 없이 통과한다는 것 자체가 이 기능의 약속이다.
  needsDb: false,
  desc: '샘플 DB — 도커 없이 만들기·중복 방지·다시 만들기(파일만 교체)'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page

  await click('[data-nav-module="remote"]')
  await click('[data-nav-view="connections"]')
  await page.waitForTimeout(300)

  // ── CASE-conn-055 빈 상태에서 만들기 → 카드가 생기고 활성으로 골라진다 ──
  await click('button:has-text("샘플 DB 만들기")')
  await page.waitForSelector('text=샘플 DB', { timeout: 15_000 })
  const afterCreate = await body()
  check('샘플 DB: 카드 생성(도커 없이)', afterCreate.includes('샘플 DB'))
  check('샘플 DB: 활성 연결로 선택됨', (await page.locator('[data-conn-id]:has-text("샘플 DB") :text("활성")').count()) > 0)

  // ── CASE-conn-056 접속이 생겼으니 툴바 라벨이 '다시 만들기' 로 바뀐다 ──
  await page.waitForSelector('button:has-text("샘플 DB 다시 만들기")', { timeout: 5_000 })
  check('샘플 DB: 라벨이 상태를 말한다(다시 만들기)', (await body()).includes('샘플 DB 다시 만들기'))

  const cardCount = async () => page.locator('[data-conn-id]').count()
  const before = await cardCount()

  // ── CASE-conn-057 Remote 에 표 23 + 뷰 2 = 25행이 보인다 ──
  {
    await click('[data-nav-view="definition"]')
    await page.waitForTimeout(1_500)
    const rows = await page.locator('[data-table-row]').count()
    check(`샘플 DB: Remote 에 표 23 + 뷰 2 = 25행 (실측 ${rows})`, rows === 25)
    check('샘플 DB: 뷰도 읽힌다', (await page.locator('[data-table-row="v_user_summary"]').count()) === 1)
    await click('[data-nav-view="connections"]')
    await page.waitForTimeout(300)
  }

  // ── CASE-conn-058 다시 만들기 확인 — 경로와 "사라진다"는 사실을 보이고, 취소는 아무것도 안 바꾼다 ──
  await click('button:has-text("샘플 DB 다시 만들기")')
  await page.waitForSelector('text=이 파일에 넣은 데이터는 사라집니다', { timeout: 5_000 })
  const confirmText = await body()
  check('샘플 DB: 확인 문구가 무엇이 지워지는지 말한다', confirmText.includes('이 파일에 넣은 데이터는 사라집니다'))
  check('샘플 DB: 확인 문구에 파일 경로가 보인다', confirmText.includes('sample.sqlite'))
  await click('button:has-text("취소")')
  await page.waitForTimeout(200)
  check('샘플 DB: 취소하면 카드가 그대로', (await cardCount()) === before)

  // ── CASE-conn-059 확인하면 파일만 새로 — 카드는 그 자리 그대로(개수 불변) ──
  await click('button:has-text("샘플 DB 다시 만들기")')
  await page.waitForSelector('button:has-text("다시 만들기"):not(:has-text("샘플"))', { timeout: 5_000 })
  await page.locator('button:has-text("다시 만들기"):not(:has-text("샘플"))').first().click()
  await page.waitForSelector('text=샘플 파일 다시 만듦', { timeout: 15_000 })
  check('샘플 DB: 다시 만든 뒤에도 카드 수 불변(접속 보존)', (await cardCount()) === before)

  // ── CASE-conn-060 파일이 통째로 바뀌었으니 확인 상태는 '미확인' 으로 되돌아간다 ──
  check(
    '샘플 DB: 다시 만든 뒤 상태 미확인',
    (await page.locator('[data-conn-id]:has-text("샘플 DB") :text("미확인")').count()) > 0
  )
}
