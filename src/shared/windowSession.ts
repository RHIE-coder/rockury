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

/**
 * 탭 하나가 들고 다니는 것 — 자리 + **그 탭이 고른 대상들**.
 *
 * 대상 선택은 2026-08-07 까지 창에 딸려 있었다(창 하나에 하나). 그때는 이 값이 브라우저
 * 저장소에 있었는데, 탭마다 갈리려면 탭과 함께 다녀야 한다 — 탭을 떼어내면 보던 대상도 따라
 * 가고, 껐다 켜도 탭마다 제 대상으로 돌아온다.
 */
export interface SessionTab extends NavLocation {
  /** 셀렉터 id → 옵션 id. 없거나 비어 있으면 "아직 아무것도 안 골랐다". */
  context?: Record<string, string>
}

export interface WindowSession {
  /** 탭들 — 배열 순서가 곧 탭 줄 순서다. 비어 있지 않다. */
  tabs: SessionTab[]
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

/** 탭 하나가 들 수 있는 대상 수 상한 — 셀렉터는 서비스마다 두셋뿐이다. */
const MAX_CONTEXT = 20

/** 셀렉터 id·옵션 id 의 길이 상한 — 둘 다 짧은 식별자다(깨진 저장본이 부풀지 않게). */
const MAX_ID_LENGTH = 200

/**
 * 대상 선택을 걸러 받는다 — 저장본과 실행 인자를 거쳐 오는 값이라 모양을 믿을 수 없다.
 * 살릴 게 없으면 **빈 것**(= 아직 아무것도 안 골랐다)이다.
 */
export function normalizeContext(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_CONTEXT) break
    if (key === '' || key.length > MAX_ID_LENGTH) continue
    if (typeof value !== 'string' || value.length > MAX_ID_LENGTH) continue
    out[key] = value
  }
  return out
}

export function encodeWindowBoot(boot: WindowBoot): string {
  const payload = {
    p: boot.primary ? 1 : 0,
    t: boot.session.tabs.map(encodeNavLocation),
    // 대상 선택은 자리와 **따로** 실는다 — 자리 표기(`db/remote/data`)는 주소에도 쓰이는
    // 공용 모양이라, 거기에 값을 끼워 넣으면 주소를 읽는 쪽까지 함께 바뀐다.
    c: boot.session.tabs.map((t) => t.context ?? {}),
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
    const raw = JSON.parse(json) as { p?: unknown; t?: unknown; c?: unknown; a?: unknown }
    const contexts = Array.isArray(raw.c) ? raw.c : []
    const session = normalizeSession({
      tabs: Array.isArray(raw.t)
        ? raw.t.map((s, i) => {
            const loc = decodeNavLocation(String(s))
            return loc ? { ...loc, context: normalizeContext(contexts[i]) } : null
          })
        : [],
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
  tabs: readonly (SessionTab | null)[]
  active: number
}): WindowSession | null {
  const tabs = raw.tabs
    .filter((t): t is SessionTab => t !== null)
    .slice(0, MAX_TABS)
    .map((t) => ({
      serviceId: t.serviceId,
      moduleId: t.moduleId,
      viewId: t.viewId,
      context: normalizeContext(t.context)
    }))
  if (tabs.length === 0) return null
  const active = Number.isInteger(raw.active) && raw.active >= 0 && raw.active < tabs.length ? raw.active : 0
  return { tabs, active }
}
