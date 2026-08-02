import { ipcRenderer } from 'electron'
import { unwrap } from '../envelope'
import type { FeedbackPayloadInput } from '../../shared/devFeedback'

export type { FeedbackPayload, FeedbackPayloadInput } from '../../shared/devFeedback'

/** 저장 결과 — 어느 폴더에 떨어졌는지와 그림이 함께 저장됐는지. */
export interface SaveDevFeedbackResult {
  folder: string
  saved: string
  hasImage: boolean
}

/**
 * 앱 셸(프레임리스 창 제어)과 개발용 도구 — 어느 서비스에도 속하지 않는 공용 크롬이다.
 * 서비스 에이전트는 이 파일을 건드리지 않는다.
 */
export const shellApi = {
  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
    close: (): void => ipcRenderer.send('window:close')
  },
  /** 개발용 화면 피드백 — 배포본에서는 메인이 거절한다. */
  devFeedback: {
    save: (payload: FeedbackPayloadInput): Promise<SaveDevFeedbackResult> =>
      unwrap(ipcRenderer.invoke('shell:saveDevFeedback', payload))
  }
}
