/**
 * 창 하나가 들고 있는 것 — **탭 목록과 그중 활성**.
 *
 * 이 값의 주인은 **메인 프로세스**다(2026-08-05). 처음엔 창마다 브라우저 저장소에 넣었는데,
 * 저장소는 창끼리 같은 것 하나라 두 창이 서로를 덮어썼다. 그래서 떼어낸 창은 저장을 못 하게
 * 막아 두었고, 그 대가로 껐다 켜면 안 돌아왔다. 주인을 창 밖으로 옮겨 둘 다 푼다.
 *
 * 흐름: 메인이 창을 만들 때 이 값을 **실행 인자로** 실어 준다(주소로 넘기면 첫 그림이 기본
 * 자리로 한 번 그려졌다 갈아치워진다). 창 안에서 탭이 바뀌면 렌더러가 메인에 되보고한다.
 */

import { decodeNavLocation, encodeNavLocation, type NavLocation } from './navLocation'

export interface WindowSession {
  /** 탭들의 자리 — 배열 순서가 곧 탭 줄 순서다. 비어 있지 않다. */
  tabs: NavLocation[]
  /** 활성 탭의 자리 번호(0부터). 범위를 벗어나면 0 으로 본다. */
  active: number
}

/** 창을 만들 때 실어 보내는 것 전부. */
export interface WindowBoot {
  /**
   * 이 창이 **첫 창인가**. 브라우저 저장소(대상 선택·마지막 자리 기억)를 쓸 수 있는 창은 하나뿐이라
   * 그것을 가른다 — 여러 창이 같이 쓰면 마지막에 움직인 창이 이겨 다음 실행이 운에 달린다.
   */
  primary: boolean
  session: WindowSession
}

/** 실행 인자에 실을 때 쓰는 앞머리. Electron `additionalArguments` 로 들어간다. */
const FLAG = '--rockury-window='

/** 한 창이 열 수 있는 탭 수 상한 — 저장본이 깨졌을 때 탭 수천 장을 그리지 않게. */
const MAX_TABS = 60

export function encodeWindowBoot(boot: WindowBoot): string {
  const payload = {
    p: boot.primary ? 1 : 0,
    t: boot.session.tabs.map(encodeNavLocation),
    a: boot.session.active
  }
  // base64 로 접는다 — 실행 인자는 공백·따옴표에 민감한데, 접어 두면 한 토막으로 안전하게 지나간다.
  return FLAG + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

/**
 * 실행 인자에서 창이 들고 나온 것을 되푼다. 없거나 깨졌으면 **null** —
 * 부르는 쪽이 "첫 창, 기본 자리"로 떨어뜨린다.
 *
 * 렌더러 쪽에서도 도는 코드라 `Buffer` 를 안 쓴다(preload 는 노드지만 이 함수는 공용이다).
 */
export function decodeWindowBoot(argv: readonly string[]): WindowBoot | null {
  const arg = argv.find((a) => a.startsWith(FLAG))
  if (!arg) return null
  try {
    const json = decodeBase64(arg.slice(FLAG.length))
    const raw = JSON.parse(json) as { p?: unknown; t?: unknown; a?: unknown }
    const session = normalizeSession({
      tabs: Array.isArray(raw.t) ? raw.t.map((s) => decodeNavLocation(String(s))) : [],
      active: typeof raw.a === 'number' ? raw.a : 0
    })
    return session ? { primary: raw.p === 1, session } : null
  } catch {
    return null
  }
}

function decodeBase64(b64: string): string {
  if (typeof atob === 'function') {
    // atob 은 바이트열을 준다 — 한글 같은 여러 바이트 글자를 살리려면 UTF-8 로 되읽어야 한다.
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }
  return Buffer.from(b64, 'base64').toString('utf8')
}

/**
 * 저장본·인자를 걸러 받는다. 살아남은 탭이 하나도 없으면 **null**(부르는 쪽이 기본을 세운다).
 * 활성 번호가 범위를 벗어나면 0 으로 되돌린다 — 탭이 지워진 저장본에서 흔한 일이다.
 */
export function normalizeSession(raw: {
  tabs: readonly (NavLocation | null)[]
  active: number
}): WindowSession | null {
  const tabs = raw.tabs.filter((t): t is NavLocation => t !== null).slice(0, MAX_TABS)
  if (tabs.length === 0) return null
  const active = Number.isInteger(raw.active) && raw.active >= 0 && raw.active < tabs.length ? raw.active : 0
  return { tabs, active }
}
