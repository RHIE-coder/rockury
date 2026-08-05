import { useEffect } from 'react'
import type { NavLocation } from '@shared/navLocation'
import { activeTab } from '../nav/tabs'
import { useNav } from '../nav/useNav'

/**
 * 앱 메뉴가 보낸 단축키 명령을 받아 탭을 움직인다(`main/menu.ts`).
 *
 * 왜 화면에서 키를 직접 안 듣나: 메뉴가 쥔 단축키(`⌘W` 등)는 화면의 키 처리보다 **먼저** 먹는다.
 * 두 곳에서 같은 키를 들으면 한 번 누른 것이 두 번 처리되거나, 메뉴 쪽만 먹고 이쪽은 죽은
 * 코드가 된다. 키의 주인을 메뉴 하나로 두고 여기는 시키는 일만 한다.
 */
export function useWindowCommands(): void {
  useEffect(() => {
    const off = window.rockury?.window?.onCommand?.((command) => {
      const nav = useNav.getState()

      if (command === 'new-tab') return nav.openTab()
      if (command === 'new-window') return openInNewWindow()
      if (command === 'next-tab') return nav.stepTab(1)
      if (command === 'prev-tab') return nav.stepTab(-1)

      if (command === 'close-tab') {
        // 한 장뿐이면 브라우저처럼 **창**을 닫는다. 단 마지막 창이면 메인이 안 닫는다 —
        // 키 하나로 앱이 통째로 꺼지는 길은 만들지 않는다(`window:closeUnlessLast`).
        if (nav.tabs.length > 1) nav.closeTab(nav.activeTabId)
        else window.rockury.window.closeUnlessLast()
        return
      }

      const at = command.startsWith('select-tab:') ? Number(command.slice('select-tab:'.length)) : NaN
      if (Number.isInteger(at)) nav.selectTabAt(at)
    })
    return off
  }, [])
}

/**
 * 자리 하나를 창으로 띄운다 — 탭 줄의 "새 창" 단추, 메뉴의 `⌘N`, 탭을 창 밖으로 끌어 놓았을 때.
 * 안 주면 **지금 보는 자리**다: 새 창에 이 창의 탭을 다 옮겨 담으면 "이 화면을 하나 더"가 아니다.
 */
export function openInNewWindow(loc?: NavLocation): void {
  const place = loc ?? activeTab(useNav.getState())
  window.rockury.window.open({
    tabs: [{ serviceId: place.serviceId, moduleId: place.moduleId, viewId: place.viewId }],
    active: 0
  })
}
