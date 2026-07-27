import type { Envelope } from '../main/ipc/envelope'

/**
 * 봉투 IPC 언랩 — 성공 시 data, 실패 시 throw. 운영부(ops) 채널 규약.
 * 서비스별 preload 파일이 공유하는 유일한 공용 조각이다.
 */
export async function unwrap<T>(p: Promise<Envelope<T>>): Promise<T> {
  const res = await p
  if (!res.success) throw new Error(res.error ?? 'IPC 호출에 실패했습니다.')
  return res.data as T
}
