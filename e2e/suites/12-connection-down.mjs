// 스모크 스위트 — 연결이 안 될 때 Remote 화면들이 그 사실을 알리는가
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '12-connection-down',
  // 실 DB 가 필요 없다 — 오히려 **아무도 안 듣는 포트**로 붙어 실패를 만든다.
  needsDb: false,
  desc: '연결 실패 알림 — 다섯 화면이 같은 말로 알리고, 원인과 다시 시도를 준다'
}

/**
 * 회귀(2026-08-04 사용자 실측): 접속이 죽은 줄 모르고 "앱이 고장 났나" 했다.
 * Data·Query 는 아무 말도 안 했고, 나머지 셋은 `역설계 실패: connect ECONNREFUSED …` 라는
 * 개발자 문구만 보였다. 화면이 비는 이유가 연결 탓인지 앱 탓인지 가릴 수 없던 것이 문제다.
 */
export async function run(ctx) {
  const { check, body } = ctx
  const page = ctx.page
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('text=Design', { timeout: 15_000 })

  // 아무도 안 듣는 포트 — 접속이 반드시 실패한다(실 DB 의존 없이 실패를 만든다).
  const conn = await page.evaluate(() =>
    window.rockury.connections.create({
      name: 'e2e 죽은 서버',
      dbType: 'postgresql',
      host: '127.0.0.1',
      port: 59999,
      database: 'nope',
      user: 'x',
      password: '',
      sslEnabled: false
    })
  )

  const VIEWS = ['definition', 'diagram', 'data', 'query', 'object']
  for (const view of VIEWS) {
    await page.evaluate(
      ([id, v]) => {
        const nav = JSON.parse(localStorage.getItem('rockury.nav') ?? '{"state":{},"version":0}')
        nav.state = {
          ...(nav.state ?? {}),
          serviceId: 'db',
          moduleId: 'remote',
          viewId: v,
          contextValues: { ...(nav.state?.contextValues ?? {}), conn: id }
        }
        localStorage.setItem('rockury.nav', JSON.stringify(nav))
      },
      [conn.id, view]
    )
    await page.reload()
    await page.waitForSelector('[data-connection-error]', { timeout: 20_000 })
    const text = await body()

    check(`Remote › ${view}: 연결 실패를 알린다`, text.includes('연결할 수 없습니다'))
    // 원인과 할 일이 함께 나와야 한다 — 원인만으로는 어디를 고칠지 모른다.
    check(`Remote › ${view}: 원인을 사람 말로 준다`, text.includes('서버가 연결을 거부했습니다'))
    check(`Remote › ${view}: 무엇을 확인할지 알려 준다`, text.includes('주소와 포트가 맞는지'))
    check(`Remote › ${view}: 다시 시도할 수 있다`, text.includes('다시 시도'))
    // 드라이버 원문을 그대로 들이밀지 않는다(접어 두되 버리지도 않는다 — '서버가 보낸 말').
    check(
      `Remote › ${view}: 개발자 문구를 앞세우지 않는다`,
      !text.includes('ECONNREFUSED')
    )

    // 표가 없는 것과 못 읽은 것은 다르다 — 헤더가 "0개 테이블" 이라고 말하면 거짓이다.
    if (view === 'data') {
      check('Remote › Data: 연결 실패를 표 0개로 위장하지 않는다', !text.includes('0개 테이블'))
      check('Remote › Data: 헤더도 연결 안 됨으로 말한다', text.includes('연결 안 됨'))
    }
  }
}
