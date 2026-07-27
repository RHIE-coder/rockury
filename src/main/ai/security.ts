import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * MCP HTTP 리스너의 요청 관문 — 순수 판정 함수(테스트 대상).
 *
 * 리스너는 127.0.0.1 에만 바인딩되지만, localhost HTTP 는 두 갈래 위협이 남는다:
 *  ① 같은 컴퓨터의 다른 프로그램 → Bearer 토큰(키체인 보관, 앱 UI 로만 노출)으로 차단
 *  ② 브라우저를 경유한 원격 공격(DNS 리바인딩·CSRF) → Origin/Host 검증으로 차단
 * 셋 다 통과해야 요청을 처리한다.
 */

export interface GateInput {
  /** Authorization 요청 헤더 원문. */
  authorization?: string
  /** Origin 요청 헤더 — 브라우저발 요청에만 존재. CLI/에이전트는 보통 없음. */
  origin?: string
  /** Host 요청 헤더. */
  host?: string
}

export type GateResult = { ok: true } | { ok: false; status: number; reason: string }

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** 상수시간 문자열 비교 — sha256 으로 길이를 고정한 뒤 timingSafeEqual(타이밍 공격 방어). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/** 요청을 통과시킬지 판정한다. 통과 조건: 로컬 Host + (Origin 없음 또는 로컬 Origin) + 토큰 일치. */
export function gateRequest(input: GateInput, token: string): GateResult {
  // Host — 리바인딩 방어 이중선(바인딩이 1차, 이건 2차).
  const hostname = (input.host ?? '').toLowerCase().replace(/:\d+$/, '')
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    return { ok: false, status: 403, reason: 'host 가 로컬이 아님' }
  }

  // Origin — 없으면 비브라우저 클라이언트(통과), 있으면 로컬 출처만.
  if (input.origin) {
    let originHost: string
    try {
      originHost = new URL(input.origin).hostname.toLowerCase()
    } catch {
      return { ok: false, status: 403, reason: 'origin 파싱 불가' }
    }
    if (!LOCAL_HOSTNAMES.has(originHost)) {
      return { ok: false, status: 403, reason: 'origin 이 로컬이 아님' }
    }
  }

  // 토큰 — Bearer 정확 일치(상수시간 비교).
  if (!input.authorization || !safeEqual(input.authorization, `Bearer ${token}`)) {
    return { ok: false, status: 401, reason: '토큰 불일치' }
  }

  return { ok: true }
}
