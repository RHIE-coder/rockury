import { ipcRenderer } from 'electron'
import { unwrap } from '../envelope'
import type { FeedbackPayloadInput } from '../../shared/devFeedback'
import type { ScopedItem, ScopedKind } from '../../main/store/scopedItems'
import type { NavLocation } from '../../shared/navLocation'
import { decodeWindowBoot, type WindowBoot, type WindowSession } from '../../shared/windowSession'

export type { FeedbackPayload, FeedbackPayloadInput } from '../../shared/devFeedback'
export type { ScopedItem, ScopedKind } from '../../main/store/scopedItems'
export type { WindowBoot, WindowSession } from '../../shared/windowSession'

/**
 * 탭 끌기가 주고받는 좌표는 전부 **이 창 안 기준**이다(`clientX`·`clientY`).
 * 화면 좌표로 펴는 일은 메인이 한다 — 렌더러가 직접 재면 창을 옮긴 뒤 값이 낡는다.
 */
export interface WindowPoint {
  x: number
  y: number
}

/** 탭 줄이 창 안에서 차지한 자리. */
export interface TabStripRect {
  left: number
  top: number
  width: number
  height: number
}

/** 저장 결과 — 어느 폴더에 떨어졌는지와 그림이 함께 저장됐는지. */
export interface SaveDevFeedbackResult {
  folder: string
  saved: string
  hasImage: boolean
}

/** 프로젝트 — 다섯 서비스가 함께 쓰는 범위. 어느 서비스도 소유하지 않아 여기 산다. */
export interface Project {
  id: string
  key: string
  name: string
  description: string
  created_at: string
}

/**
 * 앱 셸(프레임리스 창 제어)과 개발용 도구 — 어느 서비스에도 속하지 않는 공용 크롬이다.
 * 서비스 에이전트는 이 파일을 건드리지 않는다.
 */
export const shellApi = {
  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    /**
     * 창을 닫되 **마지막 창이면 안 닫는다** — `⌘W` 로 마지막 탭을 닫을 때 쓴다.
     * 키 하나로 앱이 통째로 꺼지는 길을 막는 것이고, 판정은 창 수를 아는 메인이 한다.
     */
    closeUnlessLast: (): void => ipcRenderer.send('window:closeUnlessLast'),
    /**
     * 이 창이 무엇을 들고 열렸나 — 탭 목록·활성, 그리고 브라우저 저장소의 주인인지.
     * 메인이 실행 인자로 실어 보낸 것이라 **첫 그림을 그리기 전에** 이미 여기 있다.
     */
    boot: (): WindowBoot | null => decodeWindowBoot(process.argv),
    /** 탭이 생기거나 닫히거나 자리를 옮겼다고 메인에 알린다 — 창 배치의 주인이 메인이다. */
    report: (session: WindowSession): void => ipcRenderer.send('window:session', session),
    /** 자리를 창 하나로 떼어낸다. 안 주면 이 창이 지금 보는 것을 그대로 문다. */
    open: (session?: WindowSession): void => ipcRenderer.send('window:open', session ?? null),
    /** 탭 줄이 창 안 어디인지 알린다 — 다른 창에서 끌어 온 탭을 이 줄이 삼킬지 메인이 가른다. */
    strip: (rect: TabStripRect): void => ipcRenderer.send('window:strip', rect),
    /**
     * 탭을 줄 밖으로 끌어 냈다 — 창을 만들어 커서에 붙이고 그 창 번호를 준다(못 만들면 null).
     * `grab` 은 창 왼위에서 탭을 잡은 지점까지 — 그만큼 물려 놓아야 탭이 커서 밑에 그대로 온다.
     */
    tearOff: (input: {
      loc: NavLocation
      at: WindowPoint
      grab: WindowPoint
    }): Promise<number | null> => ipcRenderer.invoke('window:tearOff', input),
    /** 끌려 나온 창을 커서 따라 옮긴다. */
    dragMove: (input: { id: number; at: WindowPoint; grab: WindowPoint }): void =>
      ipcRenderer.send('window:dragMove', input),
    /** 손을 놓았다 — 다른 창의 탭 줄 위였으면 그 창이 삼켰다는 뜻으로 true. */
    dragEnd: (input: { id: number; at: WindowPoint }): Promise<boolean> =>
      ipcRenderer.invoke('window:dragEnd', input),
    /**
     * 끌려 온 탭이 이 창의 줄 위에 있다 — 떨어질 자리(창 안 가로 좌표)를 준다. 벗어나면 null.
     * 표시만 하는 알림이라 여기서 탭이 늘지는 않는다.
     */
    onDragHover: (fn: (x: number | null) => void): (() => void) => {
      const handler = (_e: unknown, x: number | null): void => fn(x)
      ipcRenderer.on('window:dragHover', handler)
      return () => ipcRenderer.removeListener('window:dragHover', handler)
    },
    /** 끌려 온 탭을 이 창이 삼켰다 — 받은 자리에 끼우면 된다. */
    onAdopt: (fn: (input: { loc: NavLocation; x: number }) => void): (() => void) => {
      const handler = (_e: unknown, input: { loc: NavLocation; x: number }): void => fn(input)
      ipcRenderer.on('window:adopt', handler)
      return () => ipcRenderer.removeListener('window:adopt', handler)
    },
    /** 메뉴 단축키(⌘T·⌘W·⌘1~9 …)가 시키는 일을 받는다. 되부르면 구독이 끊긴다. */
    onCommand: (fn: (command: string) => void): (() => void) => {
      const handler = (_e: unknown, command: string): void => fn(command)
      ipcRenderer.on('window:command', handler)
      return () => ipcRenderer.removeListener('window:command', handler)
    }
  },
  /** 프로젝트 범위 — 셸 셀렉터가 쓰고, 각 서비스 목록이 그 선택을 따른다. */
  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke('shell:listProjects'),
    create: (input: { key: string; name: string; description?: string }): Promise<Project> =>
      ipcRenderer.invoke('shell:createProject', input),
    update: (
      id: string,
      patch: { key?: string; name?: string; description?: string }
    ): Promise<void> => ipcRenderer.invoke('shell:updateProject', id, patch),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('shell:deleteProject', id),
    /** 소속 편집 — 이미 있는 설계·접속·명세·설계본을 프로젝트로 나눈다. */
    listItems: (): Promise<ScopedItem[]> => ipcRenderer.invoke('shell:listScopedItems'),
    setItemProject: (kind: ScopedKind, id: string, projectId: string | null): Promise<void> =>
      ipcRenderer.invoke('shell:setItemProject', kind, id, projectId)
  },
  /** 개발용 화면 피드백 — 배포본에서는 메인이 거절한다. */
  devFeedback: {
    save: (payload: FeedbackPayloadInput): Promise<SaveDevFeedbackResult> =>
      unwrap(ipcRenderer.invoke('shell:saveDevFeedback', payload))
  }
}
