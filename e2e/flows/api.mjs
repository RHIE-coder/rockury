/**
 * API 서비스 앱 구동 흐름 — **아직 없다.**
 *
 * 이 파일은 API 서비스 에이전트의 자리다. 화면을 만들면 여기에 흐름을 쌓는다:
 *   ```js
 *   await click('[data-nav-service="api"]')
 *   await ctx.page.waitForSelector('text=…', { timeout: 5_000 })
 *   check('api: 무엇이 보인다', (await body()).includes('…'))
 *   ```
 * 규칙(AGENTS.md 불변식 3): e2e 는 **누적 회귀 자산**이라 쌓기만 하고 지우지 않는다.
 * 함정: 접근성 쿼리(getByRole 등)는 이 Electron 창을 크래시시킨다 → CSS/text 로케이터만.
 *
 * ⚠ `ctx.page` 를 구조분해하지 말 것 — 콜드 재시작이 창 객체를 갈아끼운다.
 */
export async function run(_ctx) {
  // 아직 흐름 없음.
}
