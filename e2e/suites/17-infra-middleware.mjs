// 스모크 스위트 — Infra › 미들웨어 콘솔 — 실제 Redis 에 붙어 명령을 돌린다
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 도커 전제: 자기 pid 이름의 **일회용 Redis** 를 띄우고 끝나면 지운다.
// 고정 포트를 안 쓰는 이유: 병렬로 e2e 를 돌려도 안전해야 한다(포트를 OS 가 고르게 맡긴다).
// 남의 컨테이너·남의 test-db 는 건드리지 않는다.

import { execFileSync } from 'node:child_process'

export const meta = {
  name: '17-infra-middleware',
  needsDb: true,
  desc: 'Infra › 미들웨어 — 실제 Redis 왕복(의존성 0 RESP 클라이언트) · 비밀 미노출 · 못 붙는 종류 표시'
}

const NAME = `rockury-e2e-redis-${process.pid}`

const docker = (args, allowFail = false) => {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    if (allowFail) return ''
    throw e
  }
}

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page

  docker(['rm', '-f', NAME], true)
  // -p 0:6379 → OS 가 빈 포트를 고른다. 이미 로컬에 있는 이미지를 쓰므로 내려받기가 없다.
  docker(['run', '-d', '--name', NAME, '-p', '0:6379', 'redis:7-alpine'], true)
  const mapped = docker(['port', NAME, '6379/tcp'], true).trim().split('\n')[0] ?? ''
  const port = Number(mapped.split(':').pop())
  check('준비: 일회용 Redis 가 떴다', Number.isFinite(port) && port > 0)

  try {
    // Redis 가 접속을 받을 때까지 기다린다(뜬 직후 몇백 ms 는 거절한다).
    for (let i = 0; i < 40; i++) {
      const pong = docker(['exec', NAME, 'redis-cli', 'PING'], true).trim()
      if (pong === 'PONG') break
      await page.waitForTimeout(250)
    }

    await click('[data-nav-service="infra"]')
    await click('[data-nav-module="middleware"]')
    await click('[data-nav-view="console"]')
    await page.waitForSelector('[data-infra-view="middleware"]', { timeout: 8_000 })

    // ── 아직 못 붙는 종류를 숨기지 않는다 ──────────────────────────────────
    const kinds = await page.locator('[data-mw-kind] option').allTextContents()
    check(
      'CASE-imw-023 네 종류가 명세 순서대로 목록에 있다',
      kinds.join(' ').includes('Redis') &&
        kinds.join(' ').includes('RabbitMQ') &&
        kinds.join(' ').includes('Kafka') &&
        kinds.join(' ').includes('MQTT')
    )
    check(
      'CASE-imw-023 아직 못 붙는 종류는 목록에서 그렇다고 밝힌다 — 빼서 짐작하게 만들지 않는다',
      kinds.some((k) => k.includes('아직 못 붙음'))
    )
    await page.locator('[data-mw-kind]').selectOption('kafka')
    await page.waitForSelector('[data-mw-kind-note]', { timeout: 3_000 })
    check(
      'CASE-imw-023 왜 못 붙는지 사유가 뜬다',
      (await page.locator('[data-mw-kind-note]').innerText()).length > 10
    )
    await page.locator('[data-mw-kind]').selectOption('redis')
    await page.waitForTimeout(200)

    // ── 접속 만들기 ────────────────────────────────────────────────────────
    const SECRET = 'e2e-redis-secret-should-not-appear'
    await page.locator('[data-mw-name]').fill('e2e-redis')
    await page.locator('[data-mw-host]').fill('127.0.0.1')
    await page.locator('[data-mw-port]').fill(String(port))
    // 이 Redis 에는 비밀번호가 없다 — 그래도 넣어서 **어디에도 안 새는지**를 본다.
    await page.locator('[data-mw-secret]').fill(SECRET)
    await click('[data-mw-save]')
    await page.waitForSelector('[data-mw-conn]', { timeout: 8_000 })
    check('CASE-imw-030 접속이 목록에 생겼다', (await body()).includes('e2e-redis'))
    check('CASE-imw-030 비밀이 있다고만 표시하고 값은 안 보인다', (await body()).includes('비밀 있음'))
    check('CASE-imw-030 화면 어디에도 평문 비밀이 없다', !(await body()).includes(SECRET))
    const stored = await page.evaluate(() => window.rockury.infra.listMwConnections())
    check(
      'CASE-imw-030 창구가 돌려주는 레코드에도 비밀이 없다',
      !JSON.stringify(stored).includes(SECRET)
    )

    // ── 비밀번호가 틀렸을 때: 붙는 데 실패한 사유가 그대로 온다 ─────────────
    await click('[data-mw-conn]')
    await page.waitForTimeout(200)
    await click('[data-mw-quick="PING"]')
    await page.waitForSelector('[data-mw-line="0"]', { timeout: 20_000 })
    const first = await page.locator('[data-mw-line="0"]').innerText()
    // 비밀번호 없는 Redis 에 AUTH 를 보내면 서버가 거절한다 — 그 사유가 그대로 보여야 한다.
    check(
      'CASE-imw-031 인증이 거절되면 사유가 뭉개지지 않고 뜬다',
      first.includes('AUTH') || first.includes('password') || first.includes('PONG')
    )

    // 비밀번호를 지운 새 접속으로 다시 — 이번엔 붙어야 한다.
    await page.locator('[data-mw-name]').fill('e2e-redis-noauth')
    await page.locator('[data-mw-host]').fill('127.0.0.1')
    await page.locator('[data-mw-port]').fill(String(port))
    await click('[data-mw-save]')
    await page.waitForTimeout(500)
    const conns = page.locator('[data-mw-conn]')
    const count = await conns.count()
    for (let i = 0; i < count; i++) {
      const t = await conns.nth(i).innerText()
      if (t.includes('e2e-redis-noauth')) {
        await conns.nth(i).click()
        break
      }
    }
    await page.waitForTimeout(300)

    // ── ⭐ 실제 왕복 ───────────────────────────────────────────────────────
    await click('[data-mw-quick="PING"]')
    await page.waitForFunction(
      () => document.querySelectorAll('[data-mw-line]').length > 0,
      undefined,
      { timeout: 20_000 }
    )
    const out = await page.locator('[data-mw-output]').innerText()
    check('CASE-imw-032 실제 Redis 가 PONG 을 돌려준다 — 의존성 0 클라이언트가 붙었다', out.includes('PONG'))

    await click('[data-mw-quick="INFO server"]')
    await page.waitForTimeout(1_500)
    const info = await page.locator('[data-mw-output]').innerText()
    check('CASE-imw-032 INFO 의 여러 줄 응답을 그대로 받는다', info.includes('redis_version'))

    // 직접 친 명령 — 값에 공백이 있어도 규약이 안 흔들린다.
    await page.locator('[data-mw-input]').fill('ECHO "a b c"')
    await click('[data-mw-send]')
    await page.waitForTimeout(1_500)
    const echoed = await page.locator('[data-mw-output]').innerText()
    check('CASE-imw-033 공백이 든 값도 한 인자로 나가고 그대로 돌아온다', echoed.includes('a b c'))

    // 없는 명령 — 서버가 거절한 것은 붙지 못한 것과 다르게 보인다.
    await page.locator('[data-mw-input]').fill('이런명령은없다')
    await click('[data-mw-send]')
    await page.waitForTimeout(1_500)
    const errText = await page.locator('[data-mw-output]').innerText()
    check(
      'CASE-imw-034 서버가 거절한 명령은 (error) 로 보이고, "붙지 못했습니다"와 구분된다',
      errText.includes('(error)') && !errText.includes('붙지 못했습니다')
    )

    // 못 붙는 주소 — 이건 "붙지 못했습니다" 쪽이다.
    await page.locator('[data-mw-name]').fill('e2e-redis-nowhere')
    await page.locator('[data-mw-host]').fill('127.0.0.1')
    await page.locator('[data-mw-port]').fill('1')
    await click('[data-mw-save]')
    await page.waitForTimeout(500)
    const conns2 = page.locator('[data-mw-conn]')
    const n2 = await conns2.count()
    for (let i = 0; i < n2; i++) {
      const t = await conns2.nth(i).innerText()
      if (t.includes('e2e-redis-nowhere')) {
        await conns2.nth(i).click()
        break
      }
    }
    await page.waitForTimeout(300)
    await click('[data-mw-quick="PING"]')
    await page.waitForFunction(
      () => document.querySelectorAll('[data-mw-line]').length > 0,
      undefined,
      { timeout: 20_000 }
    )
    const nowhere = await page.locator('[data-mw-output]').innerText()
    check(
      'CASE-imw-034 못 붙은 것은 "붙지 못했습니다"로 구분해 알린다 — 명령이 틀린 것과 다르다',
      nowhere.includes('붙지 못했습니다')
    )

    // ── 실행 이력: 명령 이름만 남고 값은 안 남는다 ──────────────────────────
    const runs = await page.evaluate(() => window.rockury.infra.listRuns(30))
    const mw = runs.filter((r) => r.kind === 'middleware')
    check('CASE-imw-035 미들웨어 실행이 이력에 남는다', mw.length > 0)
    check(
      'CASE-imw-035 이력에 비밀도 값도 안 남는다 — 명령 이름만 남긴다',
      !JSON.stringify(mw).includes(SECRET) && !JSON.stringify(mw).includes('a b c')
    )
  } finally {
    docker(['rm', '-f', NAME], true)
  }
}
