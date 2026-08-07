/**
 * 이 창이 **무엇을 들고 열렸나**, 그리고 브라우저 저장소를 쓸 수 있는 창인가.
 *
 * 창은 여러 개 뜨지만 브라우저 저장소(localStorage)는 창끼리 **같은 것 하나**다. 그대로 두면
 * 두 창이 "마지막에 본 자리 기억·프로젝트 범위"를 서로 덮어써서, 앱을 껐다 켰을 때 어느 창의
 * 상태가 남을지가 마지막으로 움직인 창에 따라 달라진다.
 *
 * 그래서 **저장소의 주인은 첫 창 하나**다. 떼어낸 창은 읽기만 한다 — 읽기를 막지 않는 이유는
 * 첫 화면 때문이다. 떼어낸 창도 그 기억을 물려받고 시작해야 "이 화면을 하나 더"가 된다.
 *
 * **탭 목록과 그 탭들이 고른 대상은 여기 안 든다 — 메인 프로세스가 주인이다**
 * (`main/windows.ts`). 창 밖에 두어야 창끼리 안 부딪히고, 껐다 켤 때 창 배치까지 되살아난다.
 * 대상이 이리로 옮겨 온 것은 2026-08-07 이다(그전엔 창에 하나였다 · `nav/tabs.ts` 머리말).
 */

import type { StateStorage } from 'zustand/middleware'
import type { WindowBoot, WindowSession } from '@shared/windowSession'

/** 창이 열릴 때 메인이 실어 보낸 것. 브라우저가 없는 곳(단위 테스트)에서는 null. */
function boot(): WindowBoot | null {
  if (typeof window === 'undefined') return null
  return window.rockury?.window?.boot?.() ?? null
}

/** 이 창이 브라우저 저장소의 주인인가 — 아무것도 못 받았으면(개발 중 새로고침 등) 주인으로 본다. */
export function isPrimaryWindow(): boolean {
  return boot()?.primary ?? true
}

/** 열자마자 들 탭들. 못 받았으면 null — 부르는 쪽이 기본 한 장을 세운다. */
export function initialSession(): WindowSession | null {
  return boot()?.session ?? null
}

/**
 * 읽기 전용 저장소 — 있는 값은 그대로 읽고, 쓰기는 삼킨다.
 * (zustand persist 는 읽기와 쓰기를 같은 저장소로 하므로, 쓰기만 막으려면 이 껍데기가 필요하다.)
 */
export function readOnlyStorage(inner: StateStorage): StateStorage {
  return {
    getItem: (name) => inner.getItem(name),
    setItem: () => {},
    removeItem: () => {}
  }
}

/**
 * 이 창이 쓸 저장소. 첫 창은 그대로, 떼어낸 창은 읽기 전용.
 * 셸의 저장 스토어(`nav` 의 대상 선택·자리 기억, `project` 범위)가 모두 이걸 거친다.
 */
export function windowStorage(): StateStorage {
  const local = localStorage as unknown as StateStorage
  return isPrimaryWindow() ? local : readOnlyStorage(local)
}
