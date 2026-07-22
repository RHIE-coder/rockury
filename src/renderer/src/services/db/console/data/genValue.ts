/**
 * 랜덤 식별값 생성 도우미(§ops 향상 — Data #1). UUID 생성 + 형식 검증.
 * 생성은 crypto.randomUUID(폴백 포함), 검증은 순수 함수 → 테스트 의무 대상.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** UUID v4 형식인지. */
export function isUuidV4(s: string): boolean {
  return UUID_V4.test(s)
}

/** UUID v4 생성. crypto.randomUUID 우선, 없으면 RFC4122 준수 폴백. */
export function genUuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // 폴백 — 실제 난수로 16바이트를 채운 뒤 v4 조립(getRandomValues 없으면 Math.random).
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'))
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`
}
