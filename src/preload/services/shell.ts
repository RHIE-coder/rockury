import { ipcRenderer } from 'electron'
import { unwrap } from '../envelope'
import type { FeedbackPayloadInput } from '../../shared/devFeedback'
import type { ScopedItem, ScopedKind } from '../../main/store/scopedItems'

export type { FeedbackPayload, FeedbackPayloadInput } from '../../shared/devFeedback'
export type { ScopedItem, ScopedKind } from '../../main/store/scopedItems'

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
    close: (): void => ipcRenderer.send('window:close')
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
