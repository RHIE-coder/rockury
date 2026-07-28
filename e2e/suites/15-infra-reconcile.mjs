// 스모크 스위트 — Infra › Live/대조 — 로컬 도커를 읽어 설계본과 대조하고 흡수한다
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 도커 전제: `npm run db:up` 이 띄운 test-db 컨테이너가 그대로 읽기 대상 fixture 가 된다.
// 남의 컨테이너를 건드리지 않는다 — 어긋남을 만들 때는 **자기 이름의 일회용 컨테이너**를
// `docker create`(실행하지 않고 만들기만)로 세우고 끝나면 지운다.

import { execFileSync } from 'node:child_process'

export const meta = {
  name: '15-infra-reconcile',
  needsDb: true,
  desc: 'Infra › Live/대조 — 도커 읽기 · 미구축/미등록/어긋남 · 설계본 흡수 · 실물 불변'
}

const DISPOSABLE = `rockury-e2e-drift-${process.pid}`

const docker = (args, allowFail = false) => {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    if (allowFail) return ''
    throw e
  }
}

/** 지금 도커에 있는 컨테이너의 이름→상태. 대조가 실물을 건드리지 않는지 확인하는 기준. */
const containerStates = () =>
  docker(['ps', '--all', '--format', '{{json .}}'])
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .reduce((acc, c) => ({ ...acc, [c.Names]: c.State }), {})

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page

  // 어긋남을 만들 재료 — 실행하지 않고 만들기만 한다(state=created → 우리 사전에서 '멈춤').
  // 이미 있는 test-db 이미지를 쓰므로 내려받기가 없고, 남의 컨테이너는 건드리지 않는다.
  docker(['rm', '-f', DISPOSABLE], true)
  docker(['create', '--name', DISPOSABLE, 'postgres:16'], true)
  const before = containerStates()
  check('준비: 일회용 컨테이너를 멈춘 상태로 만들었다', before[DISPOSABLE] === 'created')

  try {
    // ── 도커 공급자 연결 만들기 ────────────────────────────────────────────
    await click('[data-nav-service="infra"]')
    await click('[data-nav-module="catalog"]')
    await click('[data-nav-view="providers"]')
    await page.waitForSelector('[data-infra-view="providers"]', { timeout: 8_000 })

    const options = await page.locator('[data-provider-catalog] option').allTextContents()
    check('공급자: 자격증명 없는 도커도 연결 대상으로 뜬다', options.join(' ').includes('Docker'))
    await page.locator('[data-provider-catalog]').selectOption({ label: 'Docker (로컬)' })
    await page.waitForTimeout(200)
    check(
      '공급자: 자격증명이 필요 없다고 알려 준다',
      (await body()).includes('자격증명이 필요 없습니다')
    )
    await page.locator('[data-provider-name]').fill('e2e-docker')
    await click('[data-provider-save]')
    await page.waitForTimeout(500)

    // ── 설계본 준비 — 이 스위트만 돌려도 서게 한다(앞 스위트 상태에 기대지 않는다) ──
    await click('[data-nav-module="design"]')
    await click('[data-nav-view="diagram"]')
    await page.waitForTimeout(400)
    if ((await page.locator('[data-infra-create-design]').count()) > 0) {
      await click('[data-infra-create-design]')
      await page.waitForTimeout(500)
    }
    // 도커 공급자가 읽지 않는 종류(AWS)를 하나 놓는다 → '대조 안 함' 판정의 재료.
    await click('[data-add-type="aws.ec2"]')
    await page.waitForTimeout(300)
    await click('[data-infra-save]')
    await page.waitForTimeout(400)

    // ── 실물 읽기 ──────────────────────────────────────────────────────────
    await click('[data-nav-module="live"]')
    await click('[data-nav-view="map"]')
    await page.waitForSelector('[data-infra-view="live"]', { timeout: 8_000 })
    await page.locator('[data-live-provider]').selectOption({ label: 'e2e-docker' })
    await page.waitForTimeout(300)
    await click('[data-live-sync]')
    await page.waitForSelector('[data-live-row]', { timeout: 60_000 })

    const liveBody = await body()
    check('CASE-iarch-080 도커 컨테이너가 실물 지도에 뜬다', liveBody.includes(DISPOSABLE))
    check('CASE-iarch-080 상태가 사전을 거쳐 칠해진다', liveBody.includes('멈춤') && liveBody.includes('정상'))
    check('CASE-iarch-080 원본 상태 문자열도 함께 보인다', liveBody.includes('created') && liveBody.includes('running'))
    const takenAt = await page.locator('[data-live-taken-at]').innerText()
    check('CASE-iarch-081 "○분 전 기준"이 표시된다', takenAt.includes('기준'))

    // ── 대조: 설계에만 있는 것 · 실물에만 있는 것 ──────────────────────────
    await click('[data-nav-view="reconcile"]')
    await page.waitForSelector('[data-infra-view="reconcile"]', { timeout: 8_000 })
    const unreg = await page.locator('[data-reconcile-row="unregistered"]').count()
    check('CASE-iarch-082 설계에 없는 실물이 전부 미등록으로 뜬다', unreg > 0)

    // 앞 스위트(14)가 만든 AWS 노드들은 이번에 안 읽은 종류다 → '미구축'이 아니라 '대조 안 함'.
    const notChecked = await page.locator('[data-reconcile-row="not-checked"]').count()
    check(
      'CASE-iarch-034 안 읽은 종류는 미구축이 아니라 "대조 안 함"으로 뜬다',
      notChecked > 0 && (await body()).includes('대조 안 함')
    )

    // ── 흡수: 설계본에만 반영된다 ──────────────────────────────────────────
    await click('[data-reconcile-absorb]')
    await page.waitForTimeout(400)
    await click('[data-reconcile-save]')
    await page.waitForTimeout(600)

    const afterAbsorb = await body()
    check('CASE-iarch-083 흡수로 만든 노드는 설명 없음 표식이 붙는다', afterAbsorb.includes('설명 없음'))
    const unregAfter = await page.locator('[data-reconcile-row="unregistered"]').count()
    check('CASE-iarch-083 흡수하면 미등록이 줄어든다', unregAfter < unreg)

    // 흡수 초안은 전부 설명이 비어 있다 — 어디부터 채우면 되는지 알려 준다.
    await page.waitForSelector('[data-absorb-todo]', { timeout: 5_000 })
    const todoCount = Number(await page.locator('[data-absorb-todo-count]').innerText())
    check('CASE-iarch-092 흡수 뒤 무엇부터 채울지 목록이 뜬다', todoCount > 0)
    check(
      'CASE-iarch-092 목록의 항목을 누르면 그 노드가 골라진다',
      (await page.locator('[data-absorb-todo-item]').count()) > 0
    )
    await page.locator('[data-absorb-todo-item]').first().click()
    await page.waitForTimeout(200)
    const picked = await page.evaluate(() => document.querySelectorAll('[data-absorb-todo-item]').length)
    check('CASE-iarch-092 고른 뒤에도 목록이 살아 있다(연달아 채울 수 있다)', picked > 0)

    // 흡수한 컨테이너 중 멈춘 것은 이제 '어긋남'으로 뜬다(설계는 떠 있어야 한다는 뜻).
    const driftRows = await page.locator('[data-reconcile-row="drift"]').count()
    check('CASE-iarch-084 멈춘 컨테이너가 어긋남으로 뜬다', driftRows > 0)
    check(
      'CASE-iarch-084 무엇이 어떻게 다른지 필드 단위로 보인다',
      (await body()).includes('status') && (await body()).includes('정상이어야 함')
    )

    // ── 되돌리기 ──────────────────────────────────────────────────────────
    await click('[data-reconcile-undo]')
    await page.waitForTimeout(400)
    const unregBack = await page.locator('[data-reconcile-row="unregistered"]').count()
    check('CASE-iarch-086 되돌리면 설계본이 흡수 전으로 돌아온다', unregBack === unreg)

    // ── 설계에만 있는 노드 → 미구축 ────────────────────────────────────────
    await click('[data-reconcile-save]')
    await page.waitForTimeout(400)
    await click('[data-nav-module="design"]')
    await click('[data-nav-view="diagram"]')
    await page.waitForTimeout(400)
    await click('[data-add-type="docker.container"]')
    await page.waitForTimeout(300)
    await click('[data-infra-save]')
    await page.waitForTimeout(400)
    await click('[data-nav-module="live"]')
    await click('[data-nav-view="reconcile"]')
    await page.waitForTimeout(400)
    const missing = await page.locator('[data-reconcile-row="missing"]').count()
    check('CASE-iarch-085 설계에만 있는 노드가 미구축으로 뜬다', missing > 0)

    // ── ⭐ 실물 불변 — 이 서비스의 공통 불변식을 실측으로 못 박는다 ─────────
    const after = containerStates()
    check(
      'CASE-iarch-087 대조·흡수 전후로 컨테이너 상태가 하나도 변하지 않았다',
      JSON.stringify(before) === JSON.stringify(after)
    )
    check(
      'CASE-iarch-087 컨테이너가 지워지거나 새로 생기지도 않았다',
      Object.keys(before).length === Object.keys(after).length
    )
  } finally {
    docker(['rm', '-f', DISPOSABLE], true)
  }
}
