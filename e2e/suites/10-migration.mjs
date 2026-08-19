// 스모크 스위트 — Migration › 진단/계획/Seed — 대조표·관문(없앨 것)·운영→설계 가져오기·시드 반영/되먹임
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '10-migration',
  needsDb: true,
  desc: 'Migration › 진단/계획/Seed — 대조표·관문(없앨 것)·가져오기·시드 반영/되먹임'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page

  /*
   * ⭐ 진단·계획 — 대조표 · 스키마 토글 · 타깃 버전 셀렉터 · 관문(2026-08-12).
   *
   * 여기 있던 것은 `Drift` 탭에서 기준선을 찍는 검사였는데, 그 탭은 진단에 흡수됐고 문구도
   * 사라져 **한동안 죽은 채로 남아 있었다**(없는 버튼을 누르고 있었다). 지금 화면에 맞춰 다시 쓴다.
   *
   * 이 블록은 **자기 설계를 만들어** 논다 — 앞 스위트가 쌓은 설계의 draft 를 실 DB 로 갈아치우면
   * 04 가 심은 시드가 칸째 사라지고 그 여파를 99 가 뒤집어쓴다(2026-08-07 실측).
   */
  {
    const connId = await page.evaluate(
      async () => (await window.rockury.connections.list()).find((c) => c.name === 'E2E-mysql')?.id
    )

    /*
     * 먼저 **활성 설계 그대로** 진단을 한 번 연다. 두 가지를 겸한다:
     *   ① 아직 맵핑 안 된 짝에는 진단이 맵핑 관문을 먼저 내민다는 확인
     *   ② 그 과정에서 (연결 × 설계) 결속이 세워진다 — 11 이 연결 카드에서 이 결속을 읽는다.
     * ②를 빠뜨리면 11 이 "설계 바인딩" 다이얼로그에서 commerce-core 를 못 찾아 통째로 죽는다
     * (2026-08-12 실측 — 이 블록이 곧바로 자기 설계로 갈아타면서 결속이 안 생겼다).
     */
    await page.evaluate(async () => {
      const d = (await window.rockury.designs.list()).find((x) => x.name === 'commerce-core')
      if (d) window.__rockuryNav.setContextValue('design', d.id)
    })
    await click('button:has-text("Migration")')
    await page.waitForTimeout(400)
    await click('[data-nav-view="diagnose"]')
    await page.waitForSelector('text=연결된 설계 아직 없음', { timeout: 30_000 })
    check('진단: 아직 맵핑 안 된 짝에는 맵핑 관문이 먼저 선다', (await body()).includes('연결된 설계 아직 없음'))

    /*
     * 스키마 토글은 스키마가 둘 이상일 때만 뜻이 있다(하나뿐이면 끌 것이 없어 안 그린다).
     * 이 연결의 기본 범위는 `testdb` 하나라, 이 블록 동안만 전 범위로 넓혔다가 끝에서 되돌린다 —
     * 뒤 스위트(11·51)가 같은 연결을 그대로 쓴다.
     */
    const allSchemas = await page.evaluate((c) => window.rockury.introspection.schemas(c), connId)
    await page.evaluate(([c, s]) => window.rockury.connections.update(c, { schemas: s }), [connId, allSchemas])

    const designId = await page.evaluate(async (cid) => {
      const d = await window.rockury.designs.create({ name: 'e2e-diag', dialect: 'mysql' })
      window.__rockuryNav.setContextValue('design', d.id)
      window.__rockuryNav.setContextValue('conn', cid)
      return d.id
    }, connId)
    // 화면 밖(IPC)에서 만든 설계라 이 창의 목록엔 아직 없다 — 한 번 새로 그려 저장소에서 다시 읽힌다.
    await page.reload()
    await page.waitForSelector('text=Design', { timeout: 15_000 })

    // 실 DB 를 v0.1.0 으로 들인다 — 이러면 설계와 실제가 같아진다.
    await click('button:has-text("Migration")')
    await page.waitForTimeout(400)
    // 되먹임의 문은 **진단 화면의 버튼**이다 — `가져오기` 탭은 2026-08-14 에 없어졌다
    // (창을 여는 버튼 하나만 담고 있었고, 갈래는 진단이 이미 판정해 둔다).
    await click('[data-nav-view="diagnose"]')
    await page.waitForSelector('button:has-text("실 DB 를 첫 버전으로 들이기")', { timeout: 30_000 })
    await click('button:has-text("실 DB 를 첫 버전으로 들이기")')
    await page.waitForSelector('button:has-text("새 버전으로 가져오기")', { timeout: 20_000 })
    await click('button:has-text("새 버전으로 가져오기")')
    await page.waitForTimeout(2_000)

    // 설계를 한 칸 앞세운다(테이블 하나 추가) → 계획이 만들어질 거리가 생긴다.
    await page.evaluate(async (d) => {
      const mine = (await window.rockury.tables.list()).filter((t) => t.designId === d)
      const seed = mine[0]
      const fresh = {
        ...seed,
        id: `${seed.id}__e2e_diag`,
        name: 'e2e_diag_table',
        constraints: [],
        columns: [seed.columns[0]]
      }
      const tables = [...mine, fresh]
      await window.rockury.tables.replaceForDesign(d, tables)
      await window.rockury.versions.create({ designId: d, number: 'v0.2.0', snapshot: { tables } })
    }, designId)
    await page.reload()
    await page.waitForSelector('text=Design', { timeout: 15_000 })

    // ── 진단: 본문이 대조표다 ──
    await click('button:has-text("Migration")')
    await page.waitForTimeout(400)
    await click('[data-nav-view="diagnose"]')
    await page.waitForSelector('[data-diff-scroll]', { timeout: 30_000 })
    check('진단: 본문이 대조표(Definition 과 같은 표)', (await page.locator('[data-diff-scroll]').count()) === 1)
    check('진단: 제목 옆에 설계 기준 눈금', (await body()).includes('설계와 다름'))
    // 상태 줄은 **설계와의 관계** 하나로 말한다(예전엔 `실제가 다름`·`설계가 앞섬` 으로 갈렸다).
    check('상태 줄: 설계 기준 낱말', (await body()).includes('설계와 다름') && !(await body()).includes('실제가 다름'))
    // 범위를 세 문장으로 설명하던 알림은 없앴다 — 같은 사실을 스키마 토글이 칩으로 보인다.
    check('진단: 범위 알림 글은 없앴다', !(await body()).includes('어느 스키마를 봤는지'))
    /*
     * 잘린 칸을 펴는 손잡이는 **칸 자신**이 든다 — 표 머리의 "전문 보기" 체크박스는 걷어냈다
     * (2026-08-12: "체크박스말고 좀 더 우아한 방법 없어?"). 손잡이는 넘치는 칸에만 붙으므로
     * 개수는 창 폭에 따라 0 일 수 있다 — 여기서는 **머리에 체크박스가 없음**만 못박는다.
     */
    check('진단: 표 머리에 "전문 보기" 체크박스가 없다', !(await body()).includes('전문 보기'))
    /*
     * 기본은 **다 보이기**다 — 예전엔 바뀐 테이블을 열면 "바뀐 줄만"이 켜져 있어 안 바뀐 줄이
     * 통째로 감춰졌고, 제약만 바뀐 표는 "바뀐 컬럼 없음" 한 줄로 비었다
     * (2026-08-12: "바뀐것만 보여주지말고 다 보여주라고").
     */
    const changedOnlyState = await page.evaluate(
      () => document.querySelector('[data-changed-only]')?.getAttribute('data-changed-only') ?? '없음'
    )
    check(`진단: "바뀐 줄만"은 꺼진 채로 시작한다 (${changedOnlyState})`, changedOnlyState === '0')
    // 체크박스가 아니라 **켜짐/꺼짐 토글 버튼**이다(2026-08-13 사용자).
    check(
      '진단: "바뀐 줄만"은 토글 버튼이다',
      (await page.locator('button[data-changed-only][aria-pressed]').count()) === 1
    )
    check('진단: 안 바뀐 줄이 감춰지지 않는다', !(await body()).includes('바뀐 컬럼 없음'))
    /*
     * 대조표는 남은 높이를 다 쓴다 — 560px 로 못 박혀 화면 아래 절반이 비어 있었다
     * (2026-08-12: "높이 다 차지하면 안되나?"). 바닥까지의 틈으로 잰다.
     */
    const bottomGap = await page.evaluate(() => {
      const r = document.querySelector('[data-diff-scroll]')?.getBoundingClientRect()
      return r ? Math.round(window.innerHeight - r.bottom) : -1
    })
    check(`진단: 대조표가 남은 높이를 채운다 (바닥까지 ${bottomGap}px)`, bottomGap >= 0 && bottomGap < 120)
    check(
      'Migration 탭: 도구(진단·비교·기록) + 방향별 묶음',
      (await page.evaluate(() => [...document.querySelectorAll('[data-nav-view]')].map((e) => e.innerText.trim()))).join(
        ','
      ) === '진단,비교,기록,계획,실행,Seed'
    )
    // 버튼 이름이 곧 방향이다 — 예전 이름("설계로 가져오기"·"계획 만들기")을 집던 검사는 낡았다.
    check('진단: 두 방향을 나란히 내민다', (await page.locator('button:has-text("실제 → 설계")').count()) >= 1 && (await page.locator('button:has-text("설계 → 실제")').count()) >= 1)

    // ── 스키마 토글: 켠 것만 표에 든다 ──
    const sidebarCount = async () => Number((await body()).match(/테이블 (\d+)개 · 바뀜/)?.[1] ?? -1)
    check(
      '진단: 스키마마다 토글이 선다(연결이 읽은 범위 그대로)',
      (await page.locator('[data-schema-toggle]').count()) === allSchemas.length && allSchemas.length > 1
    )
    const before = await sidebarCount()
    await click('[data-schema-toggle="testdb"]')
    await page.waitForTimeout(500)
    const after = await sidebarCount()
    check('진단: 스키마를 끄면 그 테이블이 목록에서 빠진다', after > 0 && after < before)
    check('진단: 끈 스키마는 표시가 남는다(되돌릴 수 있다)', (await page.locator('[data-schema-toggle="testdb"][data-schema-on="0"]').count()) === 1)
    await click('[data-schema-toggle="testdb"]')
    await page.waitForTimeout(400)
    check('진단: 다시 켜면 원래 수로 돌아온다', (await sidebarCount()) === before)

    // ── 진단 → 계획: 두 방향 중 "설계가 정답" 쪽 ──
    await click('button:has-text("설계 → 실제")')
    await page.waitForSelector('[data-diff-scroll]', { timeout: 30_000 })
    check('계획: 진단에서 넘어오면 계획이 그려진다', (await body()).includes('실행으로'))

    // ── 타깃 버전은 상태 줄에서 고른다(머리 셀렉터는 없어졌다) ──
    await click('button:has-text("v0.2.0")')
    await page.waitForTimeout(400)
    await click('[data-slot="select-item"]:has-text("v0.1.0")')
    await page.waitForTimeout(3_000)
    check('계획: 상태 줄에서 타깃 버전을 바꾼다 → 반영할 변경 없음', (await body()).includes('반영할 변경 없음'))
    await click('button:has-text("v0.1.0")')
    await page.waitForTimeout(400)
    await click('[data-slot="select-item"]:has-text("v0.2.0")')
    await page.waitForTimeout(3_000)

    /*
     * ── 관문: 계획이 **없앨 것**이 있으면 그리기 전에 진단으로 돌려보낸다 ──
     * 실 DB 는 안 건드린다 — 설계 쪽에서 테이블 하나를 뺀 버전을 컷하면 "설계에 없는데 DB 에
     * 있는 것"이 생긴다(= 밀면 사라질 것). 기준선은 2026-08-12 에 폐기했다.
     */
    await page.evaluate(async (d) => {
      const mine = (await window.rockury.tables.list()).filter((t) => t.designId === d)
      // 방금 만든 e2e_diag_table 과 실 DB 에서 온 표 하나를 뺀다 → 그 하나가 "없앨 것"이 된다.
      const dropped = mine.filter((t) => t.name !== 'e2e_diag_table')[0]
      const tables = mine.filter((t) => t.name !== 'e2e_diag_table' && t.id !== dropped.id)
      await window.rockury.versions.create({ designId: d, number: 'v0.3.0', snapshot: { tables } })
    }, designId)
    await page.reload()
    await page.waitForSelector('text=Design', { timeout: 15_000 })
    await click('button:has-text("Migration")')
    await page.waitForTimeout(400)
    await click('[data-nav-view="plan"]')
    await page.waitForTimeout(4_000)
    // 새 버전을 **직접 고른다** — 결속은 마지막에 고른 타깃(v0.2.0)을 기억한다.
    await click('button:has-text("v0.2.0")')
    await page.waitForTimeout(400)
    await click('[data-slot="select-item"]:has-text("v0.3.0")')
    await page.waitForSelector('text=없앱니다', { timeout: 30_000 })
    check('계획: 없앨 것이 있으면 계획을 안 그린다', (await page.locator('[data-diff-scroll]').count()) === 0)
    check('계획: 막힌 자리가 무엇이 사라지는지 이름으로 보인다', (await body()).includes('설계에 없는 것들입니다'))
    check('계획: 막힌 자리가 다음 걸음을 내민다(진단에서 확인)', (await page.locator('button:has-text("진단에서 확인")').count()) === 1)

    // 관문이 내민 길을 따라가면 계획이 열린다 — 막다른 길이 아니다.
    await click('button:has-text("진단에서 확인")')
    await page.waitForSelector('[data-diff-scroll]', { timeout: 30_000 })
    await click('button:has-text("설계 → 실제")')
    await page.waitForSelector('text=이 계획이 지웁니다', { timeout: 30_000 })
    check('계획: 진단을 거치면 관문을 통과한다', (await page.locator('[data-diff-scroll]').count()) === 1)

    // 승인은 **그때 본 그 목록**에 묶인다 — 없앨 것이 달라지면 다시 막힌다.
    await page.evaluate(async (d) => {
      const mine = (await window.rockury.tables.list()).filter((t) => t.designId === d)
      const tables = mine.slice(0, Math.max(1, mine.length - 3))
      await window.rockury.versions.create({ designId: d, number: 'v0.4.0', snapshot: { tables } })
    }, designId)
    await page.reload()
    await page.waitForSelector('text=Design', { timeout: 15_000 })
    await click('button:has-text("Migration")')
    await page.waitForTimeout(400)
    await click('[data-nav-view="plan"]')
    await page.waitForTimeout(4_000)
    await click('button:has-text("v0.3.0")')
    await page.waitForTimeout(400)
    await click('[data-slot="select-item"]:has-text("v0.4.0")')
    await page.waitForSelector('text=없앱니다', { timeout: 30_000 })
    check('계획: 승인 뒤 없앨 것이 달라지면 관문이 다시 닫힌다', (await page.locator('[data-diff-scroll]').count()) === 0)

    // 범위 원복 — 뒤 스위트가 이 연결을 기본 범위(testdb 하나)로 기대한다.
    await page.evaluate((c) => window.rockury.connections.update(c, { schemas: [] }), connId)
  }

  // ⭐ 운영→설계: 실 DB 를 설계 새 버전으로 가져오기(version-up) — 되먹임의 문.
  const countVersions = () => page.evaluate(async () => {
    const ds = await window.rockury.designs.list()
    let n = 0
    for (const d of ds) n += (await window.rockury.versions.list(d.id)).length
    return n
  })
  // version-up 대상은 **이 스위트가 만든 설계**다. 활성 설계를 그대로 쓰면 03·04 가 쌓아 둔
  // commerce-core 의 draft 가 실 DB 스키마로 갈아치워진다 — 실 `orders` 에는 `order_number` 가
  // 없어서, 04 가 시드에 넣은 값이 **칸째 사라져** 화면에서 지워진 것처럼 보였다(저장소에는 그대로).
  // 그 여파를 99(콜드 재시작 후 시드 잔존)가 뒤집어썼다(2026-08-07 실측).
  await page.evaluate(async () => {
    const d = await window.rockury.designs.create({
      name: 'e2e-versionup',
      dialect: 'mysql',
      description: '운영→설계 version-up 대상(이 스위트 전용)'
    })
    window.__rockuryNav.setContextValue('design', d.id)
  })
  // 화면 밖(IPC)에서 만든 설계라 이 창의 목록엔 아직 없다 — 한 번 새로 그려 저장소에서
  // 다시 읽힌다. 안 그러면 `useActiveDesign()` 이 null 이라 가져오기 창이 "새 설계" 모드로 열린다.
  await page.reload()
  await page.waitForSelector('text=Design', { timeout: 15_000 })
  await click('button:has-text("Migration")')
  await page.waitForTimeout(500)

  const vBefore = await countVersions()
  // 되먹임의 문은 **진단 화면의 버튼**이다 — 자리 이력: Drift 머리글 버튼(~2026-08-06) →
  // `가져오기` 탭(2026-08-06, 804e7a4) → 진단의 버튼(2026-08-14, 탭 삭제).
  // 이 설계(e2e-versionup)에는 아직 버전이 없어 맵핑 관문이 "첫 버전으로 들이기"를 내민다.
  await click('[data-nav-view="diagnose"]')
  await page.waitForSelector('button:has-text("실 DB 를 첫 버전으로 들이기")', { timeout: 30_000 })
  await click('button:has-text("실 DB 를 첫 버전으로 들이기")')
  await page.waitForSelector('button:has-text("새 버전으로 가져오기")', { timeout: 15_000 })
  // 견줄 이전 버전이 없으면 창은 미리보기를 안 그린다(늘어놓기만 하던 목록은 2026-08-14 에
  // 걷혔다) — 대신 창이 **무엇을 어디로** 가져오는지 밝히는지를 본다.
  check('운영→설계: 가져오기 창이 대상을 밝힌다', (await body()).includes('실제 DB 연결을'))
  await click('button:has-text("새 버전으로 가져오기")')
  await page.waitForTimeout(1500)
  check('운영→설계: 운영 DB 가져와 설계 새 버전 컷', (await countVersions()) === vBefore + 1)

  /*
   * ⭐ 운영→설계(새 설계 부트스트랩): 설계+Draft+버전 생성 + 활성 전환.
   *
   * 창 안의 대상 토글("기존 설계에 버전 추가 / 새 설계 만들기")은 2026-08-14 에 없어졌다 —
   * **부른 버튼이 갈래를 정한다.** 그래서 길은 맵핑 관문의 `새 설계로 저장하기` 하나뿐이고,
   * 그 관문이 두 갈래를 다 내밀려면 ⑴ 결속이 아직 없고 ⑵ 버전은 있는데 ⑶ 실 DB 와 똑같은
   * 버전은 없어야 한다. 그 상태를 만든다: **빈 스냅샷 버전 하나만 든 새 설계**로 갈아탄다
   * (연결×설계 짝이 새것이라 결속도 아직 없다).
   *
   * (사용자 회귀: 설계가 이미 선택돼 있으면 "새 설계로" 갈 길이 없어 늘 버전업으로 샜다.)
   */
  await page.evaluate(async () => {
    const d = await window.rockury.designs.create({
      name: 'e2e-bootstrap-src',
      dialect: 'mysql',
      description: '새 설계 부트스트랩 관문을 세우기 위한 미끼 설계(이 스위트 전용)'
    })
    await window.rockury.versions.create({ designId: d.id, number: 'v0.1.0', snapshot: { tables: [] } })
    window.__rockuryNav.setContextValue('design', d.id)
  })
  await page.reload()
  await page.waitForSelector('text=Design', { timeout: 15_000 })
  await click('button:has-text("Migration")')
  await page.waitForTimeout(400)
  await click('[data-nav-view="diagnose"]')
  await page.waitForSelector('button:has-text("새 설계로 저장하기")', { timeout: 30_000 })
  await click('button:has-text("새 설계로 저장하기")')
  await page.waitForSelector('input[placeholder="예: commerce-core"]', { timeout: 15_000 })
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

    /*
     * ⭐ 되먹임의 재료 고르기 — **세트가 없는 테이블도** 골라 운영 행을 시드로 들인다.
     * 2026-08-18 사용자: "테이블 안에 있는 일부 데이터를 가져올 수는 없는거야? Seed Data 로
     * 셋팅하게". 예전에는 세트가 있는 테이블만 대상이라, 운영에 이미 있는 행을 손으로 다시
     * 쳐 넣어야 했다. `settings` 는 PK 가 `DEFAULT (UUID())` 라 짝짓기 기준을 UNIQUE(`key`)
     * 에서 찾아야 하는, 운영 DB 에서 가져온 표의 흔한 모양이다.
     */
    check(
      '되먹임 대상: 세트가 없는 테이블도 목록에 선다',
      (await page.locator('[data-seed-source="settings"]').count()) === 1
    )
    check(
      '되먹임 대상: 짝짓기 기준을 못 세우는 표는 이유를 단다(조용히 빼지 않는다)',
      (await page.locator('[data-seed-source] >> text=짝짓기 기준 없음').count()) >= 1
    )
    /*
     * 같은 이름이 스키마마다 있으면 **한 줄만** 서야 한다 — 시드는 테이블을 이름으로만
     * 가리켜서, 두 줄을 그리면 체크가 함께 켜지고 React 키까지 겹쳤다(2026-08-18 사용자).
     * 스키마를 여럿 걸친 판정은 `seedSource.test.ts` 가 직접 덮는다(여기 설계는 단일 스키마).
     */
    check(
      '되먹임 대상: 이름당 한 줄',
      (await page.locator('[data-seed-source="settings"]').count()) === 1
    )
    await page.locator('[data-seed-source="settings"] button[role="checkbox"]').click()
    await click('button:has-text("실 DB 읽기")')
    await page.waitForSelector('[data-seed-import-row="new"]', { timeout: 15_000 })
    const fresh = await page.locator('[data-seed-import-row="new"]').count()
    check('되먹임: 세트 없던 테이블의 운영 행이 후보로 올라온다', fresh === 5)
    for (let i = 0; i < fresh; i++) {
      await page.locator('[data-seed-import-row="new"] button[role="checkbox"]').nth(i).click()
    }
    await click('[data-seed-import-accept]')
    await page.waitForTimeout(1000)
    const made = await page.evaluate(async () => {
      const s = (await window.rockury.seedSets.list()).find((x) => x.tableName === 'settings')
      return s ? { key: s.naturalKey, rows: s.rows.length } : null
    })
    check('되먹임: 담으면 시드 세트가 생긴다', !!made && made.rows === 5)
    check(
      '되먹임: 짝짓기 기준을 UNIQUE 에서 찾는다(PK 가 DB 생성일 때)',
      JSON.stringify(made?.key) === JSON.stringify(['key'])
    )

    // ⭐ 기록은 감사용이다 — 요약 한 줄이 아니라 어디에·무엇을 이 남아야 한다(같은 날 사용자 지적).
    await click('[data-nav-view="logs"]')
    await page.waitForTimeout(600)
    const logs = await body()
    check(
      '기록: 상세에 대상 연결·계정·주소가 남는다',
      logs.includes('연결 E2E-mysql') && logs.includes('test@') && logs.includes(':13306/testdb')
    )
    // 문구 — 배지·버전 칸이 이미 말한 것을 요약이 되풀이하지 않는다(2026-08-18 사용자, 세 번 지적).
    check('기록 요약: 버전을 두 번 말하지 않는다', !/운영 DB 가져오기 →/.test(logs))
    check('기록 배지: 안에서만 쓰던 말(맵핑) 대신 뜻을 쓴다', !logs.includes('맵핑') && logs.includes('버전 지정'))
    check('기록: 상세를 누르면 모달이 열린다', (await page.locator('[data-log-detail]').count()) >= 1)
    await page.locator('[data-log-detail]').first().click()
    await page.waitForTimeout(400)
    check('기록 모달: 갈래로 갈라 보인다(스키마·테이블)', (await body()).includes('스키마'))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    /*
     * 상세를 남기기 전에 쌓인 기록은 요약 한 줄뿐이라, 고친 뒤에도 **화면이 그대로**였다
     * (2026-08-18 사용자: "달라진게 하나도 없는데"). 그런 기록은 버전 스냅샷에서 되짚어 보인다.
     */
    await page.evaluate(async ([cid, dname]) => {
      const d = (await window.rockury.designs.list()).find((x) => x.name === dname)
      const e = await window.rockury.environments.ensure(cid, d.id, 'v0.1.0')
      await window.rockury.migration.appendLog({ envId: e.id, kind: 'map', toVersion: 'v0.1.0', summary: '옛 방식 기록' })
    }, [connId, 'e2e-imported'])
    await click('button:has-text("새로고침")')
    await page.waitForTimeout(600)
    // 방금 넣은 것이 맨 위(최신순) — 그 기록을 열어 되짚었다는 표식을 본다.
    await page.locator('[data-log-detail]').first().click()
    await page.waitForTimeout(400)
    check('기록: 상세 없이 쌓인 옛 기록도 스냅샷에서 되짚어 보인다', (await body()).includes('되짚음'))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await click('[data-nav-view="seed"]')
    await page.waitForTimeout(400)

    // ── DB 원상복구(심은 행 제거) ──
    await page.evaluate(
      async ([cid, n]) => window.rockury.query.runParams(cid, 'DELETE FROM roles WHERE name = ?', [n]),
      [connId, ROLE]
    )
    check('시드 반영: 정리 후 실 DB 원복', (await countRole(ROLE)) === 0)
  }


}
