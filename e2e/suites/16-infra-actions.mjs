// 스모크 스위트 — Infra › 액션 버튼 — 카탈로그 액션 → 인자 폼 → 확인 → 실행 → 출력
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// **15 와 따로 두는 이유**: 15 는 `CASE-iarch-087`(대조 전후로 컨테이너가 하나도 안 변한다)을
// 못박는 스위트다. 여기서는 반대로 **액션이 실물을 실제로 바꾸는지**를 봐야 하므로 한 스위트에
// 두면 서로의 전제를 깬다. 그래서 자기 이름의 일회용 컨테이너를 따로 세우고 끝나면 지운다.

import { execFileSync } from 'node:child_process'

export const meta = {
  name: '16-infra-actions',
  needsDb: true,
  desc: 'Infra › 액션 — 인자 폼 자동 생성 · 위험 액션 확인·잠금(메인이 강제) · 출력 패널'
}

const DISPOSABLE = `rockury-e2e-action-${process.pid}`

const docker = (args, allowFail = false) => {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    if (allowFail) return ''
    throw e
  }
}

const stateOf = (name) =>
  docker(['ps', '--all', '--filter', `name=${name}`, '--format', '{{.State}}'], true).trim()

export async function run(ctx) {
  const { check, click } = ctx
  const page = ctx.page

  // 실행하지 않고 만들기만 한다 → state=created. 액션이 이걸 running 으로 바꾸는 것을 볼 것이다.
  docker(['rm', '-f', DISPOSABLE], true)
  docker(['create', '--name', DISPOSABLE, 'postgres:16'], true)
  check('준비: 일회용 컨테이너가 멈춘 상태로 섰다', stateOf(DISPOSABLE) === 'created')

  try {
    // ── 읽기 전용 연결 하나, 아닌 연결 하나 ────────────────────────────────
    await click('[data-nav-service="infra"]')
    await click('[data-nav-module="catalog"]')
    await click('[data-nav-view="providers"]')
    await page.waitForSelector('[data-infra-view="providers"]', { timeout: 8_000 })

    const makeProvider = async (name, readOnly) => {
      await page.locator('[data-provider-catalog]').selectOption({ label: 'Docker (로컬)' })
      await page.waitForTimeout(200)
      await page.locator('[data-provider-name]').fill(name)
      const box = page.locator('input[type="checkbox"]').first()
      if ((await box.isChecked()) !== readOnly) await box.click()
      await click('[data-provider-save]')
      await page.waitForTimeout(500)
    }
    await makeProvider('e2e-act-ro', true)
    await makeProvider('e2e-act-rw', false)

    // ── 실물을 읽고 일회용 컨테이너를 고른다 ────────────────────────────────
    const pickDisposable = async (providerName) => {
      await click('[data-nav-module="live"]')
      await click('[data-nav-view="map"]')
      await page.waitForSelector('[data-infra-view="live"]', { timeout: 8_000 })
      await page.locator('[data-live-provider]').selectOption({ label: providerName })
      await page.waitForTimeout(300)
      await click('[data-live-sync]')
      await page.waitForSelector('[data-live-row]', { timeout: 30_000 })
      const row = page.locator(`[data-live-pick]`).filter({ hasText: DISPOSABLE }).first()
      await row.click()
      await page.waitForTimeout(300)
    }

    await pickDisposable('e2e-act-ro')
    check(
      '액션: 실물을 고르면 그 종류의 액션이 뜬다',
      (await page.locator('[data-action-open="inspect"]').count()) === 1
    )
    check(
      'CASE-icat-131 읽기 전용 연결에서는 실물을 바꾸는 액션이 잠긴다',
      await page.locator('[data-action-open="restart"]').isDisabled()
    )
    check(
      'CASE-icat-131 왜 잠겼는지 알린다',
      (await page.locator('[data-action-blocked="restart"]').innerText()).includes('읽기 전용')
    )
    check(
      'CASE-icat-131 읽기만 하는 액션은 읽기 전용에서도 열려 있다',
      !(await page.locator('[data-action-open="inspect"]').isDisabled())
    )

    // ── 인자 폼이 스키마에서 자동 생성된다 ─────────────────────────────────
    await click('[data-action-open="logs"]')
    await page.waitForSelector('[data-action-arg="tail"]', { timeout: 5_000 })
    check('CASE-icat-130 인자 폼이 카탈로그 스키마에서 자동 생성된다', true)
    check(
      'CASE-icat-133 무엇이 돌아갈지 실행 전에 보인다',
      (await page.locator('[data-action-preview="logs"]').innerText()).includes('docker logs')
    )
    await click('[data-action-run="logs"]')
    await page.waitForSelector('[data-action-missing]', { timeout: 5_000 })
    check(
      'CASE-icat-130 필수 인자가 비면 무엇이 빠졌는지 알리고 안 돌린다',
      (await page.locator('[data-action-missing]').innerText()).includes('마지막 줄 수')
    )

    // ── 읽기 액션 실행 → 출력 패널 ─────────────────────────────────────────
    await click('[data-action-open="inspect"]')
    await page.waitForTimeout(200)
    await click('[data-action-run="inspect"]')
    await page.waitForSelector('[data-action-output="inspect"]', { timeout: 30_000 })
    check(
      'CASE-icat-134 출력 패널에 종료 코드가 남는다',
      (await page.locator('[data-action-exit]').innerText()).includes('0')
    )
    check(
      'CASE-icat-134 표준 출력이 그대로 보인다',
      (await page.locator('[data-action-stdout]').innerText()).includes(DISPOSABLE)
    )
    check('CASE-icat-134 읽기 액션은 실물을 바꾸지 않았다', stateOf(DISPOSABLE) === 'created')

    // ── ⭐ 잠금은 화면이 아니라 메인이 강제한다 ─────────────────────────────
    {
      const denied = await page.evaluate(async (name) => {
        const provs = await window.rockury.infra.listProviders()
        const ro = provs.find((p) => p.name === name)
        try {
          await window.rockury.infra.runAction({
            providerId: ro.id,
            cmd: 'docker',
            args: ['restart', 'whatever'],
            danger: true
          })
          return null
        } catch (e) {
          return String(e && e.message ? e.message : e)
        }
      }, 'e2e-act-ro')
      check(
        'CASE-icat-135 창구를 직접 불러도 읽기 전용 연결의 위험 액션은 거부된다 — 화면에서만 막으면 잠금이 아니라 권유다',
        typeof denied === 'string' && denied.includes('읽기 전용')
      )
    }

    // ── 위험 액션: 확인을 거쳐야 돌고, 돌면 실물이 실제로 바뀐다 ────────────
    await pickDisposable('e2e-act-rw')
    check(
      'CASE-icat-131 읽기 전용이 아니면 위험 액션이 열린다',
      !(await page.locator('[data-action-open="restart"]').isDisabled())
    )
    await click('[data-action-open="restart"]')
    await page.waitForTimeout(200)
    check(
      'CASE-icat-136 위험 액션에는 실물을 바꾼다는 표시가 붙는다',
      (await page.locator('[data-action-danger="restart"]').count()) === 1
    )
    await click('[data-action-run="restart"]')
    await page.waitForSelector('[data-action-confirm="restart"]', { timeout: 5_000 })
    check('CASE-icat-136 위험 액션은 한 번 더 묻는다 — 바로 돌지 않는다', true)
    check('CASE-icat-136 확인을 받기 전에는 실물이 그대로다', stateOf(DISPOSABLE) === 'created')

    await click('[data-action-confirm-yes="restart"]')
    await page.waitForSelector('[data-action-output="restart"]', { timeout: 60_000 })
    check(
      'CASE-icat-136 확인하면 실제로 돈다',
      (await page.locator('[data-action-exit]').innerText()).includes('0')
    )
    // `created`(만들기만 한 상태)에서 벗어났다는 것이 증명할 것이다.
    // `running` 을 요구하면 안 된다 — 이 이미지는 환경변수 없이 뜨면 곧 종료하므로(exited)
    // 언제 들여다보느냐에 따라 답이 달라진다. 상태 이름이 아니라 **바뀌었다는 사실**을 못박는다.
    const afterRestart = stateOf(DISPOSABLE)
    check(
      `CASE-icat-136 액션은 실물을 실제로 바꾼다(created → ${afterRestart}) — 이것이 Rockury 가 실물에 닿는 유일한 통로다`,
      afterRestart !== '' && afterRestart !== 'created'
    )

    // ── 실행 이력 ──────────────────────────────────────────────────────────
    const runs = await page.evaluate(() => window.rockury.infra.listRuns(20))
    const actionRuns = runs.filter((r) => r.kind === 'action')
    check('CASE-icat-137 액션 실행이 이력에 남는다', actionRuns.length > 0)
    check(
      'CASE-icat-137 이력에는 치환 전 명령이 남는다 — 실물 식별자·자격증명이 눌러앉지 않는다',
      actionRuns.every((r) => !JSON.stringify(r).includes(DISPOSABLE))
    )
  } finally {
    docker(['rm', '-f', DISPOSABLE], true)
  }
}
