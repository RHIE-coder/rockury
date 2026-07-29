/**
 * IPC 오류를 사람이 읽을 문구로 — `docs/spec/api-service.md` 응답 규율.
 *
 * Electron 은 메인에서 던진 오류를 `Error invoking remote method 'api:startMock': Error: …`
 * 로 감싸 돌려준다. 그걸 그대로 배너에 넣으면 **잘 쓴 한국어 안내 앞에 영어 프레임워크
 * 문구와 내부 채널 이름이 붙는다** — 사용자가 알 이유가 없는 우리 배선이다.
 *
 * 못 벗기면 **원문을 그대로 둔다** — 알아볼 수 없게 잘라 내느니 지저분한 편이 낫다.
 */
const WRAPPER = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/

export function ipcErrorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(WRAPPER, '').trim() || raw
}
