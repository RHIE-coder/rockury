/**
 * IPC 응답 봉투 `{ success, data?, error? }` — 운영부(ops) 신규 핸들러 규약(§ops-plan Phase 0).
 *
 * 기존 designs/tables/versions 핸들러는 raw invoke 그대로 두고, 여기서부터 봉투로 승격한다.
 * 메인에서 던진 예외를 렌더러가 throw 로 되받게 하려고 preload 가 `unwrap` 으로 벗긴다.
 */
export interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

/** 핸들러 본문을 감싸 성공/실패를 봉투로 정규화한다. 동기·비동기 함수 모두 허용. */
export async function envelope<T>(fn: () => T | Promise<T>): Promise<Envelope<T>> {
  try {
    const data = await fn()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
