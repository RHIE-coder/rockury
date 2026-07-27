/**
 * 스모크 흐름이 공유하는 실행 맥락(ctx).
 *
 * 흐름이 서비스별 파일로 갈라진 뒤(`e2e/flows/<서비스>.mjs`), 앱 핸들과 공용 도우미를
 * 넘겨 줄 통로가 필요해졌다. 앱을 여러 번 띄우지 않는다 — **한 번 띄운 창을 흐름들이 잇달아
 * 조작한다**(분할 전 단일 스크립트와 같은 성질을 유지).
 *
 * ⚠ 흐름 안에서 `ctx.page` 를 구조분해(`const { page } = ctx`)하지 말 것 —
 *    콜드 재시작(`ctx.restart()`)이 새 창 객체로 갈아끼우므로 낡은 참조를 붙들게 된다.
 *    `check`·`click`·`body`·`typeSql` 은 매번 `ctx.page` 를 읽으므로 구조분해해도 안전하다.
 */
export function createContext({ launch, userData }) {
  // 미저장 변경 가드 등 window.confirm 은 자동 수락(사용자가 "예"를 누른 것으로).
  const acceptDialogs = (p) => p.on('dialog', (d) => d.accept().catch(() => {}))

  const ctx = {
    app: null,
    page: null,
    userData,
    pass: true,

    check(label, cond) {
      console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label)
      if (!cond) ctx.pass = false
    },

    click: (sel) => ctx.page.locator(sel).first().click(),
    body: () => ctx.page.evaluate(() => document.body.innerText),

    // CodeMirror(.cm-content)에 SQL 입력 — 전체선택→삭제→타이핑→자동완성 팝업 닫기.
    async typeSql(text) {
      await ctx.page.locator('.cm-content').click()
      await ctx.page.keyboard.press('ControlOrMeta+A')
      await ctx.page.keyboard.press('Backspace')
      await ctx.page.keyboard.type(text)
      await ctx.page.keyboard.press('Escape')
    },

    /** 앱을 처음 띄운다. */
    async start() {
      ctx.app = await launch()
      ctx.page = await ctx.app.firstWindow()
      acceptDialogs(ctx.page)
    },

    /**
     * 콜드 재시작(프로세스 종료→재기동, 같은 userData) — renderer reload 가 아니라
     * 실제로 앱을 껐다 켠다. SQLite 영속을 진짜로 검증하려면 이게 필요하다.
     */
    async restart() {
      await ctx.app.close()
      await ctx.start()
    },

    async close() {
      await ctx.app?.close().catch(() => {})
    }
  }
  return ctx
}
