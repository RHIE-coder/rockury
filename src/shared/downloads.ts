/**
 * 내려받기가 어떻게 끝났나 — 메인이 알고, 화면이 그것을 그린다.
 *
 * 시작(`<a download>`)은 렌더러가 하지만 끝은 OS 저장 창 너머에 있어 렌더러가 못 본다.
 * 셋을 가르는 이유: **취소는 실패가 아니다.** 사용자가 스스로 그만둔 것을 "실패"로 알리면
 * 뭔가 잘못된 줄 알고 다시 누르게 된다.
 */
export interface DownloadDone {
  filename: string
  /** `completed` 저장됨 · `cancelled` 사용자가 저장 창에서 그만둠 · `interrupted` 도중에 끊김 */
  state: 'completed' | 'cancelled' | 'interrupted'
}
