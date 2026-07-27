/**
 * API 서비스의 IPC 채널 — **아직 없다.**
 *
 * 이 폴더는 API 에이전트의 자리다. 메인 프로세스 능력이 필요해지면:
 *   1. 여기에 `<주제>.ts` 를 만들고 `ipcMain.handle('api:<동작>', …)` 로 채널을 연다
 *      (채널 접두어는 서비스 id — AGENTS.md 네임스페이스 규칙)
 *   2. 아래 `registerApiIpc()` 에서 호출한다
 *   3. `src/main/mcp/coverage/api.ts` 에 노출 또는 제외 사유를 등재한다(안 하면 `npm test` 실패)
 *   4. 렌더러에서 쓰려면 `src/preload/services/api.ts` 에 창구를 연다
 * `src/main/index.ts` 나 다른 서비스 폴더는 건드리지 않는다.
 */
export function registerApiIpc(): void {
  // 아직 채널 없음.
}
